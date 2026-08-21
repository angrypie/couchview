import { describe, expect, test } from "bun:test";

import { COMMAND_IDS, DEFAULT_KEYBINDINGS } from "../shared/settings.ts";
import "./appTestNativeRuntime.tsx";

const { COMMAND_DEFINITIONS } = await import("./commands.ts");

describe("command registry", () => {
	test("contains metadata and a declared default for every command ID", () => {
		expect(Object.keys(COMMAND_DEFINITIONS).sort()).toEqual([...COMMAND_IDS].sort());
		for (const commandId of COMMAND_IDS) {
			const command = COMMAND_DEFINITIONS[commandId];
			expect(command.id).toBe(commandId);
			expect(command.title.length).toBeGreaterThan(0);
			expect(command.keywords.length).toBeGreaterThan(0);
			expect(command.voicePolicy.risk).toBeDefined();
			expect(command.voicePolicy.supported).toBe(true);
			expect(Object.prototype.hasOwnProperty.call(DEFAULT_KEYBINDINGS.qwerty, commandId)).toBe(
				true,
			);
			expect(Object.prototype.hasOwnProperty.call(DEFAULT_KEYBINDINGS.dvorak, commandId)).toBe(
				true,
			);
		}
		expect(COMMAND_DEFINITIONS["palette.open"].paletteVisible).toBe(false);
	});
});
