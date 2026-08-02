import { describe, expect, test } from "bun:test";

import { shouldApplyPwaUpdate, shouldShowPwaUpdatePrompt } from "./pwaUpdatePolicy.ts";

describe("PWA update policy", () => {
	test("applies safe updates during launch or after the app is backgrounded", () => {
		expect(shouldApplyPwaUpdate(true, "visible", 1_000)).toBe(true);
		expect(shouldApplyPwaUpdate(true, "hidden", 60_000)).toBe(true);
	});

	test("defers active-session updates and never reloads over unsafe work", () => {
		expect(shouldApplyPwaUpdate(true, "visible", 60_000)).toBe(false);
		expect(shouldApplyPwaUpdate(false, "visible", 1_000)).toBe(false);
		expect(shouldApplyPwaUpdate(false, "hidden", 60_000)).toBe(false);
	});

	test("shows the update prompt only when reloading could discard work", () => {
		expect(shouldShowPwaUpdatePrompt(true, false)).toBe(true);
		expect(shouldShowPwaUpdatePrompt(true, true)).toBe(false);
		expect(shouldShowPwaUpdatePrompt(false, false)).toBe(false);
	});
});
