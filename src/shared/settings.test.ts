import { describe, expect, test } from "bun:test";

import {
	COMMAND_IDS,
	createDefaultSettingsProfileData,
	DEFAULT_KEYBINDINGS,
	effectiveKeybindings,
	keybindingConflicts,
	normalizeSettingsProfileName,
	paletteShortcutHasRequiredModifier,
	parseSettingsProfileData,
	parseShortcutSequence,
	type ShortcutSequence,
	shortcutSequenceKey,
} from "./settings.ts";

const keys = (sequence: ShortcutSequence | null) =>
	sequence?.map((stroke) => stroke.key).join(" ") ?? null;

describe("settings profiles and keymaps", () => {
	test("ships complete QWERTY and Dvorak maps with mnemonic bindings unchanged", () => {
		expect(Object.keys(DEFAULT_KEYBINDINGS.qwerty).sort()).toEqual([...COMMAND_IDS].sort());
		expect(Object.keys(DEFAULT_KEYBINDINGS.dvorak).sort()).toEqual([...COMMAND_IDS].sort());

		expect(keys(DEFAULT_KEYBINDINGS.qwerty["file.previous"])).toBe("h");
		expect(keys(DEFAULT_KEYBINDINGS.qwerty["hunk.next"])).toBe("j");
		expect(keys(DEFAULT_KEYBINDINGS.dvorak["file.next"])).toBe("s");
		expect(keys(DEFAULT_KEYBINDINGS.dvorak["hunk.next"])).toBe("t");
		expect(DEFAULT_KEYBINDINGS.dvorak["navigate.settings"]).toEqual(
			DEFAULT_KEYBINDINGS.qwerty["navigate.settings"],
		);
	});

	test("keeps overrides and deliberate unassignment across layout changes", () => {
		const data = createDefaultSettingsProfileData();
		data.keyboard.bindings["file.next"] = [{ key: "ArrowRight", modifiers: ["alt"] }];
		data.keyboard.bindings["hunk.next"] = null;
		data.keyboard.layout = "dvorak";

		const effective = effectiveKeybindings(data.keyboard);
		expect(shortcutSequenceKey(effective["file.next"]!)).toBe("alt+ArrowRight");
		expect(effective["hunk.next"]).toBeNull();
		expect(keys(effective["hunk.previous"])).toBe("n");
	});

	test("normalizes shortcut strokes and rejects malformed sequences", () => {
		expect(
			parseShortcutSequence([
				{
					key: "K",
					modifiers: ["shift", "mod"],
				},
			]),
		).toEqual([{ key: "k", modifiers: ["mod", "shift"] }]);
		expect(() => parseShortcutSequence([])).toThrow("one and four");
		expect(() => parseShortcutSequence(new Array(5).fill({ key: "x", modifiers: [] }))).toThrow(
			"one and four",
		);
		expect(() => parseShortcutSequence([{ key: "Control", modifiers: [] }])).toThrow("cannot use");
		expect(() => parseShortcutSequence([{ key: "k", modifiers: ["mod", "mod"] }])).toThrow(
			"Duplicate",
		);
	});

	test("detects exact and prefix-ambiguous bindings", () => {
		const bindings = effectiveKeybindings(createDefaultSettingsProfileData().keyboard);
		bindings["navigate.review"] = [{ key: "g", modifiers: [] }];
		expect(keybindingConflicts(bindings)).toContainEqual({
			first: "navigate.review",
			second: "navigate.terminal",
		});
		bindings["navigate.review"] = bindings["navigate.terminal"];
		expect(keybindingConflicts(bindings)).toContainEqual({
			first: "navigate.review",
			second: "navigate.terminal",
		});
	});

	test("requires the palette opener to begin with a non-shift modifier", () => {
		expect(paletteShortcutHasRequiredModifier(null)).toBe(true);
		expect(paletteShortcutHasRequiredModifier([{ key: "k", modifiers: ["mod"] }])).toBe(true);
		expect(
			paletteShortcutHasRequiredModifier([
				{ key: "g", modifiers: [] },
				{ key: "k", modifiers: ["mod"] },
			]),
		).toBe(false);

		const data = createDefaultSettingsProfileData();
		data.keyboard.bindings["palette.open"] = [{ key: "k", modifiers: ["shift"] }];
		expect(() => parseSettingsProfileData(data)).toThrow("begin with a modifier");
	});

	test("validates the complete persisted document instead of repairing malformed API data", () => {
		const data = createDefaultSettingsProfileData();
		expect(parseSettingsProfileData(data)).toEqual(data);
		expect(() => parseSettingsProfileData({ ...data, typography: undefined })).toThrow(
			"Typography preferences",
		);
		const outOfRange = structuredClone(data);
		outOfRange.typography.diff.fontSize = 100;
		expect(() => parseSettingsProfileData(outOfRange)).toThrow("Typography preferences");
		const unknown = structuredClone(data) as unknown as {
			keyboard: { bindings: Record<string, unknown> };
		};
		unknown.keyboard.bindings["missing.command"] = null;
		expect(() => parseSettingsProfileData(unknown)).toThrow("Unknown command ID");
	});

	test("trims names and enforces their portable length", () => {
		expect(normalizeSettingsProfileName("  Pairing  ")).toBe("Pairing");
		expect(() => normalizeSettingsProfileName("   ")).toThrow("between 1 and 64");
		expect(() => normalizeSettingsProfileName("x".repeat(65))).toThrow("between 1 and 64");
	});
});
