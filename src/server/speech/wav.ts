import { HttpError } from "../errors.ts";
import { SPEECH_MAX_DURATION_MS, SPEECH_MIN_DURATION_MS } from "./types.ts";

export interface WavInfo {
	sampleRate: number;
	dataBytes: number;
	durationMs: number;
}

interface WavFormat {
	audioFormat: number;
	channels: number;
	sampleRate: number;
	byteRate: number;
	blockAlign: number;
	bitsPerSample: number;
}

function ascii(view: DataView, offset: number, length: number): string {
	let result = "";
	for (let index = 0; index < length; index += 1) {
		result += String.fromCharCode(view.getUint8(offset + index));
	}
	return result;
}

function invalidAudio(message: string): never {
	throw new HttpError(400, "speech_audio_invalid", message);
}

export function validatePcmWav(bytes: Uint8Array): WavInfo {
	if (bytes.byteLength < 44) invalidAudio("The WAV upload is incomplete.");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
		invalidAudio("The upload must be a RIFF WAVE file.");
	}
	const declaredSize = view.getUint32(4, true) + 8;
	if (declaredSize > bytes.byteLength || declaredSize < 44) {
		invalidAudio("The WAV file size header is invalid.");
	}

	let format: WavFormat | null = null;
	let dataBytes: number | null = null;
	let offset = 12;
	while (offset + 8 <= declaredSize) {
		const chunkId = ascii(view, offset, 4);
		const chunkSize = view.getUint32(offset + 4, true);
		const chunkStart = offset + 8;
		const chunkEnd = chunkStart + chunkSize;
		if (chunkEnd > declaredSize) invalidAudio("A WAV chunk extends beyond the upload.");
		if (chunkId === "fmt " && format === null) {
			if (chunkSize < 16) invalidAudio("The WAV format chunk is incomplete.");
			format = {
				audioFormat: view.getUint16(chunkStart, true),
				channels: view.getUint16(chunkStart + 2, true),
				sampleRate: view.getUint32(chunkStart + 4, true),
				byteRate: view.getUint32(chunkStart + 8, true),
				blockAlign: view.getUint16(chunkStart + 12, true),
				bitsPerSample: view.getUint16(chunkStart + 14, true),
			};
		} else if (chunkId === "data" && dataBytes === null) {
			dataBytes = chunkSize;
		}
		offset = chunkEnd + (chunkSize % 2);
	}

	if (!format || dataBytes === null) invalidAudio("The WAV format or audio data chunk is missing.");
	if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
		invalidAudio("Speech audio must use mono 16-bit PCM.");
	}
	if (format.sampleRate < 8_000 || format.sampleRate > 48_000) {
		invalidAudio("Speech audio must use a sample rate between 8 kHz and 48 kHz.");
	}
	if (
		format.blockAlign !== 2 ||
		format.byteRate !== format.sampleRate * format.blockAlign ||
		dataBytes % format.blockAlign !== 0
	) {
		invalidAudio("The WAV byte layout does not match its PCM format.");
	}
	const durationMs = Math.round((dataBytes / format.byteRate) * 1_000);
	if (durationMs < SPEECH_MIN_DURATION_MS) {
		throw new HttpError(
			400,
			"speech_audio_too_short",
			"Record at least 300 milliseconds of speech.",
		);
	}
	if (durationMs > SPEECH_MAX_DURATION_MS) {
		throw new HttpError(
			413,
			"speech_audio_too_long",
			"Speech recordings are limited to five minutes.",
		);
	}
	return { sampleRate: format.sampleRate, dataBytes, durationMs };
}
