import { expect, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

interface TerminalFixtureState {
	running: boolean;
	attachmentCount: number;
	socketConnections: number;
	inputs: string[];
	resizes: Array<{ cols: number; rows: number }>;
	p2pActive: boolean;
	p2pConnections: number;
}

test.describe("desktop tmux terminal", () => {
	test.skip(!localFixture, "The deterministic terminal uses the bundled e2e fixture.");

	test.beforeEach(async ({ request }) => {
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("loads Ghostty on demand and preserves one live terminal across Review handoffs", async ({
		page,
		request,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, "platform", {
				configurable: true,
				get: () => "MacIntel",
			});
			Object.defineProperty(Navigator.prototype, "userAgentData", {
				configurable: true,
				get: () => ({ platform: "macOS" }),
			});
		});
		const loadedAssets: string[] = [];
		page.on("requestfinished", (networkRequest) => {
			loadedAssets.push(new URL(networkRequest.url()).pathname);
		});

		await page.goto("/");
		await expect(page).toHaveTitle("Couchview");
		await expect(page.getByRole("region", { name: "Current file" })).toContainText("src/review.ts");
		expect(
			loadedAssets.some(
				(pathname) => pathname.includes("ghostty-web") || pathname.endsWith(".wasm"),
			),
		).toBe(false);

		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		const workspace = page.getByRole("region", { name: "tmux terminal" });
		await expect(workspace).toBeVisible();
		await expect(
			workspace.getByRole("toolbar", { name: "Terminal keyboard shortcuts" }),
		).toBeHidden();
		await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(workspace.getByRole("button", { name: "Debug" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await expect(workspace.getByTestId("terminal-latency-overlay")).toHaveCount(0);
		await expect(workspace.getByTestId("terminal-surface")).toHaveCSS(
			"caret-color",
			"rgba(0, 0, 0, 0)",
		);
		await expect
			.poll(() =>
				loadedAssets.some((pathname) =>
					/\/_expo\/static\/js\/web\/ghostty-web-[^/]+\.js$/.test(pathname),
				),
			)
			.toBe(true);
		await expect
			.poll(() =>
				loadedAssets.some((pathname) =>
					/\/assets\/.*ghostty-web\/ghostty-vt\.[^/]+\.wasm$/.test(pathname),
				),
			)
			.toBe(true);
		await expect
			.poll(() =>
				loadedAssets.some((pathname) => /\/assets\/.*Iosevka-Regular[^/]*\.woff2$/.test(pathname)),
			)
			.toBe(true);
		await expect
			.poll(() =>
				loadedAssets.some((pathname) => /\/assets\/.*Iosevka-Bold[^/]*\.woff2$/.test(pathname)),
			)
			.toBe(true);
		const state = async () =>
			(await (await request.get("/api/e2e/terminal")).json()) as TerminalFixtureState;
		await expect.poll(async () => (await state()).socketConnections).toBe(1);

		const initialDimensions = (await state()).resizes.at(-1);
		expect(initialDimensions).toBeDefined();
		const previousRowContamination = await workspace
			.getByTestId("terminal-surface")
			.locator("canvas")
			.evaluate((canvas, rows) => {
				const context = (canvas as HTMLCanvasElement).getContext("2d");
				if (!context) return -1;
				const surface = (canvas as HTMLCanvasElement).closest<HTMLElement>(".terminal-workspace");
				const expectedColor = getComputedStyle(surface ?? document.documentElement)
					.getPropertyValue("--terminal-background")
					.trim();
				const expected = document.createElement("canvas").getContext("2d");
				if (!expected) return -1;
				expected.fillStyle = expectedColor;
				expected.fillRect(0, 0, 1, 1);
				const expectedPixel = expected.getImageData(0, 0, 1, 1).data;
				const rowHeight = (canvas as HTMLCanvasElement).height / rows;
				const pixels = context.getImageData(
					0,
					0,
					Math.min(240, (canvas as HTMLCanvasElement).width),
					Math.floor(rowHeight),
				).data;
				let contaminated = 0;
				for (let index = 0; index < pixels.length; index += 4) {
					if (
						pixels[index] !== expectedPixel[0] ||
						pixels[index + 1] !== expectedPixel[1] ||
						pixels[index + 2] !== expectedPixel[2]
					) {
						contaminated += 1;
					}
				}
				return contaminated;
			}, initialDimensions!.rows);
		// Chromium can place a few anti-aliased edge pixels on the fractional row
		// boundary. Real previous-row leakage paints a meaningful part of a glyph.
		expect(previousRowContamination).toBeLessThan(10);

		const bounds = await workspace.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.width).toBeGreaterThanOrEqual(1270);
		expect(bounds!.height).toBeGreaterThanOrEqual(790);
		const toolbarBounds = await workspace.getByTestId("terminal-toolbar").boundingBox();
		expect(toolbarBounds).not.toBeNull();
		expect(toolbarBounds!.height).toBeLessThanOrEqual(32);
		const reviewBounds = await workspace.getByRole("button", { name: "Review" }).boundingBox();
		expect(reviewBounds).not.toBeNull();
		expect(reviewBounds!.height).toBeGreaterThanOrEqual(24);

		const terminalSurface = workspace.getByTestId("terminal-surface");
		const canvas = terminalSurface.locator("canvas");
		const primaryModifier = await page.evaluate(() => {
			const userAgentData = (
				navigator as Navigator & {
					userAgentData?: { platform?: string };
				}
			).userAgentData;
			const platform = userAgentData?.platform || navigator.platform || navigator.userAgent;
			return /Mac|iPhone|iPad|iPod/i.test(platform) ? "Meta" : "Control";
		});
		const cellHeight = async () => {
			const latestDimensions = (await state()).resizes.at(-1);
			if (!latestDimensions) return 0;
			return canvas.evaluate(
				(element, rows) => (element as HTMLCanvasElement).height / rows,
				latestDimensions.rows,
			);
		};
		await terminalSurface.click();
		const initialCellHeight = await cellHeight();
		const inputBeforeFormerFontShortcuts = (await state()).inputs.join("");
		for (const key of ["=", "-", "0"]) {
			await page.keyboard.press(`${primaryModifier}+${key}`);
		}
		await expect
			.poll(async () => (await state()).inputs.join("").length)
			.toBeGreaterThan(inputBeforeFormerFontShortcuts.length);
		expect(await cellHeight()).toBe(initialCellHeight);

		const inputBeforePalette = (await state()).inputs.join("");
		await page.keyboard.press(`${primaryModifier}+k`);
		await expect(
			page.getByRole("dialog", {
				name: "Command palette",
			}),
		).toBeVisible();
		expect((await state()).inputs.join("")).toBe(inputBeforePalette);
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", {
				name: "Command palette",
			}),
		).toHaveCount(0);
		await expect(terminalSurface).toBeFocused();

		await page.keyboard.down("u");
		await expect(terminalSurface).toHaveAttribute("contenteditable", "false");
		await page.keyboard.down("u");
		await page.keyboard.down("u");
		await page.keyboard.up("u");
		await expect(terminalSurface).toHaveAttribute("contenteditable", "true");
		await expect.poll(async () => (await state()).inputs.join("")).toContain("uuu");

		await page.keyboard.type("hello-from-browser");
		await expect.poll(async () => (await state()).inputs.join("")).toContain("hello-from-browser");

		const pasteDefaultPreserved = await terminalSurface.evaluate((surface) => {
			const textarea = surface.querySelector("textarea");
			if (!textarea) return false;
			const keydown = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				code: "KeyK",
				key: "v",
				metaKey: true,
			});
			textarea.dispatchEvent(keydown);
			const clipboardData = new DataTransfer();
			clipboardData.setData("text/plain", "pasted-with-primary-v");
			textarea.dispatchEvent(
				new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData,
				}),
			);
			return !keydown.defaultPrevented;
		});
		expect(pasteDefaultPreserved).toBe(true);
		await expect
			.poll(async () => (await state()).inputs.join(""))
			.toContain("pasted-with-primary-v");

		const resizeCount = (await state()).resizes.length;
		await page.setViewportSize({ width: 1080, height: 700 });
		await expect.poll(async () => (await state()).resizes.length).toBeGreaterThan(resizeCount);

		const sessionCellHeight = await cellHeight();
		const connectedState = await state();
		await workspace.getByRole("button", { name: "Review" }).click();
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
		await expect(workspace).toBeHidden();
		await page.getByRole("button", { name: "Open tmux terminal" }).click();
		await expect(workspace).toBeVisible();
		await expect(workspace.getByText("Connected", { exact: true })).toBeVisible();
		expect(await cellHeight()).toBe(sessionCellHeight);
		expect((await state()).attachmentCount).toBe(connectedState.attachmentCount);
		expect((await state()).socketConnections).toBe(connectedState.socketConnections);

		page.once("dialog", (dialog) => void dialog.accept());
		await workspace.getByRole("button", { name: "End session" }).click();
		await expect.poll(async () => (await state()).running).toBe(false);
		await expect(workspace.getByText("Session ended", { exact: true }).first()).toBeVisible();
		await page.waitForTimeout(750);
		expect((await state()).attachmentCount).toBe(connectedState.attachmentCount);
		expect((await state()).socketConnections).toBe(connectedState.socketConnections);
		expect((await state()).running).toBe(false);
	});

	test("moves terminal traffic to a real DataChannel and falls back without ending tmux", async ({
		page,
		request,
	}) => {
		const state = async () =>
			(await (await request.get("/api/e2e/terminal")).json()) as TerminalFixtureState;
		await page.goto("/?terminalLatency=1");
		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		const workspace = page.getByRole("region", { name: "tmux terminal" });
		const surface = workspace.getByTestId("terminal-surface");
		await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(workspace.getByTestId("terminal-transport")).toHaveText("Direct P2P", {
			timeout: 15_000,
		});
		await expect.poll(async () => (await state()).p2pActive).toBe(true);

		await surface.click();
		await page.keyboard.type("direct-data-channel");
		await expect.poll(async () => (await state()).inputs.join("")).toContain("direct-data-channel");
		const overlay = workspace.getByTestId("terminal-latency-overlay");
		const baseline = overlay.getByTestId("terminal-latency-baseline");
		await expect(baseline.locator("strong")).toHaveText(/\d+\.\d ms/);

		const failed = await request.post("/api/e2e/terminal/p2p/fail", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(failed.ok()).toBe(true);
		await expect(workspace.getByTestId("terminal-transport")).toHaveText("WebSocket fallback", {
			timeout: 15_000,
		});
		await expect.poll(async () => (await state()).socketConnections).toBe(2);
		expect((await state()).running).toBe(true);
		expect((await state()).p2pConnections).toBe(1);

		await surface.click();
		await page.keyboard.type("websocket-fallback");
		await expect.poll(async () => (await state()).inputs.join("")).toContain("websocket-fallback");
		await workspace.getByRole("button", { name: "Retry P2P" }).click();
		await expect(workspace.getByTestId("terminal-transport")).toHaveText("Direct P2P", {
			timeout: 15_000,
		});
		await expect.poll(async () => (await state()).p2pConnections).toBe(2);
		expect((await state()).running).toBe(true);
	});

	test("measures an isolated printable key through the echoed Ghostty canvas render", async ({
		page,
	}) => {
		await page.goto("/?terminalLatency=1");
		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		const workspace = page.getByRole("region", { name: "tmux terminal" });
		await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		const debug = workspace.getByRole("button", { name: "Debug" });
		await expect(debug).toHaveAttribute("aria-pressed", "true");
		await expect(page).toHaveURL(/(?:\?|&)terminalLatency=1(?:&|$)/);
		const overlay = workspace.getByTestId("terminal-latency-overlay");
		await expect(overlay).toContainText("Key → canvas");
		await expect(overlay).toContainText("Baseline RTT");
		const networkMetric = overlay.getByTestId("terminal-latency-baseline");
		await expect(networkMetric.locator("strong")).toHaveText(/\d+\.\d ms/);

		await debug.click();
		await expect(debug).toHaveAttribute("aria-pressed", "false");
		await expect(overlay).toHaveCount(0);
		await expect
			.poll(() =>
				page.evaluate(() => new URL(window.location.href).searchParams.get("terminalLatency")),
			)
			.toBeNull();
		await debug.click();
		await expect(debug).toHaveAttribute("aria-pressed", "true");
		const resumedOverlay = workspace.getByTestId("terminal-latency-overlay");
		const canvas = workspace.locator("canvas");

		// Let the already-scheduled render-loop callback run, then park future frames.
		// The echoed key must still paint and complete its latency sample synchronously.
		await page.evaluate(() => {
			let nextFrameId = 1_000_000;
			window.requestAnimationFrame = () => nextFrameId++;
		});
		await page.waitForTimeout(50);

		const canvasHash = () =>
			canvas.evaluate((element) => {
				const canvasElement = element as HTMLCanvasElement;
				const context = canvasElement.getContext("2d");
				if (!context) return -1;
				const pixels = context.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
				let hash = 2_166_136_261;
				for (let index = 0; index < pixels.length; index += 4) {
					hash ^= pixels[index]!;
					hash = Math.imul(hash, 16_777_619);
				}
				return hash >>> 0;
			});

		await workspace.getByTestId("terminal-surface").click();
		await page.waitForTimeout(150);
		const before = await canvasHash();
		await page.keyboard.press("x");

		const keyMetric = resumedOverlay.getByTestId("terminal-latency-key");
		await expect(keyMetric.locator("strong")).toHaveText(/\d+\.\d ms/);
		await expect(keyMetric.locator("small")).toContainText("n=1");
		for (const testId of [
			"terminal-latency-press-to-send",
			"terminal-latency-send-to-receive",
			"terminal-latency-receive-to-paint",
		]) {
			const phase = resumedOverlay.getByTestId(testId);
			await expect(phase.locator("strong")).toHaveText(/\d+\.\d ms/);
		}
		for (const testId of [
			"terminal-latency-receive-to-write",
			"terminal-latency-frame-wait",
			"terminal-latency-canvas-render",
		]) {
			const detail = resumedOverlay.getByTestId(testId);
			await expect(detail.locator("strong")).toHaveText(/\d+\.\d ms/);
		}
		expect(await canvasHash()).not.toBe(before);
	});

	test("uses profile-backed system monospace without loading bundled Iosevka", async ({
		page,
		request,
	}) => {
		const profileList = await request.get("/api/settings/profiles");
		const profile = (await profileList.json()).profiles[0];
		profile.data.typography.diff.fontFamily = "system";
		profile.data.typography.terminal = {
			fontFamily: "system",
			fontSize: 15,
			cellHeightAdjustment: 1,
			cellWidthAdjustment: -5,
		};
		const saved = await request.put(`/api/settings/profiles/${profile.id}`, {
			headers: { "x-couchview-csrf": fixtureCsrf },
			data: {
				name: profile.name,
				data: profile.data,
				expectedRevision: profile.revision,
			},
		});
		expect(saved.ok()).toBe(true);
		const loadedAssets: string[] = [];
		page.on("requestfinished", (networkRequest) => {
			loadedAssets.push(new URL(networkRequest.url()).pathname);
		});

		await page.goto("/");
		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		const workspace = page.getByRole("region", { name: "tmux terminal" });
		await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect
			.poll(() =>
				loadedAssets.some((pathname) =>
					/\/_expo\/static\/js\/web\/ghostty-web-[^/]+\.js$/.test(pathname),
				),
			)
			.toBe(true);
		await expect
			.poll(() =>
				loadedAssets.some((pathname) =>
					/\/assets\/.*ghostty-web\/ghostty-vt\.[^/]+\.wasm$/.test(pathname),
				),
			)
			.toBe(true);
		expect(
			loadedAssets.some((pathname) => /\/assets\/.*Iosevka-[^/]*\.woff2$/.test(pathname)),
		).toBe(false);

		const state = (await (await request.get("/api/e2e/terminal")).json()) as TerminalFixtureState;
		expect(state.attachmentCount).toBe(1);
		expect(state.socketConnections).toBe(1);
	});

	test("does not restart Ghostty while terminal typography is edited and applies once", async ({
		page,
		request,
	}) => {
		const state = async () =>
			(await (await request.get("/api/e2e/terminal")).json()) as TerminalFixtureState;
		await page.goto("/");
		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		const workspace = page.getByRole("region", { name: "tmux terminal" });
		await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await workspace.getByRole("button", { name: "Review" }).click();
		await page.getByRole("button", { name: "Open settings" }).click();

		const settings = page.getByRole("region", { name: "Settings" });
		const fontSize = settings.getByRole("slider", { name: "Terminal font size" });
		await expect(fontSize).toHaveAttribute("aria-valuenow", "15");
		for (const expectedValue of ["16", "17", "18"]) {
			const bounds = await fontSize.boundingBox();
			expect(bounds).not.toBeNull();
			const target = Number(expectedValue);
			const thumbSize = 20;
			const valueOffset = ((target - 8) / (32 - 8)) * (bounds!.width - thumbSize);
			await page.mouse.click(
				bounds!.x + thumbSize / 2 + valueOffset,
				bounds!.y + bounds!.height / 2,
			);
			await expect(fontSize).toHaveAttribute("aria-valuenow", expectedValue);
		}
		expect((await state()).attachmentCount).toBe(1);
		expect((await state()).socketConnections).toBe(1);

		const save = settings.getByRole("button", {
			name: "Save changes",
		});
		await expect(save).toBeEnabled();
		await save.click();
		await expect(save).toBeDisabled();
		await expect.poll(async () => (await state()).attachmentCount).toBe(2);
		await expect.poll(async () => (await state()).socketConnections).toBe(2);
		await settings.getByRole("button", { name: "Review", exact: true }).click();
		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		await expect(workspace.getByText("Connected", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect.poll(async () => (await state()).attachmentCount).toBe(2);
		await expect.poll(async () => (await state()).socketConnections).toBe(2);
		await expect(workspace.getByText("Loading terminal", { exact: true })).toHaveCount(0);
		expect((await state()).attachmentCount).toBe(2);
		expect((await state()).socketConnections).toBe(2);
	});

	test("retries with bundled renderer defaults in Safe Mode", async ({ page, request }) => {
		let rejectedHostConfig = false;
		await page.route("**/api/repositories/*/terminal/attachments", async (route) => {
			if (rejectedHostConfig) {
				await route.fallback();
				return;
			}
			rejectedHostConfig = true;
			await route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					error: {
						code: "terminal_size_invalid",
						message: "Terminal dimensions are outside the supported range",
					},
				}),
			});
		});

		await page.goto("/");
		await page.getByRole("button", { name: "Open tmux terminal" }).click();

		const workspace = page.getByRole("region", { name: "tmux terminal" });
		await expect(
			workspace.getByText("Terminal dimensions are outside the supported range"),
		).toBeVisible();
		await workspace.getByRole("button", { name: "Safe Mode" }).click();
		await expect(workspace.getByText("Connected · Safe Mode", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(workspace.getByRole("button", { name: "Safe Mode" })).toHaveCount(0);

		const state = (await (await request.get("/api/e2e/terminal")).json()) as TerminalFixtureState;
		expect(state.attachmentCount).toBe(1);
		expect(state.socketConnections).toBe(1);
	});
});
