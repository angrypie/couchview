import type { CDPSession, Locator, Page } from "@playwright/test";

import type { DiffScrollFixture } from "./diffScrollBenchFixture.ts";
import type { ProcessUsageDelta } from "./macosProcessMetrics.ts";

export type DiffScrollScenario = "repeated" | "single";

export interface DiffScrollSample {
	endScrollTop: number;
	lineElements: number;
	mountedLineElements: number;
	mainThread: {
		layoutPercent: number;
		recalcStylePercent: number;
		scriptPercent: number;
		taskPercent: number;
	};
	processUsage: ProcessUsageDelta;
	scenario: DiffScrollScenario;
	startScrollTop: number;
	targetScrollTop: number;
}

interface PerformanceMetricsResponse {
	metrics: Array<{ name: string; value: number }>;
}

function performanceMetric(response: PerformanceMetricsResponse, name: string): number {
	return response.metrics.find((metric) => metric.name === name)?.value ?? 0;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function performanceUtilization(
	before: PerformanceMetricsResponse,
	after: PerformanceMetricsResponse,
	wallTimeMs: number,
) {
	const fraction = (name: string) =>
		((performanceMetric(after, name) - performanceMetric(before, name)) / (wallTimeMs / 1_000)) *
		100;
	return {
		layoutPercent: fraction("LayoutDuration"),
		recalcStylePercent: fraction("RecalcStyleDuration"),
		scriptPercent: fraction("ScriptDuration"),
		taskPercent: fraction("TaskDuration"),
	};
}

export async function installDiffScrollRoutes(
	page: Page,
	fixture: DiffScrollFixture,
): Promise<void> {
	await page.route("**/api/repositories/*/files", async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as Record<string, unknown>;
		await route.fulfill({
			response,
			json: {
				...body,
				files: [fixture.file],
				operationRevision: fixture.diff.operationRevision,
			},
		});
	});
	await page.route("**/api/repositories/*/files/*/diff", async (route) => {
		await route.fulfill({ json: { diff: fixture.diff } });
	});
}

async function waitForMutationQuiet(scroller: Locator): Promise<void> {
	await scroller.evaluate(
		(element) =>
			new Promise<void>((resolve, reject) => {
				let quietTimer = window.setTimeout(finish, 1_000);
				const maximumTimer = window.setTimeout(() => {
					observer.disconnect();
					window.clearTimeout(quietTimer);
					reject(new Error("The diff kept mutating for more than 15 seconds."));
				}, 15_000);
				const observer = new MutationObserver(() => {
					window.clearTimeout(quietTimer);
					quietTimer = window.setTimeout(finish, 1_000);
				});
				function finish() {
					observer.disconnect();
					window.clearTimeout(maximumTimer);
					resolve();
				}
				observer.observe(element, {
					attributes: true,
					characterData: true,
					childList: true,
					subtree: true,
				});
			}),
	);
}

export async function openDiffScrollFixture(page: Page, lineCount: number): Promise<Locator> {
	await page.goto("/?repo=fixture-repository", { waitUntil: "domcontentloaded" });
	const scroller = page.getByTestId("diff-full-row-scroll");
	await scroller.waitFor({ state: "visible", timeout: 30_000 });
	await page.waitForFunction(
		({ expectedRows, prefix }) => {
			const surface = document.querySelector<HTMLElement>('[data-renderer="legend-list"]');
			const status = document.querySelector<HTMLElement>('[data-testid="diff-surface-status"]');
			const lines = document.querySelectorAll<HTMLElement>("[data-diff-view] [data-line]");
			return (
				surface?.dataset.logicalRowCount === String(expectedRows) &&
				status?.dataset.logicalRowCount === String(expectedRows) &&
				status.dataset.tokenComplete === "true" &&
				lines.length > 0 &&
				lines[0]?.innerText.includes(prefix)
			);
		},
		{ expectedRows: lineCount + 1, prefix: "line00001" },
		{ timeout: 30_000 },
	);
	await waitForMutationQuiet(scroller);
	return scroller;
}

async function scrollGeometry(scroller: Locator) {
	return scroller.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
		scrollTop: element.scrollTop,
	}));
}

async function dispatchScrollLeg(options: {
	cdp: CDPSession;
	direction: -1 | 1;
	maxScrollTop: number;
	pointer: { x: number; y: number };
}): Promise<void> {
	const { cdp, direction, maxScrollTop, pointer } = options;
	await cdp.send("Input.synthesizeScrollGesture", {
		gestureSourceType: "touch",
		preventFling: true,
		speed: 50_000,
		x: pointer.x,
		y: pointer.y,
		yDistance: direction * -(maxScrollTop + 500),
	});
	await delay(80);
}

async function resetToTop(scroller: Locator): Promise<void> {
	await scroller.evaluate((element) => {
		element.scrollTop = 0;
	});
	await delay(250);
}

export async function measureDiffScrollScenario(options: {
	cdp: CDPSession;
	page: Page;
	rootPid: number;
	scenario: DiffScrollScenario;
	scroller: Locator;
}): Promise<DiffScrollSample> {
	const { cdp, page, rootPid, scenario, scroller } = options;
	const { captureProcessTree, diffProcessTreeUsage } = await import("./macosProcessMetrics.ts");
	await page.bringToFront();
	await resetToTop(scroller);
	const bounds = await scroller.boundingBox();
	if (!bounds) throw new Error("The diff scroller has no visible bounds.");
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("The benchmark page has no fixed viewport.");
	const visibleBounds = {
		bottom: Math.min(viewport.height - 1, bounds.y + bounds.height),
		left: Math.max(1, bounds.x),
		right: Math.min(viewport.width - 1, bounds.x + bounds.width),
		top: Math.max(1, bounds.y),
	};
	if (visibleBounds.right <= visibleBounds.left || visibleBounds.bottom <= visibleBounds.top) {
		throw new Error("The diff scroller does not intersect the benchmark viewport.");
	}
	const pointer = {
		x: (visibleBounds.left + visibleBounds.right) / 2,
		y: (visibleBounds.top + visibleBounds.bottom) / 2,
	};
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...pointer });
	const initialGeometry = await scrollGeometry(scroller);
	const maxScrollTop = initialGeometry.scrollHeight - initialGeometry.clientHeight;
	if (maxScrollTop <= 0) throw new Error("The benchmark diff is not vertically scrollable.");
	const mountedLineElements = await page.locator("[data-diff-view] [data-line]").count();
	const status = page.getByTestId("diff-surface-status");
	const statusLineCount =
		(await status.count()) > 0 ? await status.getAttribute("data-logical-row-count") : null;
	const rawLineCount = await scroller.getAttribute("data-logical-row-count");
	const lineElements = Number(statusLineCount ?? rawLineCount) || mountedLineElements;
	const directions: Array<-1 | 1> = scenario === "repeated" ? [1, -1, 1, -1] : [1];
	await cdp.send("Performance.enable");
	const mainThreadBefore = (await cdp.send("Performance.getMetrics")) as PerformanceMetricsResponse;
	const processBefore = await captureProcessTree(rootPid);
	for (const direction of directions) {
		await dispatchScrollLeg({ cdp, direction, maxScrollTop, pointer });
	}
	const processAfter = await captureProcessTree(rootPid);
	const mainThreadAfter = (await cdp.send("Performance.getMetrics")) as PerformanceMetricsResponse;
	const finalGeometry = await scrollGeometry(scroller);
	const processUsage = diffProcessTreeUsage(processBefore, processAfter);
	const targetScrollTop = directions.at(-1) === 1 ? maxScrollTop : 0;
	if (Math.abs(finalGeometry.scrollTop - targetScrollTop) > 2) {
		throw new Error(
			`Scroll ended at ${finalGeometry.scrollTop.toFixed(1)}, expected ${targetScrollTop.toFixed(1)}.`,
		);
	}
	return {
		endScrollTop: finalGeometry.scrollTop,
		lineElements,
		mountedLineElements,
		mainThread: performanceUtilization(mainThreadBefore, mainThreadAfter, processUsage.wallTimeMs),
		processUsage,
		scenario,
		startScrollTop: initialGeometry.scrollTop,
		targetScrollTop,
	};
}
