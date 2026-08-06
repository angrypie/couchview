import { expect, type Locator, type Page, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

interface TerminalFixtureState {
	inputs: string[];
}

async function openFixture(page: Page) {
	await page.goto("/");
	await expect(page).toHaveTitle("Couchview");
	const currentFile = page.getByRole("region", { name: "Current file" });
	await expect(currentFile).toContainText("src/review.ts");
	await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
	await expect(page.locator(".pierre-code-view diffs-container")).toBeVisible();
	await expect(page.locator("diffs-container [data-line]").first()).toBeVisible();
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

async function setRangeValue(control: Locator, value: number) {
	await control.evaluate((element, nextValue) => {
		const input = element as HTMLInputElement;
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
		valueSetter?.call(input, String(nextValue));
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
	}, value);
}

test.describe("mobile fixture review", () => {
	test.skip(!localFixture, "The deterministic workflow uses the bundled e2e repository fixture.");

	test.beforeEach(async ({ page, request }) => {
		await page.addInitScript(() => {
			localStorage.setItem("couchview:install-hint-dismissed", "1");
		});
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("shows a quiet reconnecting indicator while the server remains reachable", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The installed iOS PWA is the representative resume case.",
		);
		await page.route("**/api/repositories/*/events", (route) => route.abort("connectionrefused"));
		await openFixture(page);

		const status = page.getByTestId("repository-connection-status");
		await expect(status).toHaveClass(/reconnecting/);
		const themeWarningColor = await page.evaluate(() => {
			const probe = document.createElement("span");
			probe.style.backgroundColor = "var(--yellow)";
			document.body.append(probe);
			const color = getComputedStyle(probe).backgroundColor;
			probe.remove();
			return color;
		});
		await expect(status).toHaveCSS("background-color", themeWarningColor);
		await expect(page.locator(".disconnected-banner")).toHaveCount(0);
	});

	test("uses the touch command palette across review, terminal, and Settings", async ({ page }) => {
		await openFixture(page);
		await page.getByRole("button", { name: "Open command palette" }).click();
		const palette = page.getByRole("dialog", { name: "Couchview command palette" });
		await expect(palette).toBeVisible();
		await expect(palette).toBeInViewport();
		await palette.getByRole("combobox", { name: "Couchview command palette" }).fill("terminal");
		await palette.getByText("Go to terminal", { exact: true }).click();

		const terminal = page.getByRole("region", { name: "tmux terminal" });
		await expect(terminal).toBeVisible();
		await terminal.getByRole("button", { name: "Open command palette" }).click();
		await palette.getByRole("combobox", { name: "Couchview command palette" }).fill("settings");
		await palette.getByText("Go to settings", { exact: true }).click();

		const settings = page.getByRole("region", { name: "Settings" });
		await expect(settings).toBeVisible();
		await settings
			.getByRole("button", {
				name: "Open command palette",
				exact: true,
			})
			.click();
		await palette.getByRole("combobox", { name: "Couchview command palette" }).fill("diff review");
		await palette.getByText("Go to diff review", { exact: true }).click();
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
		await page.getByRole("button", { name: "Open command palette" }).click();
		await palette.getByRole("combobox", { name: "Couchview command palette" }).fill("artifacts");
		await palette.getByText("Go to artifacts", { exact: true }).click();
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
			testInfo.project.name !== "mobile-375-webkit",
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
			testInfo.project.name !== "mobile-375-webkit",
			"Browser-local profile selection needs one isolated-context pass.",
		);
		const createdResponse = await request.post("/api/settings/profiles", {
			headers: { "x-couchview-csrf": fixtureCsrf },
			data: { name: "Phone" },
		});
		expect(createdResponse.ok()).toBe(true);
		const created = (await createdResponse.json()).profile;

		await page.goto("/settings");
		const selector = page.getByLabel("Active profile");
		await selector.selectOption(created.id);
		await expect(selector).toHaveValue(created.id);
		await page.reload();
		await expect(page.getByLabel("Active profile")).toHaveValue(created.id);

		const otherBrowser = await browser.newContext();
		try {
			const otherPage = await otherBrowser.newPage();
			await otherPage.goto(new URL("/settings", page.url()).href);
			await expect(otherPage.getByLabel("Active profile")).toHaveValue("default");
			await expect(otherPage.getByLabel("Active profile").locator("option")).toHaveCount(2);
		} finally {
			await otherBrowser.close();
		}
	});

	test("keeps focused form controls from triggering mobile page zoom", async ({ page }) => {
		await openFixture(page);
		await dismissPwaNotices(page);

		await page.getByRole("button", { name: "Open changed files" }).click();
		const filter = page.getByRole("searchbox", { name: "Filter changed files" });
		await expect(filter).toHaveCSS("font-size", "16px");
		await expect(filter).toHaveCSS("touch-action", "manipulation");
		await filter.focus();
		await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
		await page
			.getByRole("complementary", { name: "Changed files" })
			.getByRole("button", { name: "Close changed files" })
			.click();

		await page.getByRole("button", { name: "Show line numbers" }).click();
		await page.getByRole("button", { name: "Select old line 2" }).click();
		await page.getByRole("button", { name: "Select new line 2" }).click();
		const selection = page.getByRole("status").filter({
			hasText: "Old lines 2 / new lines 2",
		});
		await selection.getByRole("button", { name: "Comment" }).click();

		const comment = page.getByPlaceholder("Describe the issue and the expected correction…");
		await expect(comment).toHaveCSS("font-size", "16px");
		await expect(comment).toHaveCSS("touch-action", "manipulation");
		await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
	});

	test("persists independent diff and terminal typography settings", async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
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
		const appearance = settings.getByRole("region", { name: "Appearance" });
		await expect(settings.getByRole("heading", { name: "Profiles" })).toBeVisible();
		await expect(
			settings.getByText(/Profile contents are shared by this Couchview host/),
		).toBeVisible();
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
		await expect(appearance.getByLabel("Cell width adjustment")).toHaveAttribute("min", "-5");
		await expect(appearance.getByLabel("Cell width adjustment")).toHaveAttribute("max", "5");
		const systemFonts = appearance.getByRole("button", { name: /^System monospace/ });
		await systemFonts.nth(0).click();
		await setRangeValue(appearance.locator("#diff-font-size"), 14);
		await setRangeValue(appearance.getByLabel("Line height adjustment"), 3.5);
		await setRangeValue(appearance.getByLabel("Width adjustment", { exact: true }), 0.4);

		await systemFonts.nth(1).click();
		await setRangeValue(appearance.locator("#terminal-font-size"), 18);
		await setRangeValue(appearance.getByLabel("Cell height adjustment"), 4);
		await setRangeValue(appearance.getByLabel("Cell width adjustment"), -5);
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
			.locator("diffs-container")
			.first()
			.evaluate((host) => {
				const line = host.shadowRoot?.querySelector<HTMLElement>("[data-line]");
				if (!line) return null;
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
		const reloadedAppearance = reloadedSettings.getByRole("region", { name: "Appearance" });
		const reloadedSystemFonts = reloadedAppearance.getByRole("button", {
			name: /^System monospace/,
		});
		await expect(reloadedSystemFonts.nth(0)).toHaveAttribute("aria-pressed", "true");
		await expect(reloadedAppearance.locator("#diff-font-size")).toHaveValue("14");
		await expect(reloadedAppearance.getByLabel("Line height adjustment")).toHaveValue("3.5");
		await expect(reloadedAppearance.getByLabel("Width adjustment", { exact: true })).toHaveValue(
			"0.4",
		);
		await expect(reloadedSystemFonts.nth(1)).toHaveAttribute("aria-pressed", "true");
		await expect(reloadedAppearance.locator("#terminal-font-size")).toHaveValue("18");
		await expect(reloadedAppearance.getByLabel("Cell height adjustment")).toHaveValue("4");
		await expect(reloadedAppearance.getByLabel("Cell width adjustment")).toHaveValue("-5");
	});

	test("keeps review actions at the screen bottom across orientation changes", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The iOS viewport regression only needs one WebKit orientation cycle.",
		);

		await page.setViewportSize({ width: 375, height: 812 });
		await openFixture(page);
		await dismissPwaNotices(page);

		const shell = page.locator(".app-shell");
		const actions = page.getByRole("navigation", { name: "Review actions" });
		const expectActionsAtBottom = async () => {
			await expect(actions).toHaveCSS("position", "absolute");
			await expect
				.poll(() =>
					actions.evaluate((element) => {
						const bounds = element.getBoundingClientRect();
						return Math.round(window.innerHeight - bounds.bottom);
					}),
				)
				.toBeGreaterThanOrEqual(0);
			await expect
				.poll(() =>
					actions.evaluate((element) => {
						const bounds = element.getBoundingClientRect();
						return Math.round(window.innerHeight - bounds.bottom);
					}),
				)
				.toBeLessThanOrEqual(40);
		};

		await expect(shell).not.toHaveClass(/compact-landscape/);
		await expectActionsAtBottom();

		await page.setViewportSize({ width: 812, height: 375 });
		await expect(shell).toHaveClass(/compact-landscape/);
		await expectActionsAtBottom();

		await page.setViewportSize({ width: 375, height: 812 });
		await expect(shell).not.toHaveClass(/compact-landscape/);
		await expectActionsAtBottom();
	});

	test("uses an overlay drawer in iPad portrait and a split view in landscape", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The tablet orientation regression only needs one WebKit pass.",
		);

		await page.setViewportSize({ width: 834, height: 1194 });
		await openFixture(page);
		await dismissPwaNotices(page);

		const workspace = page.getByRole("region", { name: "Unified diff" });
		const drawer = page.getByRole("complementary", { name: "Changed files" });
		const menuButton = page.getByRole("button", { name: "Open changed files" });
		const actions = page.getByRole("navigation", { name: "Review actions" });
		const topBar = page.locator(".top-bar");
		const fileBar = page.getByRole("region", { name: "Current file" });
		const displayControls = page.getByLabel("Diff display controls");

		await expect(drawer).toHaveCount(0);
		await expect(menuButton).toBeVisible();
		await expect(actions).toHaveCSS("position", "absolute");
		await expect(displayControls).toBeVisible();
		await expect
			.poll(() => topBar.evaluate((element) => Math.round(element.getBoundingClientRect().height)))
			.toBeLessThanOrEqual(53);
		await expect
			.poll(() =>
				displayControls.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					const children = Array.from(element.children).map((child) => {
						const childBounds = child.getBoundingClientRect();
						return {
							center: childBounds.top + childBounds.height / 2,
							isButton: child.tagName === "BUTTON",
							left: Math.round(childBounds.left),
							right: Math.round(childBounds.right),
							width: Math.round(childBounds.width),
						};
					});
					const centers = children.map((child) => child.center);
					return {
						aligned: Math.max(...centers) - Math.min(...centers) <= 1,
						buttonsWideEnough: children
							.filter((child) => child.isButton)
							.every((child) => child.width >= 40),
						containsChildren: children.every(
							(child) =>
								child.left >= Math.round(bounds.left) && child.right <= Math.round(bounds.right),
						),
						wideEnough: Math.round(bounds.width) >= 200,
					};
				}),
			)
			.toEqual({
				aligned: true,
				buttonsWideEnough: true,
				containsChildren: true,
				wideEnough: true,
			});
		await expect
			.poll(() => fileBar.evaluate((element) => Math.round(element.getBoundingClientRect().top)))
			.toBeLessThanOrEqual(53);
		await expect
			.poll(() =>
				workspace.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					return {
						left: Math.round(bounds.left),
						width: Math.round(bounds.width),
						viewportWidth: window.innerWidth,
					};
				}),
			)
			.toEqual({ left: 0, width: 834, viewportWidth: 834 });

		await menuButton.click();
		await expect(drawer).toBeVisible();
		await expect(drawer).toHaveCSS("position", "fixed");
		await expect(page.locator(".drawer-scrim")).toBeVisible();
		await expect
			.poll(() =>
				workspace.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					return { left: Math.round(bounds.left), width: Math.round(bounds.width) };
				}),
			)
			.toEqual({ left: 0, width: 834 });
		await drawer.getByRole("button", { name: "Close changed files" }).click();
		await expect(drawer).toHaveCount(0);

		await page.setViewportSize({ width: 1194, height: 834 });
		await expect(drawer).toBeVisible();
		await expect(drawer).toHaveCSS("position", "relative");
		await expect(menuButton).toBeHidden();
		await expect(actions).toHaveCSS("position", "relative");
		await expect(displayControls).toBeVisible();
		await expect
			.poll(() => topBar.evaluate((element) => Math.round(element.getBoundingClientRect().height)))
			.toBeLessThanOrEqual(53);
		await expect
			.poll(() =>
				workspace.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					return {
						left: Math.round(bounds.left),
						width: Math.round(bounds.width),
						viewportWidth: window.innerWidth,
					};
				}),
			)
			.toEqual({ left: 300, width: 894, viewportWidth: 1194 });

		await page.setViewportSize({ width: 834, height: 1194 });
		await expect(drawer).toHaveCount(0);
		await expect(menuButton).toBeVisible();
		await expect(actions).toHaveCSS("position", "absolute");
	});

	test("keeps the iPhone portrait header to two unsquished rows", async ({ page }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-375-webkit",
			"The portrait header regression only needs one WebKit pass.",
		);

		await page.setViewportSize({ width: 390, height: 844 });
		await openFixture(page);
		await dismissPwaNotices(page);

		const topBar = page.locator(".top-bar");
		const fileBar = page.getByRole("region", { name: "Current file" });
		const displayControls = page.getByLabel("Diff display controls");

		await expect(displayControls).toBeVisible();
		await expect(displayControls.getByRole("button")).toHaveCount(4);
		await page.getByRole("button", { name: "Increase diff font size" }).click();
		await expect(displayControls.locator(".font-value")).toHaveText("12px");
		await page.getByRole("button", { name: "Decrease diff font size" }).click();
		await expect(displayControls.locator(".font-value")).toHaveText("11px");
		await expect
			.poll(() =>
				topBar.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					const visibleControls = Array.from(element.children)
						.filter((child) => {
							const bounds = child.getBoundingClientRect();
							return bounds.width > 0 && bounds.height > 0;
						})
						.map((child) => {
							const childBounds = child.getBoundingClientRect();
							return {
								center: childBounds.top + childBounds.height / 2,
								left: childBounds.left,
								right: childBounds.right,
								width: childBounds.width,
							};
						});
					const centers = visibleControls.map((child) => child.center);
					const ordered = [...visibleControls].sort((left, right) => left.left - right.left);
					return {
						aligned: Math.max(...centers) - Math.min(...centers) <= 1,
						contained: visibleControls.every(
							(child) => child.left >= bounds.left && child.right <= bounds.right,
						),
						count: visibleControls.length,
						heightIsCompact: Math.round(bounds.height) <= 43,
						noOverlap: ordered.every(
							(child, index) =>
								index === ordered.length - 1 || child.right <= ordered[index + 1]!.left,
						),
						wideEnough: visibleControls.every((child) => child.width >= 34),
					};
				}),
			)
			.toEqual({
				aligned: true,
				contained: true,
				count: 7,
				heightIsCompact: true,
				noOverlap: true,
				wideEnough: true,
			});
		await expect
			.poll(() =>
				fileBar.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					const topBarBounds = document.querySelector(".top-bar")!.getBoundingClientRect();
					return {
						attachedToTopBar: Math.round(bounds.top) === Math.round(topBarBounds.bottom),
						height: Math.round(bounds.height),
					};
				}),
			)
			.toEqual({ attachedToTopBar: true, height: 47 });

		await page.setViewportSize({ width: 844, height: 390 });
		await expect(displayControls).toBeVisible();
		await expect(page.locator(".file-bar")).toHaveCount(0);
		await expect
			.poll(() => topBar.evaluate((element) => Math.round(element.getBoundingClientRect().height)))
			.toBeLessThanOrEqual(42);
		await expect
			.poll(() =>
				displayControls.evaluate((element) => {
					const bounds = element.getBoundingClientRect();
					const buttons = Array.from(element.querySelectorAll("button")).map((button) => {
						const buttonBounds = button.getBoundingClientRect();
						return {
							height: Math.round(buttonBounds.height),
							width: Math.round(buttonBounds.width),
						};
					});
					return {
						contained: buttons.every((button) => button.width >= 32 && button.height >= 32),
						visible: bounds.width > 0 && bounds.height > 0,
					};
				}),
			)
			.toEqual({ contained: true, visible: true });
	});

	test("uses the full viewport while gutters stay fixed during horizontal code scroll", async ({
		page,
		request,
	}, testInfo) => {
		const currentFile = await openFixture(page);
		await dismissPwaNotices(page);
		await expect(
			page.locator("diffs-container [data-line]").filter({
				hasText: "visible between hunks",
			}),
		).toBeVisible();

		await expect
			.poll(() =>
				page.evaluate(() => ({
					documentWidth: document.documentElement.scrollWidth,
					viewportWidth: window.innerWidth,
				})),
			)
			.toEqual(
				expect.objectContaining({
					documentWidth: await page.evaluate(() => window.innerWidth),
				}),
			);

		const fontValue = page.locator(".font-value");
		await expect(fontValue).toHaveText("11px");
		const codeHost = page.locator("diffs-container").first();
		const renderedFont = () =>
			codeHost.evaluate((host) => {
				const line = host.shadowRoot?.querySelector<HTMLElement>("[data-line]");
				const hostStyle = getComputedStyle(host);
				const lineStyle = line ? getComputedStyle(line) : null;
				return {
					fontSize: lineStyle?.fontSize ?? "",
					hostFontSize: hostStyle.fontSize,
					lineHeight: lineStyle
						? Math.round(Number.parseFloat(lineStyle.lineHeight) * 100) / 100
						: 0,
					usesIosevka: lineStyle?.fontFamily.includes("Iosevka") ?? false,
					ligaturesDisabled: lineStyle?.fontVariantLigatures === "none",
					textInflationDisabled: Array.from(host.shadowRoot?.querySelectorAll("style") ?? []).some(
						(style) => style.textContent?.includes("-webkit-text-size-adjust: 100%"),
					),
				};
			});
		await expect.poll(renderedFont).toEqual({
			fontSize: "11px",
			hostFontSize: "11px",
			lineHeight: 17.05,
			usesIosevka: true,
			ligaturesDisabled: true,
			textInflationDisabled: true,
		});

		const fileSwitchControls = page.getByRole("navigation", { name: "Review actions" });
		await fileSwitchControls.getByRole("button", { name: "Next file" }).click();
		await expect(currentFile).toContainText("src/format.ts");
		await expect.poll(renderedFont).toEqual({
			fontSize: "11px",
			hostFontSize: "11px",
			lineHeight: 17.05,
			usesIosevka: true,
			ligaturesDisabled: true,
			textInflationDisabled: true,
		});
		await fileSwitchControls.getByRole("button", { name: "Previous file" }).click();
		await expect(currentFile).toContainText("src/review.ts");

		await expect
			.poll(() =>
				codeHost.evaluate((host) =>
					Boolean(host.shadowRoot?.querySelector("[data-disable-line-numbers]")),
				),
			)
			.toBe(true);
		await expect
			.poll(() =>
				codeHost.evaluate((host) => {
					const number = host.shadowRoot?.querySelector<HTMLElement>("[data-column-number]");
					return number?.getBoundingClientRect().width ?? 100;
				}),
			)
			.toBeLessThanOrEqual(6);
		await page.getByRole("button", { name: "Show line numbers" }).click();
		await expect(page.getByRole("button", { name: "Hide line numbers" })).toBeVisible();

		const increaseFont = page.getByRole("button", { name: "Increase diff font size" });
		for (let size = 12; size <= 24; size += 1) await increaseFont.click();
		await expect(fontValue).toHaveText("24px");
		await expect(increaseFont).toBeDisabled();
		await expect
			.poll(() =>
				page.evaluate(() =>
					getComputedStyle(document.documentElement).getPropertyValue("--code-size").trim(),
				),
			)
			.toBe("24px");

		const scroller = page.locator("diffs-container [data-code]").first();
		await expect
			.poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
			.toBeGreaterThan(20);

		const oldGutter = page.getByRole("button", { name: "Select new line 1", exact: true });
		const firstCode = page.locator("diffs-container [data-line]").first();
		const before = {
			gutterX: await oldGutter.evaluate((element) => element.getBoundingClientRect().x),
			codeX: await firstCode.evaluate((element) => element.getBoundingClientRect().x),
		};
		await scroller.evaluate((element) => {
			element.scrollLeft = Math.min(180, element.scrollWidth - element.clientWidth);
		});
		await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20);
		const after = {
			gutterX: await oldGutter.evaluate((element) => element.getBoundingClientRect().x),
			codeX: await firstCode.evaluate((element) => element.getBoundingClientRect().x),
		};
		expect(Math.abs(after.gutterX - before.gutterX)).toBeLessThanOrEqual(1.5);
		expect(after.codeX).toBeLessThan(before.codeX - 15);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
		).toBe(true);
		await page.getByRole("button", { name: "Wrap long lines" }).click();
		await expect(page.getByRole("button", { name: "Keep long lines on one line" })).toBeVisible();
		await expect
			.poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
			.toBeLessThanOrEqual(1);
		await expect
			.poll(async () => {
				const response = await request.get("/api/settings/profiles");
				return (await response.json()).profiles[0].data.display.lineWrapEnabled;
			})
			.toBe(true);
		expect(await page.evaluate(() => localStorage.getItem("couchview:line-wrap"))).toBeNull();
		await expect(
			page.getByRole("button", { name: "Find “load” in project" }).first(),
		).toBeVisible();
		expect(
			await codeHost.evaluate(
				(host) => host.shadowRoot?.querySelectorAll("[data-char]").length ?? 0,
			),
		).toBeGreaterThan(0);

		const actions = page.getByRole("navigation", { name: "Review actions" });
		const hunkActions = testInfo.project.name.includes("landscape")
			? page.locator(".compact-hunk-nav")
			: actions.locator(".hunk-nav");
		const nextHunk = hunkActions.getByRole("button", { name: "Next hunk" });
		const previousHunk = hunkActions.getByRole("button", { name: "Previous hunk" });
		await expect(previousHunk).toBeDisabled();
		await nextHunk.click();
		await expect(nextHunk).toBeEnabled();
		await expect(previousHunk).toBeDisabled();
		await nextHunk.click();
		await expect(nextHunk).toBeDisabled();
		await expect(previousHunk).toBeEnabled();
		await previousHunk.click();
		await expect(previousHunk).toBeDisabled();

		await actions.getByRole("button", { name: "Next file" }).click();
		await expect(currentFile).toContainText("src/format.ts");
		const previousFile = actions.getByRole("button", { name: "Previous file" });
		await previousFile.click();
		await expect(currentFile).toContainText("src/review.ts");
	});

	test("preloads adjacent diffs for flash-free back-and-forth navigation", async ({
		page,
	}, testInfo) => {
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

	test("searches, comments on a replacement, stages, and reviews with one-tap advance", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, "clipboard", {
				configurable: true,
				get: () => ({
					writeText: () => Promise.reject(new DOMException("Blocked for e2e", "NotAllowedError")),
				}),
			});
			Object.defineProperty(Document.prototype, "execCommand", {
				configurable: true,
				value: () => false,
			});
		});
		const currentFile = await openFixture(page);
		await dismissPwaNotices(page);

		const loadToken = page.getByRole("button", { name: "Find “load” in project" }).first();
		await loadToken.focus();
		await page.keyboard.press("Enter");
		const search = page.getByRole("dialog", { name: "Project search" });
		await expect(search).toBeVisible();
		const currentHit = search.getByRole("button", { name: /src\/review\.ts:2:16/ });
		await expect(currentHit).toBeVisible();
		await currentHit.click();
		await expect(search.locator(".source-preview")).toContainText("src/review.ts");
		await expect(search.locator(".source-line").first()).toHaveCSS("font-family", /Iosevka/);
		await expect(search.locator(".source-line").first()).toHaveCSS(
			"font-variant-ligatures",
			"none",
		);
		await search.getByRole("button", { name: "Back to results" }).click();
		await search.getByRole("button", { name: /Other files \(1\)/ }).click();
		await expect(search.getByRole("button", { name: /src\/format\.ts:2:10/ })).toBeVisible();
		await search.getByRole("button", { name: "Close search" }).click();

		await page.getByRole("button", { name: "Show line numbers" }).click();
		await page.getByRole("button", { name: "Select old line 2" }).focus();
		await page.keyboard.press("Space");
		await page.getByRole("button", { name: "Select new line 2" }).click();
		const selection = page.getByRole("status").filter({
			hasText: "Old lines 2 / new lines 2",
		});
		await expect(selection).toBeVisible();
		await selection.getByRole("button", { name: "Comment" }).click();

		const editor = page.getByRole("dialog", { name: "Add review comment" });
		await expect(editor).toContainText("src/review.ts:old L2 / new L2");
		await editor
			.getByPlaceholder("Describe the issue and the expected correction…")
			.fill("Keep the loaded result intact before returning its files.");
		await editor.getByRole("button", { name: "Add comment" }).click();
		await expect(page.getByText("Comment added", { exact: true })).toBeVisible();

		const inlineChip = page.getByRole("button", { name: /Open comment at src\/review\.ts/ });
		await expect(inlineChip).toContainText("Keep the loaded result intact");
		await inlineChip.click();
		const tray = page.getByRole("dialog", { name: "Review comments" });
		await expect(tray).toContainText("src/review.ts:old L2 / new L2");
		await expect(tray).toContainText("Keep the loaded result intact");
		await expect(tray.locator('[data-comment-id="fixture-comment-1"]')).toBeFocused();
		await tray.getByRole("button", { name: "Copy 1 for Codex" }).click();

		const manualCopy = page.getByRole("dialog", { name: "Copy comments manually" });
		await expect(manualCopy).toBeVisible();
		const correctionPrompt = await manualCopy.getByRole("textbox").inputValue();
		expect(correctionPrompt).toContain("Please address each review comment below");
		expect(correctionPrompt).toContain("src/review.ts:old L2 / new L2");
		expect(correctionPrompt).toContain("Keep the loaded result intact before returning its files.");
		await manualCopy.getByRole("button", { name: "Close manual copy dialog" }).click();

		const actions = page.getByRole("navigation", { name: "Review actions" });
		const stage = actions.getByRole("button", { name: "Stage current file" });
		await stage.click();
		await expect(page.getByText("File staged", { exact: true })).toBeVisible();
		await expect(actions.getByRole("button", { name: "Unstage current file" })).toBeVisible();
		await expect(currentFile.locator(".status-pill.staged")).toHaveText("staged");

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
		const drawer = page.getByRole("complementary", { name: "Changed files" });
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
		const drawer = page.getByRole("complementary", { name: "Changed files" });
		await expect(drawer.getByRole("button", { name: "Unreview shown files (1)" })).toBeVisible();
		const bulkActions = drawer.locator(".bulk-file-actions > button");
		await expect(bulkActions).toHaveCount(3);
		expect(
			await bulkActions.evaluateAll(
				(buttons) => new Set(buttons.map((button) => button.getBoundingClientRect().top)).size,
			),
		).toBe(1);
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
		const drawer = page.getByRole("complementary", { name: "Changed files" });
		await drawer.getByRole("button", { name: /Commands/ }).click();
		await expect(drawer).toContainText("sample-project");
		await expect(drawer).toContainText("@sample/mobile");
		await expect(drawer).toContainText("expo export");
		await expect(drawer).toContainText("Only run commands");

		await drawer.getByRole("button", { name: "Run build in apps/mobile" }).click();
		const output = page.getByRole("dialog", { name: "Package command output" });
		await expect(output).toBeVisible();
		await expect(output).toContainText("pnpm run build");
		await expect(output).toContainText("fixture output: pnpm run build");
		await expect(output).toContainText("Passed");
		await output.getByRole("button", { name: "Close package command output" }).click();

		await page.getByRole("button", { name: "Open changed files" }).click();
		await expect(
			page
				.getByRole("complementary", { name: "Changed files" })
				.getByText("Active and recent runs"),
		).toBeVisible();
	});

	test("switches projects through URL history while tabs remain independent", async ({
		context,
		page,
	}) => {
		await openFixture(page);
		await dismissPwaNotices(page);

		const repositoryButton = page.getByRole("button", { name: "Select repository" });
		await expect(repositoryButton).toContainText("sample-project");
		if (await repositoryButton.isVisible()) {
			await repositoryButton.click();
		} else {
			await page.getByRole("button", { name: "Open command palette" }).click();
			const palette = page.getByRole("dialog", { name: "Couchview command palette" });
			await palette.getByRole("combobox", { name: "Couchview command palette" }).fill("repository");
			await palette.getByText("Switch repository", { exact: true }).click();
		}
		const picker = page.getByRole("dialog", { name: "Repositories" });
		await expect(picker).toContainText("/fixtures/sample-project");
		await expect(picker).toContainText("/fixtures/design-system");
		await picker.getByRole("button", { name: /design-system \/fixtures\/design-system/ }).click();
		await expect(repositoryButton).toContainText("design-system");
		await expect(page).toHaveURL(/\?repo=fixture-repository-two$/);

		await page.goBack();
		await expect(repositoryButton).toContainText("sample-project");
		await expect(page).toHaveURL(/\?repo=fixture-repository$/);

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
		const drawer = page.getByRole("complementary", { name: "Changed files" });
		await expect(drawer).toBeVisible();
		const after = await workspace.boundingBox();
		expect(after).not.toBeNull();
		expect(after!.x).toBeCloseTo(before!.x, 0);
		expect(after!.width).toBeCloseTo(before!.width, 0);
		await expect(drawer).toHaveCSS("position", "fixed");
		await drawer.getByRole("button", { name: "Close changed files" }).click();

		const topBar = page.locator(".top-bar");
		const fileBar = page.locator(".file-bar");
		const actions = page.getByRole("navigation", { name: "Review actions" });
		await expect(fileBar).toHaveCount(0);
		await expect
			.poll(() => topBar.evaluate((element) => element.getBoundingClientRect().height))
			.toBeLessThanOrEqual(42);
		await expect(actions).toHaveCSS("position", "absolute");
		await expect
			.poll(() => actions.evaluate((element) => element.getBoundingClientRect().width))
			.toBe(520);
		await expect(actions.getByRole("button")).toHaveCount(7);
		await expect(actions.locator(".hunk-nav")).toBeVisible();
		await expect(actions.locator(".comments-action")).toBeVisible();
		await expect(page.locator(".compact-hunk-nav")).toBeVisible();
		await expect(page.locator(".compact-comments-button")).toBeVisible();

		const currentFile = page.getByRole("region", { name: "Current file" });
		await actions.getByRole("button", { name: "Review + next" }).click();
		await expect(currentFile).toContainText("src/format.ts");

		await actions.getByRole("button", { name: "Stage current file" }).click();
		await expect(actions.getByRole("button", { name: "Unstage current file" })).toBeVisible();
		await actions.getByRole("button", { name: "Unstage current file" }).click();
		await expect(actions.getByRole("button", { name: "Stage current file" })).toBeVisible();
	});
});
