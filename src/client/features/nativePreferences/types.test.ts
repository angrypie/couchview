import { expect, test } from "bun:test";

import { DEFAULT_NATIVE_PREFERENCES, normalizeNativePreferences } from "./types.ts";

test("native preferences preserve a valid theme choice", () => {
	expect(normalizeNativePreferences(null)).toEqual(DEFAULT_NATIVE_PREFERENCES);
	expect(normalizeNativePreferences({ themePreference: "light" })).toEqual({
		themePreference: "light",
	});
});

test("native preferences default invalid theme choices to system", () => {
	expect(normalizeNativePreferences({ themePreference: "sepia" }).themePreference).toBe("system");
});
