import { expect, type Page, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

async function installMicrophoneFixture(page: Page) {
	await page.addInitScript(() => {
		const stream = { getTracks: () => [{ stop: () => undefined }] };
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: { getUserMedia: async () => stream },
		});
		type AudioProcessEvent = {
			inputBuffer: {
				getChannelData(index: number): Float32Array;
				numberOfChannels: number;
			};
		};
		class FakeAudioContext {
			readonly destination = {};
			readonly sampleRate = 16_000;
			createMediaStreamSource() {
				return {
					channelCount: 1,
					connect: () => undefined,
					disconnect: () => undefined,
				};
			}
			createScriptProcessor() {
				let listener: ((event: AudioProcessEvent) => void) | null = null;
				let interval: ReturnType<typeof setInterval> | null = null;
				return {
					get onaudioprocess() {
						return listener;
					},
					set onaudioprocess(value: ((event: AudioProcessEvent) => void) | null) {
						listener = value;
					},
					connect() {
						const emit = () =>
							listener?.({
								inputBuffer: {
									getChannelData: () => new Float32Array(1_024).fill(0.12),
									numberOfChannels: 1,
								},
							});
						emit();
						interval = setInterval(emit, 64);
					},
					disconnect() {
						if (interval) clearInterval(interval);
					},
				};
			}
			close() {
				return Promise.resolve();
			}
			resume() {
				return Promise.resolve();
			}
		}
		Object.defineProperty(globalThis, "AudioContext", {
			configurable: true,
			value: FakeAudioContext,
		});
	});
}

test.describe("voice commands", () => {
	test.skip(!localFixture, "The voice-command boundary uses the bundled deterministic fixture.");

	test.beforeEach(async ({ page, request }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"One Chromium secure-context client covers voice-command capture.",
		);
		const reset = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(reset.ok()).toBe(true);
		const enable = await request.post("/api/e2e/voice-commands/enable", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(enable.ok()).toBe(true);
		await installMicrophoneFixture(page);
	});

	test("records from the FAB and executes a confident navigation command", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
		const start = page.getByRole("button", { name: "Start voice command" });
		const bounds = await start.boundingBox();
		const viewport = page.viewportSize();
		expect(bounds).not.toBeNull();
		expect(viewport).not.toBeNull();
		expect((viewport?.width ?? 0) - (bounds?.x ?? 0) - (bounds?.width ?? 0)).toBeLessThan(24);
		expect((viewport?.height ?? 0) - (bounds?.y ?? 0) - (bounds?.height ?? 0)).toBeGreaterThan(56);
		await start.click();
		await page.getByRole("button", { name: "Stop voice command recording" }).click();

		await expect(page.getByRole("main", { name: "Repository artifacts" })).toBeVisible();
		await expect(page.getByText("Open artifacts succeeded")).toBeVisible();
		await expect(page).toHaveURL(/\/artifacts\?repo=fixture-repository$/);
	});

	test("holds V for push-to-talk and discards an accidental tap", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

		await page.keyboard.press("v");
		await expect(page.getByRole("button", { name: "Start voice command" })).toBeVisible();
		await expect(page.getByRole("main", { name: "Repository artifacts" })).not.toBeVisible();

		await page.keyboard.down("v");
		await expect(page.getByRole("button", { name: "Stop voice command recording" })).toBeVisible();
		await page.waitForTimeout(300);
		await page.keyboard.up("v");

		await expect(page.getByRole("main", { name: "Repository artifacts" })).toBeVisible();
	});

	test("uses Shift V to toggle a Git history voice command", async ({ page }) => {
		const configure = await page.request.post("/api/e2e/voice-commands/action", {
			data: { actionId: "navigate.history" },
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(configure.ok()).toBe(true);
		await page.goto("/");
		await expect(page.getByRole("button", { name: "Start voice command" })).toBeVisible();

		await page.keyboard.press("Shift+V");
		await expect(page.getByRole("button", { name: "Stop voice command recording" })).toBeVisible();
		await page.keyboard.press("Shift+V");

		await expect(
			page.getByRole("main", { name: "Git history and repository actions" }),
		).toBeVisible();
		await expect(page).toHaveURL(/\/history\?repo=fixture-repository$/);
	});

	test("stages through the voice action and offers a guarded undo", async ({ page }) => {
		const configure = await page.request.post("/api/e2e/voice-commands/action", {
			data: { actionId: "file.stage" },
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(configure.ok()).toBe(true);
		await page.goto("/");
		await expect(page.getByRole("button", { name: "Stage current file" })).toBeVisible();

		await page.getByRole("button", { name: "Start voice command" }).click();
		await page.getByRole("button", { name: "Stop voice command recording" }).click();
		await expect(page.getByRole("button", { name: "Unstage current file" })).toBeVisible();
		await expect(page.getByText("Stage current file succeeded")).toBeVisible();

		await page.getByRole("button", { name: "Undo" }).click();
		await expect(page.getByRole("button", { name: "Stage current file" })).toBeVisible();
		await expect(page.getByText("Voice command undone")).toBeVisible();
	});

	test("shows the transcript, score, and Needle reasoning before a low-confidence action", async ({
		page,
	}) => {
		const configure = await page.request.post("/api/e2e/voice-commands/action", {
			data: { actionId: "navigate.artifacts", confidence: 0.41 },
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(configure.ok()).toBe(true);
		await page.goto("/");

		await page.getByRole("button", { name: "Start voice command" }).click();
		await page.getByRole("button", { name: "Stop voice command recording" }).click();

		await expect(page.getByText("Confirm voice commands")).toBeVisible();
		await expect(
			page.getByText("Low confidence — check every action before continuing."),
		).toBeVisible();
		await expect(page.getByText("Transcript: “voice command phrase”")).toBeVisible();
		await expect(page.getByText("Confidence: 41%")).toBeVisible();
		await page.getByRole("button", { name: "Show Needle reasoning" }).click();
		await expect(page.getByText("'voice command phrase' -> open_artifacts")).toBeVisible();
		await expect(page.getByRole("main", { name: "Repository artifacts" })).not.toBeVisible();
	});

	test("dismisses a contextual preview as soon as repository context changes", async ({ page }) => {
		const configure = await page.request.post("/api/e2e/voice-commands/action", {
			data: { actionId: "file.stage", confidence: 0.41 },
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(configure.ok()).toBe(true);
		await page.goto("/");
		await page.getByRole("button", { name: "Start voice command" }).click();
		await page.getByRole("button", { name: "Stop voice command recording" }).click();
		await expect(page.getByText("Confirm voice commands")).toBeVisible();

		await page.evaluate(() => {
			window.history.pushState({}, "", "/?repo=fixture-repository-two");
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		await expect(page.getByText("Confirm voice commands")).not.toBeVisible();
		await expect(page.getByRole("button", { name: "Select repository" })).toContainText(
			"design-system",
		);
		await expect(page.getByRole("button", { name: "Stage current file" })).toBeVisible();
	});
});
