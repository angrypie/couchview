import type { DiffResponse } from "../../shared/contracts.ts";
import type {
	GitActionRequest,
	GitActionResponse,
	GitCommitChangesResponse,
	GitHistoryResponse,
	GitHistoryScope,
} from "../../shared/git/index.ts";
import { decodeSegment, json, readJsonObject } from "../serverHttp.ts";

interface GitWorkspaceRouteRepository {
	history(scope: GitHistoryScope, cursor: string | null): Promise<GitHistoryResponse>;
	historyCommit(commit: string): Promise<GitCommitChangesResponse>;
	historyDiff(commit: string, fileId: string): Promise<DiffResponse>;
	gitAction(input: GitActionRequest): Promise<GitActionResponse>;
}

interface GitWorkspaceRouteOptions {
	nestedPath: string;
	onMutation(operationRevision: string): Promise<void>;
	repository: GitWorkspaceRouteRepository;
	request: Request;
	url: URL;
}

export async function handleGitWorkspaceRoute({
	nestedPath,
	onMutation,
	repository,
	request,
	url,
}: GitWorkspaceRouteOptions): Promise<Response | null> {
	if (!nestedPath.startsWith("git/")) return null;
	const historyCommitRoute = /^git\/history\/([^/]+)$/.exec(nestedPath);
	const historyDiffRoute = /^git\/history\/([^/]+)\/files\/([^/]+)\/diff$/.exec(nestedPath);
	if (nestedPath === "git/history" && request.method === "GET") {
		return json(
			await repository.history(
				(url.searchParams.get("scope") ?? "current") as GitHistoryScope,
				url.searchParams.get("cursor"),
			),
		);
	}
	if (historyDiffRoute && request.method === "GET") {
		return json(
			await repository.historyDiff(
				decodeSegment(historyDiffRoute[1] ?? ""),
				decodeSegment(historyDiffRoute[2] ?? ""),
			),
		);
	}
	if (historyCommitRoute && request.method === "GET") {
		return json(await repository.historyCommit(decodeSegment(historyCommitRoute[1] ?? "")));
	}
	if (nestedPath === "git/actions" && request.method === "POST") {
		const input = await readJsonObject<GitActionRequest>(request);
		const result = await repository.gitAction(input);
		await onMutation(result.operationRevision);
		return json(result);
	}
	return null;
}
