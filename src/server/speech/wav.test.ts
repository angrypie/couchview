import { describe, expect, test } from "bun:test";

import { HttpError } from "../errors.ts";
import { validatePcmWav } from "./wav.ts";
import { pcmWav } from "./wavTestFixture.ts";

describe("validatePcmWav", () => {
	test("accepts canonical mono PCM between 8 and 48 kHz", () => {
		expect(validatePcmWav(pcmWav(500, 8_000))).toEqual({
			dataBytes: 8_000,
			durationMs: 500,
			sampleRate: 8_000,
		});
		expect(validatePcmWav(pcmWav(500, 48_000)).sampleRate).toBe(48_000);
	});

	test("rejects malformed, short, and long recordings with structured codes", () => {
		for (const [bytes, code] of [
			[new Uint8Array(44), "speech_audio_invalid"],
			[pcmWav(299), "speech_audio_too_short"],
			[pcmWav(300_001, 8_000), "speech_audio_too_long"],
		] as const) {
			try {
				validatePcmWav(bytes);
				throw new Error("Expected WAV validation to fail");
			} catch (error) {
				expect(error).toBeInstanceOf(HttpError);
				expect((error as HttpError).code).toBe(code);
			}
		}
	});

	test("rejects stereo and non-PCM layouts", () => {
		const stereo = pcmWav();
		new DataView(stereo.buffer).setUint16(22, 2, true);
		expect(() => validatePcmWav(stereo)).toThrow("mono 16-bit PCM");
	});
});
