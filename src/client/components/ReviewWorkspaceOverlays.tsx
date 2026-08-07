import type { CommitMessageCapability, RemoteBridgeCapability } from "../../shared/contracts.ts";
import type { useFailureReporting } from "../features/errors/useFailureReporting.ts";
import type { usePackageRuns } from "../features/packages/usePackageRuns.ts";
import type { useRepositoryManagement } from "../features/repositories/useRepositoryManagement.ts";
import type { useRepositoryWorkspace } from "../features/repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../features/review/useReviewWorkflow.ts";
import { RemoteBridgeSheet } from "../RemoteBridgeSheet.tsx";
import { CommitComposerSheet } from "./CommitComposerSheet.tsx";
import { FailureDetailsSheet } from "./FailureDetailsSheet.tsx";
import { PackageRunSheet } from "./PackageRunSheet.tsx";
import { RepositoryPickerSheet } from "./RepositoryPickerSheet.tsx";
import { SearchSheet } from "./SearchSheet.tsx";

interface ReviewWorkspaceOverlaysProps {
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
	const { commit, search } = workflow;
	return (
		<>
			<RepositoryPickerSheet
				addBusy={management.addBusy}
				addRoot={management.addRoot}
				currentRepositoryId={workspace.repositoryId}
				directoryBrowser={management.directoryBrowser}
				forgetBusy={management.forgetBusy}
				nativeSetupAvailable={Boolean(workspace.repositoryId && workspace.repository)}
				onAdd={() => void management.addRepository()}
				onAddDirectory={(path) => void management.addRepository(path)}
				onAddRootChange={management.setAddRoot}
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

			<FailureDetailsSheet
				failure={failureReporting.failure}
				onClose={() => failureReporting.setDetailsOpen(false)}
				onCopy={() => void failureReporting.copyDiagnostics()}
				open={failureReporting.detailsOpen}
			/>
		</>
	);
}
