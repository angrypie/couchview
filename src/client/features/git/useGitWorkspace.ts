import { useCallback, useEffect, useRef, useState } from "react";

import type { ChangesResponse, FileDiff } from "../../../shared/contracts.ts";
import type {
	GitActionRequest,
	GitCommitChangesResponse,
	GitCommitSummary,
	GitHistoryScope,
	GitWorkspaceStatus,
} from "../../../shared/git/index.ts";
import type { FailureState } from "../../lib/failures.ts";
import { gitWorkspaceTransport } from "./api.ts";

const DETAIL_CACHE_LIMIT = 8;
const DIFF_CACHE_LIMIT = 12;

export type GitPendingAction =
	| { action: "checkout"; commit: GitCommitSummary }
	| { action: Exclude<GitActionRequest["action"], "checkout"> };

interface UseGitWorkspaceOptions {
	active: boolean;
	csrfToken: string | undefined;
	onRepositoryState: (response: ChangesResponse) => void;
	operationRevision: string;
	reportFailure: (error: unknown, context: string) => FailureState;
	repositoryId: string | null;
	showToast: (message: string) => void;
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
	cache.delete(key);
	cache.set(key, value);
	while (cache.size > limit) cache.delete(cache.keys().next().value as K);
}

function actionLabel(action: GitActionRequest["action"]): string {
	switch (action) {
		case "checkout":
			return "Commit checked out";
		case "return":
			return "Returned to previous branch";
		case "stash":
			return "Repository changes stashed";
		case "restore-stash":
			return "Latest stash restored";
		case "undo-last-commit":
			return "Last commit undone; changes kept locally";
		case "clean":
			return "Repository cleaned";
	}
}

export function useGitWorkspace({
	active,
	csrfToken,
	onRepositoryState,
	operationRevision,
	reportFailure,
	repositoryId,
	showToast,
}: UseGitWorkspaceOptions) {
	const [scope, setScopeState] = useState<GitHistoryScope>("current");
	const [commits, setCommits] = useState<GitCommitSummary[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [status, setStatus] = useState<GitWorkspaceStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadMoreBusy, setLoadMoreBusy] = useState(false);
	const [details, setDetails] = useState<GitCommitChangesResponse | null>(null);
	const [detailsBusy, setDetailsBusy] = useState(false);
	const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
	const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
	const [diff, setDiff] = useState<FileDiff | null>(null);
	const [diffBusy, setDiffBusy] = useState(false);
	const [pendingAction, setPendingAction] = useState<GitPendingAction | null>(null);
	const [actionBusy, setActionBusy] = useState<GitActionRequest["action"] | null>(null);
	const nextCursorRef = useRef<string | null>(null);
	const loadMoreBusyRef = useRef(false);
	const historyRequest = useRef<AbortController | null>(null);
	const detailRequest = useRef<AbortController | null>(null);
	const diffRequest = useRef<AbortController | null>(null);
	const actionRequest = useRef<AbortController | null>(null);
	const detailCache = useRef(new Map<string, GitCommitChangesResponse>());
	const diffCache = useRef(new Map<string, FileDiff>());

	const loadHistory = useCallback(
		async (reset: boolean) => {
			if (!repositoryId) return;
			if (reset) {
				historyRequest.current?.abort();
				loadMoreBusyRef.current = false;
				setLoadMoreBusy(false);
				setLoading(true);
			} else {
				if (!nextCursorRef.current || loadMoreBusyRef.current) return;
				loadMoreBusyRef.current = true;
				setLoadMoreBusy(true);
			}
			const controller = new AbortController();
			historyRequest.current = controller;
			try {
				const response = await gitWorkspaceTransport.history(
					repositoryId,
					scope,
					reset ? null : nextCursorRef.current,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				setCommits((current) => (reset ? response.commits : [...current, ...response.commits]));
				nextCursorRef.current = response.nextCursor;
				setNextCursor(response.nextCursor);
				setStatus(response.status);
			} catch (error) {
				if (controller.signal.aborted) return;
				reportFailure(error, reset ? "Load Git history" : "Load more Git history");
			} finally {
				if (historyRequest.current === controller) {
					historyRequest.current = null;
					if (reset) setLoading(false);
					else {
						loadMoreBusyRef.current = false;
						setLoadMoreBusy(false);
					}
				}
			}
		},
		[reportFailure, repositoryId, scope],
	);

	const selectCommit = useCallback(
		async (commit: GitCommitSummary) => {
			if (!repositoryId) return;
			detailRequest.current?.abort();
			diffRequest.current?.abort();
			setSelectedCommitId(commit.id);
			setSelectedFileId(null);
			setDiff(null);
			const cached = detailCache.current.get(commit.id);
			if (cached) {
				setDetailsBusy(false);
				setDiffBusy(false);
				setDetails(cached);
				return;
			}
			const controller = new AbortController();
			detailRequest.current = controller;
			setDetails(null);
			setDetailsBusy(true);
			try {
				const response = await gitWorkspaceTransport.commit(
					repositoryId,
					commit.id,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				remember(detailCache.current, commit.id, response, DETAIL_CACHE_LIMIT);
				setDetails(response);
			} catch (error) {
				if (!controller.signal.aborted) reportFailure(error, "Load commit changes");
			} finally {
				if (detailRequest.current === controller) {
					detailRequest.current = null;
					setDetailsBusy(false);
				}
			}
		},
		[reportFailure, repositoryId],
	);

	const selectFile = useCallback(
		async (fileId: string) => {
			if (!repositoryId || !details) return;
			diffRequest.current?.abort();
			setSelectedFileId(fileId);
			const key = `${details.commit.id}:${fileId}`;
			const cached = diffCache.current.get(key);
			if (cached) {
				setDiffBusy(false);
				setDiff(cached);
				return;
			}
			const controller = new AbortController();
			diffRequest.current = controller;
			setDiffBusy(true);
			try {
				const response = await gitWorkspaceTransport.diff(
					repositoryId,
					details.commit.id,
					fileId,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				remember(diffCache.current, key, response.diff, DIFF_CACHE_LIMIT);
				setDiff(response.diff);
			} catch (error) {
				if (!controller.signal.aborted) reportFailure(error, "Load commit diff");
			} finally {
				if (diffRequest.current === controller) {
					diffRequest.current = null;
					setDiffBusy(false);
				}
			}
		},
		[details, reportFailure, repositoryId],
	);

	const performAction = useCallback(
		async (pending: GitPendingAction) => {
			if (!repositoryId || !csrfToken || actionBusy || actionRequest.current) return;
			const request: GitActionRequest =
				pending.action === "checkout"
					? {
							action: "checkout",
							commit: pending.commit.id,
							operationRevision,
						}
					: { action: pending.action, operationRevision };
			const controller = new AbortController();
			actionRequest.current = controller;
			setActionBusy(request.action);
			try {
				const response = await gitWorkspaceTransport.action(
					repositoryId,
					request,
					csrfToken,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				onRepositoryState(response);
				setStatus(response.status);
				setPendingAction(null);
				showToast(response.warning ?? actionLabel(request.action));
			} catch (error) {
				if (!controller.signal.aborted) reportFailure(error, "Run Git action");
			} finally {
				if (actionRequest.current === controller) actionRequest.current = null;
				setActionBusy(null);
			}
		},
		[
			actionBusy,
			csrfToken,
			onRepositoryState,
			operationRevision,
			reportFailure,
			repositoryId,
			showToast,
		],
	);

	const performPendingAction = useCallback(async () => {
		if (pendingAction) await performAction(pendingAction);
	}, [pendingAction, performAction]);

	const setScope = useCallback((nextScope: GitHistoryScope) => {
		historyRequest.current?.abort();
		detailRequest.current?.abort();
		diffRequest.current?.abort();
		loadMoreBusyRef.current = false;
		setScopeState(nextScope);
		setCommits([]);
		nextCursorRef.current = null;
		setNextCursor(null);
		setDetails(null);
		setSelectedCommitId(null);
		setSelectedFileId(null);
		setDiff(null);
		setLoadMoreBusy(false);
	}, []);

	const showCommits = useCallback(() => {
		detailRequest.current?.abort();
		diffRequest.current?.abort();
		setSelectedCommitId(null);
		setDetails(null);
		setSelectedFileId(null);
		setDiff(null);
	}, []);

	const showFiles = useCallback(() => {
		diffRequest.current?.abort();
		setSelectedFileId(null);
		setDiff(null);
	}, []);

	useEffect(() => {
		historyRequest.current?.abort();
		detailRequest.current?.abort();
		diffRequest.current?.abort();
		actionRequest.current?.abort();
		detailCache.current.clear();
		diffCache.current.clear();
		setCommits([]);
		nextCursorRef.current = null;
		setNextCursor(null);
		setStatus(null);
		setDetails(null);
		setSelectedCommitId(null);
		setSelectedFileId(null);
		setDiff(null);
		setPendingAction(null);
	}, [repositoryId]);

	useEffect(() => {
		if (!active || !repositoryId) return;
		void loadHistory(true);
	}, [active, loadHistory, operationRevision, repositoryId]);

	return {
		actionBusy,
		commits,
		details,
		detailsBusy,
		diff,
		diffBusy,
		loadMore: () => loadHistory(false),
		loadMoreBusy,
		loading,
		nextCursor,
		pendingAction,
		performPendingAction,
		requestAction: setPendingAction,
		returnToPreviousBranch: () => performAction({ action: "return" }),
		scope,
		selectCommit,
		selectedCommitId,
		selectedFileId,
		selectFile,
		setScope,
		showCommits,
		showFiles,
		status,
	};
}

export type GitWorkspaceController = ReturnType<typeof useGitWorkspace>;
