import { useCallback } from "react";
import type { FileChange } from "../../../shared/contracts.ts";
import type { useAppCommands } from "../commands/useAppCommands.ts";
import { useAppCommands as useCommands } from "../commands/useAppCommands.ts";
import type { useFailureReporting } from "../errors/useFailureReporting.ts";
import type { GitWorkspaceController } from "../git/index.ts";
import type { usePackageRuns } from "../packages/usePackageRuns.ts";
import type { useRepositoryManagement } from "../repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../review/useReviewWorkflow.ts";
import type { useDisplayPreferences } from "../settings/useDisplayPreferences.ts";
import type { DrawerView } from "../staging/types.ts";
import { useOverlayAccessibility } from "./useOverlayAccessibility";
import type { useWorkspaceNavigation } from "./useWorkspaceNavigation.ts";

interface UseReviewShellCommandsOptions {
	display: ReturnType<typeof useDisplayPreferences>;
	drawerOpen: boolean;
	failure: ReturnType<typeof useFailureReporting>;
	git: GitWorkspaceController;
	management: ReturnType<typeof useRepositoryManagement>;
	navigation: ReturnType<typeof useWorkspaceNavigation>;
	onDrawerOpenChange: (open: boolean) => void;
	onDrawerViewChange: (view: DrawerView) => void;
	onRemoteBridgeOpenChange: (open: boolean) => void;
	packages: ReturnType<typeof usePackageRuns>;
	remoteBridgeOpen: boolean;
	splitView: boolean;
	stagedCount: number;
	voiceCommandsEnabled: boolean;
	workflow: ReturnType<typeof useReviewWorkflow>;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
}

export function useReviewShellCommands({
	display,
	drawerOpen,
	failure,
	git,
	management,
	navigation,
	onDrawerOpenChange,
	onDrawerViewChange,
	onRemoteBridgeOpenChange,
	packages,
	remoteBridgeOpen,
	splitView,
	stagedCount,
	voiceCommandsEnabled,
	workflow,
	workspace,
}: UseReviewShellCommandsOptions): ReturnType<typeof useAppCommands> {
	const { commit, diff, review, search, staging } = workflow;
	const overlayVisible =
		management.pickerOpen ||
		remoteBridgeOpen ||
		search.open ||
		failure.detailsOpen ||
		commit.open ||
		Boolean(packages.selectedRunId) ||
		Boolean(git.pendingAction) ||
		(!splitView && drawerOpen);

	const dismissAll = useCallback(() => {
		management.setPickerOpen(false);
		onRemoteBridgeOpenChange(false);
		search.setOpen(false);
		failure.setDetailsOpen(false);
		commit.closeComposer();
		packages.setSelectedRunId(null);
		git.requestAction(null);
		onDrawerOpenChange(false);
	}, [
		commit,
		failure,
		git,
		management,
		onDrawerOpenChange,
		onRemoteBridgeOpenChange,
		packages,
		search,
	]);
	const openFiles = useCallback(() => {
		onDrawerViewChange("files");
		onDrawerOpenChange(true);
	}, [onDrawerOpenChange, onDrawerViewChange]);
	const openPackageCommands = useCallback(() => {
		onDrawerViewChange("commands");
		onDrawerOpenChange(true);
	}, [onDrawerOpenChange, onDrawerViewChange]);
	const openSearch = useCallback(() => {
		search.setQuery("");
		search.setScope("current");
		search.setSourcePreview(null);
		search.setOpen(true);
	}, [search]);
	const reviewFile = useCallback(
		(file: FileChange) => {
			void review.setReviewed(file, !file.reviewed, false);
		},
		[review],
	);

	const commands = useCommands({
		activeFile: diff.activeFile,
		activeFileIndex: diff.activeFileIndex,
		bootstrapReady: workspace.bootstrap !== null,
		bulkStageBusy: staging.bulkBusy !== null,
		canNavigateNextHunk: diff.canNavigateNextHunk,
		canNavigatePreviousHunk: diff.canNavigatePreviousHunk,
		commandBindings: display.commandBindings,
		commitBusy: commit.busy,
		fileCount: workspace.files.length,
		onDismissOverlays: dismissAll,
		onNavigateFile: diff.navigateFile,
		onNavigateHunk: diff.navigateHunk,
		onOpenArtifacts: navigation.openArtifacts,
		onOpenCommit: commit.openComposer,
		onOpenFiles: openFiles,
		onOpenHistory: navigation.openGitHistory,
		onOpenPackageCommands: openPackageCommands,
		onOpenRemote: () => onRemoteBridgeOpenChange(true),
		onOpenRepository: management.openPicker,
		onOpenSearch: openSearch,
		onOpenSettings: navigation.openSettings,
		onOpenTerminal: navigation.openTerminal,
		onReviewFile: reviewFile,
		onShowReview: navigation.showReview,
		onToggleStage: () => void staging.toggleActiveFile(),
		overlayVisible,
		repositoryReady: Boolean(workspace.repositoryId && workspace.repository),
		reviewBusy: Boolean(review.busy),
		stageBusy: Boolean(staging.busy),
		stagedCount,
		terminalCapability: workspace.bootstrap?.terminal ?? {
			available: false,
			reason: "The browser tmux terminal is unavailable from this Couchview server.",
			persistence: "tmux",
			profiles: [],
		},
		voiceKeyboardActive: voiceCommandsEnabled && navigation.mode !== "terminal",
		workspaceMode: navigation.mode,
	});

	const dismissTop = useCallback(() => {
		if (git.pendingAction) git.requestAction(null);
		else if (failure.detailsOpen) failure.setDetailsOpen(false);
		else if (management.pickerOpen) management.setPickerOpen(false);
		else if (remoteBridgeOpen) onRemoteBridgeOpenChange(false);
		else if (commit.open) commit.closeComposer();
		else if (packages.selectedRunId) packages.setSelectedRunId(null);
		else if (search.open) search.setOpen(false);
		else onDrawerOpenChange(false);
	}, [
		commit,
		failure,
		git,
		management,
		onDrawerOpenChange,
		onRemoteBridgeOpenChange,
		packages,
		remoteBridgeOpen,
		search,
	]);
	useOverlayAccessibility({
		dismissTop,
		paletteOpen: commands.paletteOpen,
		visible: overlayVisible,
	});

	return commands;
}
