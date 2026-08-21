import { expect, type Locator, type Page, test } from "@playwright/test";

import { createDiffScrollFixture } from "../../scripts/diffScrollBenchFixture.ts";
import {
	installDiffScrollRoutes,
	openDiffScrollFixture,
} from "../../scripts/diffScrollBenchPage.ts";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const LINE_HEIGHT = 11 * 1.55;

test.use({ deviceScaleFactor: 2 });

interface ScrollingTokenSample {
	hasIdentifier: boolean;
	hasSyntaxColor: boolean;
	text: string;
}

async function mountedLineCount(page: Page): Promise<number> {
	return page.locator("[data-diff-view] [data-line]").count();
}

async function waitForScrollIdle(scroller: Locator): Promise<void> {
	await scroller.evaluate(
		(element) =>
			new Promise<void>((resolve) => {
				let timer = window.setTimeout(finish, 200);
				function finish() {
					element.removeEventListener("scroll", handleScroll);
					resolve();
				}
				function handleScroll() {
					window.clearTimeout(timer);
					timer = window.setTimeout(finish, 200);
				}
				element.addEventListener("scroll", handleScroll, { passive: true });
			}),
	);
}

async function captureTokensDuringGesture(
	page: Page,
	scroller: Locator,
): Promise<ScrollingTokenSample[]> {
	const cdp = await page.context().newCDPSession(page);
	await scroller.evaluate((element) => {
		type ProbeElement = HTMLElement & {
			__couchviewTokenScrollProbe?: {
				frame: number | null;
				handle: () => void;
				samples: ScrollingTokenSample[];
			};
		};
		const target = element as ProbeElement;
		const probe = {
			frame: null as number | null,
			handle: () => undefined,
			samples: [] as ScrollingTokenSample[],
		};
		probe.handle = () => {
			if (probe.frame !== null) return;
			probe.frame = requestAnimationFrame(() => {
				probe.frame = null;
				const viewport = target.getBoundingClientRect();
				const visibleRow = [...target.querySelectorAll<HTMLElement>("[data-line]")].find((row) => {
					const bounds = row.getBoundingClientRect();
					return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
				});
				const lineText = visibleRow?.querySelector<HTMLElement>("[data-line-text]");
				if (!visibleRow || !lineText) return;
				const outerColor = getComputedStyle(lineText).color;
				const tokenElements = [...lineText.querySelectorAll<HTMLElement>("*")].filter(
					(child) => child.children.length === 0 && (child.textContent?.length ?? 0) > 0,
				);
				probe.samples.push({
					hasIdentifier: visibleRow.querySelector("[data-identifier]") !== null,
					hasSyntaxColor: tokenElements.some(
						(child) => getComputedStyle(child).color !== outerColor,
					),
					text: lineText.textContent ?? "",
				});
			});
		};
		target.__couchviewTokenScrollProbe = probe;
		target.addEventListener("scroll", probe.handle, { passive: true });
	});

	let samples: ScrollingTokenSample[] = [];
	try {
		const bounds = await scroller.boundingBox();
		const viewport = page.viewportSize();
		if (!bounds || !viewport) throw new Error("The diff scroller has no visible bounds.");
		const maxScrollTop = await scroller.evaluate(
			(element) => element.scrollHeight - element.clientHeight,
		);
		await cdp.send("Input.synthesizeScrollGesture", {
			gestureSourceType: "touch",
			preventFling: true,
			speed: 10_000,
			x: Math.max(1, Math.min(viewport.width - 1, bounds.x + bounds.width / 2)),
			y: Math.max(1, Math.min(viewport.height - 1, bounds.y + bounds.height / 2)),
			yDistance: -Math.min(2_000, maxScrollTop),
		});
		await page.waitForTimeout(50);
	} finally {
		try {
			await cdp.detach();
		} finally {
			samples = await scroller.evaluate((element) => {
				type ProbeElement = HTMLElement & {
					__couchviewTokenScrollProbe?: {
						frame: number | null;
						handle: () => void;
						samples: ScrollingTokenSample[];
					};
				};
				const target = element as ProbeElement;
				const probe = target.__couchviewTokenScrollProbe;
				if (!probe) return [];
				target.removeEventListener("scroll", probe.handle);
				if (probe.frame !== null) cancelAnimationFrame(probe.frame);
				delete target.__couchviewTokenScrollProbe;
				return probe.samples;
			});
		}
	}
	return samples;
}

async function installLegendRowRectReadCounter(page: Page): Promise<void> {
	await page.evaluate(() => {
		type ProbeWindow = Window & {
			__couchviewLegendRectProbe?: {
				count: number;
				original: typeof Element.prototype.getBoundingClientRect;
			};
		};
		const probeWindow = window as ProbeWindow;
		const original = Element.prototype.getBoundingClientRect;
		const probe = { count: 0, original };
		probeWindow.__couchviewLegendRectProbe = probe;
		Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
			if (
				this instanceof HTMLElement &&
				this.closest(".legend-list-content-container") !== null &&
				this.querySelector(
					":scope > [data-line], :scope > [data-no-newline], :scope > [data-separator]",
				) !== null
			) {
				probe.count += 1;
			}
			return original.call(this);
		};
	});
}

async function restoreLegendRowRectReadCounter(page: Page): Promise<number> {
	return page.evaluate(() => {
		type ProbeWindow = Window & {
			__couchviewLegendRectProbe?: {
				count: number;
				original: typeof Element.prototype.getBoundingClientRect;
			};
		};
		const probeWindow = window as ProbeWindow;
		const probe = probeWindow.__couchviewLegendRectProbe;
		if (!probe) return -1;
		Element.prototype.getBoundingClientRect = probe.original;
		delete probeWindow.__couchviewLegendRectProbe;
		return probe.count;
	});
}

test.describe("File Change Legend List surface", () => {
	test.skip(!localFixture, "The deterministic workflow uses the bundled E2E fixture.");

	test("renders exact, selectable, accessible semantic rows through one shared surface", async ({
		page,
	}) => {
		const lineCount = 250;
		const fixture = createDiffScrollFixture(lineCount);
		await installDiffScrollRoutes(page, fixture);
		const scroller = await openDiffScrollFixture(page, lineCount);
		const surface = page.locator('[data-renderer="legend-list"]');
		const status = page.getByTestId("diff-surface-status");

		await expect(surface).toHaveAttribute("data-logical-row-count", String(lineCount + 1));
		await expect(status).toHaveAttribute("data-token-complete", "true");
		await expect(page.getByRole("code")).toBeVisible();
		await expect(surface.locator("canvas")).toHaveCount(0);
		const mounted = await mountedLineCount(page);
		expect(mounted).toBeGreaterThan(0);
		expect(mounted).toBeLessThan(lineCount);

		const fixedGeometry = await page.evaluate((lineHeight) => {
			const [first, second] = document.querySelectorAll<HTMLElement>(
				"[data-diff-view] [data-line]",
			);
			const firstPosition = first?.parentElement;
			const secondPosition = second?.parentElement;
			const content = document.querySelector<HTMLElement>(".legend-list-content-container > div");
			return {
				contentHeight: content?.getBoundingClientRect().height ?? 0,
				firstHeight: first?.getBoundingClientRect().height ?? 0,
				positionDelta:
					Number.parseFloat(secondPosition?.style.top ?? "0") -
					Number.parseFloat(firstPosition?.style.top ?? "0"),
				selection: (() => {
					if (!first) return "";
					const range = document.createRange();
					range.selectNodeContents(first);
					const selection = window.getSelection();
					selection?.removeAllRanges();
					selection?.addRange(range);
					return selection?.toString() ?? "";
				})(),
				targetHeight: lineHeight,
			};
		}, LINE_HEIGHT);
		expect(Math.abs(fixedGeometry.firstHeight - LINE_HEIGHT)).toBeLessThan(0.1);
		expect(Math.abs(fixedGeometry.positionDelta - LINE_HEIGHT)).toBeLessThan(0.1);
		expect(Math.abs(fixedGeometry.contentHeight - (lineCount + 1) * LINE_HEIGHT)).toBeLessThan(1);
		expect(fixedGeometry.selection).toContain("line00001");
		expect(await scroller.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");

		const identifier = page.getByRole("button", { name: "Find “line00001” in project" }).first();
		await expect(identifier).toBeVisible();
		await identifier.click();
		const search = page.getByRole("dialog", { name: "Find in project" });
		await expect(search.getByRole("textbox", { name: "Search project" })).toHaveValue("line00001");
		await search.getByRole("button", { name: "Close sheet" }).click();
		await expect(search).toBeHidden();

		const scrollingTokenSamples = await captureTokensDuringGesture(page, scroller);
		expect(scrollingTokenSamples.length).toBeGreaterThan(0);
		expect(scrollingTokenSamples.every((sample) => sample.hasIdentifier)).toBe(true);
		expect(scrollingTokenSamples.every((sample) => sample.hasSyntaxColor)).toBe(true);
	});

	test("preserves hunk navigation and settled visible-line reporting", async ({ page }) => {
		const lineCount = 600;
		const fixture = createDiffScrollFixture(lineCount);
		await installDiffScrollRoutes(page, fixture);
		const scroller = await openDiffScrollFixture(page, lineCount);
		const actions = page.getByRole("navigation", { name: "Review actions" });
		const nextHunk = actions.getByRole("button", { name: "Next hunk" });

		await expect(nextHunk).toBeEnabled();
		await nextHunk.click();
		await expect
			.poll(() => scroller.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(2_000);
		await expect(page.locator('[data-line-kind="deletion"]')).toBeVisible();
		await expect(page.locator('[data-line-kind="addition"]')).toBeVisible();
		await expect(nextHunk).toBeDisabled();

		await waitForScrollIdle(scroller);
		await page.waitForTimeout(150);
		await scroller.evaluate((element) => {
			element.scrollTo({ behavior: "auto", top: 0 });
		});
		await expect
			.poll(() => scroller.evaluate((element) => element.scrollTop))
			.toBeLessThan(LINE_HEIGHT * 3);
		await expect.poll(() => nextHunk.isEnabled()).toBe(true);
	});

	test("keeps a fully tokenized 5,000-line document bounded through deep and end jumps", async ({
		page,
	}) => {
		test.setTimeout(60_000);
		const lineCount = 5_000;
		const fixture = createDiffScrollFixture(lineCount);
		await installDiffScrollRoutes(page, fixture);
		const scroller = await openDiffScrollFixture(page, lineCount);
		const status = page.getByTestId("diff-surface-status");
		const initialRevision = await status.getAttribute("data-token-revision");
		const initialMounted = await mountedLineCount(page);
		expect(initialMounted).toBeGreaterThan(0);
		expect(initialMounted).toBeLessThan(100);

		await installLegendRowRectReadCounter(page);
		let rowRectReads = -1;
		try {
			await scroller.evaluate((element) => {
				element.scrollTop = element.scrollHeight / 2;
			});
			await expect
				.poll(() => page.locator("[data-line]").filter({ hasText: "line025" }).count())
				.toBeGreaterThan(0);
			expect(await mountedLineCount(page)).toBeLessThan(100);

			await scroller.evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
			await expect(page.locator("[data-line]").filter({ hasText: "line05000" })).toBeVisible();
			await expect
				.poll(() =>
					scroller.evaluate(
						(element) => element.scrollHeight - element.clientHeight - element.scrollTop,
					),
				)
				.toBeLessThanOrEqual(1);
		} finally {
			rowRectReads = await restoreLegendRowRectReadCounter(page);
		}
		expect(rowRectReads).toBe(0);
		expect(await mountedLineCount(page)).toBeLessThan(100);
		await expect(status).toHaveAttribute("data-token-complete", "true");
		expect(await status.getAttribute("data-token-revision")).toBe(initialRevision);
	});
});
