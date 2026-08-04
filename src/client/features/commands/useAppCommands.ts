import { useMemo, useState } from "react";
import type { ChangeFile, TerminalCapability } from "../../../shared/contracts.ts";
import type { CommandId, ShortcutSequence } from "../../../shared/settings.ts";
import { COMMAND_DEFINITIONS, type RuntimeCommand } from "../../commands.ts";
import { useShortcutEngine } from "../../shortcutEngine.ts";

interface UseAppCommandsOptions {
	activeFile: ChangeFile | null;
	activeFileIndex: number;
	bootstrapReady: boolean;
	bulkStageBusy: boolean;
	canNavigateNextHunk: boolean;
	canNavigatePreviousHunk: boolean;
	commandBindings: Record<CommandId, ShortcutSequence | null>;
	commitBusy: boolean;
	fileCount: number;
	onComments: () => void;
	onDismissOverlays: () => void;
	onNavigateFile: (direction: -1 | 1) => void;
	onNavigateHunk: (direction: -1 | 1) => void;
	onOpenArtifacts: () => void;
	onOpenCommit: () => void;
	onOpenFiles: () => void;
	onOpenPackageCommands: () => void;
	onOpenRemote: () => void;
	onOpenRepository: () => void;
	onOpenSearch: () => void;
	onOpenSettings: () => void;
	onOpenTerminal: () => void;
	onReviewFile: (file: ChangeFile) => void;
	onShowReview: () => boolean;
	onToggleStage: () => void;
	overlayVisible: boolean;
	repositoryReady: boolean;
	reviewBusy: boolean;
	stageBusy: boolean;
	stagedCount: number;
	terminalCapability: TerminalCapability;
	workspaceMode: "review" | "history" | "artifacts" | "terminal" | "settings";
}

export function useAppCommands({
	activeFile,
	activeFileIndex,
	bootstrapReady,
	bulkStageBusy,
	canNavigateNextHunk,
	canNavigatePreviousHunk,
	commandBindings,
	commitBusy,
	fileCount,
	onComments,
	onDismissOverlays,
	onNavigateFile,
	onNavigateHunk,
	onOpenArtifacts,
	onOpenCommit,
	onOpenFiles,
	onOpenPackageCommands,
	onOpenRemote,
	onOpenRepository,
	onOpenSearch,
	onOpenSettings,
	onOpenTerminal,
	onReviewFile,
	onShowReview,
	onToggleStage,
	overlayVisible,
	repositoryReady,
	reviewBusy,
	stageBusy,
	stagedCount,
	terminalCapability,
	workspaceMode,
}: UseAppCommandsOptions) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [recording, setRecording] = useState(false);

	const commands = useMemo(() => {
		const command = (
			id: CommandId,
			enabled: boolean,
			disabledReason: string | null,
			perform: () => void,
		): RuntimeCommand => ({
			...COMMAND_DEFINITIONS[id],
			binding: commandBindings[id],
			enabled,
			disabledReason: enabled ? null : disabledReason,
			perform,
		});
		const reviewAction = (perform: () => void) => () => {
			if (!onShowReview()) return;
			onDismissOverlays();
			perform();
		};
		return {
			"palette.open": command("palette.open", true, null, () => {
				setPaletteOpen((current) => !current);
			}),
			"navigate.review": command(
				"navigate.review",
				true,
				null,
				reviewAction(() => {}),
			),
			"navigate.artifacts": command(
				"navigate.artifacts",
				repositoryReady,
				"Select a repository first",
				reviewAction(onOpenArtifacts),
			),
			"navigate.terminal": command(
				"navigate.terminal",
				repositoryReady && terminalCapability.available,
				terminalCapability.reason ?? "Select a repository first",
				reviewAction(onOpenTerminal),
			),
			"navigate.remote": command(
				"navigate.remote",
				repositoryReady,
				"Select a repository first",
				reviewAction(onOpenRemote),
			),
			"navigate.settings": command("navigate.settings", true, null, () => {
				onDismissOverlays();
				onOpenSettings();
			}),
			"repository.switch": command(
				"repository.switch",
				bootstrapReady,
				"Couchview is still loading",
				reviewAction(onOpenRepository),
			),
			"panel.files": command(
				"panel.files",
				repositoryReady,
				"Select a repository first",
				reviewAction(onOpenFiles),
			),
			"panel.packageCommands": command(
				"panel.packageCommands",
				repositoryReady,
				"Select a repository first",
				reviewAction(onOpenPackageCommands),
			),
			"search.open": command(
				"search.open",
				Boolean(activeFile && repositoryReady),
				"Open a changed file first",
				reviewAction(onOpenSearch),
			),
			"commit.open": command(
				"commit.open",
				stagedCount > 0 && !commitBusy,
				stagedCount === 0 ? "Stage changes before committing" : "A commit is already running",
				reviewAction(onOpenCommit),
			),
			"comments.open": command(
				"comments.open",
				repositoryReady,
				"Select a repository first",
				reviewAction(onComments),
			),
			"file.toggleStage": command(
				"file.toggleStage",
				Boolean(activeFile) && !stageBusy && !bulkStageBusy,
				activeFile ? "A staging operation is already running" : "Open a changed file first",
				onToggleStage,
			),
			"file.toggleReviewed": command(
				"file.toggleReviewed",
				Boolean(activeFile) && !reviewBusy,
				activeFile ? "A review update is already running" : "Open a changed file first",
				() => activeFile && onReviewFile(activeFile),
			),
			"file.previous": command("file.previous", activeFileIndex > 0, "This is the first file", () =>
				onNavigateFile(-1),
			),
			"file.next": command(
				"file.next",
				activeFileIndex >= 0 && activeFileIndex < fileCount - 1,
				"This is the last file",
				() => onNavigateFile(1),
			),
			"hunk.previous": command(
				"hunk.previous",
				workspaceMode === "review" && canNavigatePreviousHunk,
				workspaceMode === "review" ? "There is no previous hunk" : "Open diff review first",
				() => onNavigateHunk(-1),
			),
			"hunk.next": command(
				"hunk.next",
				workspaceMode === "review" && canNavigateNextHunk,
				workspaceMode === "review" ? "There is no next hunk" : "Open diff review first",
				() => onNavigateHunk(1),
			),
		} satisfies Record<CommandId, RuntimeCommand>;
	}, [
		activeFile,
		activeFileIndex,
		bootstrapReady,
		bulkStageBusy,
		canNavigateNextHunk,
		canNavigatePreviousHunk,
		commandBindings,
		commitBusy,
		fileCount,
		onComments,
		onDismissOverlays,
		onNavigateFile,
		onNavigateHunk,
		onOpenArtifacts,
		onOpenCommit,
		onOpenFiles,
		onOpenPackageCommands,
		onOpenRemote,
		onOpenRepository,
		onOpenSearch,
		onOpenSettings,
		onOpenTerminal,
		onReviewFile,
		onShowReview,
		onToggleStage,
		repositoryReady,
		reviewBusy,
		stageBusy,
		stagedCount,
		terminalCapability.available,
		terminalCapability.reason,
		workspaceMode,
	]);

	const { pending } = useShortcutEngine({
		bindings: commandBindings,
		commands,
		paletteOpen,
		recording,
		restricted: workspaceMode === "terminal" || overlayVisible,
	});

	return {
		commands,
		paletteOpen,
		pending,
		recording,
		setPaletteOpen,
		setRecording,
	};
}
