import type {
	CodexCapability,
	CommitMessageCapability,
	RemoteBridgeCapability,
} from "../../shared/contracts.ts";
import { CodexCommentsPanel } from "../CodexCommentsPanel.tsx";
import type { useFailureReporting } from "../features/errors/useFailureReporting.ts";
import type { usePackageRuns } from "../features/packages/usePackageRuns.ts";
import type { useRepositoryManagement } from "../features/repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../features/repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../features/review/useReviewWorkflow.ts";
import { RemoteBridgeSheet } from "../RemoteBridgeSheet.tsx";
import { CommentComposerSheet } from "./CommentComposerSheet.tsx";
import { CommentsTray } from "./CommentsTray.tsx";
import { CommitComposerSheet } from "./CommitComposerSheet.tsx";
import { FailureDetailsSheet } from "./FailureDetailsSheet.tsx";
import { ManualCopySheet } from "./ManualCopySheet.tsx";
import { PackageRunSheet } from "./PackageRunSheet.tsx";
import { RepositoryPickerSheet } from "./RepositoryPickerSheet.tsx";
import { SearchSheet } from "./SearchSheet.tsx";

interface ReviewWorkspaceOverlaysProps {
	codexCapability: CodexCapability;
	commitMessageCapability: CommitMessageCapability;
	failureReporting: ReturnType<typeof useFailureReporting>;
	management: ReturnType<typeof useRepositoryManagement>;
	onRemoteBridgeOpenChange: (open: boolean) => void;
	packages: ReturnType<typeof usePackageRuns>;
	remoteBridgeCapability: RemoteBridgeCapability;
	remoteBridgeOpen: boolean;
	showToast: (message: string) => void;
	workflow: ReturnType<typeof useReviewWorkflow>;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
}

export function ReviewWorkspaceOverlays({
	codexCapability,
	commitMessageCapability,
	failureReporting,
	management,
	onRemoteBridgeOpenChange,
	packages,
	remoteBridgeCapability,
	remoteBridgeOpen,
	showToast,
	workflow,
	workspace,
}: ReviewWorkspaceOverlaysProps) {
	const { comments, commit, diff, search } = workflow;
	return (
		<>
			<RepositoryPickerSheet
				currentRepositoryId={workspace.repositoryId}
				forgetBusy={management.forgetBusy}
				nativeSetupAvailable={Boolean(workspace.repositoryId && workspace.repository)}
				onClose={() => management.setPickerOpen(false)}
				onForget={(entry) => void management.forgetRepository(entry)}
				onOpenNativeSetup={() => {
					management.setPickerOpen(false);
					onRemoteBridgeOpenChange(true);
				}}
				onRebuild={() => void management.rebuildAndRestart()}
				onSelect={management.selectRepository}
				open={management.pickerOpen}
				repositories={workspace.bootstrap?.repositories ?? []}
				restart={workspace.bootstrap?.restart ?? null}
				restartPhase={management.restartPhase}
			/>

			{workspace.bootstrap && workspace.repositoryId && workspace.repository && (
				<RemoteBridgeSheet
					capability={remoteBridgeCapability}
					csrfToken={workspace.bootstrap.csrfToken}
					onClose={() => onRemoteBridgeOpenChange(false)}
					onNotice={showToast}
					open={remoteBridgeOpen}
					repositoryId={workspace.repositoryId}
					repositoryName={workspace.repository.name}
					repositoryRoot={workspace.repository.root}
				/>
			)}

			<SearchSheet
				busy={search.busy}
				inputRef={search.inputRef}
				onClose={() => search.setOpen(false)}
				onQueryChange={(query) => {
					search.setQuery(query);
					search.setSourcePreview(null);
				}}
				onScopeChange={(scope) => {
					search.setScope(scope);
					search.setSourcePreview(null);
				}}
				onShowResults={() => search.setSourcePreview(null)}
				onShowSource={(match) => void search.showSource(match)}
				open={search.open}
				query={search.query}
				result={search.result}
				scope={search.scope}
				sourceBusy={search.sourceBusy}
				sourcePreview={search.sourcePreview}
			/>

			<CommentComposerSheet
				activeFile={diff.activeFile}
				body={comments.body}
				busy={comments.busy}
				editingComment={comments.editingComment}
				onBodyChange={comments.setBody}
				onClose={() => comments.setComposerOpen(false)}
				onSubmit={(event) => void comments.saveComment(event)}
				open={comments.composerOpen}
				selection={diff.commentSelection}
			/>

			<CommitComposerSheet
				busy={commit.busy}
				capability={commitMessageCapability}
				message={commit.message}
				messageBusy={commit.messageBusy}
				onClose={commit.closeComposer}
				onGenerate={() => void commit.generateMessage()}
				onMessageChange={commit.setMessage}
				onSubmit={(event) => void commit.commit(event)}
				open={commit.open}
				stagedCount={workspace.files.filter((file) => file.staged).length}
			/>

			<PackageRunSheet
				busyKey={packages.runBusy}
				clock={packages.clock}
				onClose={() => packages.setSelectedRunId(null)}
				onStop={() => void packages.stop()}
				outputRef={packages.outputRef}
				repositoryRoot={workspace.repository?.root}
				run={packages.selectedRunId ? packages.selectedRun : null}
				snapshot={packages.snapshot}
			/>

			<CommentsTray
				activeCommentCount={comments.activeComments.length}
				capability={codexCapability}
				comments={comments.comments}
				currentCommentCount={comments.currentCommentCount}
				focusedCommentId={comments.focusedCommentId}
				onClose={() => comments.setTrayOpen(false)}
				onCopy={() => void comments.copyComments()}
				onDelete={(comment) => void comments.deleteComment(comment)}
				onEdit={comments.editComment}
				onJump={comments.jumpToComment}
				onSendToCodex={() => {
					comments.setTrayOpen(false);
					comments.setCodexPanelOpen(true);
				}}
				open={comments.trayOpen}
			/>

			{comments.codexPanelOpen && workspace.repositoryId && workspace.bootstrap && (
				<CodexCommentsPanel
					capability={codexCapability}
					csrfToken={workspace.bootstrap.csrfToken}
					currentCommentCount={comments.currentCommentCount}
					onClose={() => comments.setCodexPanelOpen(false)}
					repositoryId={workspace.repositoryId}
					showToast={showToast}
				/>
			)}

			<FailureDetailsSheet
				failure={failureReporting.failure}
				onClose={() => failureReporting.setDetailsOpen(false)}
				onCopy={() => void failureReporting.copyDiagnostics()}
				open={failureReporting.detailsOpen}
			/>

			<ManualCopySheet
				onClose={() => comments.setCopyFallbackText("")}
				text={comments.copyFallbackText}
			/>
		</>
	);
}
