import { describe, expect, test } from "bun:test";

import type { NeedleResolution } from "../src/server/voiceCommands/needleRuntime.ts";
import { VOICE_ACTION_IDS } from "../src/shared/voiceCommands.ts";
import {
	evaluateVoiceCommandCase,
	summarizeVoiceCommandEvaluation,
	VOICE_COMMAND_EVAL_CASES,
} from "./voiceCommandEval.ts";

describe("voice command evaluation", () => {
	test("covers every registered action plus no-match and stacked requests", () => {
		const expected = new Set(VOICE_COMMAND_EVAL_CASES.flatMap((entry) => entry.expectedActionIds));
		expect([...expected].sort()).toEqual([...VOICE_ACTION_IDS].sort());
		expect(VOICE_COMMAND_EVAL_CASES.some((entry) => entry.expectedActionIds.length === 0)).toBe(
			true,
		);
		expect(VOICE_COMMAND_EVAL_CASES.some((entry) => entry.expectedActionIds.length > 1)).toBe(true);
	});

	test("requires the complete ordered Needle call array", () => {
		const testCase = {
			transcript: "open settings and artifacts",
			expectedActionIds: ["navigate.settings", "navigate.artifacts"],
		} as const;
		const exact: NeedleResolution = {
			actionIds: ["navigate.settings", "navigate.artifacts"],
			confidence: 0.8,
			reasoning: "both requested destinations were selected",
		};
		const partial: NeedleResolution = { ...exact, actionIds: ["navigate.settings"] };
		expect(evaluateVoiceCommandCase(testCase, exact).passed).toBe(true);
		expect(evaluateVoiceCommandCase(testCase, partial)).toMatchObject({
			passed: false,
			unsafeAutoExecution: true,
		});
	});

	test("does not classify a mismatched stacked result as an automatic execution", () => {
		const testCase = {
			transcript: "stage this file and mark it reviewed",
			expectedActionIds: ["file.stage", "file.markReviewed"],
		} as const;
		const resolution: NeedleResolution = {
			actionIds: ["file.stage", "file.markUnreviewed"],
			confidence: 0.95,
			reasoning: "two calls were selected",
		};
		expect(evaluateVoiceCommandCase(testCase, resolution)).toMatchObject({
			passed: false,
			unsafeAutoExecution: false,
		});
	});

	test("summarizes exact accuracy separately from unsafe automatic execution", () => {
		const summary = summarizeVoiceCommandEvaluation([
			{ passed: true, unsafeAutoExecution: false },
			{ passed: false, unsafeAutoExecution: false },
			{ passed: true, unsafeAutoExecution: false },
		]);
		expect(summary).toEqual({
			exactPassed: 2,
			total: 3,
			exactAccuracy: 2 / 3,
			unsafeAutoExecutions: 0,
		});
	});
});
