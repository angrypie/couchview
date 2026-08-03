import type { DiffResponse } from "../../shared/contracts.ts";
import type {
	GitActionRequest,
	GitActionResponse,
	GitCommitChangesResponse,
	GitHistoryResponse,
	GitHistoryScope,
} from "../../shared/git/index.ts";
import type { RepositorySnapshot } from "../repositoryContent.ts";
import { RepositoryGitActions } from "./actions.ts";
import { createCliGitExecutionPort, type GitExecutionPort } from "./execution.ts";
import { RepositoryHistory } from "./history.ts";
import { RepositoryMutationCoordinator } from "./mutationCoordinator.ts";

export interface RepositoryGitModule {
	history(scope: GitHistoryScope, cursor: string | null): Promise<GitHistoryResponse>;
	historyCommit(commit: string): Promise<GitCommitChangesResponse>;
	historyDiff(commit: string, fileId: string): Promise<DiffResponse>;
	action(input: GitActionRequest): Promise<GitActionResponse>;
	runMutation<T>(operation: () => Promise<T>): Promise<T>;
}

export interface RepositoryGitModuleOptions {
	root: string;
	repositoryId: string;
	emptyTree: string;
	getSnapshot(fresh?: boolean): Promise<RepositorySnapshot>;
	execution?: GitExecutionPort;
}

export function createRepositoryGitModule({
	root,
	repositoryId,
	emptyTree,
	getSnapshot,
	execution = createCliGitExecutionPort(root),
}: RepositoryGitModuleOptions): RepositoryGitModule {
	const mutations = new RepositoryMutationCoordinator();
	const history = new RepositoryHistory(repositoryId, emptyTree, getSnapshot, execution);
	const actions = new RepositoryGitActions(getSnapshot, history, mutations, execution);
	return {
		history: (scope, cursor) => history.list(scope, cursor),
		historyCommit: (commit) => history.commit(commit),
		historyDiff: (commit, fileId) => history.diff(commit, fileId),
		action: (input) => actions.perform(input),
		runMutation: (operation) => mutations.run(operation),
	};
}
