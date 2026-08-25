import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	type BenchmarkSummary,
	compareBenchmark,
	createStagedSnapshot,
	readTrackedBaseline,
	runStagedComparison,
	stagedIndexHash,
	summarizeSamples,
	TRACKED_BASELINE_PATH,
} from "./benchmarkQualityChecks.ts";
import { updateQualityBenchmarkBaseline } from "./updateQualityBenchmarkBaseline.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

function runGit(root: string, args: string[]) {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: root,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

function gitOutput(root: string, args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: root,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
	return new TextDecoder().decode(result.stdout);
}

function summary(medianMs: number): BenchmarkSummary {
	return {
		maxMs: medianMs,
		meanMs: medianMs,
		medianMs,
		minMs: medianMs,
		p95Ms: medianMs,
		samples: 1,
	};
}

function baselineDocument(medianMs: number): string {
	return `${JSON.stringify(
		{
			architecture: "arm64",
			benchmarks: [
				{ name: "custom architecture checker", summary: summary(medianMs) },
				{ name: "complete architecture gate", summary: summary(medianMs) },
			],
			bunVersion: "1.4.0",
			createdAt: "2026-08-02T00:00:00.000Z",
			platform: "darwin",
			schemaVersion: 1,
			sourceIndexHash: "fixture-index-hash",
		},
		null,
		"\t",
	)}\n`;
}

async function benchmarkRepository(options: { baseline?: string | null } = {}): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), "couchview-benchmark-repository-"));
	temporaryDirectories.push(root);
	await Promise.all([
		mkdir(resolve(root, "node_modules")),
		mkdir(resolve(root, "scripts")),
		mkdir(resolve(root, "benchmarks")),
	]);
	await writeFile(
		resolve(root, "package.json"),
		JSON.stringify({ scripts: { "check:architecture": "bun run scripts/checkArchitecture.ts" } }),
	);
	await writeFile(resolve(root, "scripts/checkArchitecture.ts"), "export {};\n");
	if (options.baseline !== null) {
		await writeFile(
			resolve(root, TRACKED_BASELINE_PATH),
			options.baseline ?? baselineDocument(1_000),
		);
	}
	runGit(root, ["init", "--quiet", "--initial-branch=main"]);
	runGit(root, ["config", "user.email", "benchmark@example.invalid"]);
	runGit(root, ["config", "user.name", "Benchmark Test"]);
	runGit(root, ["add", "package.json", "scripts", "benchmarks"]);
	runGit(root, ["commit", "--quiet", "-m", "baseline"]);
	return root;
}

describe("quality-control benchmark", () => {
	test("summarizes samples without allowing outliers to define the median", () => {
		expect(summarizeSamples([10, 11, 12, 13, 90])).toEqual({
			maxMs: 90,
			meanMs: 27.2,
			medianMs: 12,
			minMs: 10,
			p95Ms: 90,
			samples: 5,
		});
	});

	test("allows at most twenty percent regression from the tracked baseline", () => {
		expect(compareBenchmark(summary(100), summary(120)).regressed).toBe(false);
		expect(compareBenchmark(summary(100), summary(120.01)).regressed).toBe(true);
	});

	test("detects cumulative slowdown against the fixed baseline", () => {
		const original = summary(100);
		const firstCommit = summary(110);
		const secondCommit = summary(110 * 1.1);

		expect(compareBenchmark(original, firstCommit).regressed).toBe(false);
		expect(compareBenchmark(firstCommit, secondCommit).regressed).toBe(false);
		expect(compareBenchmark(original, secondCommit).regressed).toBe(true);
	});

	test("materializes the staged index without including unstaged edits", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "couchview-benchmark-repository-"));
		temporaryDirectories.push(root);
		await mkdir(resolve(root, "node_modules"));
		await writeFile(resolve(root, "value.txt"), "head\n");
		runGit(root, ["init", "--quiet", "--initial-branch=main"]);
		runGit(root, ["config", "user.email", "benchmark@example.invalid"]);
		runGit(root, ["config", "user.name", "Benchmark Test"]);
		runGit(root, ["add", "value.txt"]);
		runGit(root, ["commit", "--quiet", "-m", "baseline"]);

		await writeFile(resolve(root, "value.txt"), "staged\n");
		runGit(root, ["add", "value.txt"]);
		await writeFile(resolve(root, "value.txt"), "unstaged\n");

		const snapshot = await createStagedSnapshot(root);
		try {
			expect(await readFile(resolve(snapshot.root, "value.txt"), "utf8")).toBe("staged\n");
		} finally {
			await snapshot.cleanup();
		}
	});

	test("compares against the tracked baseline without modifying repository state", async () => {
		const root = await benchmarkRepository();
		const statusBefore = gitOutput(root, ["status", "--short"]);
		const baselineBefore = await readFile(resolve(root, TRACKED_BASELINE_PATH), "utf8");

		expect(await runStagedComparison(root)).toBe(true);
		expect(gitOutput(root, ["status", "--short"])).toBe(statusBefore);
		expect(await readFile(resolve(root, TRACKED_BASELINE_PATH), "utf8")).toBe(baselineBefore);
	});

	test("rejects a staged candidate above the tracked baseline limit", async () => {
		const root = await benchmarkRepository({ baseline: baselineDocument(1) });
		expect(await runStagedComparison(root)).toBe(false);
	});

	test("updates only the tracked baseline through the explicit writer", async () => {
		const root = await benchmarkRepository();
		const expectedSourceIndexHash = stagedIndexHash(root);
		const path = await updateQualityBenchmarkBaseline(root);
		const baseline = await readTrackedBaseline(root);

		expect(existsSync(path)).toBe(true);
		expect(path).toBe(resolve(root, TRACKED_BASELINE_PATH));
		expect(path.startsWith(resolve(root, ".git"))).toBe(false);
		expect(baseline.sourceIndexHash).toBe(expectedSourceIndexHash);
		expect(baseline.benchmarks.map(({ name }) => name)).toEqual([
			"custom architecture checker",
			"complete architecture gate",
		]);
		expect(gitOutput(root, ["status", "--short"])).toBe(` M ${TRACKED_BASELINE_PATH}\n`);
	});

	test("reports a missing tracked baseline", async () => {
		const root = await benchmarkRepository({ baseline: null });
		expect(runStagedComparison(root)).rejects.toThrow(
			"tracked quality benchmark baseline is missing",
		);
	});

	test("reports a malformed tracked baseline", async () => {
		const root = await benchmarkRepository({ baseline: "{}\n" });
		expect(runStagedComparison(root)).rejects.toThrow(
			"tracked quality benchmark baseline is malformed",
		);
	});
});
