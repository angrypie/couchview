import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, chromium } from "@playwright/test";

import { buildExpoWeb } from "./buildExpoWeb.ts";
import { createDiffScrollFixture } from "./diffScrollBenchFixture.ts";
import {
	type DiffScrollSample,
	installDiffScrollRoutes,
	measureDiffScrollScenario,
	openDiffScrollFixture,
} from "./diffScrollBenchPage.ts";
import {
	evaluateDiffScrollBudgets,
	formatDiffScrollSummary,
	summarizeDiffScrollSamples,
} from "./diffScrollBenchReport.ts";
import { launchDiffScrollFixtureServer } from "./diffScrollBenchServer.ts";

interface BenchmarkOptions {
	controlMode: "raw" | null;
	dist: string | null;
	lineCount: number;
	maximumCpuPercent: number | null;
	maximumPowerWatts: number | null;
	output: string | null;
	samples: number;
	warmups: number;
}

function positiveInteger(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1)
		throw new Error(`${name} must be a positive integer.`);
	return parsed;
}

function nonnegativeInteger(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${name} must be a non-negative integer.`);
	}
	return parsed;
}

function optionalPositiveNumber(value: string | undefined, name: string): number | null {
	if (value === undefined) return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive.`);
	return parsed;
}

function benchmarkOptions(args: string[]): BenchmarkOptions {
	const parsed = parseArgs({
		args,
		options: {
			control: { default: false, type: "boolean" },
			dist: { type: "string" },
			lines: { default: "5000", type: "string" },
			"max-cpu": { type: "string" },
			"max-power": { type: "string" },
			output: { type: "string" },
			samples: { default: "3", type: "string" },
			warmups: { default: "1", type: "string" },
		},
		strict: true,
	});
	return {
		controlMode: parsed.values.control ? "raw" : null,
		dist: parsed.values.dist ? resolve(parsed.values.dist) : null,
		lineCount: positiveInteger(parsed.values.lines, "--lines"),
		maximumCpuPercent: optionalPositiveNumber(parsed.values["max-cpu"], "--max-cpu"),
		maximumPowerWatts: optionalPositiveNumber(parsed.values["max-power"], "--max-power"),
		output: parsed.values.output ? resolve(parsed.values.output) : null,
		samples: positiveInteger(parsed.values.samples, "--samples"),
		warmups: nonnegativeInteger(parsed.values.warmups, "--warmups"),
	};
}

function commandOutput(command: string[]): string {
	try {
		const result = Bun.spawnSync(command, { stderr: "pipe", stdout: "pipe" });
		return result.success ? new TextDecoder().decode(result.stdout).trim() : "unavailable";
	} catch {
		return "unavailable";
	}
}

async function gpuDescription(browser: Browser): Promise<Record<string, unknown>> {
	const session = await browser.newBrowserCDPSession();
	try {
		const response = await session.send("SystemInfo.getInfo");
		return {
			auxAttributes: response.gpu.auxAttributes,
			devices: response.gpu.devices,
		};
	} finally {
		await session.detach();
	}
}

async function runSamplePair(options: {
	baseURL: string;
	browser: Browser;
	controlMode: BenchmarkOptions["controlMode"];
	lineCount: number;
	rootPid: number;
}): Promise<{ repeated: DiffScrollSample; single: DiffScrollSample }> {
	const context = await options.browser.newContext({
		baseURL: options.baseURL,
		deviceScaleFactor: 2,
		locale: "en-US",
		timezoneId: "Europe/Lisbon",
		viewport: { height: 800, width: 1280 },
	});
	try {
		const page = await context.newPage();
		let scroller;
		if (options.controlMode === "raw") {
			await page.setContent(
				`<div data-logical-row-count="${options.lineCount + 1}" data-testid="diff-full-row-scroll" style="height:680px;overflow-y:auto;width:1280px"><div style="height:${Math.ceil(options.lineCount * 17.05 + 32)}px"></div></div>`,
			);
			scroller = page.getByTestId("diff-full-row-scroll");
		} else {
			const fixture = createDiffScrollFixture(options.lineCount);
			await installDiffScrollRoutes(page, fixture);
			scroller = await openDiffScrollFixture(page, options.lineCount);
		}
		const cdp = await context.newCDPSession(page);
		const single = await measureDiffScrollScenario({
			cdp,
			page,
			rootPid: options.rootPid,
			scenario: "single",
			scroller,
		});
		const repeated = await measureDiffScrollScenario({
			cdp,
			page,
			rootPid: options.rootPid,
			scenario: "repeated",
			scroller,
		});
		await cdp.detach();
		return { repeated, single };
	} finally {
		await context.close();
	}
}

function browserRootPid(marker: string): number {
	const output = commandOutput(["ps", "-axo", "pid=,command="]);
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(.+)$/.exec(line);
		const command = match?.[2];
		if (!match?.[1] || !command?.includes(marker) || command.includes(" --type=")) continue;
		return Number(match[1]);
	}
	throw new Error("Could not identify the Chromium root process.");
}

async function launchBrowser(): Promise<{ browser: Browser; rootPid: number }> {
	const marker = `couchview-diff-scroll-${crypto.randomUUID()}`;
	const browser = await chromium.launch({
		args: [
			`--couchview-benchmark-id=${marker}`,
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
		],
		headless: false,
	});
	try {
		return { browser, rootPid: browserRootPid(marker) };
	} catch (error) {
		await browser.close();
		throw error;
	}
}

async function runBenchmark(options: BenchmarkOptions) {
	if (platform() !== "darwin") throw new Error("The CPU/power benchmark requires macOS.");
	const temporaryRoot = options.dist
		? null
		: await mkdtemp(resolve(tmpdir(), "couchview-diff-scroll-benchmark-"));
	const staticDirectory = options.dist ?? resolve(temporaryRoot!, "dist");
	if (!options.dist) await buildExpoWeb({ outputRoot: staticDirectory });
	const fixtureServer = await launchDiffScrollFixtureServer(staticDirectory);
	let browserResources: Awaited<ReturnType<typeof launchBrowser>> | null = null;
	try {
		browserResources = await launchBrowser();
		const { browser, rootPid } = browserResources;
		console.log(`Chromium ${browser.version()} (root pid ${rootPid})`);
		for (let index = 0; index < options.warmups; index += 1) {
			console.log(`Warmup ${index + 1}/${options.warmups}`);
			await runSamplePair({
				baseURL: fixtureServer.baseURL,
				browser,
				controlMode: options.controlMode,
				lineCount: options.lineCount,
				rootPid,
			});
		}
		const single: DiffScrollSample[] = [];
		const repeated: DiffScrollSample[] = [];
		for (let index = 0; index < options.samples; index += 1) {
			console.log(`Measured pair ${index + 1}/${options.samples}`);
			const pair = await runSamplePair({
				baseURL: fixtureServer.baseURL,
				browser,
				controlMode: options.controlMode,
				lineCount: options.lineCount,
				rootPid,
			});
			single.push(pair.single);
			repeated.push(pair.repeated);
			console.log(
				`  single CPU ${pair.single.processUsage.averageCpuPercent.toFixed(1)}%, ` +
					`power ${pair.single.processUsage.averagePowerWatts.toFixed(3)} W`,
			);
			console.log(
				`  repeated CPU ${pair.repeated.processUsage.averageCpuPercent.toFixed(1)}%, ` +
					`power ${pair.repeated.processUsage.averagePowerWatts.toFixed(3)} W`,
			);
		}
		const summaries = {
			repeated: summarizeDiffScrollSamples(repeated),
			single: summarizeDiffScrollSamples(single),
		};
		console.log(formatDiffScrollSummary(summaries.single));
		console.log(formatDiffScrollSummary(summaries.repeated));
		const report = {
			createdAt: new Date().toISOString(),
			environment: {
				architecture: arch(),
				browser: browser.version(),
				cpu: cpus()[0]?.model ?? "unknown",
				gpu: await gpuDescription(browser),
				hardwareModel: commandOutput(["sysctl", "-n", "hw.model"]),
				logicalCpus: cpus().length,
				macOS: commandOutput(["sw_vers", "-productVersion"]),
				osRelease: release(),
			},
			samples: { repeated, single },
			schemaVersion: 1,
			source: {
				commit: commandOutput(["git", "rev-parse", "HEAD"]),
				dirty: commandOutput(["git", "status", "--porcelain"]) !== "",
			},
			summaries,
			workload: {
				controlMode: options.controlMode,
				deviceScaleFactor: 2,
				lineCount: options.lineCount,
				repeatedLegs: 4,
				viewport: { height: 800, width: 1280 },
				scrollGestureSpeedPixelsPerSecond: 50_000,
			},
		};
		if (options.output) {
			await mkdir(dirname(options.output), { recursive: true });
			await writeFile(options.output, `${JSON.stringify(report, null, "\t")}\n`);
			console.log(`Wrote ${options.output}`);
		}
		const budgetFailures: string[] = [];
		if (options.maximumCpuPercent !== null && options.maximumPowerWatts !== null) {
			for (const summary of [summaries.single, summaries.repeated]) {
				budgetFailures.push(
					...evaluateDiffScrollBudgets(summary, {
						maximumCpuPercent: options.maximumCpuPercent,
						maximumPowerWatts: options.maximumPowerWatts,
					}).map((failure) => `${summary.scenario}: ${failure}`),
				);
			}
		} else if (options.maximumCpuPercent !== null || options.maximumPowerWatts !== null) {
			throw new Error("Use --max-cpu and --max-power together.");
		}
		if (budgetFailures.length > 0) {
			throw new Error(`Diff scroll performance budget failed:\n- ${budgetFailures.join("\n- ")}`);
		}
	} finally {
		if (browserResources) {
			await browserResources.browser.close();
		}
		await fixtureServer.close();
		if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true });
	}
}

await runBenchmark(benchmarkOptions(process.argv.slice(2)));
