import { afterEach, describe, expect, test } from "bun:test";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseGrepOutput, parseNumstat, parsePorcelainV2, parseUnifiedDiff } from "./git.ts";
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

describe("parsePorcelainV2", () => {
	test("parses ordinary, renamed, untracked, and conflicted records without splitting paths", () => {
		const output = [
			"# branch.oid 0123456789abcdef",
			"# branch.head feature/review",
			"1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/a file.ts",
			"2 R. N... 100644 100644 100644 ccccccc ddddddd R100 src/new name.ts",
			"src/old name.ts",
			"? src/new file.ts",
			"u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc src/conflict.ts",
			"",
		].join("\0");

		const parsed = parsePorcelainV2(output);

		expect(parsed.branch).toBe("feature/review");
		expect(parsed.head).toBe("0123456789abcdef");
		expect(parsed.entries).toHaveLength(4);
		expect(parsed.entries[0]).toMatchObject({
			path: "src/a file.ts",
			kind: "modified",
			staged: false,
			unstaged: true,
		});
		expect(parsed.entries[1]).toMatchObject({
			path: "src/new name.ts",
			previousPath: "src/old name.ts",
			kind: "renamed",
		});
		expect(parsed.entries[2]).toMatchObject({ path: "src/new file.ts", kind: "untracked" });
		expect(parsed.entries[3]).toMatchObject({
			path: "src/conflict.ts",
			kind: "unmerged",
			conflicted: true,
		});
	});

	test("recognizes an unborn branch", () => {
		const parsed = parsePorcelainV2("# branch.oid (initial)\0# branch.head main\0");
		expect(parsed).toMatchObject({ branch: "main", head: null, unborn: true });
	});

	test("merges a staged deletion and same-path recreation into one partial file", () => {
		const parsed = parsePorcelainV2(
			[
				"# branch.oid abcdef",
				"1 D. N... 100644 000000 000000 aaaaaaa 0000000 same.txt",
				"? same.txt",
				"",
			].join("\0"),
		);
		expect(parsed.entries).toEqual([
			expect.objectContaining({
				path: "same.txt",
				kind: "modified",
				indexStatus: "D",
				worktreeStatus: "?",
				staged: true,
				unstaged: true,
			}),
		]);
	});
});

describe("parseNumstat", () => {
	test("parses text, binary, and renamed files without splitting unusual paths", () => {
		const output = [
			"3\t2\tsrc/ordinary file.ts",
			"-\t-\tpublic/image.bin",
			"1\t0\t",
			"src/old name.ts",
			"src/new name.ts",
			"2\t1\tline\nfeed.ts",
			"",
		].join("\0");

		expect(parseNumstat(output)).toEqual([
			{
				path: "src/ordinary file.ts",
				previousPath: null,
				additions: 3,
				deletions: 2,
				binary: false,
			},
			{
				path: "public/image.bin",
				previousPath: null,
				additions: null,
				deletions: null,
				binary: true,
			},
			{
				path: "src/new name.ts",
				previousPath: "src/old name.ts",
				additions: 1,
				deletions: 0,
				binary: false,
			},
			{
				path: "line\nfeed.ts",
				previousPath: null,
				additions: 2,
				deletions: 1,
				binary: false,
			},
		]);
	});
});

describe("parseUnifiedDiff", () => {
	test("assigns old/new line numbers and newline metadata", () => {
		const parsed = parseUnifiedDiff(
			[
				"diff --git a/example.ts b/example.ts",
				"--- a/example.ts",
				"+++ b/example.ts",
				"@@ -2,2 +2,3 @@ function example() {",
				" same",
				"-old",
				"+new",
				"+more",
				"\\ No newline at end of file",
				"",
			].join("\n"),
		);

		expect(parsed.additions).toBe(2);
		expect(parsed.deletions).toBe(1);
		expect(parsed.hunks).toHaveLength(1);
		expect(parsed.hunks[0]?.lines.slice(0, 4)).toMatchObject([
			{ kind: "context", oldLine: 2, newLine: 2 },
			{ kind: "deletion", oldLine: 3, newLine: null },
			{ kind: "addition", oldLine: null, newLine: 3 },
			{ kind: "addition", oldLine: null, newLine: 4, noNewline: true },
		]);
	});

	test("bounds rendered rows and ignores accidental later file sections", () => {
		const parsed = parseUnifiedDiff(
			[
				"diff --git a/a.ts b/a.ts",
				"--- a/a.ts",
				"+++ b/a.ts",
				"@@ -0,0 +1,3 @@",
				"+one",
				"+two",
				"+three",
				"diff --git a/b.ts b/b.ts",
				"--- a/b.ts",
				"+++ b/b.ts",
				"@@ -0,0 +1 @@",
				"+other file",
				"",
			].join("\n"),
			2,
		);
		expect(parsed.truncated).toBe(true);
		expect(parsed.hunks).toHaveLength(1);
		expect(parsed.hunks[0]?.lines.map((line) => line.text)).toEqual(["one", "two"]);
	});
});

describe("parseGrepOutput", () => {
	test("parses Git's NUL-delimited filename, line, and column fields", () => {
		const output = new TextEncoder().encode(
			"src/a file.ts\0" +
				"12\0" +
				"5\0" +
				"const token = true;\n" +
				"src/b.ts\0" +
				"3\0" +
				"1\0" +
				"token()\n",
		);
		expect(parseGrepOutput(output)).toEqual([
			{ path: "src/a file.ts", line: 12, column: 5, preview: "const token = true;" },
			{ path: "src/b.ts", line: 3, column: 1, preview: "token()" },
		]);
	});
});

describe("GitRepository", () => {
	test("reviews, searches, previews, and stages an untracked file on an unborn branch", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "couchview-backend-"));
		temporaryDirectories.push(directory);
		const initialized = Bun.spawnSync(["git", "init", "-q", directory]);
		expect(initialized.exitCode).toBe(0);
		await writeFile(path.join(directory, "sample file.ts"), "alpha\nbeta token\n", "utf8");
		await writeFile(path.join(directory, "substring.ts"), "const tokenized = true;\n", "utf8");
		const repository = await GitRepository.open(directory);

		try {
			const looseObjectDirectories = (
				await readdir(path.join(directory, ".git", "objects"), {
					withFileTypes: true,
				})
			).filter((entry) => entry.isDirectory() && /^[0-9a-f]{2}$/.test(entry.name));
			expect(looseObjectDirectories).toHaveLength(0);
			expect(await Bun.file(path.join(directory, ".git", "couchview", "state.json")).exists()).toBe(
				false,
			);
			const before = await repository.changes();
			const file = before.files.find((candidate) => candidate.path === "sample file.ts");
			expect(file).toMatchObject({
				kind: "untracked",
				staged: false,
				unstaged: true,
				binary: false,
				additions: 2,
				deletions: 0,
			});
			if (!file) throw new Error("fixture file missing from Git status");

			const diff = await repository.diff(file.id);
			expect(diff.diff).toMatchObject({ binary: false, additions: 2, deletions: 0 });
			expect(diff.diff.hunks[0]?.lines[1]).toMatchObject({ text: "beta token", newLine: 2 });

			const search = await repository.search("token", "sample file.ts");
			expect(search.currentFile).toEqual([
				{ path: "sample file.ts", line: 2, column: 6, preview: "beta token" },
			]);
			expect(search.otherFiles).toEqual([]);
			const source = await repository.source("sample file.ts", 2, 1);
			expect(source.lines).toEqual([
				{ line: 1, text: "alpha" },
				{ line: 2, text: "beta token" },
			]);

			await repository.setReview({
				fileId: file.id,
				contentRevision: file.contentRevision,
				reviewed: true,
			});
			await repository.createComment({
				fileId: file.id,
				contentRevision: file.contentRevision,
				side: "new",
				startLine: 2,
				endLine: 2,
				hunkHeader: diff.diff.hunks[0]?.header ?? "",
				excerpt: ["beta token"],
				body: "Please rename this.",
			});

			const staged = await repository.stage({
				fileId: file.id,
				operationRevision: before.operationRevision,
				contentRevision: file.contentRevision,
			});
			expect(staged.file).toMatchObject({
				staged: true,
				unstaged: false,
				reviewed: true,
				commentCount: 1,
				binary: false,
				additions: 2,
				deletions: 0,
			});
			expect(staged.file?.contentRevision).toBe(file.contentRevision);
			if (!staged.file) throw new Error("staged fixture disappeared");
			expect(staged.changes).toEqual({
				upserted: [staged.file],
				removedFileIds: [],
				orderedFileIds: before.files.map((candidate) => candidate.id),
			});

			const unstaged = await repository.stage({
				fileId: file.id,
				operationRevision: staged.operationRevision,
				contentRevision: file.contentRevision,
				staged: false,
			});
			expect(unstaged.file).toMatchObject({
				staged: false,
				unstaged: true,
				reviewed: true,
				commentCount: 1,
				binary: false,
				additions: 2,
				deletions: 0,
			});
			expect(unstaged.file?.contentRevision).toBe(file.contentRevision);
			if (!unstaged.file) throw new Error("unstaged fixture disappeared");
			expect(unstaged.changes).toEqual({
				upserted: [unstaged.file],
				removedFileIds: [],
				orderedFileIds: before.files.map((candidate) => candidate.id),
			});
		} finally {
			repository.close();
		}
	});

	test("unstages a tracked file without changing its working contents", async () => {
		const directory = await committedRepository({ "tracked.ts": "export const value = 1;\n" });
		await writeFile(path.join(directory, "tracked.ts"), "export const value = 2;\n");
		git(directory, ["add", "--", "tracked.ts"]);
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			const file = before.files.find((candidate) => candidate.path === "tracked.ts");
			expect(file).toMatchObject({ staged: true, unstaged: false });
			if (!file) throw new Error("tracked fixture missing");

			const result = await repository.stage({
				fileId: file.id,
				operationRevision: before.operationRevision,
				contentRevision: file.contentRevision,
				staged: false,
			});

			expect(result.file).toMatchObject({ staged: false, unstaged: true });
			expect(git(directory, ["diff", "--cached", "--name-only"]).trim()).toBe("");
			expect(await readFile(path.join(directory, "tracked.ts"), "utf8")).toBe(
				"export const value = 2;\n",
			);
		} finally {
			repository.close();
		}
	});

	test("returns a removal delta when staging eliminates the change", async () => {
		const directory = await committedRepository({ "base.ts": "export {};\n" });
		await writeFile(path.join(directory, "temporary.ts"), "export const value = 1;\n");
		git(directory, ["add", "--", "temporary.ts"]);
		await rm(path.join(directory, "temporary.ts"));
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			const file = before.files.find((candidate) => candidate.path === "temporary.ts");
			expect(file).toMatchObject({ staged: true, unstaged: true });
			if (!file) throw new Error("temporary fixture missing");

			const result = await repository.stage({
				fileId: file.id,
				operationRevision: before.operationRevision,
				contentRevision: file.contentRevision,
			});

			expect(result.file).toBeNull();
			expect(result.changes).toEqual({
				upserted: [],
				removedFileIds: [file.id],
				orderedFileIds: [],
			});
			expect((await repository.changes()).files).toEqual([]);
		} finally {
			repository.close();
		}
	});

	test("stages multiple files atomically from one repository revision", async () => {
		const directory = await committedRepository({
			"first.ts": "export const first = 1;\n",
			"second.ts": "export const second = 1;\n",
		});
		await writeFile(path.join(directory, "first.ts"), "export const first = 2;\n");
		await writeFile(path.join(directory, "second.ts"), "export const second = 2;\n");
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			expect(before.files).toHaveLength(2);
			const result = await repository.stageFiles({
				files: before.files.map((file) => ({
					fileId: file.id,
					contentRevision: file.contentRevision,
				})),
				operationRevision: before.operationRevision,
			});

			expect(result.files).toHaveLength(2);
			expect(result.files).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: "first.ts", staged: true, unstaged: false }),
					expect.objectContaining({ path: "second.ts", staged: true, unstaged: false }),
				]),
			);
			expect(result.changes.upserted).toHaveLength(2);
			expect(git(directory, ["diff", "--cached", "--name-only"]).trim().split("\n")).toEqual([
				"first.ts",
				"second.ts",
			]);
		} finally {
			repository.close();
		}
	});

	test("does not partially bulk-stage files from a stale revision", async () => {
		const directory = await committedRepository({
			"first.ts": "export const first = 1;\n",
			"second.ts": "export const second = 1;\n",
		});
		await writeFile(path.join(directory, "first.ts"), "export const first = 2;\n");
		await writeFile(path.join(directory, "second.ts"), "export const second = 2;\n");
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			await writeFile(path.join(directory, "second.ts"), "export const second = 3;\n");

			await expect(
				repository.stageFiles({
					files: before.files.map((file) => ({
						fileId: file.id,
						contentRevision: file.contentRevision,
					})),
					operationRevision: before.operationRevision,
				}),
			).rejects.toMatchObject({ status: 409 });
			expect(git(directory, ["diff", "--cached", "--name-only"])).toBe("");
		} finally {
			repository.close();
		}
	});

	test("returns complete file context while preserving compact review hunks", async () => {
		const original = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
		const directory = await committedRepository({
			"complete.txt": `${original.join("\n")}\n`,
		});
		const changed = [...original];
		changed[0] = "changed first";
		changed[29] = "changed last";
		await writeFile(path.join(directory, "complete.txt"), `${changed.join("\n")}\n`);
		const repository = await GitRepository.open(directory);

		try {
			const changes = await repository.changes();
			const file = changes.files.find((candidate) => candidate.path === "complete.txt");
			if (!file) throw new Error("complete-file fixture missing");

			const response = await repository.diff(file.id);
			expect(response.diff.hunks).toHaveLength(2);
			expect(response.diff.fullFilePatch).toContain(" line 15\n");
			expect(parseUnifiedDiff(response.diff.fullFilePatch ?? "").hunks).toHaveLength(1);
		} finally {
			repository.close();
		}
	});

	test("commits only staged content and leaves later working edits unstaged", async () => {
		const directory = await committedRepository({ "tracked.ts": "export const value = 1;\n" });
		const repository = await GitRepository.open(directory);

		try {
			const clean = await repository.changes();
			await expect(
				repository.commit({
					message: "Nothing yet",
					operationRevision: clean.operationRevision,
				}),
			).rejects.toMatchObject({ status: 409, code: "nothing_staged" });

			await writeFile(path.join(directory, "tracked.ts"), "export const value = 2;\n");
			const before = await repository.changes();
			const file = before.files.find((candidate) => candidate.path === "tracked.ts");
			if (!file) throw new Error("tracked fixture missing");
			const staged = await repository.stage({
				fileId: file.id,
				operationRevision: before.operationRevision,
				contentRevision: file.contentRevision,
			});

			await writeFile(path.join(directory, "tracked.ts"), "export const value = 3;\n");
			const partial = await repository.changes();
			expect(partial.files[0]).toMatchObject({ staged: true, unstaged: true });
			await expect(
				repository.commit({
					message: "Use a stale snapshot",
					operationRevision: staged.operationRevision,
				}),
			).rejects.toMatchObject({ status: 409, code: "operation_changed" });

			const committed = await repository.commit({
				message: "Update tracked value\n\nKeep the working edit local.",
				operationRevision: partial.operationRevision,
			});
			expect(committed.commit).toBe(git(directory, ["rev-parse", "HEAD"]).trim());
			expect(git(directory, ["log", "-1", "--pretty=%B"])).toBe(
				"Update tracked value\n\nKeep the working edit local.\n\n",
			);
			expect(git(directory, ["show", "HEAD:tracked.ts"])).toBe("export const value = 2;\n");
			expect(await readFile(path.join(directory, "tracked.ts"), "utf8")).toBe(
				"export const value = 3;\n",
			);
			expect((await repository.changes()).files[0]).toMatchObject({
				staged: false,
				unstaged: true,
			});
		} finally {
			repository.close();
		}
	});

	test("reports a missing Git identity without changing the staged index", async () => {
		const directory = await committedRepository({ "tracked.ts": "before\n" });
		await writeFile(path.join(directory, "tracked.ts"), "after\n");
		git(directory, ["add", "--", "tracked.ts"]);
		git(directory, ["config", "user.useConfigOnly", "true"]);
		git(directory, ["config", "user.name", ""]);
		git(directory, ["config", "user.email", ""]);
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			await expect(
				repository.commit({
					message: "Cannot identify author",
					operationRevision: before.operationRevision,
				}),
			).rejects.toMatchObject({ status: 409, code: "git_identity_missing" });
			expect((await repository.changes()).files[0]).toMatchObject({
				staged: true,
				unstaged: false,
			});
			expect(git(directory, ["log", "-1", "--pretty=%s"])).toBe("fixture\n");
		} finally {
			repository.close();
		}
	});

	test("builds bounded commit-message context from the staged index only", async () => {
		const directory = await committedRepository({
			"tracked.ts": "export const value = 1;\n",
		});
		const repository = await GitRepository.open(directory);

		try {
			const clean = await repository.changes();
			await expect(
				repository.commitMessageContext({
					operationRevision: clean.operationRevision,
				}),
			).rejects.toMatchObject({ status: 409, code: "nothing_staged" });

			await writeFile(path.join(directory, "tracked.ts"), "export const value = 2;\n");
			const changed = await repository.changes();
			const file = changed.files[0];
			if (!file) throw new Error("commit-message fixture missing");
			await repository.stage({
				fileId: file.id,
				operationRevision: changed.operationRevision,
				contentRevision: file.contentRevision,
			});
			await writeFile(path.join(directory, "tracked.ts"), "export const value = 3;\n");
			const partial = await repository.changes();
			const context = await repository.commitMessageContext({
				operationRevision: partial.operationRevision,
			});

			expect(context).toContain('"path":"tracked.ts"');
			expect(context).toContain('"fixture"');
			expect(context).toContain("+export const value = 2;");
			expect(context).not.toContain("+export const value = 3;");
			await expect(
				repository.commitMessageContext({
					operationRevision: changed.operationRevision,
				}),
			).rejects.toMatchObject({ status: 409, code: "operation_changed" });
		} finally {
			repository.close();
		}
	});

	test("marks oversized staged patches as truncated commit-message context", async () => {
		const directory = await committedRepository({ "large.txt": "before\n" });
		await writeFile(path.join(directory, "large.txt"), `${"after context line\n".repeat(20_000)}`);
		git(directory, ["add", "--", "large.txt"]);
		const repository = await GitRepository.open(directory);

		try {
			const changes = await repository.changes();
			const context = await repository.commitMessageContext({
				operationRevision: changes.operationRevision,
			});
			expect(context).toContain("STAGED PATCH (truncated):");
			expect(Buffer.byteLength(context)).toBeLessThan(400 * 1024);
		} finally {
			repository.close();
		}
	});

	test("keeps same-stat working changes visible after rewriting a temporary index", async () => {
		const directory = await committedRepository({
			"racy.bin": new Uint8Array([0, 1, 2, 3]),
			"other.txt": "before\n",
		});
		const racyPath = path.join(directory, "racy.bin");
		const originalMetadata = await stat(racyPath);
		await writeFile(racyPath, new Uint8Array([0, 9, 8, 7]));
		await utimes(racyPath, originalMetadata.atime, originalMetadata.mtime);
		await utimes(
			path.join(directory, ".git", "index"),
			originalMetadata.atime,
			originalMetadata.mtime,
		);
		await writeFile(path.join(directory, "other.txt"), "after\n");
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			const other = before.files.find((file) => file.path === "other.txt");
			expect(before.files.map((file) => file.path)).toContain("racy.bin");
			if (!other) throw new Error("other fixture missing");

			await repository.stage({
				fileId: other.id,
				operationRevision: before.operationRevision,
				contentRevision: other.contentRevision,
			});

			const after = await repository.changes();
			expect(after.files.map((file) => file.path)).toContain("racy.bin");
			expect(git(directory, ["diff", "--name-only", "--", "racy.bin"])).toBe("racy.bin\n");
		} finally {
			repository.close();
		}
	});

	test("keeps reviews across staging and unrelated commits, then marks changed anchors stale", async () => {
		const directory = await committedRepository({
			"target.ts": "one\n\nthree token\n",
			"unrelated.ts": "export const unrelated = 1;\n",
		});
		git(directory, ["config", "diff.suppressBlankEmpty", "true"]);
		git(directory, ["config", "color.grep", "always"]);
		await writeFile(path.join(directory, "target.ts"), "ONE\n\nthree token\n");
		git(directory, ["add", "--", "target.ts"]);
		await writeFile(path.join(directory, "target.ts"), "ONE\n\nTHREE token\n");
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			const file = before.files.find((candidate) => candidate.path === "target.ts");
			expect(file).toMatchObject({ staged: true, unstaged: true });
			if (!file) throw new Error("target fixture missing");
			const diff = await repository.diff(file.id);
			expect(diff.diff.hunks.flatMap((hunk) => hunk.lines)).toContainEqual(
				expect.objectContaining({ kind: "addition", text: "THREE token", newLine: 3 }),
			);
			const search = await repository.search("token", "target.ts");
			expect(search.currentFile[0]).toMatchObject({ path: "target.ts", line: 3 });

			await repository.setReview({
				fileId: file.id,
				contentRevision: file.contentRevision,
				reviewed: true,
			});
			const replacementHunk = diff.diff.hunks[0];
			if (!replacementHunk) throw new Error("target hunk missing");
			const created = await repository.createComment({
				fileId: file.id,
				contentRevision: file.contentRevision,
				side: "mixed",
				startLine: 1,
				endLine: 3,
				oldStartLine: 1,
				oldEndLine: 3,
				newStartLine: 1,
				newEndLine: 3,
				hunkHeader: replacementHunk.header,
				excerpt: ["forged excerpt"],
				body: "Keep both replacement ranges.",
			});
			expect(created.comment.excerpt).not.toContain("forged excerpt");

			const staged = await repository.stage({
				fileId: file.id,
				operationRevision: before.operationRevision,
				contentRevision: file.contentRevision,
			});
			expect(staged.file).toMatchObject({ staged: true, unstaged: false, reviewed: true });
			expect(staged.file?.contentRevision).toBe(file.contentRevision);

			await writeFile(path.join(directory, "unrelated.ts"), "export const unrelated = 2;\n");
			git(directory, ["add", "--", "unrelated.ts"]);
			git(directory, ["commit", "-q", "--only", "-m", "unrelated", "--", "unrelated.ts"]);
			const afterUnrelatedCommit = await repository.changes();
			const unchangedTarget = afterUnrelatedCommit.files.find(
				(candidate) => candidate.path === "target.ts",
			);
			expect(unchangedTarget?.contentRevision).toBe(file.contentRevision);
			expect(unchangedTarget?.reviewed).toBe(true);

			await writeFile(path.join(directory, "target.ts"), "ONE\n\nchanged token\n");
			const staleState = await repository.reviewState();
			expect(staleState.reviews.find((review) => review.fileId === file.id)?.reviewed).toBe(false);
			expect(staleState.comments.find((comment) => comment.id === created.comment.id)?.stale).toBe(
				true,
			);
			const edited = await repository.updateComment(created.comment.id, "Still needs attention.");
			expect(edited.comment.stale).toBe(true);
		} finally {
			repository.close();
		}
	});

	test("stages a copied destination without staging its modified source", async () => {
		const directory = await committedRepository({ "source.txt": "original\n" });
		git(directory, ["config", "status.renames", "copies"]);
		await copyFile(path.join(directory, "source.txt"), path.join(directory, "copy.txt"));
		git(directory, ["add", "--", "copy.txt"]);
		await writeFile(path.join(directory, "copy.txt"), "original\ncopy edit\n");
		await writeFile(path.join(directory, "source.txt"), "source edit\n");
		const repository = await GitRepository.open(directory);

		try {
			const before = await repository.changes();
			const copied = before.files.find((candidate) => candidate.path === "copy.txt");
			expect(copied).toMatchObject({ staged: true, unstaged: true });
			if (!copied) throw new Error("copy fixture missing");
			const copyDiff = await repository.diff(copied.id);
			expect(
				copyDiff.diff.hunks.flatMap((hunk) => hunk.lines).map((line) => line.text),
			).not.toContain("source edit");
			await repository.stage({
				fileId: copied.id,
				operationRevision: before.operationRevision,
				contentRevision: copied.contentRevision,
			});
			expect(git(directory, ["diff", "--cached", "--", "source.txt"])).toBe("");
			expect(git(directory, ["diff", "--", "source.txt"])).toContain("source edit");
		} finally {
			repository.close();
		}
	});

	test("returns conflicts for a busy or changed index without staging the selected file", async () => {
		const directory = await committedRepository({ "a.txt": "a\n", "b.txt": "b\n" });
		await writeFile(path.join(directory, "a.txt"), "a changed\n");
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			const file = before.files.find((candidate) => candidate.path === "a.txt");
			if (!file) throw new Error("conflict fixture missing");
			const indexLock = `${repository.indexPath}.lock`;
			await writeFile(indexLock, "busy");
			await expect(
				repository.stage({
					fileId: file.id,
					operationRevision: before.operationRevision,
					contentRevision: file.contentRevision,
				}),
			).rejects.toMatchObject({ status: 423 });
			await rm(indexLock);

			await writeFile(path.join(directory, "a.txt"), "a changed again\n");
			await expect(
				repository.stage({
					fileId: file.id,
					operationRevision: before.operationRevision,
					contentRevision: file.contentRevision,
				}),
			).rejects.toMatchObject({ status: 409 });
			expect(git(directory, ["diff", "--cached", "--", "a.txt"])).toBe("");

			const refreshed = await repository.changes();
			const refreshedFile = refreshed.files.find((candidate) => candidate.path === "a.txt");
			if (!refreshedFile) throw new Error("refreshed fixture missing");
			await writeFile(path.join(directory, "b.txt"), "b changed\n");
			git(directory, ["add", "--", "b.txt"]);
			await expect(
				repository.stage({
					fileId: refreshedFile.id,
					operationRevision: refreshed.operationRevision,
					contentRevision: refreshedFile.contentRevision,
				}),
			).rejects.toMatchObject({ status: 409 });
			expect(git(directory, ["diff", "--cached", "--", "a.txt"])).toBe("");
		} finally {
			repository.close();
		}
	});

	test("staging a deleted file does not recurse into an untracked replacement directory", async () => {
		const directory = await committedRepository({ foo: "tracked leaf\n" });
		await rm(path.join(directory, "foo"));
		await mkdir(path.join(directory, "foo"));
		await writeFile(path.join(directory, "foo", "bar.txt"), "untracked child\n");
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			const deleted = before.files.find((candidate) => candidate.path === "foo");
			const child = before.files.find((candidate) => candidate.path === "foo/bar.txt");
			expect(deleted?.kind).toBe("deleted");
			expect(child?.kind).toBe("untracked");
			if (!deleted) throw new Error("deleted fixture missing");
			await repository.stage({
				fileId: deleted.id,
				operationRevision: before.operationRevision,
				contentRevision: deleted.contentRevision,
			});
			expect(git(directory, ["diff", "--cached", "--name-only", "--", "foo/bar.txt"])).toBe("");
			expect(git(directory, ["ls-files", "--", "foo/bar.txt"])).toBe("");
		} finally {
			repository.close();
		}
	});

	test("shows and stages an index conflict as one reviewable file", async () => {
		const directory = await committedRepository({ "conflict.txt": "base\n" });
		const primaryBranch = git(directory, ["branch", "--show-current"]).trim();
		git(directory, ["checkout", "-q", "-b", "other"]);
		await writeFile(path.join(directory, "conflict.txt"), "other\n");
		git(directory, ["commit", "-qam", "other"]);
		git(directory, ["checkout", "-q", primaryBranch]);
		await writeFile(path.join(directory, "conflict.txt"), "primary\n");
		git(directory, ["commit", "-qam", "primary"]);
		const merge = Bun.spawnSync(["git", "-C", directory, "merge", "other"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(merge.exitCode).not.toBe(0);
		const repository = await GitRepository.open(directory);
		try {
			const before = await repository.changes();
			const conflicted = before.files.find((candidate) => candidate.path === "conflict.txt");
			expect(conflicted).toMatchObject({ conflicted: true, staged: true, unstaged: true });
			if (!conflicted) throw new Error("conflict fixture missing");
			await expect(
				repository.commitMessageContext({
					operationRevision: before.operationRevision,
				}),
			).rejects.toMatchObject({
				status: 409,
				code: "unresolved_conflicts",
			});
			const diff = await repository.diff(conflicted.id);
			expect(
				diff.diff.hunks.flatMap((hunk) => hunk.lines).some((line) => line.text.includes("<<<<<<<")),
			).toBe(true);
			await repository.stage({
				fileId: conflicted.id,
				operationRevision: before.operationRevision,
				contentRevision: conflicted.contentRevision,
			});
			expect(
				(await repository.changes()).files.find((file) => file.path === "conflict.txt")?.conflicted,
			).toBe(false);
		} finally {
			repository.close();
		}
	});
});
