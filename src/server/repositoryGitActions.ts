import type { GitActionRequest, GitActionResponse } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { GitCommandError, runGit } from "./git.ts";
import type { RepositorySnapshot } from "./repositoryContent.ts";
import { RepositoryHistory } from "./repositoryHistory.ts";
import { RepositoryMutationCoordinator } from "./repositoryMutationCoordinator.ts";

const GIT_ACTIONS = [
	"checkout",
	"return",
	"stash",
	"restore-stash",
	"undo-last-commit",
	"clean",
] as const;

function assertActionRequest(input: unknown): asserts input is GitActionRequest {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "invalid_request", "Git action request is invalid");
	}
	const request = input as Record<string, unknown>;
	if (
		typeof request.operationRevision !== "string" ||
		request.operationRevision.trim().length === 0 ||
		request.operationRevision.length > 200
	) {
		throw new HttpError(400, "invalid_request", "Operation revision is invalid");
	}
	if (typeof request.action !== "string" || !GIT_ACTIONS.includes(request.action as never)) {
		throw new HttpError(400, "invalid_git_action", "Git action is invalid");
	}
	const checkout = request.action === "checkout";
	const allowedKeys = new Set(["action", "operationRevision", ...(checkout ? ["commit"] : [])]);
	if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
		throw new HttpError(400, "invalid_request", "Git action request has unexpected fields");
	}
	if (checkout && (typeof request.commit !== "string" || !/^[0-9a-f]{40}$/.test(request.commit))) {
		throw new HttpError(400, "invalid_commit", "Commit identifier is invalid");
	}
}

function gitActionError(error: unknown): never {
	if (error instanceof HttpError) throw error;
	if (error instanceof GitCommandError) {
		if (/index\.lock|another git process/i.test(error.stderr)) {
			throw new HttpError(423, "git_index_locked", "The Git index is busy; try again shortly");
		}
		if (/local changes|would be overwritten|untracked working tree files/i.test(error.stderr)) {
			throw new HttpError(
				409,
				"dirty_worktree",
				"Repository changes must be stashed or cleaned before checkout",
			);
		}
		throw new HttpError(409, "git_action_failed", error.stderr.trim() || error.message);
	}
	throw error;
}

export class RepositoryGitActions {
	constructor(
		private readonly root: string,
		private readonly getSnapshot: (fresh?: boolean) => Promise<RepositorySnapshot>,
		private readonly history: RepositoryHistory,
		private readonly mutations: RepositoryMutationCoordinator,
	) {}

	async perform(input: GitActionRequest): Promise<GitActionResponse> {
		assertActionRequest(input);
		return this.mutations.run(async () => {
			const before = await this.getSnapshot(true);
			if (before.operationRevision !== input.operationRevision) {
				throw new HttpError(
					409,
					"operation_changed",
					"Project changes changed; refresh before running this Git action",
				);
			}
			try {
				const warning = await this.runAction(input, before);
				return this.response(warning);
			} catch (error) {
				gitActionError(error);
			}
		});
	}

	private async runAction(
		input: GitActionRequest,
		before: RepositorySnapshot,
	): Promise<string | null> {
		switch (input.action) {
			case "checkout":
				return this.checkout(input.commit, before);
			case "return":
				return this.returnToPreviousBranch(before);
			case "stash":
				return this.stash(before);
			case "restore-stash":
				return this.restoreStash(before);
			case "undo-last-commit":
				return this.undoLastCommit(before);
			case "clean":
				return this.clean(before);
		}
	}

	private async checkout(commit: string, before: RepositorySnapshot): Promise<null> {
		if (before.files.length > 0) {
			throw new HttpError(
				409,
				"dirty_worktree",
				"Stash or clean repository changes before checking out a commit",
			);
		}
		await this.history.assertCheckoutCommit(commit);
		await runGit(this.root, ["checkout", "--quiet", "--detach", commit], { timeoutMs: 60_000 });
		return null;
	}

	private async returnToPreviousBranch(before: RepositorySnapshot): Promise<null> {
		if (before.files.length > 0) {
			throw new HttpError(
				409,
				"dirty_worktree",
				"Stash or clean repository changes before returning to a branch",
			);
		}
		if (before.repository.branch) {
			throw new HttpError(409, "not_detached", "Repository is already on a branch");
		}
		const previousBranch = (await this.history.status(before)).previousBranch;
		if (!previousBranch) {
			throw new HttpError(409, "previous_branch_unavailable", "No previous branch is available");
		}
		await runGit(this.root, ["checkout", "--quiet", previousBranch], { timeoutMs: 60_000 });
		return null;
	}

	private async stash(before: RepositorySnapshot): Promise<null> {
		if (before.files.length === 0) {
			throw new HttpError(409, "nothing_to_stash", "There are no repository changes to stash");
		}
		if (before.files.some((file) => file.conflicted)) {
			throw new HttpError(409, "unresolved_conflicts", "Resolve Git conflicts before stashing");
		}
		await runGit(
			this.root,
			[
				"stash",
				"push",
				"--include-untracked",
				"--message",
				`Couchview ${new Date().toISOString()}`,
			],
			{ literalPathspecs: false, timeoutMs: 120_000 },
		);
		return null;
	}

	private async restoreStash(before: RepositorySnapshot): Promise<string | null> {
		if (before.files.length > 0) {
			throw new HttpError(
				409,
				"dirty_worktree",
				"Clean or stash current changes before restoring the latest stash",
			);
		}
		if ((await this.history.status(before)).stashCount === 0) {
			throw new HttpError(409, "stash_not_found", "There is no stash to restore");
		}
		try {
			await runGit(this.root, ["stash", "pop", "--index"], {
				literalPathspecs: false,
				timeoutMs: 120_000,
			});
			return null;
		} catch (error) {
			if (!(error instanceof GitCommandError)) throw error;
			const after = await this.getSnapshot(true);
			if (after.operationRevision === before.operationRevision) throw error;
			return "The stash was kept because Git could not restore it cleanly. Resolve the reported conflicts before continuing.";
		}
	}

	private async undoLastCommit(before: RepositorySnapshot): Promise<null> {
		if (!before.repository.branch) {
			throw new HttpError(409, "detached_head", "Return to a branch before undoing a commit");
		}
		if (!(await this.history.status(before)).canUndoLastCommit) {
			throw new HttpError(409, "parent_commit_unavailable", "The current commit has no parent");
		}
		await runGit(this.root, ["reset", "--mixed", "HEAD^"], { timeoutMs: 60_000 });
		return null;
	}

	private async clean(before: RepositorySnapshot): Promise<null> {
		if (before.repository.unborn || !before.repository.head) {
			throw new HttpError(409, "unborn_repository", "An unborn repository cannot be cleaned");
		}
		await runGit(this.root, ["reset", "--hard", "HEAD"], { timeoutMs: 60_000 });
		await runGit(this.root, ["clean", "-fd"], { timeoutMs: 60_000 });
		return null;
	}

	private async response(warning: string | null): Promise<GitActionResponse> {
		const after = await this.getSnapshot(true);
		return {
			repository: after.repository,
			files: after.files,
			operationRevision: after.operationRevision,
			status: await this.history.status(after),
			warning,
		};
	}
}
