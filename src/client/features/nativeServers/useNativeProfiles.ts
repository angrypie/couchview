import { useCallback, useEffect, useState } from "react";
import { nativeCredentialStore } from "./credentialStore";
import { claimNativePairing } from "./nativeApi.ts";
import { parseNativePairingLink } from "./pairingLink.ts";
import { nativeProfileStorage } from "./profileStorage";
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
	const [profiles, setProfiles] = useState<NativeServerProfile[]>([]);
	const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
	const [hydrated, setHydrated] = useState(false);
	const [claiming, setClaiming] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		void nativeProfileStorage.load().then(
			(stored) => {
				if (!active) return;
				setProfiles(stored.profiles);
				setActiveProfileId(
					stored.profiles.some(({ id }) => id === stored.activeProfileId)
						? stored.activeProfileId
						: (stored.profiles[0]?.id ?? null),
				);
				setHydrated(true);
			},
			(loadError) => {
				if (!active) return;
				setError(errorMessage(loadError));
				setHydrated(true);
			},
		);
		return () => {
			active = false;
		};
	}, []);

	const save = useCallback(
		async (nextProfiles: NativeServerProfile[], nextActiveProfileId: string | null) => {
			setProfiles(nextProfiles);
			setActiveProfileId(nextActiveProfileId);
			await nativeProfileStorage.save(nextProfiles, nextActiveProfileId);
		},
		[],
	);

	const activate = useCallback(
		async (profileId: string) => {
			if (!profiles.some(({ id }) => id === profileId)) return;
			setError(null);
			try {
				await save(profiles, profileId);
			} catch (activateError) {
				setError(errorMessage(activateError));
			}
		},
		[profiles, save],
	);

	const claim = useCallback(
		async (link: string, deviceLabel: string) => {
			setClaiming(true);
			setError(null);
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
				setError(errorMessage(claimError));
				throw claimError;
			} finally {
				setClaiming(false);
			}
		},
		[profiles, save],
	);

	const remove = useCallback(
		async (profileId: string) => {
			const removed = profiles.find(({ id }) => id === profileId);
			if (!removed) return;
			setError(null);
			try {
				await nativeCredentialStore.remove(removed.serverId);
				const next = profiles.filter(({ id }) => id !== profileId);
				const nextActive = activeProfileId === profileId ? (next[0]?.id ?? null) : activeProfileId;
				await save(next, nextActive);
			} catch (removeError) {
				setError(errorMessage(removeError));
			}
		},
		[activeProfileId, profiles, save],
	);

	const update = useCallback(
		async (profile: NativeServerProfile) => {
			const next = profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate));
			try {
				await save(next, activeProfileId);
			} catch (updateError) {
				setError(errorMessage(updateError));
			}
		},
		[activeProfileId, profiles, save],
	);

	return {
		hydrated,
		profiles,
		activeProfile: profiles.find(({ id }) => id === activeProfileId) ?? null,
		error,
		claiming,
		activate,
		claim,
		remove,
		update,
	};
}
