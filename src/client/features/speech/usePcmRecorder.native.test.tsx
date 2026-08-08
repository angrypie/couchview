import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { SpeechRecordingAdapter } from "./types.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

let audioModeCalls = 0;
let streamStartCalls = 0;
let onAudioBuffer:
	| ((buffer: { channels: number; data: ArrayBuffer; sampleRate: number }) => void)
	| null = null;

mock.module("expo-audio", () => ({
	requestRecordingPermissionsAsync: async () => ({ granted: true }),
	setAudioModeAsync: async () => {
		audioModeCalls += 1;
		throw new Error("AudioStream must manage its own native audio session.");
	},
	useAudioStream: (options: { onBuffer(buffer: unknown): void }) => {
		onAudioBuffer = options.onBuffer as typeof onAudioBuffer;
		return {
			stream: {
				sampleRate: 16_000,
				start: async () => {
					streamStartCalls += 1;
				},
				stop: () => undefined,
			},
		};
	},
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { usePcmRecorder } = await import("./usePcmRecorder.native.ts");

let recorder: SpeechRecordingAdapter | null = null;

function RecorderHarness() {
	recorder = usePcmRecorder();
	return null;
}

function currentRecorder(): SpeechRecordingAdapter {
	if (!recorder) throw new Error("The recorder harness has not rendered.");
	return recorder;
}

beforeEach(() => {
	audioModeCalls = 0;
	onAudioBuffer = null;
	streamStartCalls = 0;
});

afterEach(() => {
	cleanup();
	recorder = null;
});

describe("native PCM recorder", () => {
	test("lets Expo AudioStream manage the native recording session", async () => {
		render(<RecorderHarness />);

		await act(async () => currentRecorder().start());

		expect(audioModeCalls).toBe(0);
		expect(streamStartCalls).toBe(1);
	});

	test("publishes analyzed native PCM levels and resets them on stop", async () => {
		render(<RecorderHarness />);
		const levels: number[] = [];
		const unsubscribe = currentRecorder().level?.subscribe((level) => levels.push(level));
		await act(async () => currentRecorder().start());

		const data = new ArrayBuffer(320);
		const view = new DataView(data);
		for (let offset = 0; offset < data.byteLength; offset += 2) {
			view.setInt16(offset, 3_277, true);
		}
		onAudioBuffer?.({ channels: 1, data, sampleRate: 16_000 });

		expect(levels.at(-1)).toBeGreaterThan(0.5);
		await act(async () => currentRecorder().stop());
		expect(levels.at(-1)).toBe(0);
		unsubscribe?.();
	});
});
