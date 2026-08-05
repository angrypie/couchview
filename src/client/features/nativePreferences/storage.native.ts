import AsyncStorage from "@react-native-async-storage/async-storage";

import { type NativePreferences, normalizeNativePreferences } from "./types.ts";

const PREFERENCES_KEY = "couchview.native.preferences.v1";

export const nativePreferencesStorage = {
	async load(): Promise<NativePreferences> {
		const serialized = await AsyncStorage.getItem(PREFERENCES_KEY);
		if (!serialized) return normalizeNativePreferences(null);
		try {
			return normalizeNativePreferences(JSON.parse(serialized));
		} catch {
			return normalizeNativePreferences(null);
		}
	},
	save(preferences: NativePreferences): Promise<void> {
		return AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
	},
};
