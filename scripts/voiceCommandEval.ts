import path from "node:path";

import { resolveStateDatabasePath } from "../src/server/database.ts";
import {
	ensureNeedleLibrary,
	type NeedleResolution,
} from "../src/server/voiceCommands/needleRuntime.ts";
import { openNeedleResolver } from "../src/server/voiceCommands/needleWorkerClient.ts";
import {
	VOICE_ACTION_DEFINITIONS,
	VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE,
	type VoiceActionId,
} from "../src/shared/voiceCommands.ts";

export interface VoiceCommandEvalCase {
	transcript: string;
	expectedActionIds: readonly VoiceActionId[];
}

export interface VoiceCommandEvalResult {
	case: VoiceCommandEvalCase;
	passed: boolean;
	unsafeAutoExecution: boolean;
	resolution: NeedleResolution;
}

export const VOICE_COMMAND_EVAL_CASES = [
	{ transcript: "open command palette", expectedActionIds: ["palette.open"] },
	{ transcript: "open review", expectedActionIds: ["navigate.review"] },
	{ transcript: "open git history", expectedActionIds: ["navigate.history"] },
	{ transcript: "open artifacts", expectedActionIds: ["navigate.artifacts"] },
	{ transcript: "open terminal", expectedActionIds: ["navigate.terminal"] },
	{ transcript: "open native remote", expectedActionIds: ["navigate.remote"] },
	{ transcript: "open settings", expectedActionIds: ["navigate.settings"] },
	{ transcript: "switch repository", expectedActionIds: ["repository.switch"] },
	{ transcript: "open changed files", expectedActionIds: ["panel.files"] },
	{ transcript: "Open package commands.", expectedActionIds: ["panel.packageCommands"] },
	{ transcript: "search repository", expectedActionIds: ["search.open"] },
	{ transcript: "open commit composer", expectedActionIds: ["commit.open"] },
	{ transcript: "stage current file", expectedActionIds: ["file.stage"] },
	{ transcript: "unstage current file", expectedActionIds: ["file.unstage"] },
	{ transcript: "review current file", expectedActionIds: ["file.markReviewed"] },
	{ transcript: "mark current file unreviewed", expectedActionIds: ["file.markUnreviewed"] },
	{ transcript: "previous file", expectedActionIds: ["file.previous"] },
	{ transcript: "next file", expectedActionIds: ["file.next"] },
	{ transcript: "previous hunk", expectedActionIds: ["hunk.previous"] },
	{ transcript: "next hunk", expectedActionIds: ["hunk.next"] },
	{
		transcript: "open settings and artifacts",
		expectedActionIds: ["navigate.settings", "navigate.artifacts"],
	},
	{
		transcript: "stage this file and mark it reviewed",
		expectedActionIds: ["file.stage", "file.markReviewed"],
	},
	{ transcript: "what is the weather today", expectedActionIds: [] },
	{ transcript: "run npm test in terminal", expectedActionIds: [] },
] as const satisfies readonly VoiceCommandEvalCase[];

function sameOrderedActions(
	actual: readonly VoiceActionId[],
	expected: readonly VoiceActionId[],
): boolean {
	return (
		actual.length === expected.length &&
		actual.every((actionId, index) => actionId === expected[index])
	);
}

export function evaluateVoiceCommandCase(
	testCase: VoiceCommandEvalCase,
	resolution: NeedleResolution,
): VoiceCommandEvalResult {
	const passed = sameOrderedActions(resolution.actionIds, testCase.expectedActionIds);
	const onlyActionId = resolution.actionIds.length === 1 ? resolution.actionIds[0] : undefined;
	const wouldAutoExecute =
		onlyActionId !== undefined &&
		resolution.confidence >= VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE &&
		VOICE_ACTION_DEFINITIONS[onlyActionId].risk !== "dangerous";
	return {
		case: testCase,
		passed,
		unsafeAutoExecution: !passed && wouldAutoExecute,
		resolution,
	};
}

export function summarizeVoiceCommandEvaluation(
	results: readonly { passed: boolean; unsafeAutoExecution: boolean }[],
): {
	exactPassed: number;
	total: number;
	exactAccuracy: number;
	unsafeAutoExecutions: number;
} {
	const exactPassed = results.filter((result) => result.passed).length;
	return {
		exactPassed,
		total: results.length,
		exactAccuracy: results.length === 0 ? 0 : exactPassed / results.length,
		unsafeAutoExecutions: results.filter((result) => result.unsafeAutoExecution).length,
	};
}

async function runVoiceCommandEvaluation(): Promise<void> {
	const storageDirectory = path.join(path.dirname(resolveStateDatabasePath()), "needle");
	const libraryPath = await ensureNeedleLibrary(storageDirectory);
	const resolver = await openNeedleResolver(libraryPath);
	const results: VoiceCommandEvalResult[] = [];
	try {
		for (const testCase of VOICE_COMMAND_EVAL_CASES) {
			const result = evaluateVoiceCommandCase(
				testCase,
				await resolver.resolve(testCase.transcript),
			);
			results.push(result);
			const confidence = `${(result.resolution.confidence * 100).toFixed(2)}%`;
			const status = result.passed ? "PASS" : result.unsafeAutoExecution ? "UNSAFE" : "CONFIRM";
			console.log(`${status} ${confidence} ${JSON.stringify(testCase.transcript)}`);
			if (!result.passed) {
				console.log(`  expected: ${testCase.expectedActionIds.join(", ") || "no call"}`);
				console.log(`  actual:   ${result.resolution.actionIds.join(", ") || "no call"}`);
				console.log(`  reasoning: ${result.resolution.reasoning ?? "unavailable"}`);
			}
		}
	} finally {
		resolver.close();
	}
	const summary = summarizeVoiceCommandEvaluation(results);
	console.log(
		`\n${summary.exactPassed}/${summary.total} exact ordered resolutions ` +
			`(${(summary.exactAccuracy * 100).toFixed(2)}%); ` +
			`${summary.unsafeAutoExecutions} unsafe automatic executions`,
	);
	if (summary.unsafeAutoExecutions > 0) process.exitCode = 1;
}

if (import.meta.main) {
	await runVoiceCommandEvaluation();
}
