import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RepositoryContent } from "./repositoryContent.ts";

const temporaryDirectories: string[] = [];
const decoder = new TextDecoder();

function git(directory: string, args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", directory, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, LANG: "C", LC_ALL: "C" },
	});
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${decoder.decode(result.stderr)}`);
	}
}

async function projectFileFixture(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-project-files-"));
	temporaryDirectories.push(directory);
	git(directory, ["init", "-q", "--initial-branch=main"]);
	git(directory, ["config", "user.name", "Couchview Tests"]);
	git(directory, ["config", "user.email", "couchview@example.invalid"]);
	await writeFile(path.join(directory, ".gitignore"), "ignored/\n*.ignored\n");
	await writeFile(path.join(directory, "deleted.ts"), "export const deleted = true;\n");
	await writeFile(path.join(directory, "tracked\nline.ts"), "export const line = true;\n");
	await writeFile(path.join(directory, "tracked\tname.ts"), "export const tab = true;\n");
	git(directory, ["add", "-A"]);
	git(directory, ["commit", "-q", "-m", "fixture"]);

	await rm(path.join(directory, "deleted.ts"));
	await writeFile(path.join(directory, "new [draft]\nfile.ts"), "export const draft = true;\n");
	await writeFile(path.join(directory, "untracked\tfile.ts"), "export const local = true;\n");
	await mkdir(path.join(directory, "ignored"));
	await writeFile(path.join(directory, "ignored", "secret.ts"), "secret\n");
	await writeFile(path.join(directory, "skip.ignored"), "ignored\n");
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("project file catalog", () => {
	test("lists openable tracked and non-ignored untracked files with literal names", async () => {
		const directory = await projectFileFixture();
		const result = await new RepositoryContent(directory).projectFiles();
		const expected = [
			".gitignore",
			"new [draft]\nfile.ts",
			"tracked\nline.ts",
			"tracked\tname.ts",
			"untracked\tfile.ts",
		].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

		expect(result).toEqual({
			files: expected.map((path) => ({ path })),
			truncated: false,
		});
		expect(result.files.map((file) => file.path)).not.toContain("deleted.ts");
		expect(result.files.map((file) => file.path)).not.toContain("ignored/secret.ts");
		expect(result.files.map((file) => file.path)).not.toContain("skip.ignored");
	});

	test("caps the result count and reports truncation", async () => {
		const directory = await projectFileFixture();
		const result = await new RepositoryContent(directory).projectFiles({
			maxOutputBytes: 1024 * 1024,
			maxResults: 2,
		});

		expect(result.files).toHaveLength(2);
		expect(result.truncated).toBe(true);
	});

	test("drops a partial path when the bounded Git output is truncated", async () => {
		const directory = await projectFileFixture();
		const result = await new RepositoryContent(directory).projectFiles({
			maxOutputBytes: 16,
			maxResults: 50,
		});

		expect(result.files).toEqual([]);
		expect(result.truncated).toBe(true);
	});
});
