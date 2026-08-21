import { describe, expect, test } from "bun:test";

import { VOICE_ACTION_IDS } from "../../shared/voiceCommands.ts";
import { needleToolSchemas, parseNeedleEnvelope } from "./needleRuntime.ts";

function envelope(value: unknown): Buffer {
	return Buffer.from(`${JSON.stringify(value)}\0ignored`, "utf8");
}

describe("Needle runtime response parsing", () => {
	test("declares one parameterless Needle tool per voice action", () => {
		const schemas = needleToolSchemas();
		expect(schemas).toHaveLength(VOICE_ACTION_IDS.length);
		expect(new Set(schemas.map((schema) => schema.name)).size).toBe(VOICE_ACTION_IDS.length);
		expect(schemas.every((schema) => schema.description.length > 0)).toBe(true);
		expect(
			schemas.every(
				(schema) =>
					schema.parameters.type === "object" &&
					Object.keys(schema.parameters.properties).length === 0 &&
					schema.parameters.additionalProperties === false,
			),
		).toBe(true);
	});

	test("preserves ordered stacked commands and top-level model signals", () => {
		expect(
			parseNeedleEnvelope(
				envelope({
					confidence: 0.81,
					reasoning: "'settings' -> open_settings; 'artifacts' -> open_artifacts",
					function_calls: [
						{ name: "open_settings", arguments: {} },
						{ name: "open_artifacts", arguments: {} },
						{ name: "review_current_file", arguments: {} },
					],
				}),
			),
		).toEqual({
			actionIds: ["navigate.settings", "navigate.artifacts", "file.markReviewed"],
			confidence: 0.81,
			reasoning: "'settings' -> open_settings; 'artifacts' -> open_artifacts",
		});
	});

	test("drops unknown or malformed actions and clamps confidence", () => {
		expect(
			parseNeedleEnvelope(
				envelope({
					confidence: 2,
					reasoning: 42,
					function_calls: [
						{ name: "delete_current_file", arguments: {} },
						{ name: "unknown", arguments: {} },
					],
				}),
			),
		).toEqual({ actionIds: [], confidence: 1, reasoning: null });
	});

	test("rejects malformed native envelopes", () => {
		expect(() => parseNeedleEnvelope(Buffer.from("not-json\0"))).toThrow(
			"Needle returned an invalid response envelope",
		);
	});
});
