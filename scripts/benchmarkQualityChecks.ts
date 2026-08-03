import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export interface BenchmarkSummary {
	maxMs: number;
	meanMs: number;
	medianMs: number;
	minMs: number;
	p95Ms: number;
	samples: number;
}

export interface QualityBenchmarkBaseline {
	architecture: string;
	benchmarks: Array<{
		name: string;
		summary: BenchmarkSummary;
	}>;
	bunVersion: string;
	createdAt: string;
	platform: string;
	schemaVersion: 1;
	sourceIndexHash: string;
}

export interface RegressionResult {
	allowedMedianMs: number;
	deltaMs: number;
	regressed: boolean;
	ratio: number;
}

export interface StagedSnapshot {
	root: string;
	cleanup(): Promise<void>;
}

interface BenchmarkDefinition {
	command: string[];
	name: string;
	samples: number;
	warmups: number;
}

export const MAXIMUM_RELATIVE_INCREASE = 1.2;
export const TRACKED_BASELINE_PATH = "benchmarks/quality-checks.json";

const BENCHMARKS: BenchmarkDefinition[] = [
	{
		name: "custom architecture checker",
		command: ["run", "scripts/checkArchitecture.ts"],
		warmups: 2,
		samples: 15,
	},
	{
		name: "complete architecture gate",
		command: ["run", "check:architecture"],
		warmups: 1,
		samples: 5,
	},
];

function outputText(value: Uint8Array | undefined): string {
	return value ? new TextDecoder().decode(value).trim() : "";
}

function runChecked(command: string[], cwd: string): void {
	const result = Bun.spawnSync(command, {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.success) return;
	const diagnostic = [outputText(result.stderr), outputText(result.stdout)]
		.filter(Boolean)
		.join("\n");
	throw new Error(`${command.join(" ")} failed${diagnostic ? `:\n${diagnostic}` : "."}`);
}

function runOutput(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.success) return outputText(result.stdout);
	const diagnostic = [outputText(result.stderr), outputText(result.stdout)]
		.filter(Boolean)
		.join("\n");
	throw new Error(`${command.join(" ")} failed${diagnostic ? `:\n${diagnostic}` : "."}`);
}

function percentile(sortedSamples: readonly number[], fraction: number): number {
	const index = Math.max(0, Math.ceil(sortedSamples.length * fraction) - 1);
	return sortedSamples[index] ?? 0;
}

export function summarizeSamples(samples: readonly number[]): BenchmarkSummary {
	if (samples.length === 0) throw new Error("At least one benchmark sample is required.");
	const sorted = [...samples].sort((left, right) => left - right);
	return {
		maxMs: sorted.at(-1) ?? 0,
		meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
		medianMs: percentile(sorted, 0.5),
		minMs: sorted[0] ?? 0,
		p95Ms: percentile(sorted, 0.95),
		samples: sorted.length,
	};
}

export function compareBenchmark(
	baseline: BenchmarkSummary,
	candidate: BenchmarkSummary,
): RegressionResult {
	const allowedMedianMs = baseline.medianMs * MAXIMUM_RELATIVE_INCREASE;
	return {
		allowedMedianMs,
		deltaMs: candidate.medianMs - baseline.medianMs,
		regressed: candidate.medianMs > allowedMedianMs,
		ratio:
			baseline.medianMs === 0 ? Number.POSITIVE_INFINITY : candidate.medianMs / baseline.medianMs,
	};
}

async function initializeSnapshot(root: string, dependencyRoot: string): Promise<void> {
	const dependencySource = resolve(dependencyRoot, "node_modules");
	if (!existsSync(dependencySource)) {
		throw new Error("node_modules is missing; run bun install before benchmarking.");
	}
	await symlink(
		dependencySource,
		resolve(root, "node_modules"),
		process.platform === "win32" ? "junction" : "dir",
	);
	// Biome's VCS-aware rules need a repository root. The temporary repository is deleted with
	// the snapshot and never touches the user's worktree or index.
	runChecked(["git", "init", "--quiet"], root);
}

export async function createStagedSnapshot(repositoryRoot: string): Promise<StagedSnapshot> {
	const temporaryRoot = await mkdtemp(resolve(tmpdir(), "couchview-quality-benchmark-"));
	const snapshotRoot = resolve(temporaryRoot, "candidate");
	await mkdir(snapshotRoot);

	try {
		// checkout-index materializes exactly what the pending commit contains. Working-tree edits
		// that have not been staged cannot affect either the benchmark or its tracked baseline.
		runChecked(
			["git", "checkout-index", "--all", `--prefix=${snapshotRoot}${sep}`],
			repositoryRoot,
		);
		await initializeSnapshot(snapshotRoot, repositoryRoot);
	} catch (error) {
		await rm(temporaryRoot, { force: true, recursive: true });
		throw error;
	}

	return {
		root: snapshotRoot,
		cleanup: () => rm(temporaryRoot, { force: true, recursive: true }),
	};
}

function supportsBenchmark(root: string, benchmark: BenchmarkDefinition): boolean {
	if (benchmark.command.at(-1) === "scripts/checkArchitecture.ts") {
		return existsSync(resolve(root, "scripts/checkArchitecture.ts"));
	}
	const packagePath = resolve(root, "package.json");
	if (!existsSync(packagePath)) return false;
	try {
		const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
			scripts?: Record<string, string>;
		};
		return Boolean(manifest.scripts?.["check:architecture"]);
	} catch {
		return false;
	}
}

function timedRun(root: string, benchmark: BenchmarkDefinition): number {
	const startedAt = Bun.nanoseconds();
	runChecked([process.execPath, ...benchmark.command], root);
	return (Bun.nanoseconds() - startedAt) / 1_000_000;
}

function benchmarkRoot(root: string): Array<{ name: string; summary: BenchmarkSummary }> {
	return BENCHMARKS.map((benchmark) => {
		if (!supportsBenchmark(root, benchmark)) {
			throw new Error(`The staged candidate is missing ${benchmark.name}.`);
		}
		for (let index = 0; index < benchmark.warmups; index += 1) {
			timedRun(root, benchmark);
		}
		const samples = Array.from({ length: benchmark.samples }, () => timedRun(root, benchmark));
		return { name: benchmark.name, summary: summarizeSamples(samples) };
	});
}

function formatMilliseconds(value: number): string {
	return `${value.toFixed(1)} ms`;
}

function isSummary(value: unknown): value is BenchmarkSummary {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const summary = value as Record<string, unknown>;
	const timingKeys = ["maxMs", "meanMs", "medianMs", "minMs", "p95Ms"];
	return (
		timingKeys.every((key) => typeof summary[key] === "number" && Number.isFinite(summary[key])) &&
		typeof summary.samples === "number" &&
		Number.isInteger(summary.samples) &&
		summary.samples > 0
	);
}

function parseTrackedBaseline(value: unknown): QualityBenchmarkBaseline {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("The tracked quality benchmark baseline is malformed.");
	}
	const baseline = value as Record<string, unknown>;
	if (
		baseline.schemaVersion !== 1 ||
		typeof baseline.createdAt !== "string" ||
		typeof baseline.sourceIndexHash !== "string" ||
		typeof baseline.bunVersion !== "string" ||
		typeof baseline.platform !== "string" ||
		typeof baseline.architecture !== "string" ||
		!Array.isArray(baseline.benchmarks) ||
		baseline.benchmarks.some(
			(entry) =>
				!entry ||
				typeof entry !== "object" ||
				typeof (entry as Record<string, unknown>).name !== "string" ||
				!isSummary((entry as Record<string, unknown>).summary),
		)
	) {
		throw new Error("The tracked quality benchmark baseline is malformed.");
	}
	return baseline as unknown as QualityBenchmarkBaseline;
}

export function trackedBaselinePath(repositoryRoot: string): string {
	return resolve(repositoryRoot, TRACKED_BASELINE_PATH);
}

export async function readTrackedBaseline(
	repositoryRoot: string,
): Promise<QualityBenchmarkBaseline> {
	const path = trackedBaselinePath(repositoryRoot);
	if (!existsSync(path)) {
		throw new Error(
			`The tracked quality benchmark baseline is missing at ${TRACKED_BASELINE_PATH}. ` +
				"Run `bun run benchmark:quality:update` after staging the intended implementation.",
		);
	}
	try {
		return parseTrackedBaseline(JSON.parse(await readFile(path, "utf8")));
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error("The tracked quality benchmark baseline is malformed.");
		}
		throw error;
	}
}

export function stagedIndexHash(repositoryRoot: string): string {
	const index = runOutput(["git", "ls-files", "--stage"], repositoryRoot);
	return new Bun.CryptoHasher("sha256").update(index).digest("hex");
}

export async function measureStagedCandidate(
	repositoryRoot: string,
): Promise<Array<{ name: string; summary: BenchmarkSummary }>> {
	const snapshot = await createStagedSnapshot(repositoryRoot);
	try {
		return benchmarkRoot(snapshot.root);
	} finally {
		await snapshot.cleanup();
	}
}

export async function runStagedComparison(repositoryRoot: string): Promise<boolean> {
	const snapshot = await createStagedSnapshot(repositoryRoot);
	let regressed = false;
	try {
		const baseline = await readTrackedBaseline(snapshot.root);
		console.log(
			`Quality-control benchmark: tracked baseline vs staged candidate (${basename(repositoryRoot)})`,
		);
		const candidate = benchmarkRoot(snapshot.root);
		for (const benchmark of BENCHMARKS) {
			const before = baseline.benchmarks.find((entry) => entry.name === benchmark.name);
			const after = candidate.find((entry) => entry.name === benchmark.name);
			if (!before || !after) {
				throw new Error(`The tracked baseline is missing ${benchmark.name}.`);
			}
			const comparison = compareBenchmark(before.summary, after.summary);
			const marker = comparison.regressed ? "REGRESSION" : "pass";
			console.log(
				`- ${benchmark.name}: ${marker}; baseline ${formatMilliseconds(before.summary.medianMs)}, ` +
					`staged ${formatMilliseconds(after.summary.medianMs)}, ` +
					`limit ${formatMilliseconds(comparison.allowedMedianMs)}`,
			);
			regressed ||= comparison.regressed;
		}
	} finally {
		await snapshot.cleanup();
	}
	return !regressed;
}

async function main() {
	const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
	if (argumentsWithoutSeparator.length > 0) {
		throw new Error("Usage: bun run benchmark:quality");
	}
	const passed = await runStagedComparison(resolve(import.meta.dir, ".."));
	if (!passed) {
		console.error(
			"Quality-control performance exceeds 120% of the tracked baseline. Re-run under a " +
				"quiet load, then inspect the changed checker before continuing.",
		);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
