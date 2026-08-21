import { useAtom, useAtomValue } from "jotai/react";
import { useCallback, useState } from "react";

import { useHydratePersistedAtom } from "../../lib/store/persistedAtom.ts";
import { nativeCredentialStore } from "./credentialStore";
import { claimNativePairing } from "./nativeApi.ts";
import { parseNativePairingLink } from "./pairingLink.ts";
import { nativeProfilesState } from "./profileState.ts";
import type { NativeServerProfile } from "./types.ts";

export interface NativeProfilesController {
	hydrated: boolean;
	profiles: NativeServerProfile[];
	activeProfile: NativeServerProfile | null;
	error: string | null;
	claiming: boolean;
	activate(profileId: string): Promise<void>;
	claim(link: string, deviceLabel: string): Promise<void>;
	remove(profileId: string): Promise<void>;
	update(profile: NativeServerProfile): Promise<void>;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Could not update Couchview servers";
}

export function useNativeProfiles(): NativeProfilesController {
	const [metadata, setMetadata] = useAtom(nativeProfilesState.valueAtom);
	const hydrated = useAtomValue(nativeProfilesState.hydratedAtom);
	const persistenceError = useAtomValue(nativeProfilesState.errorAtom);
	const [claiming, setClaiming] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const { activeProfileId, profiles } = metadata;
	useHydratePersistedAtom(nativeProfilesState);

	const save = useCallback(
		async (nextProfiles: NativeServerProfile[], nextActiveProfileId: string | null) => {
			await setMetadata({ profiles: nextProfiles, activeProfileId: nextActiveProfileId });
		},
		[setMetadata],
	);

	const activate = useCallback(
		async (profileId: string) => {
			if (!hydrated || !profiles.some(({ id }) => id === profileId)) return;
			setActionError(null);
			try {
				await save(profiles, profileId);
			} catch (activateError) {
				setActionError(errorMessage(activateError));
			}
		},
		[hydrated, profiles, save],
	);

	const claim = useCallback(
		async (link: string, deviceLabel: string) => {
			if (!hydrated) throw new Error("Server profiles are still loading");
			setClaiming(true);
			setActionError(null);
			try {
				const pairing = parseNativePairingLink(link);
				const claimed = await claimNativePairing(pairing.baseUrl, {
					code: pairing.code,
					deviceLabel,
				});
				if (claimed.serverId !== pairing.serverId) {
					throw new Error("The server identity changed while pairing; create a new pairing link");
				}
				await nativeCredentialStore.set(pairing.serverId, claimed.token);
				const existing = profiles.find(({ serverId }) => serverId === pairing.serverId);
				const now = new Date().toISOString();
				const profile: NativeServerProfile = {
					id: pairing.serverId,
					name: existing?.name ?? new URL(pairing.baseUrl).host,
					baseUrl: pairing.baseUrl,
					serverId: pairing.serverId,
					lastInstanceId: existing?.lastInstanceId ?? null,
					lastRepositoryId: existing?.lastRepositoryId ?? null,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
				};
				const next = [...profiles.filter(({ serverId }) => serverId !== pairing.serverId), profile];
				try {
					await save(next, profile.id);
				} catch (saveError) {
					await nativeCredentialStore.remove(pairing.serverId);
					throw saveError;
				}
			} catch (claimError) {
				setActionError(errorMessage(claimError));
				throw claimError;
			} finally {
				setClaiming(false);
			}
		},
		[hydrated, profiles, save],
	);

	const remove = useCallback(
		async (profileId: string) => {
			if (!hydrated) return;
			const removed = profiles.find(({ id }) => id === profileId);
			if (!removed) return;
			setActionError(null);
			try {
				await nativeCredentialStore.remove(removed.serverId);
				const next = profiles.filter(({ id }) => id !== profileId);
				const nextActive = activeProfileId === profileId ? (next[0]?.id ?? null) : activeProfileId;
				await save(next, nextActive);
			} catch (removeError) {
				setActionError(errorMessage(removeError));
			}
		},
		[activeProfileId, hydrated, profiles, save],
	);

	const update = useCallback(
		async (profile: NativeServerProfile) => {
			if (!hydrated) return;
			const next = profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate));
			try {
				await save(next, activeProfileId);
			} catch (updateError) {
				setActionError(errorMessage(updateError));
			}
		},
		[activeProfileId, hydrated, profiles, save],
	);

	return {
		hydrated,
		profiles,
		activeProfile: profiles.find(({ id }) => id === activeProfileId) ?? null,
		error: actionError ?? (persistenceError ? errorMessage(persistenceError) : null),
		claiming,
		activate,
		claim,
		remove,
		update,
	};
}
