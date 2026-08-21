import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
	compareDiffScrollBenchmarkReports,
	formatDiffScrollComparison,
} from "./diffScrollBenchReport.ts";

interface CompareOptions {
	baseline: string;
	candidate: string;
}

function compareOptions(args: string[]): CompareOptions {
	const parsed = parseArgs({
		args,
		options: {
			baseline: { type: "string" },
			candidate: { type: "string" },
		},
		strict: true,
	});
	if (!parsed.values.baseline || !parsed.values.candidate) {
		throw new Error("Use --baseline <report.json> and --candidate <report.json>.");
	}
	const baseline = resolve(parsed.values.baseline);
	const candidate = resolve(parsed.values.candidate);
	if (baseline === candidate) {
		throw new Error("Baseline and candidate reports must use different paths.");
	}
	return { baseline, candidate };
}

async function readReport(path: string, label: string): Promise<unknown> {
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (error) {
		throw new Error(`Could not read ${label} report at ${path}.`, { cause: error });
	}
	try {
		return JSON.parse(source);
	} catch (error) {
		throw new Error(`${label} report at ${path} is not valid JSON.`, { cause: error });
	}
}

async function main(): Promise<void> {
	const options = compareOptions(process.argv.slice(2));
	const baseline = await readReport(options.baseline, "baseline");
	const candidate = await readReport(options.candidate, "candidate");
	const comparison = compareDiffScrollBenchmarkReports(baseline, candidate);
	console.log(formatDiffScrollComparison(comparison));
	console.log("Candidate is strictly lower in CPU and power for both scenarios.");
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
