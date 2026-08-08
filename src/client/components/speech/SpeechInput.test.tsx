import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";

import type { SpeechRecordingAdapter } from "../../features/speech/types.ts";

const { cleanup, fireEvent, render, screen, waitFor } = await import(
	"../../appTestEnvironment.tsx"
);
const { SpeechProvider } = await import("../../features/speech/index.ts");
const { SpeechInput, speechButtonClassNames, speechIconClassName } = await import(
	"./SpeechInput.tsx"
);
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
		expect(speechButtonClassNames.recording).toContain("bg-destructive/10");
		expect(speechIconClassName("transcribing", false)).toContain("animate-spin");
		expect(speechIconClassName("recording", false)).toContain("uw-entering-fade-in");
		expect(speechIconClassName("transcribing", true)).not.toContain("animate-spin");
		expect(speechIconClassName("recording", true)).not.toContain("uw-entering");
		expect(speechRecordingWaveformClassName).not.toContain("animate-pulse");
		expect(speechRecordingWaveformStyle(0)).toEqual({
			opacity: 0.3,
			transform: [{ scaleY: 0.25 }],
		});
		const loudStyle = speechRecordingWaveformStyle(1);
		expect(Number(loudStyle.opacity)).toBeCloseTo(0.95);
		expect(loudStyle.transform).toEqual([{ scaleY: 1 }]);
		expect(speechRecordingWaveformStyle(1, true)).toEqual({
			opacity: 0.55,
			transform: [{ scaleY: 0.55 }],
		});
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
