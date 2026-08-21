import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	measureStagedCandidate,
	type QualityBenchmarkBaseline,
	stagedIndexHash,
	trackedBaselinePath,
} from "./benchmarkQualityChecks.ts";

function formatMilliseconds(value: number): string {
	return `${value.toFixed(1)} ms`;
}

export async function updateQualityBenchmarkBaseline(repositoryRoot: string): Promise<string> {
	console.log("Updating the tracked quality-control baseline from the staged candidate");
	const benchmarks = await measureStagedCandidate(repositoryRoot);
	for (const benchmark of benchmarks) {
		console.log(`- ${benchmark.name}: median ${formatMilliseconds(benchmark.summary.medianMs)}`);
	}
	const baseline: QualityBenchmarkBaseline = {
		architecture: process.arch,
		benchmarks,
		bunVersion: Bun.version,
		createdAt: new Date().toISOString(),
		platform: process.platform,
		schemaVersion: 1,
		sourceIndexHash: stagedIndexHash(repositoryRoot),
	};
	const path = trackedBaselinePath(repositoryRoot);
	const temporaryPath = `${path}.${process.pid}.tmp`;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(temporaryPath, `${JSON.stringify(baseline, null, "\t")}\n`);
	await rename(temporaryPath, path);
	console.log(`Tracked baseline updated: ${path}`);
	console.log("Review and stage this file explicitly before committing.");
	return path;
}

async function main() {
	const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
	if (argumentsWithoutSeparator.length > 0) {
		throw new Error("Usage: bun run benchmark:quality:update");
	}
	await updateQualityBenchmarkBaseline(resolve(import.meta.dir, ".."));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
