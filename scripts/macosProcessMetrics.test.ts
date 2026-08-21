import { describe, expect, test } from "bun:test";

import {
	captureProcessTree,
	processTreeFromRows,
	runKnownProcessMetricSelfTest,
	runProcessMetricSelfTest,
} from "./macosProcessMetrics.ts";

describe("macOS process-tree metrics", () => {
	test.skipIf(process.platform !== "darwin")(
		"timestamps snapshots in Foundation's system-uptime clock domain",
		async () => {
			const before = await captureProcessTree(process.pid);
			const swift = Bun.spawn(
				["xcrun", "swift", "-e", "import Foundation; print(ProcessInfo.processInfo.systemUptime)"],
				{ stderr: "pipe", stdout: "pipe" },
			);
			const [exitCode, stdout, stderr] = await Promise.all([
				swift.exited,
				new Response(swift.stdout).text(),
				new Response(swift.stderr).text(),
			]);
			const after = await captureProcessTree(process.pid);
			const foundationUptimeNanoseconds = Number(stdout.trim()) * 1_000_000_000;

			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			expect(foundationUptimeNanoseconds).toBeGreaterThanOrEqual(before.capturedAtNanoseconds);
			expect(foundationUptimeNanoseconds).toBeLessThanOrEqual(after.capturedAtNanoseconds);
		},
	);

	test("selects the complete descendant tree without neighboring processes", () => {
		const rows = [
			{ command: "Chromium", pid: 100, parentPid: 1 },
			{ command: "Chromium Helper", pid: 101, parentPid: 100 },
			{ command: "Chromium Renderer", pid: 102, parentPid: 101 },
			{ command: "unrelated", pid: 103, parentPid: 1 },
			{ command: "unrelated child", pid: 104, parentPid: 103 },
		];

		expect(processTreeFromRows(rows, 100)).toEqual([100, 101, 102]);
	});

	test.skipIf(process.platform !== "darwin")(
		"observes explicitly identified owned processes without enumerating the process table",
		async () => {
			const result = await runKnownProcessMetricSelfTest();

			expect(result.passed).toBe(true);
			expect(result.usage.cpuTimeMs).toBeGreaterThan(40);
			expect(result.usage.energyJoules).toBeGreaterThan(0);
			expect(result.usage.lostPids).toEqual([]);
		},
	);

	test.skipIf(process.platform !== "darwin")(
		"observes real CPU work and energy through the macOS kernel",
		async () => {
			const result = await runProcessMetricSelfTest();

			expect(result.passed).toBe(true);
			expect(result.usage.cpuTimeMs).toBeGreaterThan(40);
			expect(result.usage.energyJoules).toBeGreaterThan(0);
			expect(result.usage.averageCpuPercent).toBeGreaterThan(10);
			expect(result.usage.averagePowerWatts).toBeGreaterThan(0);
			expect(result.usage.lostPids).toEqual([]);
		},
	);
});
