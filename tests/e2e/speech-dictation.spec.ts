import { expect, type Page, test } from "@playwright/test";

const localFixture = !process.env.PLAYWRIGHT_BASE_URL;
const fixtureCsrf = "e2e-csrf-token";

async function openCommandSearch(page: Page) {
	await page.goto("/");
	await expect(page).toHaveTitle("Couchview");
	await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();
	await page.getByRole("button", { name: "Open command palette" }).click();
	const palette = page.getByRole("dialog", { name: "Command palette" });
	await expect(palette).toBeVisible();
	return {
		palette,
		search: palette.getByRole("textbox", { name: "Search commands" }),
	};
}

async function enableFixtureSpeech(page: Page) {
	const response = await page.request.post("/api/e2e/speech/enable", {
		headers: { "x-couchview-csrf": fixtureCsrf },
	});
	expect(response.ok()).toBe(true);
}

test.describe("web dictation", () => {
	test.skip(!localFixture, "The microphone boundary uses the bundled deterministic fixture.");

	test.beforeEach(async ({ page, request }, testInfo) => {
		test.skip(
			testInfo.project.name !== "mobile-430-chromium",
			"One Chromium secure-context client covers the universal web recorder.",
		);
		const response = await request.post("/api/e2e/reset", {
			headers: { "x-couchview-csrf": fixtureCsrf },
		});
		expect(response.ok()).toBe(true);
	});

	test("hides the microphone when the host is ready but browser capture is unavailable", async ({
		page,
	}) => {
		await enableFixtureSpeech(page);
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "mediaDevices", {
				configurable: true,
				value: undefined,
			});
		});
		const { palette } = await openCommandSearch(page);
		await expect(palette.getByRole("button", { name: "Start dictation" })).toHaveCount(0);
	});

	test("records PCM, uploads on stop, and replaces the current selection", async ({ page }) => {
		await enableFixtureSpeech(page);
		await page.addInitScript(() => {
			type SpeechFixtureState = { quietTransitions: number[] };
			const fixtureState: SpeechFixtureState = { quietTransitions: [] };
			Object.defineProperty(globalThis, "__couchviewSpeechFixtureState", {
				configurable: true,
				value: fixtureState,
			});
			const stream = {
				getTracks: () => [{ stop: () => undefined }],
			};
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
					let bufferIndex = 0;
					let previousSpeaking = false;
					return {
						get onaudioprocess() {
							return listener;
						},
						set onaudioprocess(value: ((event: AudioProcessEvent) => void) | null) {
							listener = value;
						},
						connect() {
							const emitBuffer = () => {
								const speaking = Math.floor(bufferIndex / 6) % 2 === 1;
								if (previousSpeaking && !speaking) {
									fixtureState.quietTransitions.push(performance.now());
								}
								previousSpeaking = speaking;
								listener?.({
									inputBuffer: {
										getChannelData: () => new Float32Array(1_024).fill(speaking ? 0.15 : 0),
										numberOfChannels: 1,
									},
								});
								bufferIndex += 1;
							};
							emitBuffer();
							interval = setInterval(emitBuffer, 64);
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

		const { palette, search } = await openCommandSearch(page);
		await search.click();
		await page.keyboard.type("open old");
		await page.keyboard.down("Shift");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.up("Shift");
		const microphone = palette.getByRole("button", { name: "Start dictation" });
		await expect(microphone).toBeVisible();
		await microphone.click();
		const stop = palette.getByRole("button", { name: "Stop dictation" });
		await expect(stop).toBeVisible();
		const waveform = palette.getByTestId("speech-recording-waveform");
		await expect(waveform).toBeVisible();
		const waveformObservation = await waveform.evaluate(async (element) => {
			const samples: Array<{ at: number; height: number }> = [];
			for (let sample = 0; sample < 40; sample += 1) {
				samples.push({
					at: performance.now(),
					height: element.getBoundingClientRect().height,
				});
				await new Promise((resolve) => setTimeout(resolve, 40));
			}
			const fixtureState = (
				globalThis as typeof globalThis & {
					__couchviewSpeechFixtureState?: { quietTransitions: number[] };
				}
			).__couchviewSpeechFixtureState;
			return { quietTransitions: fixtureState?.quietTransitions ?? [], samples };
		});
		const renderedSamples = waveformObservation.samples;
		const renderedHeights = renderedSamples.map(({ height }) => height);
		expect(Math.max(...renderedHeights) - Math.min(...renderedHeights)).toBeGreaterThan(14);
		const firstLoudIndex = renderedSamples.findIndex(({ height }) => height > 24);
		expect(firstLoudIndex).toBeGreaterThan(-1);
		const firstLoudAt = renderedSamples[firstLoudIndex]?.at ?? Number.NEGATIVE_INFINITY;
		const quietStartedAt = waveformObservation.quietTransitions.find(
			(timestamp) => timestamp > firstLoudAt,
		);
		expect(quietStartedAt).toBeDefined();
		const decayedSample = renderedSamples
			.slice(firstLoudIndex + 1)
			.find(({ at, height }) => at >= (quietStartedAt ?? Number.POSITIVE_INFINITY) && height < 12);
		expect(decayedSample).toBeDefined();
		expect(
			(decayedSample?.at ?? Number.POSITIVE_INFINITY) -
				(quietStartedAt ?? Number.NEGATIVE_INFINITY),
		).toBeLessThan(350);
		await stop.click();

		await expect(search).toHaveValue("open dictated phrase");
		const spinner = palette.getByTestId("speech-transcribing-spinner");
		await expect(spinner).toHaveCount(0);

		await palette.getByRole("button", { name: "Transcript inserted" }).click();
		await expect(palette.getByRole("button", { name: "Stop dictation" })).toBeVisible();
		await expect(waveform).toBeVisible();
		await expect(spinner).toHaveCount(0);
	});
});
