import type { ChangeKind, ChangesResponse } from "../contracts.ts";

export type GitHistoryScope = "current" | "all";

export interface GitCommitSummary {
	id: string;
	shortId: string;
	parents: string[];
	subject: string;
	authorName: string;
	authoredAt: string;
	decorations: string[];
}

export interface GitHistoryFile {
	id: string;
	path: string;
	previousPath: string | null;
	kind: ChangeKind;
	binary: boolean;
	additions: number | null;
	deletions: number | null;
}

export interface GitWorkspaceStatus {
	previousBranch: string | null;
	stashCount: number;
	canUndoLastCommit: boolean;
	trackedChangeCount: number;
	untrackedChangeCount: number;
}

export interface GitHistoryResponse {
	commits: GitCommitSummary[];
	nextCursor: string | null;
	historyRevision: string;
	scope: GitHistoryScope;
	status: GitWorkspaceStatus;
}

export interface GitCommitChangesResponse {
	commit: GitCommitSummary;
	files: GitHistoryFile[];
}

interface GitActionRequestBase {
	operationRevision: string;
}

export type GitActionRequest =
	| (GitActionRequestBase & { action: "checkout"; commit: string })
	| (GitActionRequestBase & { action: "return" })
	| (GitActionRequestBase & { action: "stash" })
	| (GitActionRequestBase & { action: "restore-stash" })
	| (GitActionRequestBase & { action: "undo-last-commit" })
	| (GitActionRequestBase & { action: "clean" });

export interface GitActionResponse extends ChangesResponse {
	status: GitWorkspaceStatus;
	warning: string | null;
}
