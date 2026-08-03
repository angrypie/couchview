import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { GitRepository } from "../repository.ts";

const temporaryDirectories: string[] = [];
const decoder = new TextDecoder();

function git(directory: string, args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", directory, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, LANG: "C", LC_ALL: "C" },
	});
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${decoder.decode(result.stderr)}`);
	}
	return decoder.decode(result.stdout).trim();
}

async function repositoryFixture(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-history-"));
	temporaryDirectories.push(directory);
	git(directory, ["init", "-q", "--initial-branch=main"]);
	git(directory, ["config", "user.name", "Couchview Tests"]);
	git(directory, ["config", "user.email", "couchview@example.invalid"]);
	await writeFile(path.join(directory, "tracked.txt"), "one\n");
	git(directory, ["add", "-A"]);
	git(directory, ["commit", "-q", "-m", "first commit"]);
	return directory;
}

async function commitFile(directory: string, contents: string, message: string): Promise<string> {
	await writeFile(path.join(directory, "tracked.txt"), contents);
	git(directory, ["add", "-A"]);
	git(directory, ["commit", "-q", "-m", message]);
	return git(directory, ["rev-parse", "HEAD"]);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("repository history", () => {
	test("paginates history and invalidates cursors when refs move", async () => {
		const directory = await repositoryFixture();
		for (let index = 2; index <= 52; index += 1) {
			await commitFile(directory, `${index}\n`, `commit ${index}`);
		}
		const repository = await GitRepository.open(directory);
		try {
			const firstPage = await repository.history("current", null);
			expect(firstPage.commits).toHaveLength(50);
			expect(firstPage.nextCursor).not.toBeNull();
			const secondPage = await repository.history("current", firstPage.nextCursor);
			expect(secondPage.commits).toHaveLength(2);
			expect(secondPage.nextCursor).toBeNull();

			await commitFile(directory, "53\n", "commit 53");
			await expect(repository.history("current", firstPage.nextCursor)).rejects.toMatchObject({
				code: "history_changed",
			});
		} finally {
			repository.close();
		}
	});

	test("lists current and all-ref history and renders a selected commit diff", async () => {
		const directory = await repositoryFixture();
		const mainHead = await commitFile(directory, "two\n", "second commit");
		git(directory, ["checkout", "-q", "-b", "feature"]);
		const featureHead = await commitFile(directory, "feature\n", "feature commit");
		git(directory, ["tag", "feature-tag"]);
		git(directory, ["checkout", "-q", "-b", "remote-only"]);
		const remoteOnlyHead = await commitFile(directory, "remote only\n", "remote-only commit");
		git(directory, ["checkout", "-q", "main"]);
		git(directory, ["update-ref", "refs/remotes/origin/remote-only", remoteOnlyHead]);
		git(directory, ["branch", "-D", "remote-only"]);
		const repository = await GitRepository.open(directory);
		try {
			const current = await repository.history("current", null);
			expect(current.commits.map((commit) => commit.id)).toContain(mainHead);
			expect(current.commits.map((commit) => commit.id)).not.toContain(featureHead);
			const all = await repository.history("all", null);
			expect(all.commits.map((commit) => commit.id)).toContain(featureHead);
			expect(all.commits.map((commit) => commit.id)).not.toContain(remoteOnlyHead);
			expect(all.commits.find((commit) => commit.id === featureHead)?.decorations).toContain(
				"tag: feature-tag",
			);

			const selected = await repository.historyCommit(mainHead);
			expect(selected.commit.subject).toBe("second commit");
			expect(selected.files).toEqual([
				expect.objectContaining({ path: "tracked.txt", kind: "modified", additions: 1 }),
			]);
			const diff = await repository.historyDiff(mainHead, selected.files[0]?.id ?? "");
			expect(diff.diff.hunks[0]?.lines).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "deletion", text: "one" }),
					expect.objectContaining({ kind: "addition", text: "two" }),
				]),
			);
			const currentState = await repository.changes();
			await expect(
				repository.gitAction({
					action: "checkout",
					commit: remoteOnlyHead,
					operationRevision: currentState.operationRevision,
				}),
			).rejects.toMatchObject({ code: "commit_not_in_history" });
		} finally {
			repository.close();
		}
	});

	test("compares roots to the empty tree and merges to their first parent", async () => {
		const directory = await repositoryFixture();
		const root = git(directory, ["rev-parse", "HEAD"]);
		git(directory, ["mv", "tracked.txt", "renamed.txt"]);
		git(directory, ["commit", "-q", "-m", "rename tracked file"]);
		const renamed = git(directory, ["rev-parse", "HEAD"]);
		await writeFile(path.join(directory, "asset.bin"), new Uint8Array([0, 1, 2, 3]));
		git(directory, ["add", "asset.bin"]);
		git(directory, ["commit", "-q", "-m", "add binary asset"]);
		const binary = git(directory, ["rev-parse", "HEAD"]);

		git(directory, ["checkout", "-q", "-b", "side"]);
		await writeFile(path.join(directory, "side.txt"), "side\n");
		git(directory, ["add", "side.txt"]);
		git(directory, ["commit", "-q", "-m", "side change"]);
		git(directory, ["checkout", "-q", "main"]);
		await writeFile(path.join(directory, "main.txt"), "main\n");
		git(directory, ["add", "main.txt"]);
		git(directory, ["commit", "-q", "-m", "main change"]);
		git(directory, ["merge", "-q", "--no-ff", "side", "-m", "merge side"]);
		const merge = git(directory, ["rev-parse", "HEAD"]);

		const repository = await GitRepository.open(directory);
		try {
			const rootChanges = await repository.historyCommit(root);
			expect(rootChanges.files).toEqual([
				expect.objectContaining({ path: "tracked.txt", kind: "added" }),
			]);
			const rootDiff = await repository.historyDiff(root, rootChanges.files[0]?.id ?? "");
			expect(rootDiff.diff.hunks[0]?.lines).toContainEqual(
				expect.objectContaining({ kind: "addition", text: "one" }),
			);

			const renameChanges = await repository.historyCommit(renamed);
			expect(renameChanges.files).toEqual([
				expect.objectContaining({
					kind: "renamed",
					path: "renamed.txt",
					previousPath: "tracked.txt",
				}),
			]);

			const binaryChanges = await repository.historyCommit(binary);
			expect(binaryChanges.files).toEqual([
				expect.objectContaining({ path: "asset.bin", binary: true }),
			]);
			const binaryDiff = await repository.historyDiff(binary, binaryChanges.files[0]?.id ?? "");
			expect(binaryDiff.diff.binary).toBe(true);

			const mergeChanges = await repository.historyCommit(merge);
			expect(mergeChanges.files).toEqual([
				expect.objectContaining({ path: "side.txt", kind: "added" }),
			]);
		} finally {
			repository.close();
		}
	});

	test("stashes tracked and untracked changes before detached checkout and returns", async () => {
		const directory = await repositoryFixture();
		const first = git(directory, ["rev-parse", "HEAD"]);
		await commitFile(directory, "two\n", "second commit");
		await writeFile(path.join(directory, "tracked.txt"), "local\n");
		await writeFile(path.join(directory, "untracked.txt"), "new\n");
		const repository = await GitRepository.open(directory);
		try {
			const dirty = await repository.changes();
			await expect(
				repository.gitAction({
					action: "checkout",
					commit: first,
					operationRevision: dirty.operationRevision,
				}),
			).rejects.toMatchObject({ code: "dirty_worktree" });
			const stashed = await repository.gitAction({
				action: "stash",
				operationRevision: dirty.operationRevision,
			});
			expect(git(directory, ["status", "--short"])).toBe("");
			expect(stashed.files).toEqual([]);
			expect(stashed.status.stashCount).toBe(1);

			const checkedOut = await repository.gitAction({
				action: "checkout",
				commit: first,
				operationRevision: stashed.operationRevision,
			});
			expect(checkedOut.repository).toMatchObject({ branch: null, head: first });
			expect(checkedOut.status.previousBranch).toBe("main");
			const returned = await repository.gitAction({
				action: "return",
				operationRevision: checkedOut.operationRevision,
			});
			expect(returned.repository.branch).toBe("main");
			const restored = await repository.gitAction({
				action: "restore-stash",
				operationRevision: returned.operationRevision,
			});
			expect(restored.status.stashCount).toBe(0);
			expect(await readFile(path.join(directory, "tracked.txt"), "utf8")).toBe("local\n");
			expect(await readFile(path.join(directory, "untracked.txt"), "utf8")).toBe("new\n");
		} finally {
			repository.close();
		}
	});

	test("keeps a stash available when restoring it creates a conflict", async () => {
		const directory = await repositoryFixture();
		await writeFile(path.join(directory, "tracked.txt"), "stashed\n");
		const repository = await GitRepository.open(directory);
		try {
			const dirty = await repository.changes();
			const stashed = await repository.gitAction({
				action: "stash",
				operationRevision: dirty.operationRevision,
			});
			expect(stashed.status.stashCount).toBe(1);

			await commitFile(directory, "committed elsewhere\n", "conflicting commit");
			const current = await repository.changes();
			const restored = await repository.gitAction({
				action: "restore-stash",
				operationRevision: current.operationRevision,
			});
			expect(restored.warning).toContain("stash was kept");
			expect(restored.status.stashCount).toBe(1);
			expect(restored.files).toEqual([
				expect.objectContaining({ path: "tracked.txt", conflicted: true }),
			]);
		} finally {
			repository.close();
		}
	});

	test("undoes the latest commit with a mixed reset", async () => {
		const directory = await repositoryFixture();
		const first = git(directory, ["rev-parse", "HEAD"]);
		await commitFile(directory, "two\n", "second commit");
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			const response = await repository.gitAction({
				action: "undo-last-commit",
				operationRevision: before.operationRevision,
			});
			expect(response.repository.head).toBe(first);
			expect(response.files).toEqual([
				expect.objectContaining({ path: "tracked.txt", staged: false, unstaged: true }),
			]);
			expect(await readFile(path.join(directory, "tracked.txt"), "utf8")).toBe("two\n");
		} finally {
			repository.close();
		}
	});

	test("cleans tracked and untracked files while preserving ignored content", async () => {
		const directory = await repositoryFixture();
		await writeFile(path.join(directory, ".gitignore"), "ignored/\n");
		git(directory, ["add", ".gitignore"]);
		git(directory, ["commit", "-q", "-m", "ignore generated files"]);
		await writeFile(path.join(directory, "tracked.txt"), "dirty\n");
		await writeFile(path.join(directory, "remove.txt"), "remove\n");
		await mkdir(path.join(directory, "ignored"));
		await writeFile(path.join(directory, "ignored", "keep.txt"), "keep\n");
		git(directory, ["init", "-q", "nested-repository"]);
		await writeFile(path.join(directory, "nested-repository", "keep.txt"), "nested\n");
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			const response = await repository.gitAction({
				action: "clean",
				operationRevision: before.operationRevision,
			});
			expect(response.files).toEqual([
				expect.objectContaining({ path: "nested-repository/", kind: "untracked" }),
			]);
			expect(await readFile(path.join(directory, "tracked.txt"), "utf8")).toBe("one\n");
			expect(await readFile(path.join(directory, "ignored", "keep.txt"), "utf8")).toBe("keep\n");
			expect(await readFile(path.join(directory, "nested-repository", "keep.txt"), "utf8")).toBe(
				"nested\n",
			);
			await expect(readFile(path.join(directory, "remove.txt"), "utf8")).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			repository.close();
		}
	});

	test("rejects malformed and stale action targets", async () => {
		const directory = await repositoryFixture();
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			await expect(
				repository.gitAction({
					action: "checkout",
					commit: "--help",
					operationRevision: before.operationRevision,
				}),
			).rejects.toMatchObject({ code: "invalid_commit" });
			await expect(
				repository.gitAction({
					action: "clean",
					commit: git(directory, ["rev-parse", "HEAD"]),
					operationRevision: before.operationRevision,
				} as unknown as Parameters<typeof repository.gitAction>[0]),
			).rejects.toMatchObject({ code: "invalid_request" });
			await writeFile(path.join(directory, "tracked.txt"), "changed\n");
			await expect(
				repository.gitAction({
					action: "clean",
					operationRevision: before.operationRevision,
				}),
			).rejects.toMatchObject({ code: "operation_changed" });
		} finally {
			repository.close();
		}
	});
});
