import {
	DEFAULT_THEME_PREFERENCE,
	normalizeThemePreference,
	type ThemePreference,
} from "../../../shared/theme.ts";

export interface NativePreferences {
	themePreference: ThemePreference;
}

export const DEFAULT_NATIVE_PREFERENCES: NativePreferences = {
	themePreference: DEFAULT_THEME_PREFERENCE,
};

export function normalizeNativePreferences(value: unknown): NativePreferences {
	if (!value || typeof value !== "object") return DEFAULT_NATIVE_PREFERENCES;
	const candidate = value as Partial<NativePreferences>;
	return {
		themePreference: normalizeThemePreference(candidate.themePreference),
	};
}
