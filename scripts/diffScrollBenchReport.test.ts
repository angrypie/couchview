import { describe, expect, test } from "bun:test";
import type { DiffScrollSample } from "./diffScrollBenchPage.ts";
import {
	compareDiffScrollBenchmarkReports,
	type DiffScrollBudgets,
	evaluateDiffScrollBudgets,
	formatDiffScrollComparison,
	summarizeDiffScrollSamples,
} from "./diffScrollBenchReport.ts";

function sample(
	cpuPercent: number,
	powerWatts: number,
	scenario: DiffScrollSample["scenario"] = "single",
): DiffScrollSample {
	return {
		endScrollTop: scenario === "single" ? 1_000 : 0,
		lineElements: 5_001,
		mountedLineElements: 42,
		mainThread: {
			layoutPercent: 1,
			recalcStylePercent: 2,
			scriptPercent: 3,
			taskPercent: 4,
		},
		processUsage: {
			averageCpuPercent: cpuPercent,
			averagePowerWatts: powerWatts,
			cpuTimeMs: 100,
			cycles: 200,
			energyJoules: 3,
			instructions: 400,
			interruptWakeups: 5,
			lifetimeMaxPhysicalFootprintMB: 800,
			lostPids: [],
			packageIdleWakeups: 6,
			physicalFootprintMB: 700,
			processes: [],
			wallTimeMs: 1_000,
		},
		scenario,
		startScrollTop: 0,
		targetScrollTop: scenario === "single" ? 1_000 : 0,
	};
}

function benchmarkReport(
	options: {
		environmentCpu?: string;
		initializationTime?: number;
		repeatedCpu?: number;
		repeatedPower?: number;
		singleCpu?: number;
		singlePower?: number;
	} = {},
) {
	const singleCpu = options.singleCpu ?? 30;
	const singlePower = options.singlePower ?? 3;
	const repeatedCpu = options.repeatedCpu ?? 40;
	const repeatedPower = options.repeatedPower ?? 4;
	return {
		createdAt: "2026-08-21T00:00:00.000Z",
		environment: {
			architecture: "arm64",
			browser: "149.0.7827.55",
			cpu: options.environmentCpu ?? "Apple M4 Pro",
			gpu: {
				auxAttributes: {
					displayType: "ANGLE_METAL",
					initializationTime: options.initializationTime ?? 0.1,
					processCrashCount: 0,
					visibilityCallbackCallCount: 0,
				},
				devices: [{ deviceString: "Apple M4 Pro", vendorId: 4203 }],
			},
			hardwareModel: "Mac16,11",
			logicalCpus: 12,
			macOS: "26.5.2",
			osRelease: "25.5.0",
		},
		samples: {
			repeated: Array.from({ length: 5 }, () => sample(repeatedCpu, repeatedPower, "repeated")),
			single: Array.from({ length: 5 }, () => sample(singleCpu, singlePower)),
		},
		schemaVersion: 1,
		source: { commit: "abc", dirty: false },
		summaries: {},
		workload: {
			controlMode: null,
			deviceScaleFactor: 2,
			lineCount: 5_000,
			repeatedLegs: 4,
			scrollGestureSpeedPixelsPerSecond: 50_000,
			viewport: { height: 800, width: 1_280 },
		},
	};
}

describe("diff scroll benchmark report", () => {
	test("uses medians so one noisy run cannot define the result", () => {
		const summary = summarizeDiffScrollSamples([
			sample(40, 4),
			sample(20, 2),
			sample(30, 3),
			sample(200, 20),
			sample(10, 1),
		]);

		expect(summary.cpuPercent.median).toBe(30);
		expect(summary.powerWatts.median).toBe(3);
		expect(summary.cpuPercent.p95).toBe(200);
	});

	test("requires strict raw-sample CPU and power improvements in comparable reports", () => {
		const baseline = benchmarkReport();
		const candidate = benchmarkReport({
			initializationTime: 0.2,
			repeatedCpu: 39,
			repeatedPower: 3.9,
			singleCpu: 29,
			singlePower: 2.9,
		});
		candidate.environment.gpu.auxAttributes.processCrashCount = 2;
		candidate.environment.gpu.auxAttributes.visibilityCallbackCallCount = 7;

		const comparison = compareDiffScrollBenchmarkReports(baseline, candidate);

		expect(comparison.single.cpuPercent).toEqual({
			baselineMedian: 30,
			candidateMedian: 29,
			delta: -1,
			relativeChange: 29 / 30 - 1,
		});
		expect(comparison.repeated.powerWatts.candidateMedian).toBe(3.9);
		expect(formatDiffScrollComparison(comparison)).toContain(
			"single: CPU 29.000% vs 30.000% (-3.3%)",
		);
	});

	test("rejects workload and stable environment mismatches", () => {
		const baseline = benchmarkReport();
		const workloadMismatch = benchmarkReport({ singleCpu: 29, singlePower: 2.9 });
		workloadMismatch.workload.lineCount = 250;
		expect(() => compareDiffScrollBenchmarkReports(baseline, workloadMismatch)).toThrow(
			"Candidate workload does not exactly match",
		);

		const environmentMismatch = benchmarkReport({
			environmentCpu: "Apple M5",
			repeatedCpu: 39,
			repeatedPower: 3.9,
			singleCpu: 29,
			singlePower: 2.9,
		});
		expect(() => compareDiffScrollBenchmarkReports(baseline, environmentMismatch)).toThrow(
			"Candidate environment does not exactly match",
		);

		const gpuMismatch = benchmarkReport({
			repeatedCpu: 39,
			repeatedPower: 3.9,
			singleCpu: 29,
			singlePower: 2.9,
		});
		gpuMismatch.environment.gpu.auxAttributes.displayType = "ANGLE_OPENGL";
		expect(() => compareDiffScrollBenchmarkReports(baseline, gpuMismatch)).toThrow(
			"Candidate environment does not exactly match",
		);
	});

	test("rejects reports from another schema", () => {
		const baseline = benchmarkReport();
		const candidate = benchmarkReport();
		candidate.schemaVersion = 2;

		expect(() => compareDiffScrollBenchmarkReports(baseline, candidate)).toThrow(
			"Candidate report must use diff scroll schemaVersion 1",
		);
	});

	test("rejects incomplete, lost-process, malformed, and mislabelled samples", () => {
		const baseline = benchmarkReport();
		const incomplete = benchmarkReport();
		incomplete.samples.single.pop();
		expect(() => compareDiffScrollBenchmarkReports(baseline, incomplete)).toThrow(
			"must contain exactly 5 samples",
		);

		const lostProcess = benchmarkReport();
		lostProcess.samples.repeated[2]!.processUsage.lostPids.push(123);
		expect(() => compareDiffScrollBenchmarkReports(baseline, lostProcess)).toThrow(
			"lostPids must be empty",
		);

		const nonfinite = benchmarkReport();
		nonfinite.samples.single[1]!.processUsage.averageCpuPercent = Number.NaN;
		expect(() => compareDiffScrollBenchmarkReports(baseline, nonfinite)).toThrow(
			"must be a finite non-negative number",
		);

		const mislabelled = benchmarkReport();
		mislabelled.samples.repeated[0]!.scenario = "single";
		expect(() => compareDiffScrollBenchmarkReports(baseline, mislabelled)).toThrow(
			"has scenario single, expected repeated",
		);
	});

	test("rejects ties or regressions in any required median", () => {
		const baseline = benchmarkReport();
		const candidate = benchmarkReport({
			repeatedCpu: 39,
			repeatedPower: 4.1,
			singleCpu: 30,
			singlePower: 2.9,
		});
		candidate.summaries = {
			repeated: { cpuPercent: { median: 0 }, powerWatts: { median: 0 } },
			single: { cpuPercent: { median: 0 }, powerWatts: { median: 0 } },
		};

		expect(() => compareDiffScrollBenchmarkReports(baseline, candidate)).toThrow(
			"single median CPU 30.000% is not lower than baseline 30.000%",
		);
		expect(() => compareDiffScrollBenchmarkReports(baseline, candidate)).toThrow(
			"repeated median power 4.100000 W is not lower than baseline 4.000000 W",
		);
	});

	test("fails independently on whole-process CPU and measured power", () => {
		const summary = summarizeDiffScrollSamples([sample(31, 3.1)]);
		const budgets: DiffScrollBudgets = {
			maximumCpuPercent: 30,
			maximumPowerWatts: 3,
		};

		expect(evaluateDiffScrollBudgets(summary, budgets)).toEqual([
			"median whole-process CPU 31.00% exceeds 30.00%",
			"median measured power 3.100 W exceeds 3.000 W",
		]);
	});
});
