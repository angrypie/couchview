import type { FileChange, ResolvedVoiceCommand } from "../../../shared/contracts.ts";
import type { CommandId } from "../../../shared/settings.ts";
import { VOICE_ACTION_DEFINITIONS } from "../../../shared/voiceCommands.ts";
import { api } from "../../api.ts";
import type { RuntimeCommand } from "../../commands.ts";

export interface VoiceContext {
	repositoryId: string | null;
	operationRevision: string;
	reviewRevision: number;
	file: FileChange | null;
}

type UndoStep =
	| {
			kind: "stage";
			fileId: string;
			contentRevision: string;
			staged: boolean;
	  }
	| {
			kind: "review";
			fileId: string;
			contentRevision: string;
			reviewed: boolean;
	  };

export interface UndoPlan {
	repositoryId: string;
	operationRevision: string;
	reviewRevision: number | null;
	steps: UndoStep[];
}

export interface VoiceExecutionDependencies {
	commands: Record<CommandId, RuntimeCommand>;
	csrfToken: string | null;
	refreshChanges(): Promise<unknown>;
	refreshReviews(): Promise<unknown>;
}

export interface VoiceExecutionResult {
	message: string;
	undo: UndoPlan | null;
}

interface VoiceFileContext {
	repositoryId: string;
	file: FileChange;
}

function sequenceRetainsCapturedFile(resolved: ResolvedVoiceCommand[]): boolean {
	let fileNavigationSeen = false;
	for (const command of resolved) {
		if (VOICE_ACTION_DEFINITIONS[command.actionId].contextual && fileNavigationSeen) return false;
		if (command.actionId === "file.previous" || command.actionId === "file.next") {
			fileNavigationSeen = true;
		}
	}
	return true;
}

export function contextMatches(current: VoiceContext, captured: VoiceContext): boolean {
	return (
		current.repositoryId === captured.repositoryId &&
		current.operationRevision === captured.operationRevision &&
		current.reviewRevision === captured.reviewRevision &&
		current.file?.id === captured.file?.id &&
		current.file?.contentRevision === captured.file?.contentRevision
	);
}

export function hasVoiceConfirmationContextChanged(
	commands: ResolvedVoiceCommand[],
	captured: VoiceContext,
	current: VoiceContext,
): boolean {
	return (
		commands.some((command) => VOICE_ACTION_DEFINITIONS[command.actionId].contextual) &&
		!contextMatches(current, captured)
	);
}

async function executeStageAction(
	actionId: "file.stage" | "file.unstage",
	context: VoiceFileContext,
	csrfToken: string,
	operationRevision: string,
	staged: boolean,
): Promise<{ operationRevision: string; staged: boolean; undo: UndoStep | null }> {
	const desired = actionId === "file.stage";
	if (staged === desired) return { operationRevision, staged, undo: null };
	const response = await api.stage(
		context.repositoryId,
		{
			fileId: context.file.id,
			contentRevision: context.file.contentRevision,
			operationRevision,
			staged: desired,
		},
		csrfToken,
	);
	return {
		operationRevision: response.operationRevision,
		staged: desired,
		undo: {
			kind: "stage",
			fileId: context.file.id,
			contentRevision: response.file?.contentRevision ?? context.file.contentRevision,
			staged,
		},
	};
}

async function executeReviewAction(
	actionId: "file.markReviewed" | "file.markUnreviewed",
	context: VoiceFileContext,
	csrfToken: string,
	operationRevision: string,
	reviewRevision: number,
	reviewed: boolean,
): Promise<{
	operationRevision: string;
	reviewRevision: number;
	reviewed: boolean;
	undo: UndoStep | null;
}> {
	const desired = actionId === "file.markReviewed";
	if (reviewed === desired) return { operationRevision, reviewRevision, reviewed, undo: null };
	const response = await api.setReviewed(
		context.repositoryId,
		{
			fileId: context.file.id,
			contentRevision: context.file.contentRevision,
			operationRevision,
			expectedReviewRevision: reviewRevision,
			reviewed: desired,
		},
		csrfToken,
	);
	return {
		operationRevision: response.operationRevision,
		reviewRevision: response.reviewRevision,
		reviewed: desired,
		undo: {
			kind: "review",
			fileId: context.file.id,
			contentRevision: context.file.contentRevision,
			reviewed,
		},
	};
}

export async function executeVoiceActions(
	resolved: ResolvedVoiceCommand[],
	context: VoiceContext,
	dependencies: VoiceExecutionDependencies,
): Promise<VoiceExecutionResult> {
	if (!sequenceRetainsCapturedFile(resolved)) {
		throw new Error("Say file navigation and file changes as separate voice commands.");
	}
	const hasContextualAction = resolved.some(
		(command) => VOICE_ACTION_DEFINITIONS[command.actionId].contextual,
	);
	if (hasContextualAction && (!context.repositoryId || !context.file || !dependencies.csrfToken)) {
		throw new Error("Open a changed file before using that voice command.");
	}
	for (const resolvedCommand of resolved) {
		const action = VOICE_ACTION_DEFINITIONS[resolvedCommand.actionId];
		const command = dependencies.commands[action.commandId];
		if (!command.enabled) {
			throw new Error(command.disabledReason ?? `${action.title} is unavailable right now.`);
		}
	}
	let operationRevision = context.operationRevision;
	let reviewRevision = context.reviewRevision;
	let staged = Boolean(context.file?.staged && !context.file.unstaged);
	let reviewed = Boolean(context.file?.reviewed);
	const undoSteps: UndoStep[] = [];
	const completed: string[] = [];
	for (const resolvedCommand of resolved) {
		const action = VOICE_ACTION_DEFINITIONS[resolvedCommand.actionId];
		const command = dependencies.commands[action.commandId];
		if (!action.contextual) {
			if (command.perform() === false) {
				throw new Error(`${action.title} is unavailable right now.`);
			}
			completed.push(action.title);
			continue;
		}
		if (!context.repositoryId || !context.file || !dependencies.csrfToken) {
			throw new Error("Open a changed file before using that voice command.");
		}
		const target = { repositoryId: context.repositoryId, file: context.file };
		if (action.id === "file.stage" || action.id === "file.unstage") {
			const result = await executeStageAction(
				action.id,
				target,
				dependencies.csrfToken,
				operationRevision,
				staged,
			);
			operationRevision = result.operationRevision;
			staged = result.staged;
			if (result.undo) undoSteps.push(result.undo);
		} else if (action.id === "file.markReviewed" || action.id === "file.markUnreviewed") {
			const result = await executeReviewAction(
				action.id,
				target,
				dependencies.csrfToken,
				operationRevision,
				reviewRevision,
				reviewed,
			);
			operationRevision = result.operationRevision;
			reviewRevision = result.reviewRevision;
			reviewed = result.reviewed;
			if (result.undo) undoSteps.push(result.undo);
		} else {
			throw new Error(`${action.title} is not available as a contextual voice action.`);
		}
		completed.push(action.title);
	}
	await Promise.all([dependencies.refreshChanges(), dependencies.refreshReviews()]);
	const undo =
		context.repositoryId && undoSteps.length > 0
			? {
					repositoryId: context.repositoryId,
					operationRevision,
					reviewRevision: undoSteps.some((step) => step.kind === "review") ? reviewRevision : null,
					steps: undoSteps.reverse(),
				}
			: null;
	return {
		message:
			completed.length === 1
				? `${completed[0]} succeeded`
				: `${completed.length} commands succeeded`,
		undo,
	};
}

export async function applyVoiceUndo(
	plan: UndoPlan,
	dependencies: Pick<VoiceExecutionDependencies, "csrfToken" | "refreshChanges" | "refreshReviews">,
): Promise<void> {
	if (!dependencies.csrfToken) return;
	let operationRevision = plan.operationRevision;
	let reviewRevision = plan.reviewRevision;
	for (const step of plan.steps) {
		if (step.kind === "stage") {
			const response = await api.stage(
				plan.repositoryId,
				{
					fileId: step.fileId,
					contentRevision: step.contentRevision,
					operationRevision,
					staged: step.staged,
				},
				dependencies.csrfToken,
			);
			operationRevision = response.operationRevision;
		} else {
			if (reviewRevision === null) {
				throw new Error("Review undo is missing its captured review revision.");
			}
			const response = await api.setReviewed(
				plan.repositoryId,
				{
					fileId: step.fileId,
					contentRevision: step.contentRevision,
					operationRevision,
					expectedReviewRevision: reviewRevision,
					reviewed: step.reviewed,
				},
				dependencies.csrfToken,
			);
			operationRevision = response.operationRevision;
			reviewRevision = response.reviewRevision;
		}
	}
	await Promise.all([dependencies.refreshChanges(), dependencies.refreshReviews()]);
}
