import { useCallback } from "react";
import type { ChangeFile } from "../../../shared/contracts.ts";
import type { useAppCommands } from "../commands/useAppCommands.ts";
import { useAppCommands as useCommands } from "../commands/useAppCommands.ts";
import type { useFailureReporting } from "../errors/useFailureReporting.ts";
import type { usePackageRuns } from "../packages/usePackageRuns.ts";
import type { useRepositoryManagement } from "../repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../review/useReviewWorkflow.ts";
import type { useDisplayPreferences } from "../settings/useDisplayPreferences.ts";
import type { DrawerView } from "../staging/types.ts";
import { useOverlayAccessibility } from "./useOverlayAccessibility.ts";
import type { useWorkspaceNavigation } from "./useWorkspaceNavigation.ts";

interface UseReviewShellCommandsOptions {
	display: ReturnType<typeof useDisplayPreferences>;
	drawerOpen: boolean;
	failure: ReturnType<typeof useFailureReporting>;
	management: ReturnType<typeof useRepositoryManagement>;
	navigation: ReturnType<typeof useWorkspaceNavigation>;
	onDrawerOpenChange: (open: boolean) => void;
	onDrawerViewChange: (view: DrawerView) => void;
	onRemoteBridgeOpenChange: (open: boolean) => void;
	packages: ReturnType<typeof usePackageRuns>;
	remoteBridgeOpen: boolean;
	splitView: boolean;
	stagedCount: number;
	workflow: ReturnType<typeof useReviewWorkflow>;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
}

export function useReviewShellCommands({
	display,
	drawerOpen,
	failure,
	management,
	navigation,
	onDrawerOpenChange,
	onDrawerViewChange,
	onRemoteBridgeOpenChange,
	packages,
	remoteBridgeOpen,
	splitView,
	stagedCount,
	workflow,
	workspace,
}: UseReviewShellCommandsOptions): ReturnType<typeof useAppCommands> & {
	openComments: () => void;
} {
	const { comments, commit, diff, review, search, staging } = workflow;
	const overlayVisible =
		management.pickerOpen ||
		remoteBridgeOpen ||
		search.open ||
		failure.detailsOpen ||
		commit.open ||
		Boolean(packages.selectedRunId) ||
		comments.composerOpen ||
		comments.trayOpen ||
		Boolean(comments.copyFallbackText) ||
		(!splitView && drawerOpen);

	const dismissAll = useCallback(() => {
		management.setPickerOpen(false);
		onRemoteBridgeOpenChange(false);
		search.setOpen(false);
		failure.setDetailsOpen(false);
		commit.closeComposer();
		packages.setSelectedRunId(null);
		comments.setComposerOpen(false);
		comments.setTrayOpen(false);
		comments.setCopyFallbackText("");
		onDrawerOpenChange(false);
	}, [
		comments,
		commit,
		failure,
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
		window.setTimeout(() => search.inputRef.current?.focus(), 30);
	}, [search]);
	const openComments = useCallback(() => {
		comments.setFocusedCommentId(null);
		comments.setTrayOpen(true);
	}, [comments]);
	const reviewFile = useCallback(
		(file: ChangeFile) => {
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
		onComments: openComments,
		onDismissOverlays: dismissAll,
		onNavigateFile: diff.navigateFile,
		onNavigateHunk: diff.navigateHunk,
		onOpenCommit: commit.openComposer,
		onOpenFiles: openFiles,
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
		workspaceMode: navigation.mode,
	});

	const dismissTop = useCallback(() => {
		if (comments.copyFallbackText) comments.setCopyFallbackText("");
		else if (failure.detailsOpen) failure.setDetailsOpen(false);
		else if (management.pickerOpen) management.setPickerOpen(false);
		else if (remoteBridgeOpen) onRemoteBridgeOpenChange(false);
		else if (commit.open) commit.closeComposer();
		else if (packages.selectedRunId) packages.setSelectedRunId(null);
		else if (comments.composerOpen) comments.setComposerOpen(false);
		else if (comments.trayOpen) comments.setTrayOpen(false);
		else if (search.open) search.setOpen(false);
		else onDrawerOpenChange(false);
	}, [
		comments,
		commit,
		failure,
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

	return { ...commands, openComments };
}
