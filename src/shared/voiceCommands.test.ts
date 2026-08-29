import { describe, expect, test } from "bun:test";

import { COMMAND_IDS } from "./settings.ts";
import {
	VOICE_ACTION_DEFINITIONS,
	VOICE_ACTION_IDS,
	VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE,
	VOICE_COMMAND_POLICIES,
} from "./voiceCommands.ts";

describe("voice command registry", () => {
	test("requires an explicit voice policy for every registered command", () => {
		expect(Object.keys(VOICE_COMMAND_POLICIES).sort()).toEqual([...COMMAND_IDS].sort());
		expect(Object.values(VOICE_COMMAND_POLICIES).every((policy) => "risk" in policy)).toBe(true);
	});

	test("declares a unique Needle tool name and risk for every voice action", () => {
		const definitions = VOICE_ACTION_IDS.map((actionId) => VOICE_ACTION_DEFINITIONS[actionId]);
		expect(new Set(definitions.map((definition) => definition.toolName)).size).toBe(
			VOICE_ACTION_IDS.length,
		);
		for (const definition of definitions) {
			expect(definition.risk).toBe(VOICE_COMMAND_POLICIES[definition.commandId].risk);
		}
	});

	test("uses the agreed automatic execution threshold", () => {
		expect(VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE).toBe(0.5);
	});

	test("exposes Git history as a Needle navigation action", () => {
		expect(VOICE_ACTION_DEFINITIONS["navigate.history"]).toMatchObject({
			commandId: "navigate.history",
			risk: "navigation",
			toolName: "open_git_history",
		});
	});

	test("exposes the project file picker as a Needle navigation action", () => {
		expect(VOICE_ACTION_DEFINITIONS["file.open"]).toMatchObject({
			commandId: "file.open",
			risk: "navigation",
			toolName: "open_project_file_picker",
		});
	});
});
