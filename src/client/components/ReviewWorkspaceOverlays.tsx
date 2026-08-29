import type { CommitMessageCapability, RemoteBridgeCapability } from "../../shared/contracts.ts";
import type { useFailureReporting } from "../features/errors/useFailureReporting.ts";
import type { usePackageRuns } from "../features/packages/usePackageRuns.ts";
import type { useRepositoryWorkspace } from "../features/repositories/useRepositoryWorkspace.ts";
import type { useReviewWorkflow } from "../features/review/useReviewWorkflow.ts";
import { RemoteBridgeSheet } from "../RemoteBridgeSheet.tsx";
import { CommitComposerSheet } from "./CommitComposerSheet.tsx";
import { FailureDetailsSheet } from "./FailureDetailsSheet.tsx";
import { PackageRunSheet } from "./PackageRunSheet.tsx";
import { SearchSheet } from "./SearchSheet.tsx";

interface ReviewWorkspaceOverlaysProps {
	commitMessageCapability: CommitMessageCapability;
	failureReporting: ReturnType<typeof useFailureReporting>;
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
				onClose={() => search.setOpen(false)}
				onQueryChange={search.setQuery}
				onScopeChange={search.setScope}
				onSelectMatch={search.selectMatch}
				open={search.open}
				query={search.query}
				result={search.result}
				scope={search.scope}
			/>

			<CommitComposerSheet
				busy={commit.busy}
				capability={commitMessageCapability}
				message={commit.message}
				messageBusy={commit.messageBusy}
				onClose={commit.closeComposer}
				onGenerate={() => void commit.generateMessage()}
				onMessageChange={commit.setMessage}
				onSubmit={() => void commit.commit()}
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
