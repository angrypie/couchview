import { isDeepStrictEqual } from "node:util";

import type { DiffScrollSample, DiffScrollScenario } from "./diffScrollBenchPage.ts";

export interface NumericSummary {
	max: number;
	mean: number;
	median: number;
	min: number;
	p95: number;
	samples: number;
}

export interface DiffScrollSummary {
	cpuPercent: NumericSummary;
	energyJoules: NumericSummary;
	lineElements: number;
	mountedLineElements: number;
	physicalFootprintMB: NumericSummary;
	powerWatts: NumericSummary;
	scenario: DiffScrollScenario;
	scriptPercent: NumericSummary;
	taskPercent: NumericSummary;
	wallTimeMs: NumericSummary;
}

export interface DiffScrollBudgets {
	maximumCpuPercent: number;
	maximumPowerWatts: number;
}

export interface DiffScrollMetricComparison {
	baselineMedian: number;
	candidateMedian: number;
	delta: number;
	relativeChange: number;
}

export interface DiffScrollScenarioComparison {
	cpuPercent: DiffScrollMetricComparison;
	powerWatts: DiffScrollMetricComparison;
	scenario: DiffScrollScenario;
}

export interface DiffScrollBenchmarkComparison {
	repeated: DiffScrollScenarioComparison;
	single: DiffScrollScenarioComparison;
}

interface ComparableDiffScrollReport {
	environment: Record<string, unknown>;
	samples: Record<DiffScrollScenario, readonly DiffScrollSample[]>;
	workload: Record<string, unknown>;
}

const REQUIRED_COMPARISON_SAMPLES = 5;
const VOLATILE_GPU_ATTRIBUTES = [
	"initializationTime",
	"processCrashCount",
	"visibilityCallbackCallCount",
] as const;

function percentile(sorted: readonly number[], fraction: number): number {
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export function summarizeNumbers(values: readonly number[]): NumericSummary {
	if (values.length === 0) throw new Error("At least one benchmark sample is required.");
	const sorted = [...values].sort((left, right) => left - right);
	return {
		max: sorted.at(-1) ?? 0,
		mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
		median: percentile(sorted, 0.5),
		min: sorted[0] ?? 0,
		p95: percentile(sorted, 0.95),
		samples: sorted.length,
	};
}

export function summarizeDiffScrollSamples(
	samples: readonly DiffScrollSample[],
): DiffScrollSummary {
	const first = samples[0];
	if (!first) throw new Error("At least one diff scroll sample is required.");
	if (samples.some((sample) => sample.scenario !== first.scenario)) {
		throw new Error("Diff scroll samples must belong to one scenario.");
	}
	return {
		cpuPercent: summarizeNumbers(samples.map((sample) => sample.processUsage.averageCpuPercent)),
		energyJoules: summarizeNumbers(samples.map((sample) => sample.processUsage.energyJoules)),
		lineElements: first.lineElements,
		mountedLineElements: first.mountedLineElements,
		physicalFootprintMB: summarizeNumbers(
			samples.map((sample) => sample.processUsage.physicalFootprintMB),
		),
		powerWatts: summarizeNumbers(samples.map((sample) => sample.processUsage.averagePowerWatts)),
		scenario: first.scenario,
		scriptPercent: summarizeNumbers(samples.map((sample) => sample.mainThread.scriptPercent)),
		taskPercent: summarizeNumbers(samples.map((sample) => sample.mainThread.taskPercent)),
		wallTimeMs: summarizeNumbers(samples.map((sample) => sample.processUsage.wallTimeMs)),
	};
}

export function evaluateDiffScrollBudgets(
	summary: DiffScrollSummary,
	budgets: DiffScrollBudgets,
): string[] {
	const failures: string[] = [];
	if (summary.cpuPercent.median > budgets.maximumCpuPercent) {
		failures.push(
			`median whole-process CPU ${summary.cpuPercent.median.toFixed(2)}% exceeds ${budgets.maximumCpuPercent.toFixed(2)}%`,
		);
	}
	if (summary.powerWatts.median > budgets.maximumPowerWatts) {
		failures.push(
			`median measured power ${summary.powerWatts.median.toFixed(3)} W exceeds ${budgets.maximumPowerWatts.toFixed(3)} W`,
		);
	}
	return failures;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function finiteMetric(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${label} must be a finite non-negative number.`);
	}
	return value;
}

function scenarioSamples(
	value: unknown,
	reportLabel: string,
	scenario: DiffScrollScenario,
): readonly DiffScrollSample[] {
	if (!Array.isArray(value) || value.length !== REQUIRED_COMPARISON_SAMPLES) {
		throw new Error(
			`${reportLabel} ${scenario} must contain exactly ${REQUIRED_COMPARISON_SAMPLES} samples.`,
		);
	}
	for (const [index, rawSample] of value.entries()) {
		const sampleLabel = `${reportLabel} ${scenario} sample ${index + 1}`;
		const sample = objectValue(rawSample, sampleLabel);
		if (sample.scenario !== scenario) {
			throw new Error(
				`${sampleLabel} has scenario ${String(sample.scenario)}, expected ${scenario}.`,
			);
		}
		const processUsage = objectValue(sample.processUsage, `${sampleLabel} processUsage`);
		finiteMetric(processUsage.averageCpuPercent, `${sampleLabel} CPU`);
		finiteMetric(processUsage.averagePowerWatts, `${sampleLabel} power`);
		if (!Array.isArray(processUsage.lostPids)) {
			throw new Error(`${sampleLabel} lostPids must be an array.`);
		}
		if (processUsage.lostPids.length > 0) {
			throw new Error(`${sampleLabel} lostPids must be empty.`);
		}
	}
	return value as readonly DiffScrollSample[];
}

function comparableReport(value: unknown, label: string): ComparableDiffScrollReport {
	const report = objectValue(value, label);
	if (report.schemaVersion !== 1) {
		throw new Error(`${label} must use diff scroll schemaVersion 1.`);
	}
	const samples = objectValue(report.samples, `${label} samples`);
	return {
		environment: objectValue(report.environment, `${label} environment`),
		samples: {
			repeated: scenarioSamples(samples.repeated, label, "repeated"),
			single: scenarioSamples(samples.single, label, "single"),
		},
		workload: objectValue(report.workload, `${label} workload`),
	};
}

function stableEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
	const gpu = environment.gpu;
	if (gpu === null || typeof gpu !== "object" || Array.isArray(gpu)) return environment;
	const gpuRecord = gpu as Record<string, unknown>;
	const auxAttributes = gpuRecord.auxAttributes;
	if (auxAttributes === null || typeof auxAttributes !== "object" || Array.isArray(auxAttributes)) {
		return environment;
	}
	const stableAuxAttributes = { ...(auxAttributes as Record<string, unknown>) };
	for (const attribute of VOLATILE_GPU_ATTRIBUTES) delete stableAuxAttributes[attribute];
	return {
		...environment,
		gpu: {
			...gpuRecord,
			auxAttributes: stableAuxAttributes,
		},
	};
}

function metricComparison(
	baselineValues: readonly number[],
	candidateValues: readonly number[],
): DiffScrollMetricComparison {
	const baselineMedian = summarizeNumbers(baselineValues).median;
	const candidateMedian = summarizeNumbers(candidateValues).median;
	return {
		baselineMedian,
		candidateMedian,
		delta: candidateMedian - baselineMedian,
		relativeChange:
			baselineMedian === 0 ? Number.POSITIVE_INFINITY : candidateMedian / baselineMedian - 1,
	};
}

function compareScenario(
	baseline: readonly DiffScrollSample[],
	candidate: readonly DiffScrollSample[],
	scenario: DiffScrollScenario,
): DiffScrollScenarioComparison {
	return {
		cpuPercent: metricComparison(
			baseline.map((sample) => sample.processUsage.averageCpuPercent),
			candidate.map((sample) => sample.processUsage.averageCpuPercent),
		),
		powerWatts: metricComparison(
			baseline.map((sample) => sample.processUsage.averagePowerWatts),
			candidate.map((sample) => sample.processUsage.averagePowerWatts),
		),
		scenario,
	};
}

function requireStrictlyLower(comparison: DiffScrollScenarioComparison): void {
	const failures: string[] = [];
	if (comparison.cpuPercent.candidateMedian >= comparison.cpuPercent.baselineMedian) {
		failures.push(
			`${comparison.scenario} median CPU ${comparison.cpuPercent.candidateMedian.toFixed(3)}% ` +
				`is not lower than baseline ${comparison.cpuPercent.baselineMedian.toFixed(3)}%`,
		);
	}
	if (comparison.powerWatts.candidateMedian >= comparison.powerWatts.baselineMedian) {
		failures.push(
			`${comparison.scenario} median power ${comparison.powerWatts.candidateMedian.toFixed(6)} W ` +
				`is not lower than baseline ${comparison.powerWatts.baselineMedian.toFixed(6)} W`,
		);
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
}

export function compareDiffScrollBenchmarkReports(
	baselineValue: unknown,
	candidateValue: unknown,
): DiffScrollBenchmarkComparison {
	const baseline = comparableReport(baselineValue, "Baseline report");
	const candidate = comparableReport(candidateValue, "Candidate report");
	if (!isDeepStrictEqual(baseline.workload, candidate.workload)) {
		throw new Error("Candidate workload does not exactly match the baseline workload.");
	}
	if (
		!isDeepStrictEqual(
			stableEnvironment(baseline.environment),
			stableEnvironment(candidate.environment),
		)
	) {
		throw new Error("Candidate environment does not exactly match the baseline environment.");
	}
	const comparison = {
		repeated: compareScenario(baseline.samples.repeated, candidate.samples.repeated, "repeated"),
		single: compareScenario(baseline.samples.single, candidate.samples.single, "single"),
	};
	const failures: string[] = [];
	for (const scenario of [comparison.single, comparison.repeated]) {
		try {
			requireStrictlyLower(scenario);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (failures.length > 0) {
		throw new Error(`Candidate is not strictly better than baseline:\n${failures.join("\n")}`);
	}
	return comparison;
}

export function formatDiffScrollComparison(comparison: DiffScrollBenchmarkComparison): string {
	return [comparison.single, comparison.repeated]
		.map(
			(scenario) =>
				`${scenario.scenario}: CPU ${scenario.cpuPercent.candidateMedian.toFixed(3)}% vs ` +
				`${scenario.cpuPercent.baselineMedian.toFixed(3)}% ` +
				`(${(scenario.cpuPercent.relativeChange * 100).toFixed(1)}%); power ` +
				`${scenario.powerWatts.candidateMedian.toFixed(6)} W vs ` +
				`${scenario.powerWatts.baselineMedian.toFixed(6)} W ` +
				`(${(scenario.powerWatts.relativeChange * 100).toFixed(1)}%)`,
		)
		.join("\n");
}

export function formatDiffScrollSummary(summary: DiffScrollSummary): string {
	return [
		`${summary.scenario}:`,
		`CPU ${summary.cpuPercent.median.toFixed(1)}%`,
		`power ${summary.powerWatts.median.toFixed(3)} W`,
		`energy ${summary.energyJoules.median.toFixed(3)} J`,
		`memory ${summary.physicalFootprintMB.median.toFixed(0)} MB`,
		`wall ${summary.wallTimeMs.median.toFixed(0)} ms`,
		`Chrome task ${summary.taskPercent.median.toFixed(1)}%`,
		`script ${summary.scriptPercent.median.toFixed(1)}%`,
		`rows ${summary.lineElements} (${summary.mountedLineElements} mounted)`,
	].join(" | ");
}
