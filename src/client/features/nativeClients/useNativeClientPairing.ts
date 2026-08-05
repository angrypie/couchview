import { useCallback, useEffect, useRef, useState } from "react";

import type { NativeClientDevice, NativeClientPairingResponse } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { messageOf } from "../../lib/failures.ts";

interface UseNativeClientPairingOptions {
	active: boolean;
	csrfToken: string;
	onNotice(message: string): void;
}

interface PendingPairing {
	payload: NativeClientPairingResponse;
	existingDeviceIds: string[];
}

export function useNativeClientPairing({
	active,
	csrfToken,
	onNotice,
}: UseNativeClientPairingOptions) {
	const [devices, setDevices] = useState<NativeClientDevice[]>([]);
	const [pairing, setPairing] = useState<PendingPairing | null>(null);
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [error, setError] = useState("");
	const mutationRequest = useRef<AbortController | null>(null);

	const refresh = useCallback(async (signal?: AbortSignal) => {
		setLoading(true);
		try {
			const response = await api.nativeClients(signal);
			const activeDevices = response.devices.filter((device) => !device.revokedAt);
			setDevices(activeDevices);
			setError("");
			return activeDevices;
		} catch (nextError) {
			if (!signal?.aborted) setError(messageOf(nextError));
			return null;
		} finally {
			if (!signal?.aborted) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!active) return;
		const controller = new AbortController();
		void refresh(controller.signal);
		return () => controller.abort();
	}, [active, refresh]);

	useEffect(() => {
		if (!active || !pairing) return;
		const interval = window.setInterval(() => {
			if (Date.now() >= new Date(pairing.payload.expiresAt).getTime()) {
				setPairing(null);
				setError("That app pairing expired. Generate a new link to continue.");
				return;
			}
			void refresh().then((nextDevices) => {
				if (nextDevices?.some((device) => !pairing.existingDeviceIds.includes(device.id))) {
					setPairing(null);
					onNotice("Couchview app paired");
				}
			});
		}, 2_000);
		return () => window.clearInterval(interval);
	}, [active, onNotice, pairing, refresh]);

	useEffect(
		() => () => {
			mutationRequest.current?.abort();
		},
		[],
	);

	const createPairing = useCallback(async () => {
		if (creating) return;
		const controller = new AbortController();
		mutationRequest.current?.abort();
		mutationRequest.current = controller;
		setCreating(true);
		setError("");
		try {
			const payload = await api.createNativeClientPairing(csrfToken, controller.signal);
			if (controller.signal.aborted) return;
			setPairing({ payload, existingDeviceIds: devices.map((device) => device.id) });
			onNotice("App pairing link created");
		} catch (nextError) {
			if (!controller.signal.aborted) setError(messageOf(nextError));
		} finally {
			if (mutationRequest.current === controller) {
				mutationRequest.current = null;
				setCreating(false);
			}
		}
	}, [creating, csrfToken, devices, onNotice]);

	const revoke = useCallback(
		async (device: NativeClientDevice) => {
			if (revokingId) return;
			const controller = new AbortController();
			mutationRequest.current?.abort();
			mutationRequest.current = controller;
			setRevokingId(device.id);
			setError("");
			try {
				await api.revokeNativeClient(device.id, csrfToken, controller.signal);
				if (controller.signal.aborted) return;
				setDevices((current) => current.filter((candidate) => candidate.id !== device.id));
				onNotice(`Revoked ${device.label}`);
			} catch (nextError) {
				if (!controller.signal.aborted) setError(messageOf(nextError));
			} finally {
				if (mutationRequest.current === controller) {
					mutationRequest.current = null;
					setRevokingId(null);
				}
			}
		},
		[csrfToken, onNotice, revokingId],
	);

	const copyPairingLink = useCallback(async () => {
		if (!pairing) return;
		try {
			await copyToClipboard(pairing.payload.deepLink);
			onNotice("App pairing link copied");
		} catch (nextError) {
			setError(messageOf(nextError));
		}
	}, [onNotice, pairing]);

	return {
		copyPairingLink,
		createPairing,
		creating,
		devices,
		error,
		loading,
		pairing: pairing?.payload ?? null,
		refresh,
		revoke,
		revokingId,
	};
}
