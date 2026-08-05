import { type NativePreferences, normalizeNativePreferences } from "./types.ts";

const PREFERENCES_KEY = "couchview.native.preferences.v1";

function storage(): Storage | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

export const nativePreferencesStorage = {
	async load(): Promise<NativePreferences> {
		const serialized = storage()?.getItem(PREFERENCES_KEY) ?? null;
		if (!serialized) return normalizeNativePreferences(null);
		try {
			return normalizeNativePreferences(JSON.parse(serialized));
		} catch {
			return normalizeNativePreferences(null);
		}
	},
	async save(preferences: NativePreferences): Promise<void> {
		storage()?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
	},
};
