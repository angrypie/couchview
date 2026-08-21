import type { DiffResponse } from "../../../shared/contracts.ts";
import {
	GIT_API_ROUTES,
	type GitActionRequest,
	type GitActionResponse,
	type GitCommitChangesResponse,
	type GitHistoryResponse,
	type GitHistoryScope,
} from "../../../shared/git/index.ts";
import { request, withQuery } from "../../api.ts";

interface GitWorkspaceTransport {
	history(
		repositoryId: string,
		scope: GitHistoryScope,
		cursor: string | null,
		signal?: AbortSignal,
	): Promise<GitHistoryResponse>;
	commit(
		repositoryId: string,
		commit: string,
		signal?: AbortSignal,
	): Promise<GitCommitChangesResponse>;
	diff(
		repositoryId: string,
		commit: string,
		fileId: string,
		signal?: AbortSignal,
	): Promise<DiffResponse>;
	action(
		repositoryId: string,
		body: GitActionRequest,
		csrfToken: string,
		signal?: AbortSignal,
	): Promise<GitActionResponse>;
}

export const gitWorkspaceTransport: GitWorkspaceTransport = {
	history(repositoryId, scope, cursor, signal) {
		return request<GitHistoryResponse>(
			withQuery(GIT_API_ROUTES.history(repositoryId), { scope, cursor }),
			{ signal },
		);
	},
	commit(repositoryId, commit, signal) {
		return request<GitCommitChangesResponse>(GIT_API_ROUTES.historyCommit(repositoryId, commit), {
			signal,
		});
	},
	diff(repositoryId, commit, fileId, signal) {
		return request<DiffResponse>(GIT_API_ROUTES.historyDiff(repositoryId, commit, fileId), {
			signal,
		});
	},
	action(repositoryId, body, csrfToken, signal) {
		return request<GitActionResponse>(
			GIT_API_ROUTES.actions(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},
};
