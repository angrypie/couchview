import {
	DEFAULT_THEME_PREFERENCE,
	normalizeThemePreference,
	type ThemePreference,
} from "../../../shared/theme.ts";

export interface NativePreferences {
	diffFontSize: number;
	terminalFontSize: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	themePreference: ThemePreference;
}

export const DEFAULT_NATIVE_PREFERENCES: NativePreferences = {
	diffFontSize: 13,
	terminalFontSize: 13,
	lineNumbersVisible: true,
	lineWrapEnabled: false,
	themePreference: DEFAULT_THEME_PREFERENCE,
};

function boundedFontSize(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.round(Math.min(20, Math.max(10, value)))
		: fallback;
}

export function normalizeNativePreferences(value: unknown): NativePreferences {
	if (!value || typeof value !== "object") return DEFAULT_NATIVE_PREFERENCES;
	const candidate = value as Partial<NativePreferences>;
	return {
		diffFontSize: boundedFontSize(candidate.diffFontSize, DEFAULT_NATIVE_PREFERENCES.diffFontSize),
		terminalFontSize: boundedFontSize(
			candidate.terminalFontSize,
			DEFAULT_NATIVE_PREFERENCES.terminalFontSize,
		),
		lineNumbersVisible:
			typeof candidate.lineNumbersVisible === "boolean"
				? candidate.lineNumbersVisible
				: DEFAULT_NATIVE_PREFERENCES.lineNumbersVisible,
		lineWrapEnabled:
			typeof candidate.lineWrapEnabled === "boolean"
				? candidate.lineWrapEnabled
				: DEFAULT_NATIVE_PREFERENCES.lineWrapEnabled,
		themePreference: normalizeThemePreference(candidate.themePreference),
	};
}
