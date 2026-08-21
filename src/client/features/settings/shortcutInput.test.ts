import { describe, expect, test } from "bun:test";

import { formatShortcutInput, parseShortcutInput } from "./shortcutInput.ts";

describe("portable shortcut input", () => {
	test("parses modifiers, aliases, and multi-stroke shortcuts", () => {
		expect(parseShortcutInput("Mod+Shift+K g t")).toEqual([
			{ key: "k", modifiers: ["mod", "shift"] },
			{ key: "g", modifiers: [] },
			{ key: "t", modifiers: [] },
		]);
		expect(parseShortcutInput("Command+Space")).toEqual([{ key: "Space", modifiers: ["mod"] }]);
	});

	test("formats shortcuts without navigator or keyboard events", () => {
		expect(
			formatShortcutInput([
				{ key: "ArrowDown", modifiers: ["mod", "alt"] },
				{ key: "x", modifiers: [] },
			]),
		).toBe("Mod+Alt+Down X");
		expect(formatShortcutInput(null)).toBe("Unassigned");
	});

	test("rejects empty strokes and modifier-only input", () => {
		expect(() => parseShortcutInput("")).toThrow("at least one");
		expect(() => parseShortcutInput("Mod+Shift")).toThrow("exactly one key");
		expect(() => parseShortcutInput("K+L")).toThrow("exactly one key");
	});
});
