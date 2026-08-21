import { describe, expect, test } from "bun:test";

import type { FileChange, ResolvedVoiceCommand } from "../../../shared/contracts.ts";
import { COMMAND_IDS } from "../../../shared/settings.ts";
import { VOICE_COMMAND_POLICIES } from "../../../shared/voiceCommands.ts";
import type { RuntimeCommand } from "../../commands.ts";
import {
	contextMatches,
	executeVoiceActions,
	hasVoiceConfirmationContextChanged,
	type VoiceContext,
} from "./voiceCommandExecution.ts";

const file: FileChange = {
	id: "file-1",
	path: "src/app.ts",
	previousPath: null,
	kind: "modified",
	indexStatus: "M",
	worktreeStatus: " ",
	staged: true,
	unstaged: false,
	conflicted: false,
	binary: false,
	additions: 1,
	deletions: 0,
	contentRevision: "content-1",
	reviewed: false,
};

function context(overrides: Partial<VoiceContext> = {}): VoiceContext {
	return {
		repositoryId: "repo-1",
		operationRevision: "operation-1",
		reviewRevision: 4,
		file,
		...overrides,
	};
}

function resolved(actionId: ResolvedVoiceCommand["actionId"]): ResolvedVoiceCommand {
	return { actionId };
}

function commands(
	perform: (id: string) => boolean | void,
): Record<(typeof COMMAND_IDS)[number], RuntimeCommand> {
	return Object.fromEntries(
		COMMAND_IDS.map((id) => [
			id,
			{
				id,
				title: id,
				category: "Actions",
				keywords: [id],
				icon: null as unknown as RuntimeCommand["icon"],
				repeatable: false,
				paletteVisible: true,
				voicePolicy: VOICE_COMMAND_POLICIES[id],
				binding: null,
				enabled: true,
				disabledReason: null,
				perform: () => perform(id),
			},
		]),
	) as Record<(typeof COMMAND_IDS)[number], RuntimeCommand>;
}

describe("voice command execution", () => {
	test("cancels contextual mutations when repository context changes", () => {
		expect(contextMatches(context(), context())).toBe(true);
		expect(contextMatches(context({ operationRevision: "operation-2" }), context())).toBe(false);
		expect(contextMatches(context({ reviewRevision: 5 }), context())).toBe(false);
		expect(contextMatches(context({ file: { ...file, id: "file-2" } }), context())).toBe(false);
	});

	test("marks a contextual confirmation stale as soon as its captured context changes", () => {
		expect(hasVoiceConfirmationContextChanged([resolved("file.stage")], context(), context())).toBe(
			false,
		);
		expect(
			hasVoiceConfirmationContextChanged(
				[resolved("file.markReviewed")],
				context(),
				context({ reviewRevision: 5 }),
			),
		).toBe(true);
		expect(
			hasVoiceConfirmationContextChanged(
				[resolved("navigate.settings")],
				context(),
				context({ reviewRevision: 5 }),
			),
		).toBe(false);
	});

	test("executes navigation through the shared command registry", async () => {
		const performed: string[] = [];
		const result = await executeVoiceActions([resolved("navigate.settings")], context(), {
			commands: commands((id) => {
				performed.push(id);
			}),
			csrfToken: "csrf",
			refreshChanges: async () => undefined,
			refreshReviews: async () => undefined,
		});
		expect(performed).toEqual(["navigate.settings"]);
		expect(result).toEqual({ message: "Open settings succeeded", undo: null });
	});

	test("treats an already-applied idempotent mutation as success without undo", async () => {
		const result = await executeVoiceActions([resolved("file.stage")], context(), {
			commands: commands(() => undefined),
			csrfToken: "csrf",
			refreshChanges: async () => undefined,
			refreshReviews: async () => undefined,
		});
		expect(result).toEqual({ message: "Stage current file succeeded", undo: null });
	});

	test("reports a shared command that is unavailable at execution time", async () => {
		const registry = commands(() => undefined);
		registry["navigate.artifacts"] = {
			...registry["navigate.artifacts"]!,
			enabled: false,
			disabledReason: "Artifacts are unavailable right now",
		};
		await expect(
			executeVoiceActions([resolved("navigate.artifacts")], context(), {
				commands: registry,
				csrfToken: "csrf",
				refreshChanges: async () => undefined,
				refreshReviews: async () => undefined,
			}),
		).rejects.toThrow("Artifacts are unavailable right now");
	});

	test("does not report success when a shared navigation command declines to run", async () => {
		await expect(
			executeVoiceActions([resolved("navigate.review")], context(), {
				commands: commands(() => false),
				csrfToken: "csrf",
				refreshChanges: async () => undefined,
				refreshReviews: async () => undefined,
			}),
		).rejects.toThrow("Open review is unavailable right now");
	});

	test("preflights every stacked command before performing the sequence", async () => {
		const performed: string[] = [];
		const registry = commands((id) => {
			performed.push(id);
		});
		registry["navigate.artifacts"] = {
			...registry["navigate.artifacts"]!,
			enabled: false,
			disabledReason: "Artifacts are unavailable right now",
		};
		await expect(
			executeVoiceActions(
				[resolved("navigate.settings"), resolved("navigate.artifacts")],
				context(),
				{
					commands: registry,
					csrfToken: "csrf",
					refreshChanges: async () => undefined,
					refreshReviews: async () => undefined,
				},
			),
		).rejects.toThrow("Artifacts are unavailable right now");
		expect(performed).toEqual([]);
	});

	test("does not bypass shared availability for a direct idempotent mutation", async () => {
		const registry = commands(() => undefined);
		registry["file.toggleStage"] = {
			...registry["file.toggleStage"]!,
			enabled: false,
			disabledReason: "A staging operation is already running",
		};
		await expect(
			executeVoiceActions([resolved("file.stage")], context({ file: { ...file, staged: false } }), {
				commands: registry,
				csrfToken: "csrf",
				refreshChanges: async () => undefined,
				refreshReviews: async () => undefined,
			}),
		).rejects.toThrow("A staging operation is already running");
	});

	test("rejects a stacked mutation after file navigation before executing either action", async () => {
		const performed: string[] = [];
		await expect(
			executeVoiceActions(
				[resolved("file.next"), resolved("file.stage")],
				context({ file: { ...file, staged: false } }),
				{
					commands: commands((id) => {
						performed.push(id);
					}),
					csrfToken: "csrf",
					refreshChanges: async () => undefined,
					refreshReviews: async () => undefined,
				},
			),
		).rejects.toThrow("Say file navigation and file changes as separate voice commands");
		expect(performed).toEqual([]);
	});
});
