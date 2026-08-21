import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";

import type { SpeechRecordingAdapter } from "../../features/speech/types.ts";

const { act, cleanup, fireEvent, render, screen, waitFor } = await import(
	"../../appTestEnvironment.tsx"
);
const { SpeechProvider } = await import("../../features/speech/index.ts");
const { SpeechInput, speechButtonClassNames, speechIconClassName, speechSpinnerClassName } =
	await import("./SpeechInput.tsx");
const { speechRecordingWaveformClassName, speechRecordingWaveformStyle } = await import(
	"./SpeechRecordingLevelIndicator.tsx"
);

afterEach(cleanup);

const capability = {
	enabled: true,
	ready: true,
	model: "parakeet-tdt-0.6b-v3-int8",
	maxDurationMs: 300_000,
	maxUploadBytes: 32 * 1024 * 1024,
	reason: null,
};

describe("SpeechInput", () => {
	test("maps exact animation classes and removes recurring motion when requested", () => {
		expect(speechButtonClassNames.idle).toContain(
			"active:scale-95 transition-transform duration-100",
		);
		expect(speechButtonClassNames.recording).toContain("bg-destructive/15");
		expect(speechIconClassName(false)).not.toContain("animate-spin");
		expect(speechIconClassName(false)).toContain("uw-entering-fade-in");
		expect(speechIconClassName(false)).not.toContain("uw-exiting");
		expect(speechIconClassName(true)).not.toContain("uw-entering");
		expect(speechSpinnerClassName(false)).toContain("animate-spin");
		expect(speechSpinnerClassName(false)).not.toContain("uw-exiting");
		expect(speechSpinnerClassName(true)).not.toContain("animate-spin");
		expect(speechRecordingWaveformClassName).not.toContain("animate-pulse");
		expect(speechRecordingWaveformClassName).toContain("h-6 w-7");
		expect(speechRecordingWaveformStyle(0)).toEqual({
			opacity: 0.45,
			transform: [{ scaleY: 0.2 }],
		});
		const loudStyle = speechRecordingWaveformStyle(1);
		expect(Number(loudStyle.opacity)).toBeCloseTo(1);
		expect(loudStyle.transform).toEqual([{ scaleY: 1.55 }]);
		expect(speechRecordingWaveformStyle(1, true)).toEqual({
			opacity: 0.75,
			transform: [{ scaleY: 0.65 }],
		});
	});

	test("unmounts the spinner before completion and the next recording", async () => {
		const adapter: SpeechRecordingAdapter = {
			available: true,
			cancel: () => undefined,
			start: async () => undefined,
			stop: async () => ({ chunks: [new Uint8Array(9_600)], sampleRate: 16_000 }),
		};
		let resolveTranscript:
			| ((response: {
					durationMs: number;
					inferenceMs: number;
					language: string;
					text: string;
			  }) => void)
			| null = null;
		const transcript = new Promise<{
			durationMs: number;
			inferenceMs: number;
			language: string;
			text: string;
		}>((resolve) => {
			resolveTranscript = resolve;
		});
		function Harness() {
			const [value, setValue] = useState("");
			return <SpeechInput onChangeText={setValue} value={value} />;
		}
		render(
			<SpeechProvider
				capability={capability}
				csrfToken="csrf"
				emitFeedback={async () => undefined}
				recordingAdapter={adapter}
				transcribeSpeech={() => transcript}
			>
				<Harness />
			</SpeechProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
		fireEvent.click(await screen.findByRole("button", { name: "Stop dictation" }));
		expect(await screen.findByTestId("speech-transcribing-spinner")).toBeTruthy();

		await act(async () => {
			resolveTranscript?.({
				durationMs: 300,
				inferenceMs: 4,
				language: "en",
				text: "first",
			});
			await transcript;
		});
		const completed = await screen.findByRole("button", { name: "Transcript inserted" });
		expect(screen.queryByTestId("speech-transcribing-spinner")).toBeNull();

		fireEvent.click(completed);
		await screen.findByRole("button", { name: "Stop dictation" });
		expect(screen.getByTestId("speech-recording-waveform")).toBeTruthy();
		expect(screen.queryByTestId("speech-transcribing-spinner")).toBeNull();
	});

	test("hides the mic when unavailable or explicitly opted out", async () => {
		const unavailable = { ...capability, ready: false, reason: "not ready" };
		const view = render(
			<SpeechProvider capability={unavailable} csrfToken="csrf">
				<SpeechInput onChangeText={() => undefined} value="" />
			</SpeechProvider>,
		);
		expect(screen.queryByRole("button", { name: "Start dictation" })).toBeNull();

		view.rerender(
			<SpeechProvider capability={capability} csrfToken="csrf">
				<SpeechInput onChangeText={() => undefined} speechEnabled={false} value="" />
			</SpeechProvider>,
		);
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Start dictation" })).toBeNull();
		});
	});

	test("announces successful insertion through the shared control", async () => {
		const adapter: SpeechRecordingAdapter = {
			available: true,
			cancel: () => undefined,
			start: async () => undefined,
			stop: async () => ({ chunks: [new Uint8Array(9_600)], sampleRate: 16_000 }),
		};
		function Harness() {
			const [value, setValue] = useState("before ");
			return <SpeechInput onChangeText={setValue} value={value} />;
		}
		render(
			<SpeechProvider
				capability={capability}
				csrfToken="csrf"
				emitFeedback={async () => undefined}
				recordingAdapter={adapter}
				transcribeSpeech={async () => ({
					durationMs: 300,
					inferenceMs: 4,
					language: "en",
					text: "dictated",
				})}
			>
				<Harness />
			</SpeechProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
		const stop = await screen.findByRole("button", { name: "Stop dictation" });
		expect(screen.getByTestId("speech-recording-waveform")).toBeTruthy();
		fireEvent.click(stop);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Transcript inserted" })).toBeTruthy();
		});
		expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("before dictated");
	});
});
