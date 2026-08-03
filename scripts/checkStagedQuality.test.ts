import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runStagedQualityCommands } from "./checkStagedQuality.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

function runGit(root: string, args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: root,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

async function stagedQualityRepository(): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), "couchview-staged-quality-"));
	temporaryDirectories.push(root);
	await Promise.all([mkdir(resolve(root, "node_modules")), mkdir(resolve(root, "scripts"))]);
	await writeFile(resolve(root, "value.txt"), "head\n");
	await writeFile(
		resolve(root, "scripts/checkValue.ts"),
		'const value = await Bun.file(new URL("../value.txt", import.meta.url)).text();\n' +
			'if (value !== "staged\\n") process.exitCode = 1;\n',
	);
	runGit(root, ["init", "--quiet", "--initial-branch=main"]);
	runGit(root, ["config", "user.email", "quality@example.invalid"]);
	runGit(root, ["config", "user.name", "Quality Test"]);
	runGit(root, ["add", "value.txt", "scripts/checkValue.ts"]);
	runGit(root, ["commit", "--quiet", "-m", "fixture"]);
	return root;
}

describe("staged commit quality", () => {
	test("checks the staged candidate and excludes later working-tree edits", async () => {
		const root = await stagedQualityRepository();
		await writeFile(resolve(root, "value.txt"), "staged\n");
		runGit(root, ["add", "value.txt"]);
		await writeFile(resolve(root, "value.txt"), "unstaged\n");

		const commands = [{ name: "fixture", command: ["run", "scripts/checkValue.ts"] }];
		await expect(runStagedQualityCommands(root, commands)).resolves.toBeUndefined();

		runGit(root, ["add", "value.txt"]);
		await expect(runStagedQualityCommands(root, commands)).rejects.toThrow(
			"Staged fixture check failed",
		);
	});
});
