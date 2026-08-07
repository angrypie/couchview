const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";
export const THEME_PREFERENCE_ATTRIBUTE = "data-theme-preference";
export const THEME_PREFERENCE_STORAGE_KEY = "couchview:theme-preference:v1";
export const THEME_METADATA_COLORS: Record<ResolvedTheme, string> = {
	light: "#f6f8fb",
	dark: "#101317",
};

export function normalizeThemePreference(value: unknown): ThemePreference {
	return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value)
		? (value as ThemePreference)
		: DEFAULT_THEME_PREFERENCE;
}
