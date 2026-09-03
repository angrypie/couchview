import { WifiOff } from "lucide-react-native";
import { View } from "react-native";

import type { RemoteBridgeCapability, TerminalCapability } from "../../shared/contracts.ts";
import type { ResolvedTheme } from "../../shared/theme.ts";
import type { usePackageRuns } from "../features/packages/usePackageRuns.ts";
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
import { Icon, Text } from "./ui";

interface ReviewWorkspaceChromeProps {
	commandPaletteShortcut: string;
	compactLandscape: boolean;
	display: ReturnType<typeof useDisplayPreferences>;
	drawerOpen: boolean;
	drawerView: DrawerView;
	failureAvailable: boolean;
	filters: ReturnType<typeof useChangedFileFilters>;
	onDrawerOpenChange: (open: boolean) => void;
	onDrawerViewChange: (view: DrawerView) => void;
	onOpenCommandPalette: () => void;
	onOpenFailure: () => void;
	onOpenArtifacts: () => void;
	onOpenGitHistory: () => void;
	onOpenRemoteBridge: () => void;
	onOpenRepositoryPicker: () => void;
	onOpenSettings: () => void;
	onOpenTerminal: () => void;
	packages: ReturnType<typeof usePackageRuns>;
	remoteBridgeCapability: RemoteBridgeCapability;
	splitView: boolean;
	terminalCapability: TerminalCapability;
	themeType: ResolvedTheme;
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
	onDrawerOpenChange,
	onDrawerViewChange,
	onOpenCommandPalette,
	onOpenFailure,
	onOpenArtifacts,
	onOpenGitHistory,
	onOpenRemoteBridge,
	onOpenRepositoryPicker,
	onOpenSettings,
	onOpenTerminal,
	packages,
	remoteBridgeCapability,
	splitView,
	terminalCapability,
	themeType,
	workflow,
	workspace,
	workspaceMode,
}: ReviewWorkspaceChromeProps) {
	const { diff, review, search, staging } = workflow;
	const commandsAvailable =
		packages.scripts.packages.length > 0 ||
		packages.scripts.warnings.length > 0 ||
		packages.runs.length > 0;
	const activeFileFullyStaged = Boolean(diff.activeFile?.staged && !diff.activeFile.unstaged);

	return (
		<View className="min-h-0 flex-1 flex-row overflow-hidden bg-background">
			<ChangedFilesDrawer
				bulkReviewBusy={review.bulkBusy}
				bulkStageBusy={staging.bulkBusy}
				changeTotals={filters.changeTotals}
				commandsAvailable={commandsAvailable}
				commandsLoading={packages.commandsLoading}
				commitBusy={workflow.commit.busy}
				currentFileId={diff.readOnly ? null : diff.currentFileId}
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

			<View className="min-w-0 flex-1 bg-background">
				<ReviewTopBar
					activeFile={diff.activeFile}
					activePath={diff.activePath}
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
					onFontSizeChange={display.setFontSize}
					onLineNumbersChange={display.setLineNumbersVisible}
					onLineWrapChange={display.setLineWrapEnabled}
					onCopyLink={workflow.copyCurrentLink}
					onNavigateHunk={diff.navigateHunk}
					onOpenCommandPalette={onOpenCommandPalette}
					onOpenDrawer={() => onDrawerOpenChange(true)}
					onOpenArtifacts={onOpenArtifacts}
					onOpenGitHistory={onOpenGitHistory}
					onOpenRemoteBridge={onOpenRemoteBridge}
					onOpenRepositoryPicker={onOpenRepositoryPicker}
					onOpenSettings={onOpenSettings}
					onOpenTerminal={onOpenTerminal}
					remoteBridgeCapability={remoteBridgeCapability}
					readOnly={diff.readOnly}
					repository={workspace.repository}
					repositoryId={workspace.repositoryId}
					reviewedCount={filters.reviewedCount}
					splitView={splitView}
					terminalActive={workspaceMode === "terminal"}
					terminalCapability={terminalCapability}
				/>

				{workspace.connectionState === "offline" && !compactLandscape ? (
					<View
						accessibilityLiveRegion="polite"
						className="flex-row items-center justify-center gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5"
						role="status"
					>
						<Icon as={WifiOff} size={13} tone="destructive" />
						<Text className="text-xs font-medium text-destructive">
							Offline — cannot reach the local server
						</Text>
					</View>
				) : null}

				<CurrentFileBar
					activeFile={diff.activeFile}
					activePath={diff.activePath}
					diff={diff.diff}
					onCopyLink={workflow.copyCurrentLink}
					onOpenSettings={onOpenSettings}
					readOnly={diff.readOnly}
					visible={!compactLandscape}
				/>

				<DiffWorkspace
					diff={diff.diff}
					diffError={diff.error}
					diffLoading={diff.loading}
					failureAvailable={failureAvailable}
					fileCount={workspace.files.length}
					fontSize={display.fontSize}
					lineNumbersVisible={display.lineNumbersVisible}
					lineWrapEnabled={display.lineWrapEnabled}
					onIdentifierClick={search.openWithQuery}
					onOpenFailure={onOpenFailure}
					onRetry={diff.retry}
					onVisibleLineChange={diff.handleVisibleLineChange}
					readOnly={diff.readOnly}
					repositoryId={workspace.repositoryId}
					retryAvailable={Boolean(diff.activePath)}
					rowCount={diff.rows.length}
					themeType={themeType}
					typography={display.typography.diff}
					viewerRef={diff.viewerRef}
				/>

				<ReviewBottomBar
					activeFile={diff.activeFile}
					activeFileFullyStaged={activeFileFullyStaged}
					activeFileIndex={diff.activeFileIndex}
					bulkStageBusy={staging.bulkBusy !== null}
					canNavigateNextHunk={diff.canNavigateNextHunk}
					canNavigatePreviousHunk={diff.canNavigatePreviousHunk}
					fileCount={workspace.files.length}
					onNavigateFile={diff.navigateFile}
					onNavigateHunk={diff.navigateHunk}
					onReview={() =>
						diff.activeFile &&
						void review.setReviewed(diff.activeFile, !diff.activeFile.reviewed, true)
					}
					onToggleStage={() => void staging.toggleActiveFile()}
					reviewBusy={review.busy}
					stageBusy={staging.busy}
				/>
			</View>
		</View>
	);
}
