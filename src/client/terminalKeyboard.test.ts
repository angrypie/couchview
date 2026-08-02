import { describe, expect, test } from "bun:test";

import {
	terminalControlCharacter,
	terminalKeyboardCode,
	terminalModifierOnlyKey,
} from "./terminalKeyboard.ts";

describe("mobile terminal keyboard helpers", () => {
	test("maps Ctrl letter chords to ASCII control characters", () => {
		expect(terminalControlCharacter("c")).toBe("\x03");
		expect(terminalControlCharacter("C")).toBe("\x03");
		expect(terminalControlCharacter("l")).toBe("\x0c");
		expect(terminalControlCharacter("v")).toBe("\x16");
		expect(terminalControlCharacter("z")).toBe("\x1a");
	});

	test("supports the standard punctuation and number control aliases", () => {
		expect(terminalControlCharacter(" ")).toBe("\x00");
		expect(terminalControlCharacter("2")).toBe("\x00");
		expect(terminalControlCharacter("[")).toBe("\x1b");
		expect(terminalControlCharacter("\\")).toBe("\x1c");
		expect(terminalControlCharacter("]")).toBe("\x1d");
		expect(terminalControlCharacter("?")).toBe("\x7f");
		expect(terminalControlCharacter("9")).toBeNull();
	});

	test("derives browser codes when mobile keyboards omit them", () => {
		expect(terminalKeyboardCode("c")).toBe("KeyC");
		expect(terminalKeyboardCode("7")).toBe("Digit7");
		expect(terminalKeyboardCode("ArrowLeft")).toBe("ArrowLeft");
		expect(terminalKeyboardCode("?", "Slash")).toBe("Slash");
		expect(terminalKeyboardCode("é")).toBe("");
	});

	test("does not consume the Ctrl latch for modifier and composition keys", () => {
		expect(terminalModifierOnlyKey("Shift")).toBe(true);
		expect(terminalModifierOnlyKey("Dead")).toBe(true);
		expect(terminalModifierOnlyKey("c")).toBe(false);
	});
});
