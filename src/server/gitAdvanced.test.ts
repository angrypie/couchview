import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateDatabase } from "./database.ts";
import { GitCommandError, type GitResult, reconcileGitStdout, runGit } from "./git.ts";
import { GitRepository } from "./repository.ts";

const temporaryDirectories: string[] = [];
const decoder = new TextDecoder();

function git(directory: string, args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", directory, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, LC_ALL: "C", LANG: "C" },
	});
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${decoder.decode(result.stderr)}`);
	}
	return decoder.decode(result.stdout);
}

async function committedRepository(files: Record<string, string | Uint8Array>): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-backend-"));
	temporaryDirectories.push(directory);
	git(directory, ["init", "-q"]);
	git(directory, ["config", "user.name", "Couchview Tests"]);
	git(directory, ["config", "user.email", "couchview@example.invalid"]);
	for (const [relativePath, contents] of Object.entries(files)) {
		const absolutePath = path.join(directory, relativePath);
		await mkdir(path.dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, contents);
	}
	git(directory, ["add", "-A"]);
	git(directory, ["commit", "-q", "-m", "fixture"]);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("GitRepository advanced behavior", () => {
	test("stages file/directory transitions without collapsing the review queue", async () => {
		const directoryToFile = await committedRepository({ "a/b.txt": "nested\n" });
		await rm(path.join(directoryToFile, "a"), { recursive: true });
		await writeFile(path.join(directoryToFile, "a"), "flat\n");
		const first = await GitRepository.open(directoryToFile);
		try {
			const changes = await first.changes();
			expect(changes.files.map((file) => file.path)).toEqual(["a", "a/b.txt"]);
			const replacement = changes.files.find((file) => file.path === "a");
			if (!replacement) throw new Error("directory-to-file fixture missing");
			await first.stage({
				fileId: replacement.id,
				operationRevision: changes.operationRevision,
				contentRevision: replacement.contentRevision,
			});
			expect(git(directoryToFile, ["ls-files", "-z"])).toBe("a\0");
			expect(git(directoryToFile, ["diff", "--cached", "--name-status"])).toContain("A\ta");
			expect(git(directoryToFile, ["diff", "--cached", "--name-status"])).toContain("D\ta/b.txt");
		} finally {
			first.close();
		}

		const fileToDirectory = await committedRepository({ a: "flat\n" });
		await rm(path.join(fileToDirectory, "a"));
		await mkdir(path.join(fileToDirectory, "a"));
		await writeFile(path.join(fileToDirectory, "a/b.txt"), "nested\n");
		const second = await GitRepository.open(fileToDirectory);
		try {
			const changes = await second.changes();
			expect(changes.files.map((file) => file.path)).toEqual(["a", "a/b.txt"]);
			const replacement = changes.files.find((file) => file.path === "a/b.txt");
			if (!replacement) throw new Error("file-to-directory fixture missing");
			await second.stage({
				fileId: replacement.id,
				operationRevision: changes.operationRevision,
				contentRevision: replacement.contentRevision,
			});
			expect(git(fileToDirectory, ["ls-files", "-z"])).toBe("a/b.txt\0");
			expect(git(fileToDirectory, ["diff", "--cached", "--name-status"])).toContain("D\ta");
			expect(git(fileToDirectory, ["diff", "--cached", "--name-status"])).toContain("A\ta/b.txt");
		} finally {
			second.close();
		}
	});

	test("accepts and stages literal backslashes in POSIX filenames", async () => {
		const directory = await committedRepository({ "base.txt": "base\n" });
		const unusualPath = "foo\\..\\bar.ts";
		await writeFile(path.join(directory, unusualPath), "export const valid = true;\n");
		const repository = await GitRepository.open(directory);
		try {
			const changes = await repository.changes();
			const file = changes.files.find((candidate) => candidate.path === unusualPath);
			expect(file).toBeDefined();
			if (!file) throw new Error("literal-backslash fixture missing");
			expect((await repository.diff(file.id)).diff.hunks).toHaveLength(1);
			await repository.stage({
				fileId: file.id,
				operationRevision: changes.operationRevision,
				contentRevision: file.contentRevision,
			});
			expect(git(directory, ["ls-files", "-z"])).toContain(`${unusualPath}\0`);
		} finally {
			repository.close();
		}
	});

	test("renders and comments on an untracked file containing one empty line", async () => {
		const directory = await committedRepository({ "base.txt": "base\n" });
		await writeFile(path.join(directory, "blank.txt"), "\n");
		const repository = await GitRepository.open(directory);
		try {
			const changes = await repository.changes();
			const file = changes.files.find((candidate) => candidate.path === "blank.txt");
			if (!file) throw new Error("blank-line fixture missing");
			const response = await repository.diff(file.id);
			expect(response.diff.additions).toBe(1);
			expect(response.diff.hunks[0]?.lines).toContainEqual(
				expect.objectContaining({ kind: "addition", text: "", newLine: 1 }),
			);
			const comment = await repository.createComment({
				fileId: file.id,
				contentRevision: file.contentRevision,
				side: "new",
				startLine: 1,
				endLine: 1,
				hunkHeader: response.diff.hunks[0]?.header ?? "",
				excerpt: [],
				body: "Decide whether this empty line is intentional.",
			});
			expect(comment.comment.excerpt).toEqual([""]);
		} finally {
			repository.close();
		}
	});

	test("bounds previews for a match inside a very long source line", async () => {
		const directory = await committedRepository({ "base.txt": "base\n" });
		await writeFile(
			path.join(directory, "minified.js"),
			`${"a".repeat(300_000)} targetWord ${"b".repeat(300_000)}\n`,
		);
		const repository = await GitRepository.open(directory);
		try {
			const result = await repository.search("targetWord", "minified.js");
			expect(result.currentFile).toHaveLength(1);
			expect(result.currentFile[0]?.preview).toContain("targetWord");
			expect(result.currentFile[0]?.preview.length).toBeLessThanOrEqual(514);
			expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(2_000);
		} finally {
			repository.close();
		}
	});

	test("handles deletion, rename, binary, symlink, mode-only, and unusual paths", async () => {
		const renameContents = Array.from({ length: 40 }, (_, index) => `rename line ${index}\n`).join(
			"",
		);
		const directory = await committedRepository({
			"delete.txt": "remove me\n",
			"rename-old.txt": renameContents,
			"mode.sh": "#!/bin/sh\nexit 0\n",
			"binary.dat": new Uint8Array([0, 1, 2, 3]),
		});
		await rm(path.join(directory, "delete.txt"));
		git(directory, ["mv", "rename-old.txt", "renamed file.txt"]);
		await writeFile(
			path.join(directory, "renamed file.txt"),
			renameContents.replace("rename line 20\n", "renamed line 20\n"),
		);
		await chmod(path.join(directory, "mode.sh"), 0o755);
		await writeFile(path.join(directory, "binary.dat"), new Uint8Array([0, 9, 8, 7]));
		await symlink("mode.sh", path.join(directory, "link to mode"));
		const oddPath = "--odd $name [x]\n.ts";
		await writeFile(path.join(directory, oddPath), "const odd = true;\n");
		const repository = await GitRepository.open(directory);

		try {
			const changes = await repository.changes();
			expect(changes.files.map((file) => file.path)).toEqual(
				expect.arrayContaining([
					"delete.txt",
					"renamed file.txt",
					"mode.sh",
					"binary.dat",
					"link to mode",
					oddPath,
				]),
			);
			const binary = changes.files.find((file) => file.path === "binary.dat");
			const deleted = changes.files.find((file) => file.path === "delete.txt");
			const renamed = changes.files.find((file) => file.path === "renamed file.txt");
			const mode = changes.files.find((file) => file.path === "mode.sh");
			const link = changes.files.find((file) => file.path === "link to mode");
			const odd = changes.files.find((file) => file.path === oddPath);
			if (!binary || !deleted || !renamed || !mode || !link || !odd) {
				throw new Error("edge fixture missing");
			}
			expect(binary).toMatchObject({
				binary: true,
				additions: null,
				deletions: null,
			});
			expect(deleted).toMatchObject({ binary: false, additions: 0, deletions: 1 });
			expect(renamed).toMatchObject({ binary: false, additions: 1, deletions: 1 });
			expect(mode).toMatchObject({ binary: false, additions: 0, deletions: 0 });
			expect(link).toMatchObject({ binary: false, additions: 1, deletions: 0 });
			expect(odd).toMatchObject({ binary: false, additions: 1, deletions: 0 });
			expect((await repository.diff(binary.id)).diff.binary).toBe(true);
			const modeDiff = await repository.diff(mode.id);
			expect(modeDiff.diff.hunks).toHaveLength(0);
			expect(modeDiff.diff.header.join("\n")).toContain("new mode 100755");
			expect((await repository.diff(link.id)).diff.header.join("\n")).toContain(
				"new file mode 120000",
			);
			await expect(
				repository.createComment({
					fileId: binary.id,
					contentRevision: binary.contentRevision,
					side: "new",
					startLine: 1,
					endLine: 1,
					hunkHeader: "@@ -1 +1 @@",
					excerpt: [],
					body: "Invalid binary anchor",
				}),
			).rejects.toMatchObject({ status: 400 });
			const stagePath = async (pathName: string) => {
				const current = await repository.changes();
				const file = current.files.find((candidate) => candidate.path === pathName);
				if (!file) throw new Error(`stage fixture missing: ${pathName}`);
				const staged = await repository.stage({
					fileId: file.id,
					operationRevision: current.operationRevision,
					contentRevision: file.contentRevision,
				});
				if (!staged.file) throw new Error(`staged fixture disappeared: ${pathName}`);
				expect(staged.changes.upserted).toContainEqual(staged.file);
			};
			for (const pathName of [
				"delete.txt",
				"renamed file.txt",
				"binary.dat",
				"mode.sh",
				"link to mode",
				oddPath,
			]) {
				await stagePath(pathName);
			}
			expect(git(directory, ["ls-files", "--", "delete.txt"])).toBe("");
			expect(git(directory, ["ls-files", "-s", "--", "link to mode"])).toStartWith("120000 ");
			expect(git(directory, ["diff", "--cached", "--summary", "--", "mode.sh"])).toContain(
				"mode change 100644 => 100755",
			);
			expect(git(directory, ["diff", "--cached", "--name-only", "--", "binary.dat"])).toBe(
				"binary.dat\n",
			);
			expect(git(directory, ["diff", "--cached", "--name-status", "-M"])).toMatch(
				/R\d+\trename-old\.txt\trenamed file\.txt/,
			);
			expect(git(directory, ["diff", "--cached", "--name-only", "-z"])).toContain(oddPath);
		} finally {
			repository.close();
		}
	}, 10_000);

	test("merges delete-plus-recreate status and bounds huge serialized diffs", async () => {
		const directory = await committedRepository({ "same.txt": "old value\n" });
		git(directory, ["rm", "-q", "--", "same.txt"]);
		await writeFile(path.join(directory, "same.txt"), "new value\n");
		await writeFile(path.join(directory, "huge.txt"), `${'"\\'.repeat(1_200_000)}\n`);
		const repository = await GitRepository.open(directory);

		try {
			const changes = await repository.changes();
			const sameFiles = changes.files.filter((file) => file.path === "same.txt");
			expect(sameFiles).toHaveLength(1);
			expect(sameFiles[0]).toMatchObject({ staged: true, unstaged: true, kind: "modified" });
			const sameDiff = await repository.diff(sameFiles[0]!.id);
			const sameLines = sameDiff.diff.hunks.flatMap((hunk) => hunk.lines);
			expect(sameLines).toContainEqual(
				expect.objectContaining({ kind: "deletion", text: "old value" }),
			);
			expect(sameLines).toContainEqual(
				expect.objectContaining({ kind: "addition", text: "new value" }),
			);

			const huge = changes.files.find((file) => file.path === "huge.txt");
			if (!huge) throw new Error("huge fixture missing");
			const hugeDiff = await repository.diff(huge.id);
			expect(hugeDiff.diff.tooLarge).toBe(true);
			expect(new TextEncoder().encode(JSON.stringify(hugeDiff)).byteLength).toBeLessThanOrEqual(
				2 * 1024 * 1024,
			);
		} finally {
			repository.close();
		}
	});

	test("reloads state under an interprocess-style lock without losing updates", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "couchview-state-"));
		const stateDirectory = await mkdtemp(path.join(tmpdir(), "couchview-database-"));
		temporaryDirectories.push(directory);
		temporaryDirectories.push(stateDirectory);
		git(directory, ["init", "-q"]);
		await writeFile(path.join(directory, "state.ts"), "export const state = true;\n");
		const database = await StateDatabase.open(path.join(stateDirectory, "state.sqlite"));
		const first = await GitRepository.open(directory, database);
		const second = await GitRepository.open(directory, database);
		try {
			const changes = await first.changes();
			const file = changes.files[0];
			if (!file) throw new Error("state fixture missing");
			const diff = await first.diff(file.id);
			await first.setReview({
				fileId: file.id,
				contentRevision: file.contentRevision,
				reviewed: true,
			});
			await second.createComment({
				fileId: file.id,
				contentRevision: file.contentRevision,
				side: "new",
				startLine: 1,
				endLine: 1,
				hunkHeader: diff.diff.hunks[0]?.header ?? "",
				excerpt: [],
				body: "Keep both writes.",
			});
			const state = await first.reviewState();
			expect(state.reviews).toHaveLength(1);
			expect(state.comments).toHaveLength(1);
			const stored = database.reviewState(first.id);
			expect(stored.reviews).toHaveLength(1);
			expect(stored.comments).toHaveLength(1);
			expect(await Bun.file(path.join(directory, ".git", "couchview", "state.json")).exists()).toBe(
				false,
			);
		} finally {
			first.close();
			second.close();
			database.close();
		}
	});

	test("returns a bounded prefix when Git output exceeds the subprocess buffer", async () => {
		const directory = await committedRepository({
			"large.txt": "x".repeat(2 * 1024 * 1024),
		});
		const objectId = git(directory, ["rev-parse", "HEAD:large.txt"]).trim();
		const result = await runGit(directory, ["cat-file", "blob", objectId], {
			binaryOutput: true,
			maxOutputBytes: 128,
			truncateOutput: true,
		});
		expect(result.stdout).toHaveLength(128);
		expect(result.stdoutTruncated).toBe(true);
	});

	test("recovers text output buffered by simple-git when the raw stream misses it", () => {
		const buffered = "diff --git a/example.ts b/example.ts\0\n";
		const result = reconcileGitStdout(new Uint8Array(), 0, buffered, 24);

		expect(decoder.decode(result.output)).toBe(buffered.slice(0, 24));
		expect(result).toMatchObject({
			recovered: true,
			totalBytes: Buffer.byteLength(buffered),
			truncated: true,
		});
	});

	test("returns complete diffs across overlapping simple-git requests", async () => {
		const directory = await committedRepository({
			"concurrent.ts": "export const value = 1;\n",
		});
		await writeFile(path.join(directory, "concurrent.ts"), "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		try {
			const changes = await repository.changes();
			const file = changes.files.find((candidate) => candidate.path === "concurrent.ts");
			if (!file) throw new Error("concurrent diff fixture missing");

			const diffs = await Promise.all(Array.from({ length: 8 }, () => repository.diff(file.id)));
			expect(diffs).toHaveLength(8);
			expect(diffs.every((result) => result.diff.hunks.length > 0)).toBe(true);
			expect(diffs.every((result) => result.diff.additions === 1)).toBe(true);
			expect(diffs.every((result) => result.diff.deletions === 1)).toBe(true);
		} finally {
			repository.close();
		}
	});

	test("keeps diff output complete while status snapshots overlap", async () => {
		const directory = await committedRepository({
			"mixed-concurrency.ts": "export const value = 1;\n",
		});
		await writeFile(path.join(directory, "mixed-concurrency.ts"), "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		try {
			const changes = await repository.changes();
			const file = changes.files.find((candidate) => candidate.path === "mixed-concurrency.ts");
			if (!file) throw new Error("mixed concurrency fixture missing");

			const results = await Promise.all(
				Array.from({ length: 8 }, (_, index) =>
					index % 2 === 0 ? repository.changes() : repository.diff(file.id),
				),
			);
			const diffs = results.filter(
				(result): result is Awaited<ReturnType<typeof repository.diff>> => "diff" in result,
			);
			expect(diffs).toHaveLength(4);
			expect(diffs.every((result) => result.diff.hunks.length > 0)).toBe(true);
			expect(diffs.every((result) => result.diff.additions === 1)).toBe(true);
			expect(diffs.every((result) => result.diff.deletions === 1)).toBe(true);
		} finally {
			repository.close();
		}
	});

	test("closes source descriptors after hashing content revisions", async () => {
		const directory = await committedRepository({
			"descriptor.ts": "export const value = 1;\n",
		});
		const absolutePath = path.join(directory, "descriptor.ts");
		await writeFile(absolutePath, "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		try {
			for (let index = 0; index < 8; index += 1) {
				await repository.changes();
			}
			if (process.platform === "darwin") {
				const inspection = Bun.spawnSync([
					"lsof",
					"-a",
					"-p",
					String(process.pid),
					"--",
					absolutePath,
				]);
				expect(decoder.decode(inspection.stdout)).not.toContain(absolutePath);
			}
		} finally {
			repository.close();
		}
	});

	test("preserves Git stderr and operation metadata for failed commands", async () => {
		const directory = await committedRepository({ "tracked.txt": "tracked\n" });
		const error = await runGit(directory, ["rev-parse", "missing-review-ref"]).catch(
			(caught) => caught,
		);
		expect(error).toBeInstanceOf(GitCommandError);
		expect(error).toMatchObject({
			kind: "exit",
			operation: "rev-parse",
			exitCode: 128,
		});
		expect((error as GitCommandError).stderr).toContain("missing-review-ref");
	});

	test("retries an unexpectedly empty tracked diff and diagnoses a repeated empty result", async () => {
		const directory = await committedRepository({
			"empty-retry.ts": "export const value = 1;\n",
		});
		await writeFile(path.join(directory, "empty-retry.ts"), "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		const changes = await repository.changes();
		const file = changes.files.find((candidate) => candidate.path === "empty-retry.ts");
		if (!file) throw new Error("empty diff retry fixture missing");
		const repositoryInternals = repository as unknown as {
			diffs: {
				readTrackedDiff: (
					diffArgs: (contextLines: number) => readonly string[],
					needsFullFilePatch: boolean,
				) => Promise<[GitResult, GitResult | null]>;
			};
		};
		const { diffs: internals } = repositoryInternals;
		const readTrackedDiff = internals.readTrackedDiff.bind(internals);
		const empty: GitResult = {
			stdout: new Uint8Array(),
			stdoutTruncated: false,
			stderr: "",
			exitCode: 0,
		};
		let reads = 0;
		internals.readTrackedDiff = async (...args) => {
			reads += 1;
			return reads === 1 ? [empty, args[1] ? empty : null] : readTrackedDiff(...args);
		};

		try {
			const recovered = await repository.diff(file.id);
			expect(recovered.diff.hunks).not.toHaveLength(0);
			expect(recovered.diff.additions).toBe(1);
			expect(recovered.diff.deletions).toBe(1);
			expect(reads).toBe(2);

			internals.readTrackedDiff = async (_diffArgs, needsFullFilePatch) => [
				empty,
				needsFullFilePatch ? empty : null,
			];
			const error = await repository.diff(file.id).catch((caught) => caught);
			expect(error).toBeInstanceOf(GitCommandError);
			expect(error).toMatchObject({ kind: "empty_output", operation: "diff" });
		} finally {
			repository.close();
		}
	});

	test("does not let inherited Git repository variables redirect commands", async () => {
		const directory = await committedRepository({ "target.txt": "target\n" });
		const other = await committedRepository({ "other.txt": "other\n" });
		const previousGitDirectory = process.env.GIT_DIR;
		const previousWorkTree = process.env.GIT_WORK_TREE;
		const previousSshCommand = process.env.GIT_SSH_COMMAND;
		const previousEditor = process.env.EDITOR;
		try {
			process.env.GIT_DIR = path.join(other, ".git");
			process.env.GIT_WORK_TREE = other;
			process.env.GIT_SSH_COMMAND = "false";
			process.env.EDITOR = "false";
			const result = await runGit(directory, ["rev-parse", "--show-toplevel"]);
			expect(decoder.decode(result.stdout).trim()).toBe(await realpath(directory));
		} finally {
			if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = previousGitDirectory;
			if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
			else process.env.GIT_WORK_TREE = previousWorkTree;
			if (previousSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
			else process.env.GIT_SSH_COMMAND = previousSshCommand;
			if (previousEditor === undefined) delete process.env.EDITOR;
			else process.env.EDITOR = previousEditor;
		}
	});

	test("changes the operation revision when the branch label changes at the same commit", async () => {
		const directory = await committedRepository({ "branch.txt": "base\n" });
		await writeFile(path.join(directory, "branch.txt"), "working change\n");
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			git(directory, ["switch", "-q", "-c", "same-commit-branch"]);
			const after = await repository.changes();
			expect(after.repository.head).toBe(before.repository.head);
			expect(after.repository.branch).toBe("same-commit-branch");
			expect(after.operationRevision).not.toBe(before.operationRevision);
		} finally {
			repository.close();
		}
	});

	test("retries when the first status read is missing repository identity", async () => {
		const directory = await committedRepository({ "retry.ts": "export const value = 1;\n" });
		await writeFile(path.join(directory, "retry.ts"), "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		const repositoryInternals = repository as unknown as {
			snapshots: {
				readSnapshotInputs: () => Promise<[GitResult, GitResult]>;
			};
		};
		const { snapshots: internals } = repositoryInternals;
		const readSnapshotInputs = internals.readSnapshotInputs.bind(internals);
		let reads = 0;
		internals.readSnapshotInputs = async () => {
			const results = await readSnapshotInputs();
			reads += 1;
			return reads === 1 ? [{ ...results[0], stdout: new Uint8Array() }, results[1]] : results;
		};

		try {
			const snapshot = await repository.changes();
			expect(snapshot.repository.branch).toBe("main");
			expect(snapshot.repository.head).not.toBeNull();
			expect(snapshot.files.map((file) => file.path)).toContain("retry.ts");
			expect(reads).toBe(2);
		} finally {
			repository.close();
		}
	});

	test("keeps the last verified snapshot when status capture is incomplete", async () => {
		const directory = await committedRepository({ "stable.ts": "export const value = 1;\n" });
		await writeFile(path.join(directory, "stable.ts"), "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		const repositoryInternals = repository as unknown as {
			snapshots: {
				readSnapshotInputs: () => Promise<[GitResult, GitResult]>;
			};
		};
		const { snapshots: internals } = repositoryInternals;

		try {
			const verified = await repository.changes();
			const readSnapshotInputs = internals.readSnapshotInputs.bind(internals);
			internals.readSnapshotInputs = async () => {
				const results = await readSnapshotInputs();
				return [{ ...results[0], stdout: new Uint8Array() }, results[1]];
			};

			const refreshes = await Promise.all([
				repository.changes(),
				repository.changes(),
				repository.changes(),
			]);
			expect(refreshes).toEqual([verified, verified, verified]);
		} finally {
			repository.close();
		}
	});

	test("does not let a background status refresh retrigger the repository watcher", async () => {
		const directory = await committedRepository({ "watch.ts": "export const value = 1;\n" });
		await writeFile(path.join(directory, "watch.ts"), "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		const repositoryInternals = repository as unknown as {
			snapshots: {
				readSnapshotInputs: () => Promise<[GitResult, GitResult]>;
			};
		};
		const { snapshots: internals } = repositoryInternals;
		const readSnapshotInputs = internals.readSnapshotInputs.bind(internals);
		let reads = 0;
		internals.readSnapshotInputs = async () => {
			reads += 1;
			return readSnapshotInputs();
		};
		repository.startWatching(() => undefined);

		try {
			const snapshot = await repository.changes();
			expect(snapshot.files.map((file) => file.path)).toContain("watch.ts");
			await Bun.sleep(500);
			expect(reads).toBe(1);
		} finally {
			repository.close();
		}
	});

	test("does not publish watcher events for ignored filesystem churn", async () => {
		const directory = await committedRepository({
			".gitignore": ".runtime/\n",
			"watch.ts": "export const value = 1;\n",
		});
		await writeFile(path.join(directory, "watch.ts"), "export const value = 2;\n");
		const repository = await GitRepository.open(directory);
		const repositoryInternals = repository as unknown as {
			snapshots: {
				refreshWatcher: (onChange: (revision: string) => void) => Promise<void>;
			};
		};
		const { snapshots: internals } = repositoryInternals;
		const baseline = await repository.changes();
		const revisions: string[] = [];
		const collectRevision = (revision: string) => revisions.push(revision);

		try {
			const runtimeDirectory = path.join(directory, ".runtime");
			await mkdir(runtimeDirectory);
			await writeFile(path.join(runtimeDirectory, "heartbeat.json"), "{}\n");
			await internals.refreshWatcher(collectRevision);
			expect(revisions).toEqual([]);

			await writeFile(path.join(directory, "watch.ts"), "export const value = 3;\n");
			await internals.refreshWatcher(collectRevision);
			expect(revisions).toHaveLength(1);
			expect(revisions[0]).not.toBe(baseline.operationRevision);
		} finally {
			repository.close();
		}
	});

	test("coalesces overlapping unborn-repository snapshots without publishing a false clean state", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "couchview-concurrent-"));
		temporaryDirectories.push(directory);
		git(directory, ["init", "-q"]);
		git(directory, ["symbolic-ref", "HEAD", "refs/heads/main"]);
		await writeFile(path.join(directory, "first.ts"), "export const first = 1;\n");
		await writeFile(path.join(directory, "second.ts"), "export const second = 2;\n");
		const repository = await GitRepository.open(directory);
		try {
			const snapshots = await Promise.all(Array.from({ length: 50 }, () => repository.changes()));
			expect(snapshots.every((snapshot) => snapshot.repository.branch === "main")).toBe(true);
			expect(snapshots.every((snapshot) => snapshot.repository.unborn)).toBe(true);
			expect(snapshots.every((snapshot) => snapshot.files.length === 2)).toBe(true);
		} finally {
			repository.close();
		}
	});

	test("accepts a genuinely clean tree after confirming the empty snapshot", async () => {
		const directory = await committedRepository({ "clean.ts": "export const clean = true;\n" });
		await writeFile(path.join(directory, "clean.ts"), "export const clean = false;\n");
		const repository = await GitRepository.open(directory);
		try {
			const changed = await repository.changes();
			expect(changed.files).toHaveLength(1);
			git(directory, ["restore", "--", "clean.ts"]);
			const clean = await repository.changes();
			expect(clean.files).toHaveLength(0);
			expect(clean.repository.branch).toBe(changed.repository.branch);
			expect(clean.repository.head).toBe(changed.repository.head);
		} finally {
			repository.close();
		}
	});

	test("uses Git-normalized modes when deciding whether reviews became stale", async () => {
		const directory = await committedRepository({ "review.sh": "echo base\n" });
		await writeFile(path.join(directory, "review.sh"), "echo changed\n");
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			const file = before.files.find((candidate) => candidate.path === "review.sh");
			if (!file) throw new Error("mode revision fixture missing");
			const diff = await repository.diff(file.id);
			await repository.setReview({
				fileId: file.id,
				contentRevision: file.contentRevision,
				reviewed: true,
			});
			await repository.createComment({
				fileId: file.id,
				contentRevision: file.contentRevision,
				side: "new",
				startLine: 1,
				endLine: 1,
				hunkHeader: diff.diff.hunks[0]?.header ?? "",
				excerpt: [],
				body: "Keep the changed command.",
			});

			await chmod(path.join(directory, "review.sh"), 0o600);
			const permissionOnly = await repository.changes();
			expect(permissionOnly.files[0]?.contentRevision).toBe(file.contentRevision);
			expect(permissionOnly.files[0]?.reviewed).toBe(true);
			expect((await repository.reviewState()).comments[0]?.stale).toBe(false);

			await chmod(path.join(directory, "review.sh"), 0o700);
			const executable = await repository.changes();
			expect(executable.files[0]?.contentRevision).not.toBe(file.contentRevision);
			expect(executable.files[0]?.reviewed).toBe(false);
			expect((await repository.reviewState()).comments[0]?.stale).toBe(true);
		} finally {
			repository.close();
		}
	});
});
