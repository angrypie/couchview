import { useEffect } from "react";
import type {
	CodexGenerationPreferences,
	CommitMessageCapability,
} from "../../../shared/contracts.ts";
import type { FailureState } from "../../lib/failures.ts";
import { useReviewComments } from "../comments/useReviewComments.ts";
import { useCommitWorkflow } from "../commit/useCommitWorkflow.ts";
import { useRepositoryEvents } from "../repositories/useRepositoryEvents.ts";
import type { useRepositoryWorkspace } from "../repositories/useRepositoryWorkspace.ts";
import { useRepositorySearch } from "../search/useRepositorySearch.ts";
import { useStagingWorkflow } from "../staging/useStagingWorkflow.ts";
import { useDiffReview } from "./useDiffReview.ts";
import type { UndoReview } from "./useReviewStatus.ts";
import { useReviewStatus } from "./useReviewStatus.ts";

interface UseReviewWorkflowOptions {
	closeDrawer: () => void;
	commitMessageCapability: CommitMessageCapability;
	codexPreferences: CodexGenerationPreferences;
	dismissToast: () => void;
	refreshPackageScripts: () => Promise<unknown>;
	reportFailure: (error: unknown, context: string) => FailureState;
	showToast: (message: string, undo?: UndoReview, details?: boolean) => void;
	stagedCount: number;
	workspace: ReturnType<typeof useRepositoryWorkspace>;
}

export function useReviewWorkflow({
	closeDrawer,
	commitMessageCapability,
	codexPreferences,
	dismissToast,
	refreshPackageScripts,
	reportFailure,
	showToast,
	stagedCount,
	workspace,
}: UseReviewWorkflowOptions) {
	const diff = useDiffReview({
		files: workspace.files,
		onFileSelected: closeDrawer,
		reportFailure,
		repositoryId: workspace.repositoryId,
	});
	const search = useRepositorySearch({
		activeFile: diff.activeFile,
		repositoryId: workspace.repositoryId,
		showToast,
	});
	const comments = useReviewComments({
		activeFile: diff.activeFile,
		csrfToken: workspace.bootstrap?.csrfToken,
		currentFileId: diff.currentFileId,
		diff: diff.diff,
		files: workspace.files,
		onSelectFile: diff.selectFile,
		repositoryId: workspace.repositoryId,
		rows: diff.rows,
		selection: diff.commentSelection,
		setFiles: workspace.setFiles,
		setSelection: diff.setSelection,
		showToast,
		viewerRef: diff.viewerRef,
	});
	const review = useReviewStatus({
		activeFileIndex: diff.activeFileIndex,
		csrfToken: workspace.bootstrap?.csrfToken,
		dismissToast,
		files: workspace.files,
		onSelectFile: diff.selectFile,
		refreshReviewState: comments.refreshReviewState,
		repositoryId: workspace.repositoryId,
		setFiles: workspace.setFiles,
		showToast,
	});
	const staging = useStagingWorkflow({
		activeFile: diff.activeFile,
		activeFileIndex: diff.activeFileIndex,
		csrfToken: workspace.bootstrap?.csrfToken,
		currentFileId: diff.currentFileId,
		diff: diff.diff,
		files: workspace.files,
		loadDiff: diff.loadDiff,
		onOperationRevision: workspace.applyOperationRevision,
		operationRevision: workspace.operationRevision,
		refreshChanges: workspace.refreshChanges,
		reportFailure,
		repositoryId: workspace.repositoryId,
		setCurrentFileId: diff.setCurrentFileId,
		setDiff: diff.setDiff,
		setFiles: workspace.setFiles,
		showToast,
	});
	const commit = useCommitWorkflow({
		capability: commitMessageCapability,
		codexPreferences,
		csrfToken: workspace.bootstrap?.csrfToken,
		onCommittedStateRefresh: comments.refreshReviewState,
		onOpen: closeDrawer,
		onOperationRevision: workspace.applyOperationRevision,
		operationRevision: workspace.operationRevision,
		refreshChanges: workspace.refreshChanges,
		reportFailure,
		repositoryId: workspace.repositoryId,
		showToast,
		stagedCount,
	});

	useEffect(() => {
		if (!workspace.repositoryId) return;
		void comments.refreshReviewState().catch(workspace.markConnectionFailure);
	}, [comments.refreshReviewState, workspace.markConnectionFailure, workspace.repositoryId]);

	useRepositoryEvents({
		clearRepositorySelection: workspace.clearRepositorySelection,
		getCurrentFileId: diff.getCurrentFileId,
		getDiff: diff.getDiff,
		getOperationRevision: workspace.getOperationRevision,
		getRepositoryId: workspace.getRepositoryId,
		loadDiff: diff.loadDiff,
		loadRepository: workspace.loadRepository,
		markConnectionFailure: workspace.markConnectionFailure,
		phase: workspace.phase,
		queueExternalStageChange: staging.queueExternalChange,
		refreshChanges: workspace.refreshChanges,
		refreshPackageScripts,
		refreshRepositories: workspace.refreshRepositories,
		refreshReviewState: comments.refreshReviewState,
		repositoryId: workspace.repositoryId,
		repositoryLoading: workspace.repositoryLoading,
		setConnectionState: workspace.setConnectionState,
		setDiff: diff.setDiff,
	});

	return {
		comments,
		commit,
		diff,
		review,
		search,
		staging,
	};
}
