import AsyncStorage from "@react-native-async-storage/async-storage";

import type { NativeServerProfile } from "./types.ts";

const PROFILES_KEY = "couchview.native.profiles.v1";
const ACTIVE_PROFILE_KEY = "couchview.native.active-profile.v1";

export const nativeProfileStorage = {
	async load(): Promise<{ profiles: NativeServerProfile[]; activeProfileId: string | null }> {
		const entries = await AsyncStorage.multiGet([PROFILES_KEY, ACTIVE_PROFILE_KEY]);
		const profilesJson = entries.find(([key]) => key === PROFILES_KEY)?.[1] ?? null;
		const activeProfileId = entries.find(([key]) => key === ACTIVE_PROFILE_KEY)?.[1] ?? null;
		try {
			const parsed: unknown = JSON.parse(profilesJson ?? "[]");
			return {
				profiles: Array.isArray(parsed) ? (parsed as NativeServerProfile[]) : [],
				activeProfileId,
			};
		} catch {
			return { profiles: [], activeProfileId: null };
		}
	},
	async save(
		profiles: readonly NativeServerProfile[],
		activeProfileId: string | null,
	): Promise<void> {
		await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
		if (activeProfileId) await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
		else await AsyncStorage.removeItem(ACTIVE_PROFILE_KEY);
	},
};
