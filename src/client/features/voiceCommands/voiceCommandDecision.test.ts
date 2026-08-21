import { describe, expect, test } from "bun:test";

import type { ResolvedVoiceCommand } from "../../../shared/contracts.ts";
import { voiceCommandDisposition } from "./voiceCommandDecision.ts";

function command(overrides: Partial<ResolvedVoiceCommand> = {}): ResolvedVoiceCommand {
	return {
		actionId: "navigate.settings",
		...overrides,
	};
}

describe("voice command disposition", () => {
	test("executes one confident navigation or reversible action", () => {
		expect(voiceCommandDisposition([command()], 0.5)).toBe("execute");
		expect(voiceCommandDisposition([command({ actionId: "file.stage" })], 0.98)).toBe("execute");
	});

	test("confirms low-confidence and stacked commands", () => {
		expect(voiceCommandDisposition([command()], 0.4999)).toBe("confirm");
		expect(
			voiceCommandDisposition([command(), command({ actionId: "navigate.artifacts" })], 0.99),
		).toBe("confirm");
	});

	test("routes an empty mapping to the command-palette fallback", () => {
		expect(voiceCommandDisposition([], 0.99)).toBe("no-match");
	});
});
