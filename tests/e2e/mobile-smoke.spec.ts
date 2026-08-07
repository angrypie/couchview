import { expect, type Locator, type Page, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

interface TerminalFixtureState {
	inputs: string[];
}

function changedFilesPanel(page: Page) {
	return page
		.getByRole("dialog", { name: "Changed files" })
		.or(page.getByRole("complementary", { name: "Changed files" }));
}

async function expectAtViewportBottom(page: Page, locator: Locator) {
	await expect(locator).toBeVisible();
	await expect
		.poll(async () => {
			const bounds = await locator.boundingBox();
			const viewport = page.viewportSize();
			if (!bounds || !viewport) return false;
			const bottomGap = viewport.height - bounds.y - bounds.height;
			return (
				Math.abs(bottomGap) <= 24 && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1
			);
		})
		.toBe(true);
}

async function openFixture(page: Page) {
	await page.goto("/");
	await expect(page).toHaveTitle("Couchview");
	const currentFile = page.getByRole("region", { name: "Current file" });
	await expect(currentFile).toContainText("src/review.ts");
	const diff = page.getByRole("region", { name: "Unified diff" });
	await expect(diff).toBeVisible();
	await expect(diff.getByRole("code")).toBeVisible();
	return currentFile;
}

async function dismissPwaNotices(page: Page) {
	// Clear persistent install/update notices so they do not intentionally sit
	// above the bottom sheets exercised below.
	for (const name of ["Dismiss", "Not now", "Later"]) {
		const buttons = await page.getByRole("button", { name, exact: true }).all();
		for (const button of buttons) {
			if (await button.isVisible()) await button.click();
		}
	}
}

async function setRangeValue(control: Locator, value: number, min: number, max: number) {
	const bounds = await control.boundingBox();
	expect(bounds).not.toBeNull();
	const thumbRadius = 10;
	const usableWidth = Math.max(1, bounds!.width - thumbRadius * 2);
	const rawX = thumbRadius + ((value - min) / (max - min)) * usableWidth;
	const x = Math.max(thumbRadius + 1, Math.min(bounds!.width - thumbRadius - 1, rawX));
	await control.click({ position: { x, y: bounds!.height / 2 } });
	await expect(control).toHaveAttribute("aria-valuenow", String(value));
}

test.describe("mobile fixture review", () => {
	test.skip(!localFixture, "The deterministic workflow uses the bundled e2e repository fixture.");

	test.beforeEach(async ({ page, request }) => {
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("shows a quiet reconnecting indicator while the server remains reachable", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"One mobile browser is enough for the transport-state contract.",
		);
		await page.route("**/api/repositories/*/events", (route) => route.abort("connectionrefused"));
		await openFixture(page);

		const status = page.getByTestId("repository-connection-status");
		await expect(status).toHaveAccessibleName("Reconnecting to local server");
		await expect(
			page.getByText("Offline — cannot reach the local server", { exact: true }),
		).toHaveCount(0);
	});

	test("uses the touch command palette across review, terminal, and Settings", async ({ page }) => {
		await openFixture(page);
		await page.getByRole("button", { name: "Open command palette" }).click();
		const palette = page.getByRole("dialog", { name: "Command palette" });
		await expect(palette).toBeVisible();
		await expect(palette).toBeInViewport();
		await palette.getByRole("textbox", { name: "Search commands" }).fill("terminal");
		await palette.getByText("Go to terminal", { exact: true }).click();
		await expect(palette).toHaveCount(0);

		const terminal = page.getByRole("region", { name: "tmux terminal" });
		await expect(terminal).toBeVisible();
		await terminal.getByRole("button", { name: "Open command palette" }).click();
		await palette.getByRole("textbox", { name: "Search commands" }).fill("settings");
		await palette.getByText("Go to settings", { exact: true }).click();
		await expect(palette).toHaveCount(0);

		const settings = page.getByRole("region", { name: "Settings" });
		await expect(settings).toBeVisible();
		await settings
			.getByRole("button", {
				name: /^Open command palette/,
			})
			.click();
		await palette.getByRole("textbox", { name: "Search commands" }).fill("diff review");
		await palette.getByText("Go to diff review", { exact: true }).click();
		await expect(palette).toHaveCount(0);
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
		await page.getByRole("button", { name: "Open command palette" }).click();
		await palette.getByRole("textbox", { name: "Search commands" }).fill("artifacts");
		await palette.getByText("Go to artifacts", { exact: true }).click();
		await expect(palette).toHaveCount(0);
		await expect(page.getByRole("main", { name: "Repository artifacts" })).toBeVisible();
		await expect(page).toHaveURL(/\/artifacts\?repo=fixture-repository$/);
		await page.getByRole("button", { name: "Review", exact: true }).click();
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
	});

	test("uses mobile terminal helper keys and a one-shot Ctrl modifier", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"Terminal keyboard helpers need one representative touch-browser pass.",
		);
		await openFixture(page);
		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		const terminal = page.getByRole("region", { name: "tmux terminal" });
		await expect(terminal.getByText("Connected", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		const helpers = terminal.getByRole("toolbar", {
			name: "Terminal keyboard shortcuts",
		});
		await expect(helpers).toBeVisible();
		const control = helpers.getByRole("button", {
			name: "Control modifier for next key",
		});
		const state = async () =>
			(await (await request.get("/api/e2e/terminal")).json()) as TerminalFixtureState;

		await control.click();
		await expect(control).toHaveAttribute("aria-pressed", "true");
		await page.keyboard.press("l");
		await expect(control).toHaveAttribute("aria-pressed", "false");
		await expect.poll(async () => (await state()).inputs.join("")).toContain("\x0c");

		await helpers.getByRole("button", { name: "Send Ctrl+C" }).click();
		await helpers.getByRole("button", { name: "Send Escape" }).click();
		await helpers.getByRole("button", { name: "Send Arrow Up" }).click();
		await expect.poll(async () => (await state()).inputs.join("")).toContain("\x03\x1b\x1b[A");
	});

	test("keeps the selected host profile browser-specific", async ({
		browser,
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"Browser-local profile selection needs one isolated-context pass.",
		);
		const createdResponse = await request.post("/api/settings/profiles", {
			headers: { "x-couchview-csrf": fixtureCsrf },
			data: { name: "Phone" },
		});
		expect(createdResponse.ok()).toBe(true);
		await page.goto("/settings");
		const selector = page.getByRole("button", { name: "Active profile" });
		await selector.click();
		await page
			.getByRole("dialog", { name: "Active profile" })
			.getByRole("button", { name: "Phone" })
			.click();
		await expect(selector).toContainText("Phone");
		await page.reload();
		await expect(page.getByRole("button", { name: "Active profile" })).toContainText("Phone");

		const otherBrowser = await browser.newContext();
		try {
			const otherPage = await otherBrowser.newPage();
			await otherPage.goto(new URL("/settings", page.url()).href);
			const otherSelector = otherPage.getByRole("button", { name: "Active profile" });
			await expect(otherSelector).toContainText("Default");
			await otherSelector.click();
			const options = otherPage.getByRole("dialog", { name: "Active profile" });
			await expect(options.getByRole("button", { name: "Default" })).toBeVisible();
			await expect(options.getByRole("button", { name: "Phone" })).toBeVisible();
		} finally {
			await otherBrowser.close();
		}
	});

	test("keeps focused form controls from triggering mobile page zoom", async ({ page }) => {
		await openFixture(page);
		await dismissPwaNotices(page);

		await page.getByRole("button", { name: "Open changed files" }).click();
		const filter = page.getByRole("searchbox", { name: "Filter changed files" });
		await expect(filter).toBeVisible();
		const filterBounds = await filter.boundingBox();
		expect(filterBounds).not.toBeNull();
		expect(filterBounds!.height).toBeGreaterThanOrEqual(36);
		await filter.focus();
		await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
		await changedFilesPanel(page).getByRole("button", { name: "Close changed files" }).click();
	});

	test("persists independent diff and terminal typography settings", async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"Typography settings need one mobile browser persistence pass.",
		);
		await openFixture(page);
		await page.getByRole("button", { name: "Open settings" }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/settings");

		await page.goBack();
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
		await page.goForward();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/settings");

		const settings = page.getByRole("region", { name: "Settings" });
		const appearance = settings.getByTestId("appearance-settings-card");
		await expect(settings.getByRole("heading", { name: "Profiles" })).toBeVisible();
		await expect(settings.getByText(/Profiles are shared by this Couchview host/)).toBeVisible();
		await expect(appearance.getByTestId("diff-column-ruler")).toContainText("80");
		await expect(appearance.getByTestId("terminal-column-ruler")).toContainText("80");
		await expect(appearance.getByLabel("lualine preview")).toContainText("NORMAL");
		await expect(appearance.getByLabel("lualine preview")).toContainText("");
		await expect(appearance.getByLabel("tmux status preview")).toContainText("nvim *");
		const terminalPreview = appearance.getByTestId("terminal-typography-preview");
		await expect(terminalPreview).toHaveAttribute("data-renderer", "ghostty-web");
		const terminalPreviewCanvas = terminalPreview.locator("canvas");
		await expect(terminalPreviewCanvas).toBeVisible({ timeout: 15_000 });
		await expect
			.poll(() =>
				terminalPreviewCanvas.evaluate((canvas) => {
					const terminalCanvas = canvas as HTMLCanvasElement;
					return terminalCanvas.height * terminalCanvas.width;
				}),
			)
			.toBeGreaterThan(0);
		const initialTerminalPreview = await terminalPreviewCanvas.evaluate((canvas) =>
			(canvas as HTMLCanvasElement).toDataURL(),
		);
		await expect(
			appearance.getByRole("slider", { name: "Terminal cell width adjustment" }),
		).toHaveAttribute("aria-valuemin", "-5");
		await expect(
			appearance.getByRole("slider", { name: "Terminal cell width adjustment" }),
		).toHaveAttribute("aria-valuemax", "5");
		const systemFonts = appearance.getByRole("radio", { name: "System monospace" });
		await systemFonts.nth(0).click();
		await setRangeValue(appearance.getByRole("slider", { name: "Diff font size" }), 14, 9, 24);
		await setRangeValue(
			appearance.getByRole("slider", { name: "Diff line height adjustment" }),
			3.5,
			-5,
			5,
		);
		await setRangeValue(
			appearance.getByRole("slider", { name: "Diff width adjustment" }),
			0.4,
			-1,
			2,
		);

		await systemFonts.nth(1).click();
		await setRangeValue(appearance.getByRole("slider", { name: "Terminal font size" }), 18, 8, 32);
		await setRangeValue(
			appearance.getByRole("slider", { name: "Terminal cell height adjustment" }),
			4,
			-4,
			16,
		);
		await setRangeValue(
			appearance.getByRole("slider", { name: "Terminal cell width adjustment" }),
			-4,
			-5,
			5,
		);
		await expect
			.poll(() =>
				terminalPreviewCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
			)
			.not.toBe(initialTerminalPreview);
		const save = settings.getByRole("button", { name: "Save changes" });
		await expect(save).toBeEnabled();
		await save.click();
		await expect(save).toBeDisabled();
		await settings.getByRole("button", { name: "Review", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/");

		const renderedFont = await page
			.getByRole("region", { name: "Unified diff" })
			.getByRole("code")
			.locator("[data-line]")
			.first()
			.evaluate((line) => {
				const style = getComputedStyle(line);
				return {
					family: style.fontFamily,
					fontSize: style.fontSize,
					letterSpacing: style.letterSpacing,
					lineHeight: Math.round(Number.parseFloat(style.lineHeight) * 10) / 10,
				};
			});
		expect(renderedFont).toEqual({
			family: expect.not.stringContaining("Iosevka"),
			fontSize: "14px",
			letterSpacing: "0.4px",
			lineHeight: 25.2,
		});

		await page.reload();
		await page.getByRole("button", { name: "Open settings" }).click();
		const reloadedSettings = page.getByRole("region", { name: "Settings" });
		const reloadedAppearance = reloadedSettings.getByTestId("appearance-settings-card");
		const reloadedSystemFonts = reloadedAppearance.getByRole("radio", {
			name: "System monospace",
		});
		await expect(reloadedSystemFonts.nth(0)).toHaveAttribute("aria-checked", "true");
		await expect(
			reloadedAppearance.getByRole("slider", { name: "Diff font size" }),
		).toHaveAttribute("aria-valuenow", "14");
		await expect(
			reloadedAppearance.getByRole("slider", { name: "Diff line height adjustment" }),
		).toHaveAttribute("aria-valuenow", "3.5");
		await expect(
			reloadedAppearance.getByRole("slider", { name: "Diff width adjustment" }),
		).toHaveAttribute("aria-valuenow", "0.4");
		await expect(reloadedSystemFonts.nth(1)).toHaveAttribute("aria-checked", "true");
		await expect(
			reloadedAppearance.getByRole("slider", { name: "Terminal font size" }),
		).toHaveAttribute("aria-valuenow", "18");
		await expect(
			reloadedAppearance.getByRole("slider", { name: "Terminal cell height adjustment" }),
		).toHaveAttribute("aria-valuenow", "4");
		await expect(
			reloadedAppearance.getByRole("slider", { name: "Terminal cell width adjustment" }),
		).toHaveAttribute("aria-valuenow", "-4");
	});

	test("keeps review actions at the screen bottom across orientation changes", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"One mobile Chromium orientation cycle covers the universal layout contract.",
		);

		await page.setViewportSize({ width: 375, height: 812 });
		await openFixture(page);
		await dismissPwaNotices(page);

		const actions = page.getByRole("navigation", { name: "Review actions" });
		await expectAtViewportBottom(page, actions);

		await page.setViewportSize({ width: 812, height: 375 });
		await expectAtViewportBottom(page, actions);
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.setViewportSize({ width: 375, height: 812 });
		await expectAtViewportBottom(page, actions);
	});

	test("uses an overlay drawer in iPad portrait and a split view in landscape", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"One mobile Chromium pass covers tablet breakpoint behavior.",
		);

		await page.setViewportSize({ width: 834, height: 1194 });
		await openFixture(page);
		await dismissPwaNotices(page);

		const workspace = page.getByRole("region", { name: "Unified diff" });
		const drawerDialog = page.getByRole("dialog", { name: "Changed files" });
		const splitDrawer = page.getByRole("complementary", { name: "Changed files" });
		const menuButton = page.getByRole("button", { name: "Open changed files" });
		const actions = page.getByRole("navigation", { name: "Review actions" });
		const displayControls = page.getByLabel("Diff display controls");

		await expect(drawerDialog).toHaveCount(0);
		await expect(splitDrawer).toHaveCount(0);
		await expect(menuButton).toBeVisible();
		await expectAtViewportBottom(page, actions);
		await expect(displayControls).toBeVisible();
		const portraitWorkspace = await workspace.boundingBox();
		expect(portraitWorkspace).not.toBeNull();
		expect(portraitWorkspace!.x).toBeLessThanOrEqual(1);
		expect(portraitWorkspace!.width).toBeGreaterThanOrEqual(833);

		await menuButton.click();
		await expect(drawerDialog).toBeVisible();
		const overlayBounds = await drawerDialog.boundingBox();
		expect(overlayBounds).not.toBeNull();
		expect(overlayBounds!.x).toBeLessThanOrEqual(1);
		expect(overlayBounds!.width).toBeGreaterThan(320);
		expect(overlayBounds!.width).toBeLessThan(834);
		expect(await workspace.boundingBox()).toEqual(portraitWorkspace);
		await drawerDialog.getByRole("button", { name: "Close changed files" }).click();
		await expect(drawerDialog).toHaveCount(0);

		await page.setViewportSize({ width: 1194, height: 834 });
		await expect(splitDrawer).toBeVisible();
		await expect(menuButton).toBeHidden();
		await expectAtViewportBottom(page, actions);
		await expect(displayControls).toBeVisible();
		const drawerBounds = await splitDrawer.boundingBox();
		const landscapeWorkspace = await workspace.boundingBox();
		expect(drawerBounds).not.toBeNull();
		expect(landscapeWorkspace).not.toBeNull();
		expect(drawerBounds!.width).toBeGreaterThanOrEqual(280);
		expect(
			Math.abs(drawerBounds!.x + drawerBounds!.width - landscapeWorkspace!.x),
		).toBeLessThanOrEqual(1);
		expect(landscapeWorkspace!.x + landscapeWorkspace!.width).toBeCloseTo(1194, 0);

		await page.setViewportSize({ width: 834, height: 1194 });
		await expect(splitDrawer).toHaveCount(0);
		await expect(menuButton).toBeVisible();
		await expectAtViewportBottom(page, actions);
	});

	test("keeps the iPhone portrait header to two unsquished rows", async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"One mobile Chromium pass covers the compact header.",
		);

		await page.setViewportSize({ width: 390, height: 844 });
		await openFixture(page);
		await dismissPwaNotices(page);

		const fileBar = page.getByRole("region", { name: "Current file" });
		const displayControls = page.getByLabel("Diff display controls");

		await expect(displayControls).toBeVisible();
		await expect(displayControls.getByRole("button")).toHaveCount(4);
		await page.getByRole("button", { name: "Increase diff font size" }).click();
		await expect(displayControls.getByText("12px", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Decrease diff font size" }).click();
		await expect(displayControls.getByText("11px", { exact: true })).toBeVisible();
		for (const button of await displayControls.getByRole("button").all()) {
			const bounds = await button.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds!.x).toBeGreaterThanOrEqual(0);
			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
			expect(bounds!.width).toBeGreaterThanOrEqual(32);
			expect(bounds!.height).toBeGreaterThanOrEqual(32);
		}
		const portraitFileBounds = await fileBar.boundingBox();
		expect(portraitFileBounds).not.toBeNull();
		expect(portraitFileBounds!.height).toBeGreaterThanOrEqual(40);
		expect(portraitFileBounds!.x).toBeLessThanOrEqual(1);
		expect(portraitFileBounds!.width).toBeGreaterThanOrEqual(389);

		await page.setViewportSize({ width: 844, height: 390 });
		await expect(displayControls).toBeVisible();
		const landscapeFileBar = page.getByRole("region", { name: "Current file" }).filter({
			has: page.getByRole("button", { name: "Select repository" }),
		});
		await expect(landscapeFileBar).toBeVisible();
		await expect(page.getByRole("region", { name: "Current file" })).toHaveCount(1);
		await expect(landscapeFileBar).toContainText("src/review.ts");
		const landscapeFileBounds = await landscapeFileBar.boundingBox();
		expect(landscapeFileBounds).not.toBeNull();
		expect(landscapeFileBounds!.y).toBeLessThan(portraitFileBounds!.y);
		for (const button of await displayControls.getByRole("button").all()) {
			const bounds = await button.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds!.width).toBeGreaterThanOrEqual(32);
			expect(bounds!.height).toBeGreaterThanOrEqual(32);
		}
	});

	test("keeps the diff contained while typography, wrapping, and review navigation work", async ({
		page,
		request,
	}) => {
		const currentFile = await openFixture(page);
		await dismissPwaNotices(page);
		const diff = page.getByRole("region", { name: "Unified diff" });
		const code = diff.getByRole("code");
		const firstLine = code.locator("[data-line]").first();
		await expect(code.getByText("visible between hunks", { exact: false })).toBeVisible();
		await expect(firstLine).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			await page.evaluate(() => window.innerWidth + 1),
		);

		const renderedFont = () =>
			firstLine.evaluate((line) => {
				const style = getComputedStyle(line);
				return {
					fontSize: style.fontSize,
					ligaturesDisabled: style.fontVariantLigatures === "none",
					usesIosevka: style.fontFamily.includes("Iosevka"),
				};
			});
		await expect.poll(renderedFont).toEqual({
			fontSize: "11px",
			ligaturesDisabled: true,
			usesIosevka: true,
		});

		const displayControls = page.getByLabel("Diff display controls");
		await expect(displayControls.getByText("11px", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Show line numbers" }).click();
		await expect(page.getByRole("button", { name: "Hide line numbers" })).toBeVisible();
		const firstGutter = code.locator("[data-column-number]").first();
		await expect(firstGutter).toBeVisible();
		await expect(firstGutter).not.toHaveAttribute("role", /.+/);
		await expect(firstGutter).not.toHaveAttribute("tabindex", /.+/);

		const increaseFont = page.getByRole("button", { name: "Increase diff font size" });
		for (let size = 12; size <= 24; size += 1) await increaseFont.click();
		await expect(displayControls.getByText("24px", { exact: true })).toBeVisible();
		await expect(increaseFont).toBeDisabled();
		await expect
			.poll(() => firstLine.evaluate((line) => getComputedStyle(line).fontSize))
			.toBe("24px");

		await expect
			.poll(() =>
				code.evaluate((element) => {
					const scroller = element.querySelector<HTMLElement>("[data-code]") ?? element;
					return scroller.scrollWidth - scroller.clientWidth;
				}),
			)
			.toBeGreaterThan(20);
		await page.getByRole("button", { name: "Wrap long lines" }).click();
		await expect(page.getByRole("button", { name: "Keep long lines on one line" })).toBeVisible();
		await expect
			.poll(() =>
				code.evaluate((element) => {
					const scroller = element.querySelector<HTMLElement>("[data-code]") ?? element;
					return scroller.scrollWidth - scroller.clientWidth;
				}),
			)
			.toBeLessThanOrEqual(1);
		await expect
			.poll(async () => {
				const response = await request.get("/api/settings/profiles");
				return (await response.json()).profiles[0].data.display.lineWrapEnabled;
			})
			.toBe(true);
		await expect(
			page.getByRole("button", { name: "Find “load” in project" }).first(),
		).toBeVisible();

		const actions = page.getByRole("navigation", { name: "Review actions" });
		const nextHunk = actions.getByRole("button", { name: "Next hunk" });
		const previousHunk = actions.getByRole("button", { name: "Previous hunk" });
		await expect(previousHunk).toBeDisabled();
		await nextHunk.click();
		await nextHunk.click();
		await expect(nextHunk).toBeDisabled();
		await expect(previousHunk).toBeEnabled();
		await previousHunk.click();

		await actions.getByRole("button", { name: "Next file" }).click();
		await expect(currentFile).toContainText("src/format.ts");
		await expect.poll(renderedFont).toEqual({
			fontSize: "24px",
			ligaturesDisabled: true,
			usesIosevka: true,
		});
		await actions.getByRole("button", { name: "Previous file" }).click();
		await expect(currentFile).toContainText("src/review.ts");
	});

	test("preloads adjacent diffs for flash-free back-and-forth navigation", async ({ page }) => {
		const diffRequests: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("/files/") && request.url().endsWith("/diff")) {
				diffRequests.push(request.url());
			}
		});
		const prefetched = page.waitForResponse((response) =>
			response.url().endsWith("/files/fixture-format-ts/diff"),
		);
		const currentFile = await openFixture(page);
		await prefetched;
		await page.evaluate(() => {
			const state = window as typeof window & {
				__loadingDiffObserved?: boolean;
				__loadingDiffObserver?: MutationObserver;
			};
			state.__loadingDiffObserved = false;
			state.__loadingDiffObserver = new MutationObserver(() => {
				if (document.body.textContent?.includes("Loading diff…")) {
					state.__loadingDiffObserved = true;
				}
			});
			state.__loadingDiffObserver.observe(document.body, {
				childList: true,
				subtree: true,
			});
		});

		const actions = page.getByRole("navigation", { name: "Review actions" });
		await actions.getByRole("button", { name: "Next file" }).click();
		await expect(currentFile).toContainText("src/format.ts");
		await expect(page.getByText("Loading diff…")).toHaveCount(0);
		const previousFile = actions.getByRole("button", { name: "Previous file" });
		await previousFile.click();
		await expect(currentFile).toContainText("src/review.ts");

		const loadingObserved = await page.evaluate(() => {
			const state = window as typeof window & {
				__loadingDiffObserved?: boolean;
				__loadingDiffObserver?: MutationObserver;
			};
			state.__loadingDiffObserver?.disconnect();
			return state.__loadingDiffObserved;
		});
		expect(loadingObserved).toBe(false);
		expect(
			diffRequests.filter((url) => url.endsWith("/files/fixture-review-ts/diff")),
		).toHaveLength(1);
		expect(
			diffRequests.filter((url) => url.endsWith("/files/fixture-format-ts/diff")),
		).toHaveLength(1);
	});

	test("searches, stages, and reviews with one-tap advance", async ({ page }) => {
		const currentFile = await openFixture(page);
		await dismissPwaNotices(page);

		const loadToken = page.getByRole("button", { name: "Find “load” in project" }).first();
		await loadToken.click();
		const search = page.getByRole("dialog", { name: "Find in project" });
		await expect(search).toBeVisible();
		await expect(search.getByRole("textbox", { name: "Search project" })).toHaveValue("load");
		const currentHit = search.getByRole("button", { name: /src\/review\.ts:2:16/ });
		await expect(currentHit).toBeVisible();
		await currentHit.click();
		await expect(search.getByText("src/review.ts", { exact: true })).toBeVisible();
		await expect(search).toContainText("return true");
		await search.getByRole("button", { name: "Back to results" }).click();
		await search.getByRole("tab", { name: /Other files \(1\)/ }).click();
		await expect(search.getByRole("button", { name: /src\/format\.ts:2:10/ })).toBeVisible();
		await search.getByRole("button", { name: "Close sheet" }).click();

		const actions = page.getByRole("navigation", { name: "Review actions" });
		const stage = actions.getByRole("button", { name: "Stage current file" });
		await stage.click();
		await expect(page.getByText("File staged", { exact: true })).toBeVisible();
		await expect(actions.getByRole("button", { name: "Unstage current file" })).toBeVisible();
		await expect(currentFile).toContainText("staged");

		await actions.getByRole("button", { name: "Review + next" }).click();
		await expect(currentFile).toContainText("src/format.ts");
		await expect(page.getByText("Marked reviewed", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
	});

	test("commits staged changes from the phone drawer", async ({ page }) => {
		const currentFile = await openFixture(page);
		await dismissPwaNotices(page);

		const actions = page.getByRole("navigation", { name: "Review actions" });
		await actions.getByRole("button", { name: "Stage current file" }).click();
		await expect(page.getByText("File staged", { exact: true })).toBeVisible();

		await page.getByRole("button", { name: "Open changed files" }).click();
		const drawer = changedFilesPanel(page);
		await drawer.getByRole("button", { name: "Commit 1 staged file" }).click();

		const composer = page.getByRole("dialog", { name: "Commit staged changes" });
		await expect(composer).toContainText("unstaged edits stay local");
		await expect(composer).toContainText("Only staged changes are sent to Codex");
		await composer.getByRole("button", { name: "Generate with Codex" }).click();
		const message = composer.getByPlaceholder("Commit message…");
		await expect(message).toHaveValue("feat(review): generate commit messages with Codex");
		await message.fill("fix(review): edit generated message on phone");
		await composer.getByRole("button", { name: "Commit staged changes" }).click();

		await expect(page.getByText("Committed abc1234", { exact: true })).toBeVisible();
		await expect(currentFile).toContainText("src/format.ts");
	});

	test("bulk stages reviewed files or the entire change set", async ({ page }) => {
		const currentFile = await openFixture(page);
		await dismissPwaNotices(page);
		const actions = page.getByRole("navigation", { name: "Review actions" });
		await actions.getByRole("button", { name: "Review + next" }).click();
		await expect(currentFile).toContainText("src/format.ts");
		await page.getByRole("button", { name: "Previous file" }).first().click();
		await expect(currentFile).toContainText("src/review.ts");

		await page.getByRole("button", { name: "Open changed files" }).click();
		const drawer = changedFilesPanel(page);
		await expect(drawer.getByRole("button", { name: "Unreview shown files (1)" })).toBeVisible();
		await expect(drawer.getByRole("button", { name: "Stage reviewed files (1)" })).toBeVisible();
		await drawer.getByRole("button", { name: "Stage reviewed files (1)" }).click();
		await expect(page.getByText("1 reviewed file staged", { exact: true })).toBeVisible();
		await expect(drawer.getByRole("button", { name: "Stage reviewed files (0)" })).toHaveCount(0);
		await expect(drawer.getByRole("button", { name: "Stage all files (1)" })).toBeEnabled();

		await drawer.getByRole("button", { name: "Stage all files (1)" }).click();
		await expect(page.getByText("1 file staged", { exact: true })).toBeVisible();
		await expect(drawer.getByRole("button", { name: "Commit 2 staged files" })).toBeEnabled();

		await drawer.getByRole("button", { name: "Unreview shown files (1)" }).click();
		await expect(page.getByText("1 review mark removed", { exact: true })).toBeVisible();
		await expect(drawer.getByRole("button", { name: "Unreview shown files (0)" })).toHaveCount(0);
	});

	test("runs grouped package commands and reconnects to their output", async ({ page }) => {
		await openFixture(page);
		await dismissPwaNotices(page);

		await page.getByRole("button", { name: "Open changed files" }).click();
		const drawer = changedFilesPanel(page);
		await drawer.getByRole("button", { name: "Commands", exact: true }).click();
		await expect(drawer).toContainText("sample-project");
		await expect(drawer).toContainText("@sample/mobile");
		await expect(drawer).toContainText("expo export");
		await expect(drawer).toContainText("Only run commands");

		await drawer.getByRole("button", { name: "Run build in apps/mobile" }).click();
		const output = page.getByRole("dialog", { name: "@sample/mobile / build" });
		await expect(output).toBeVisible();
		await expect(output).toContainText("pnpm run build");
		await expect(output).toContainText("fixture output: pnpm run build");
		await expect(output).toContainText("Passed");
		await output.getByRole("button", { name: "Close", exact: true }).click();

		if (await page.getByRole("button", { name: "Open changed files" }).isVisible()) {
			await page.getByRole("button", { name: "Open changed files" }).click();
		}
		await expect(changedFilesPanel(page).getByText("Active and recent runs")).toBeVisible();
	});

	test("switches projects through URL history while tabs remain independent", async ({
		context,
		page,
	}) => {
		await openFixture(page);
		await dismissPwaNotices(page);

		const repositoryButton = page.getByRole("button", { name: "Select repository" });
		await expect(repositoryButton).toContainText("sample-project");
		await repositoryButton.click();
		const picker = page.getByRole("dialog", { name: "Repositories" });
		await expect(picker).toContainText("/fixtures/sample-project");
		await expect(picker).toContainText("/fixtures/design-system");
		await picker.getByRole("button", { name: "design-system, /fixtures/design-system" }).click();
		await expect(repositoryButton).toContainText("design-system");
		await expect(page).toHaveURL(/\?repo=fixture-repository-two$/);

		await page.goBack();
		await expect(page).toHaveURL(/\?repo=fixture-repository$/);
		await expect(repositoryButton).toContainText("sample-project");

		const secondTab = await context.newPage();
		await secondTab.goto("/?repo=fixture-repository-two");
		await expect(secondTab.getByRole("button", { name: "Select repository" })).toContainText(
			"design-system",
		);
		await expect(repositoryButton).toContainText("sample-project");
		await secondTab.close();
	});

	test("landscape phones keep the viewer full width while the drawer overlays it", async ({
		page,
	}, testInfo) => {
		test.skip(!testInfo.project.name.includes("landscape"), "Landscape-only layout coverage.");
		await openFixture(page);
		await dismissPwaNotices(page);

		const workspace = page.getByRole("region", { name: "Unified diff" });
		const before = await workspace.boundingBox();
		expect(before).not.toBeNull();
		expect(before!.x).toBeLessThanOrEqual(1);
		expect(
			Math.abs(before!.width - (await page.evaluate(() => window.innerWidth))),
		).toBeLessThanOrEqual(1);

		await page.getByRole("button", { name: "Open changed files" }).click();
		const drawer = page.getByRole("dialog", { name: "Changed files" });
		await expect(drawer).toBeVisible();
		const after = await workspace.boundingBox();
		expect(after).not.toBeNull();
		expect(after!.x).toBeCloseTo(before!.x, 0);
		expect(after!.width).toBeCloseTo(before!.width, 0);
		await drawer.getByRole("button", { name: "Close changed files" }).click();

		const actions = page.getByRole("navigation", { name: "Review actions" });
		await expectAtViewportBottom(page, actions);
		await expect(actions.getByRole("button")).toHaveCount(6);

		const currentFile = page.getByRole("region", { name: "Current file" });
		await actions.getByRole("button", { name: "Review + next" }).click();
		await expect(currentFile).toContainText("src/format.ts");

		await actions.getByRole("button", { name: "Stage current file" }).click();
		await expect(actions.getByRole("button", { name: "Unstage current file" })).toBeVisible();
		await actions.getByRole("button", { name: "Unstage current file" }).click();
		await expect(actions.getByRole("button", { name: "Stage current file" })).toBeVisible();
	});
});
