import { describe, expect, mock, test } from "bun:test";

import { insertTranscript } from "./insertion.ts";
import { transitionSpeechPhase } from "./stateMachine.ts";
import { createSpeechLevelSignal } from "./voiceLevel.ts";
import {
	analyzeFloatChannelsToPcm16,
	analyzeInterleavedPcm16,
	createPcmWav,
	downmixInterleavedPcm16,
	floatChannelsToPcm16,
	normalizeSpeechRms,
} from "./wav.ts";

mock.module("expo-haptics", () => ({
	AndroidHaptics: {
		Confirm: "confirm",
		Reject: "reject",
		Toggle_Off: "toggle-off",
		Toggle_On: "toggle-on",
	},
	ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
	NotificationFeedbackType: { Error: "error", Success: "success" },
}));

const { emitSpeechFeedback } = await import("./speechFeedback.ts");

describe("speech state and insertion", () => {
	test("accepts the recording lifecycle and rejects impossible transitions", () => {
		expect(transitionSpeechPhase("idle", "requestingPermission")).toBe("requestingPermission");
		expect(transitionSpeechPhase("requestingPermission", "recording")).toBe("recording");
		expect(transitionSpeechPhase("recording", "transcribing")).toBe("transcribing");
		expect(transitionSpeechPhase("transcribing", "idle")).toBe("idle");
		expect(() => transitionSpeechPhase("idle", "transcribing")).toThrow(
			"Invalid speech transition",
		);
	});

	test("replaces the selected text and returns the new caret", () => {
		expect(insertTranscript("hello old world", { start: 6, end: 9 }, "new")).toEqual({
			changed: true,
			selection: { start: 9, end: 9 },
			value: "hello new world",
		});
	});

	test("preserves surrounding text while respecting maxLength", () => {
		expect(insertTranscript("abXYef", { start: 2, end: 4 }, "12345", 7)).toEqual({
			changed: true,
			selection: { start: 5, end: 5 },
			value: "ab123ef",
		});
	});

	test("leaves the field unchanged for an empty transcript", () => {
		expect(insertTranscript("keep", { start: 2, end: 2 }, "  \n ")).toEqual({
			changed: false,
			selection: { start: 2, end: 2 },
			value: "keep",
		});
	});
});

describe("speech PCM encoding", () => {
	test("downmixes floating point and interleaved native samples to mono PCM16", () => {
		const floating = floatChannelsToPcm16([new Float32Array([1, -1]), new Float32Array([0, 0])]);
		const floatingView = new DataView(floating.buffer);
		expect(floatingView.getInt16(0, true)).toBe(16_383);
		expect(floatingView.getInt16(2, true)).toBe(-16_384);

		const stereo = new ArrayBuffer(8);
		const stereoView = new DataView(stereo);
		stereoView.setInt16(0, 10_000, true);
		stereoView.setInt16(2, 2_000, true);
		stereoView.setInt16(4, -4_000, true);
		stereoView.setInt16(6, 2_000, true);
		const mono = new DataView(downmixInterleavedPcm16(stereo, 2).buffer);
		expect(mono.getInt16(0, true)).toBe(6_000);
		expect(mono.getInt16(2, true)).toBe(-1_000);
	});

	test("constructs a canonical mono PCM WAV", () => {
		const wav = createPcmWav({
			chunks: [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
			sampleRate: 16_000,
		});
		const view = new DataView(wav.buffer);
		expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(16_000);
		expect(view.getUint16(34, true)).toBe(16);
		expect([...wav.slice(44)]).toEqual([1, 2, 3, 4]);
	});
});

describe("speech voice level", () => {
	test("derives a normalized level while encoding each PCM chunk once", () => {
		const floating = analyzeFloatChannelsToPcm16([new Float32Array(128).fill(0.1)]);
		expect(floating.bytes.byteLength).toBe(256);
		expect(floating.level).toBeGreaterThan(0.8);
		expect(normalizeSpeechRms(0)).toBe(0);
		expect(normalizeSpeechRms(1)).toBe(1);

		const nativeData = new ArrayBuffer(256);
		const nativeView = new DataView(nativeData);
		for (let offset = 0; offset < nativeData.byteLength; offset += 2) {
			nativeView.setInt16(offset, 3_277, true);
		}
		const native = analyzeInterleavedPcm16(nativeData, 1);
		expect(native.bytes.byteLength).toBe(nativeData.byteLength);
		expect(native.level).toBeGreaterThan(0.8);
	});

	test("smooths peak levels and caps listener work to about fifteen updates per second", () => {
		let now = 0;
		const signal = createSpeechLevelSignal({ minimumIntervalMs: 64, now: () => now });
		const updates: number[] = [];
		const unsubscribe = signal.subscribe((level) => updates.push(level));

		signal.push(0.8);
		now = 20;
		signal.push(1);
		now = 40;
		signal.push(0.2);
		now = 64;
		signal.push(0.1);

		expect(updates).toHaveLength(3);
		expect(updates[1]).toBeCloseTo(0.52);
		expect(updates[2]).toBeCloseTo(0.832);
		expect(signal.getCurrentLevel()).toBeCloseTo(0.832);

		signal.reset();
		expect(updates.at(-1)).toBe(0);
		unsubscribe();
		signal.push(1);
		expect(updates.at(-1)).toBe(0);
	});
});

describe("speech haptics", () => {
	test("uses Android semantic haptics for each successful transition", async () => {
		const calls: string[] = [];
		const haptics = {
			impactAsync: async (value: string) => void calls.push(`impact:${value}`),
			notificationAsync: async (value: string) => void calls.push(`notification:${value}`),
			performAndroidHapticsAsync: async (value: string) => void calls.push(`android:${value}`),
		};
		for (const event of ["started", "stopped", "inserted", "failed"] as const) {
			await emitSpeechFeedback(event, "android", haptics);
		}
		expect(calls).toEqual([
			"android:toggle-on",
			"android:toggle-off",
			"android:confirm",
			"android:reject",
		]);
	});

	test("uses impacts and notifications elsewhere and swallows failures", async () => {
		const calls: string[] = [];
		const haptics = {
			impactAsync: async (value: string) => void calls.push(`impact:${value}`),
			notificationAsync: async (value: string) => void calls.push(`notification:${value}`),
			performAndroidHapticsAsync: async () => undefined,
		};
		await emitSpeechFeedback("started", "ios", haptics);
		await emitSpeechFeedback("stopped", "web", haptics);
		await emitSpeechFeedback("inserted", "ios", haptics);
		await emitSpeechFeedback("failed", "web", haptics);
		expect(calls).toEqual([
			"impact:light",
			"impact:medium",
			"notification:success",
			"notification:error",
		]);
		await expect(
			emitSpeechFeedback("started", "ios", {
				...haptics,
				impactAsync: async () => {
					throw new Error("unavailable");
				},
			}),
		).resolves.toBeUndefined();
	});
});
