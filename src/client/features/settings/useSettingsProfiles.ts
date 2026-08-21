import { useAtom, useAtomValue } from "jotai/react";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	BootstrapResponse,
	SettingsProfile,
	SettingsProfileData,
} from "../../../shared/contracts.ts";
import { DEFAULT_SETTINGS_PROFILE_ID, parseSettingsProfileData } from "../../../shared/settings.ts";
import { ApiError, api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";
import { useHydratePersistedAtom } from "../../lib/store/persistedAtom.ts";
import { fallbackSettingsProfile, settingsProfileSelectionState } from "./profileState.ts";

interface UseSettingsProfilesOptions {
	active: boolean;
	bootstrap: BootstrapResponse | null;
	setBootstrap: Dispatch<SetStateAction<BootstrapResponse | null>>;
	showToast: (message: string) => void;
}

export function useSettingsProfiles({
	active,
	bootstrap,
	setBootstrap,
	showToast,
}: UseSettingsProfilesOptions) {
	const [profiles, setProfiles] = useState<SettingsProfile[]>(() => [fallbackSettingsProfile()]);
	const [activeProfileId, setActiveProfileId] = useAtom(settingsProfileSelectionState.valueAtom);
	const selectionHydrated = useAtomValue(settingsProfileSelectionState.hydratedAtom);
	const [busy, setBusy] = useState(false);
	const csrfToken = bootstrap?.csrfToken;
	const profilesRef = useRef(profiles);
	profilesRef.current = profiles;
	const activeProfileIdRef = useRef(activeProfileId);
	activeProfileIdRef.current = activeProfileId;
	const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
	useHydratePersistedAtom(settingsProfileSelectionState);

	const activeProfile = useMemo(
		() =>
			profiles.find((profile) => profile.id === activeProfileId) ??
			profiles.find((profile) => profile.id === DEFAULT_SETTINGS_PROFILE_ID) ??
			profiles[0] ??
			fallbackSettingsProfile(),
		[activeProfileId, profiles],
	);

	const applyProfiles = useCallback(
		(nextProfiles?: SettingsProfile[]) => {
			const available =
				nextProfiles && nextProfiles.length > 0 ? nextProfiles : [fallbackSettingsProfile()];
			const needsDefaults = available.some((profile) => !profile.data.codex || !profile.data.voice);
			const next = needsDefaults
				? available.map((profile) => ({
						...profile,
						data: parseSettingsProfileData(profile.data),
					}))
				: available;
			profilesRef.current = next;
			setProfiles(next);
			setBootstrap((current) => (current ? { ...current, settingsProfiles: next } : current));
			if (!selectionHydrated) return;
			const selectedId = activeProfileIdRef.current;
			if (next.some((profile) => profile.id === selectedId)) return;
			const fallback =
				next.find((profile) => profile.id === DEFAULT_SETTINGS_PROFILE_ID) ?? next[0]!;
			activeProfileIdRef.current = fallback.id;
			void setActiveProfileId(fallback.id).catch(() => undefined);
		},
		[selectionHydrated, setActiveProfileId, setBootstrap],
	);

	const replaceProfile = useCallback(
		(profile: SettingsProfile) => {
			const current = profilesRef.current;
			const next = current.some((item) => item.id === profile.id)
				? current.map((item) => (item.id === profile.id ? profile : item))
				: [...current, profile];
			applyProfiles(next);
		},
		[applyProfiles],
	);

	const selectProfile = useCallback(
		(profileId: string) => {
			const selected =
				profilesRef.current.find((profile) => profile.id === profileId) ??
				profilesRef.current.find((profile) => profile.id === DEFAULT_SETTINGS_PROFILE_ID);
			if (!selected) return;
			activeProfileIdRef.current = selected.id;
			void setActiveProfileId(selected.id).catch(() => undefined);
		},
		[setActiveProfileId],
	);

	const refreshProfiles = useCallback(async () => {
		const response = await api.settingsProfiles();
		applyProfiles(response.profiles);
		return response.profiles;
	}, [applyProfiles]);

	const saveProfile = useCallback(
		async (
			profileId: string,
			name: string,
			data: SettingsProfileData,
			expectedRevision: number,
		) => {
			if (!csrfToken || busy) return;
			setBusy(true);
			try {
				await mutationQueueRef.current.catch(() => undefined);
				const response = await api.updateSettingsProfile(
					profileId,
					{ name, data, expectedRevision },
					csrfToken,
				);
				replaceProfile(response.profile);
				showToast(`Saved ${response.profile.name}`);
			} catch (error) {
				if (error instanceof ApiError && error.code === "stale_settings_profile") {
					await refreshProfiles().catch(() => undefined);
				}
				throw error;
			} finally {
				setBusy(false);
			}
		},
		[busy, csrfToken, refreshProfiles, replaceProfile, showToast],
	);

	const createProfile = useCallback(
		async (name: string, sourceProfileId?: string) => {
			if (!csrfToken || busy) return;
			setBusy(true);
			try {
				const response = await api.createSettingsProfile(
					{ name, ...(sourceProfileId ? { sourceProfileId } : {}) },
					csrfToken,
				);
				replaceProfile(response.profile);
				selectProfile(response.profile.id);
				showToast(`Created ${response.profile.name}`);
			} catch (error) {
				showToast(messageOf(error));
				throw error;
			} finally {
				setBusy(false);
			}
		},
		[busy, csrfToken, replaceProfile, selectProfile, showToast],
	);

	const deleteProfile = useCallback(
		async (profileId: string) => {
			if (!csrfToken || busy) return;
			setBusy(true);
			try {
				await api.deleteSettingsProfile(profileId, csrfToken);
				applyProfiles(profilesRef.current.filter((profile) => profile.id !== profileId));
				selectProfile(DEFAULT_SETTINGS_PROFILE_ID);
				showToast("Deleted settings profile");
			} catch (error) {
				showToast(messageOf(error));
				throw error;
			} finally {
				setBusy(false);
			}
		},
		[applyProfiles, busy, csrfToken, selectProfile, showToast],
	);

	const updateActiveProfileData = useCallback(
		(update: (current: SettingsProfileData) => SettingsProfileData) => {
			const profileId = activeProfileIdRef.current;
			const current = profilesRef.current.find((profile) => profile.id === profileId);
			if (!current || !csrfToken) return;
			const data = update(structuredClone(current.data));
			replaceProfile({ ...current, data });
			mutationQueueRef.current = mutationQueueRef.current
				.catch(() => undefined)
				.then(async () => {
					const latest = profilesRef.current.find((profile) => profile.id === profileId);
					if (!latest) return;
					const sentData = structuredClone(latest.data);
					const response = await api.updateSettingsProfile(
						profileId,
						{ name: latest.name, data: sentData, expectedRevision: latest.revision },
						csrfToken,
					);
					const after = profilesRef.current.find((profile) => profile.id === profileId);
					const hasNewerData = after && JSON.stringify(after.data) !== JSON.stringify(sentData);
					replaceProfile(
						hasNewerData ? { ...response.profile, data: after.data } : response.profile,
					);
				})
				.catch(async (error) => {
					await refreshProfiles().catch(() => undefined);
					showToast(messageOf(error));
				});
		},
		[csrfToken, refreshProfiles, replaceProfile, showToast],
	);

	useEffect(() => {
		if (bootstrap?.settingsProfiles) applyProfiles(bootstrap.settingsProfiles);
	}, [applyProfiles, bootstrap?.settingsProfiles]);

	useEffect(() => {
		if (!active || !csrfToken) return;
		let cancelled = false;
		void mutationQueueRef.current
			.catch(() => undefined)
			.then(async () => {
				if (!cancelled) await refreshProfiles();
			})
			.catch((error) => showToast(messageOf(error)));
		return () => {
			cancelled = true;
		};
	}, [active, csrfToken, refreshProfiles, showToast]);

	return {
		activeProfile,
		applyProfiles,
		busy,
		createProfile,
		deleteProfile,
		profiles,
		saveProfile,
		selectionHydrated,
		selectProfile,
		updateActiveProfileData,
	};
}
