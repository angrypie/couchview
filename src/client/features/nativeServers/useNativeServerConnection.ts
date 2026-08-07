import { useEffect, useRef, useState } from "react";

import { nativeCredentialStore } from "./credentialStore";
import { fetchNativeServerInstance, NativeApiError } from "./nativeApi.ts";
import type { NativeServerProfile } from "./types.ts";

type NativeServerConnectionPhase = "idle" | "loading" | "ready" | "error";

export interface NativeServerConnectionController {
	phase: NativeServerConnectionPhase;
	error: string | null;
	nativeClientToken: string | null;
	retry(): void;
}

interface NativeServerConnectionState {
	key: string | null;
	phase: NativeServerConnectionPhase;
	error: string | null;
	nativeClientToken: string | null;
}

function connectionErrorMessage(error: unknown): string {
	if (error instanceof NativeApiError && error.code === "native_client_unauthorized") {
		return "This device credential was revoked. Remove this server and pair it again.";
	}
	return error instanceof Error ? error.message : "Could not reach this Couchview server";
}

export function useNativeServerConnection(
	profile: NativeServerProfile | null,
	updateProfile: (profile: NativeServerProfile) => Promise<void>,
): NativeServerConnectionController {
	const [retryRevision, setRetryRevision] = useState(0);
	const profileRef = useRef(profile);
	const updateProfileRef = useRef(updateProfile);
	profileRef.current = profile;
	updateProfileRef.current = updateProfile;
	const connectionKey = profile
		? `${profile.id}\0${profile.baseUrl}\0${profile.serverId}\0${retryRevision}`
		: null;
	const [state, setState] = useState<NativeServerConnectionState>({
		key: null,
		phase: "idle",
		error: null,
		nativeClientToken: null,
	});

	useEffect(() => {
		const controller = new AbortController();
		const selectedProfile = profileRef.current;
		if (!selectedProfile) {
			setState({ key: null, phase: "idle", error: null, nativeClientToken: null });
			return () => controller.abort();
		}
		setState({ key: connectionKey, phase: "loading", error: null, nativeClientToken: null });
		void (async () => {
			const token = await nativeCredentialStore.get(selectedProfile.serverId);
			if (!token) throw new Error("This server profile has no device credential; pair it again");
			const instance = await fetchNativeServerInstance(
				selectedProfile.baseUrl,
				token,
				controller.signal,
			);
			if (instance.serverId !== selectedProfile.serverId) {
				throw new Error("The server at this address has a different Couchview identity");
			}
			if (controller.signal.aborted) return;
			setState({ key: connectionKey, phase: "ready", error: null, nativeClientToken: token });
			if (selectedProfile.lastInstanceId !== instance.instanceId) {
				await updateProfileRef.current({
					...selectedProfile,
					lastInstanceId: instance.instanceId,
					updatedAt: new Date().toISOString(),
				});
			}
		})().catch((connectionError) => {
			if (controller.signal.aborted) return;
			setState({
				key: connectionKey,
				phase: "error",
				error: connectionErrorMessage(connectionError),
				nativeClientToken: null,
			});
		});
		return () => controller.abort();
	}, [connectionKey]);

	const current =
		state.key === connectionKey
			? state
			: {
					key: connectionKey,
					phase: profile ? ("loading" as const) : ("idle" as const),
					error: null,
					nativeClientToken: null,
				};

	return {
		phase: current.phase,
		error: current.error,
		nativeClientToken: current.nativeClientToken,
		retry: () => setRetryRevision((current) => current + 1),
	};
}
