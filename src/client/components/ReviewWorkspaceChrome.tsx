import { WifiOff } from "lucide-react";
import type { RemoteBridgeCapability, TerminalCapability } from "../../shared/contracts.ts";
import type { usePackageRuns } from "../features/packages/usePackageRuns.ts";
import type { useRepositoryManagement } from "../features/repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../features/repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../features/review/useReviewWorkflow.ts";
import type { useDisplayPreferences } from "../features/settings/useDisplayPreferences.ts";
import type { WorkspaceMode } from "../features/shell/useWorkspaceNavigation.ts";
import type { DrawerView } from "../features/staging/types.ts";
import type { useChangedFileFilters } from "../features/staging/useChangedFileFilters.ts";
import { ChangedFilesDrawer } from "./ChangedFilesDrawer.tsx";
import { CurrentFileBar } from "./CurrentFileBar.tsx";
import { DiffWorkspace } from "./DiffWorkspace.tsx";
import { ReviewBottomBar } from "./ReviewBottomBar.tsx";
import { ReviewTopBar } from "./ReviewTopBar.tsx";

interface ReviewWorkspaceChromeProps {
	commandPaletteShortcut: string;
	compactLandscape: boolean;
	display: ReturnType<typeof useDisplayPreferences>;
	drawerOpen: boolean;
	drawerView: DrawerView;
	failureAvailable: boolean;
	filters: ReturnType<typeof useChangedFileFilters>;
	management: ReturnType<typeof useRepositoryManagement>;
	onDrawerOpenChange: (open: boolean) => void;
	onDrawerViewChange: (view: DrawerView) => void;
	onOpenCommandPalette: () => void;
	onOpenComments: () => void;
	onOpenFailure: () => void;
	onOpenGitHistory: () => void;
	onOpenRemoteBridge: () => void;
	onOpenSettings: () => void;
	onOpenTerminal: () => void;
	packages: ReturnType<typeof usePackageRuns>;
	remoteBridgeCapability: RemoteBridgeCapability;
	splitView: boolean;
	terminalCapability: TerminalCapability;
	workflow: ReturnType<typeof useReviewWorkflow>;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
	workspaceMode: WorkspaceMode;
}

export function ReviewWorkspaceChrome({
	commandPaletteShortcut,
	compactLandscape,
	display,
	drawerOpen,
	drawerView,
	failureAvailable,
	filters,
	management,
	onDrawerOpenChange,
	onDrawerViewChange,
	onOpenCommandPalette,
	onOpenComments,
	onOpenFailure,
	onOpenGitHistory,
	onOpenRemoteBridge,
	onOpenSettings,
	onOpenTerminal,
	packages,
	remoteBridgeCapability,
	splitView,
	terminalCapability,
	workflow,
	workspace,
	workspaceMode,
}: ReviewWorkspaceChromeProps) {
	const { comments, diff, review, search, staging } = workflow;
	const commandsAvailable =
		packages.scripts.packages.length > 0 ||
		packages.scripts.warnings.length > 0 ||
		packages.runs.length > 0;
	const activeFileFullyStaged = Boolean(diff.activeFile?.staged && !diff.activeFile.unstaged);

	return (
		<>
			<ChangedFilesDrawer
				bulkReviewBusy={review.bulkBusy}
				bulkStageBusy={staging.bulkBusy}
				changeTotals={filters.changeTotals}
				commandsAvailable={commandsAvailable}
				commandsLoading={packages.commandsLoading}
				commitBusy={workflow.commit.busy}
				currentFileId={diff.currentFileId}
				fileQuery={filters.fileQuery}
				files={workspace.files}
				filteredFiles={filters.filteredFiles}
				filteredReviewedCount={filters.filteredReviewedFiles.length}
				onClose={() => onDrawerOpenChange(false)}
				onCommit={workflow.commit.openComposer}
				onFileQueryChange={filters.setFileQuery}
				onOpenRun={packages.openRun}
				onReviewFilterChange={filters.setReviewFilter}
				onSelectFile={diff.selectFile}
				onStageFilterChange={filters.setStageFilter}
				onStageMultiple={(scope) => void staging.stageMultiple(scope)}
				onStartScript={(packageEntry, script) => void packages.start(packageEntry, script)}
				onUnreviewMultiple={() => void review.unreviewMultiple(filters.filteredReviewedFiles)}
				onViewChange={onDrawerViewChange}
				open={drawerOpen || splitView}
				packageRunBusy={packages.runBusy}
				packageRuns={packages.runs}
				packageScripts={packages.scripts}
				reviewFilter={filters.reviewFilter}
				splitView={splitView}
				stageBusy={staging.busy}
				stageFilter={filters.stageFilter}
				stageableCount={filters.stageableCount}
				stageableReviewedCount={filters.stageableReviewedCount}
				stagedCount={filters.stagedCount}
				view={drawerView}
			/>

			<ReviewTopBar
				activeFile={diff.activeFile}
				canNavigateNextHunk={diff.canNavigateNextHunk}
				canNavigatePreviousHunk={diff.canNavigatePreviousHunk}
				commandPaletteShortcut={commandPaletteShortcut}
				compactLandscape={compactLandscape}
				connectionState={workspace.connectionState}
				diff={diff.diff}
				fileCount={workspace.files.length}
				fontSize={display.fontSize}
				lineNumbersVisible={display.lineNumbersVisible}
				lineWrapEnabled={display.lineWrapEnabled}
				onComments={onOpenComments}
				onFontSizeChange={display.setFontSize}
				onLineNumbersChange={display.setLineNumbersVisible}
				onLineWrapChange={display.setLineWrapEnabled}
				onNavigateHunk={diff.navigateHunk}
				onOpenCommandPalette={onOpenCommandPalette}
				onOpenDrawer={() => onDrawerOpenChange(true)}
				onOpenGitHistory={onOpenGitHistory}
				onOpenRemoteBridge={onOpenRemoteBridge}
				onOpenRepositoryPicker={management.openPicker}
				onOpenSettings={onOpenSettings}
				onOpenTerminal={onOpenTerminal}
				remoteBridgeCapability={remoteBridgeCapability}
				repository={workspace.repository}
				repositoryId={workspace.repositoryId}
				reviewedCount={filters.reviewedCount}
				splitView={splitView}
				terminalActive={workspaceMode === "terminal"}
				terminalCapability={terminalCapability}
				totalCommentCount={comments.comments.length}
			/>

			{workspace.connectionState === "offline" && !compactLandscape && (
				<div className="disconnected-banner" style={{ gridColumn: splitView ? 2 : undefined }}>
					<WifiOff size={12} /> Offline — cannot reach the local server
				</div>
			)}

			<CurrentFileBar
				activeFile={diff.activeFile}
				diff={diff.diff}
				onOpenSettings={onOpenSettings}
				visible={!compactLandscape}
			/>

			<DiffWorkspace
				commentComposerOpen={comments.composerOpen}
				comments={comments.comments}
				diff={diff.diff}
				diffError={diff.error}
				diffLoading={diff.loading}
				failureAvailable={failureAvailable}
				fileCount={workspace.files.length}
				fontSize={display.fontSize}
				lineNumbersVisible={display.lineNumbersVisible}
				lineWrapEnabled={display.lineWrapEnabled}
				onClearSelection={() => diff.setSelection(null)}
				onCommentClick={comments.openInlineComment}
				onIdentifierClick={search.openWithQuery}
				onLineNumberClick={diff.handleViewerLineNumberClick}
				onOpenCommentComposer={comments.openComposer}
				onOpenFailure={onOpenFailure}
				onRetry={() => {
					if (!diff.currentFileId) return;
					const retryId = diff.currentFileId;
					diff.setCurrentFileId(null);
					window.setTimeout(() => diff.setCurrentFileId(retryId), 0);
				}}
				onVisibleLineChange={diff.handleVisibleLineChange}
				retryAvailable={Boolean(diff.currentFileId)}
				rowCount={diff.rows.length}
				selection={diff.commentSelection}
				typography={display.typography.diff}
				viewerRef={diff.viewerRef}
				viewerSelection={diff.viewerSelection}
			/>

			<ReviewBottomBar
				activeFile={diff.activeFile}
				activeFileFullyStaged={activeFileFullyStaged}
				activeFileIndex={diff.activeFileIndex}
				bulkStageBusy={staging.bulkBusy !== null}
				canNavigateNextHunk={diff.canNavigateNextHunk}
				canNavigatePreviousHunk={diff.canNavigatePreviousHunk}
				fileCount={workspace.files.length}
				onComments={onOpenComments}
				onNavigateFile={diff.navigateFile}
				onNavigateHunk={diff.navigateHunk}
				onReview={() =>
					diff.activeFile &&
					void review.setReviewed(diff.activeFile, !diff.activeFile.reviewed, true)
				}
				onToggleStage={() => void staging.toggleActiveFile()}
				reviewBusy={review.busy}
				stageBusy={staging.busy}
				totalCommentCount={comments.comments.length}
			/>
		</>
	);
}
