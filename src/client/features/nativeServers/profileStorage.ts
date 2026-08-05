import type { NativeServerProfile } from "./types.ts";

const PROFILES_KEY = "couchview.native.profiles.v1";
const ACTIVE_PROFILE_KEY = "couchview.native.active-profile.v1";

function storage(): Storage | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

export const nativeProfileStorage = {
	async load(): Promise<{ profiles: NativeServerProfile[]; activeProfileId: string | null }> {
		const target = storage();
		if (!target) return { profiles: [], activeProfileId: null };
		try {
			const parsed: unknown = JSON.parse(target.getItem(PROFILES_KEY) ?? "[]");
			return {
				profiles: Array.isArray(parsed) ? (parsed as NativeServerProfile[]) : [],
				activeProfileId: target.getItem(ACTIVE_PROFILE_KEY),
			};
		} catch {
			return { profiles: [], activeProfileId: null };
		}
	},
	async save(
		profiles: readonly NativeServerProfile[],
		activeProfileId: string | null,
	): Promise<void> {
		const target = storage();
		if (!target) return;
		target.setItem(PROFILES_KEY, JSON.stringify(profiles));
		if (activeProfileId) target.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
		else target.removeItem(ACTIVE_PROFILE_KEY);
	},
};
