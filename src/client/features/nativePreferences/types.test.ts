import { expect, test } from "bun:test";

import { DEFAULT_NATIVE_PREFERENCES, normalizeNativePreferences } from "./types.ts";

test("native preferences preserve valid choices and bound stored font sizes", () => {
	expect(normalizeNativePreferences(null)).toEqual(DEFAULT_NATIVE_PREFERENCES);
	expect(
		normalizeNativePreferences({
			diffFontSize: 100,
			terminalFontSize: 7.4,
			lineNumbersVisible: false,
			lineWrapEnabled: true,
			themePreference: "light",
		}),
	).toEqual({
		diffFontSize: 20,
		terminalFontSize: 10,
		lineNumbersVisible: false,
		lineWrapEnabled: true,
		themePreference: "light",
	});
});

test("native preferences default invalid and legacy theme choices to system", () => {
	expect(normalizeNativePreferences({ themePreference: "sepia" }).themePreference).toBe("system");
	expect(normalizeNativePreferences({ lineNumbersVisible: false }).themePreference).toBe("system");
});
