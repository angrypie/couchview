import type { PcmCapture } from "./types.ts";

const WAV_HEADER_BYTES = 44;
const SPEECH_NOISE_FLOOR_DB = -54;
const SPEECH_LOUD_LEVEL_DB = -12;

export interface PcmChunkAnalysis {
	bytes: Uint8Array;
	level: number;
}

function writeAscii(view: DataView, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		view.setUint8(offset + index, value.charCodeAt(index));
	}
}

export function createPcmWav(capture: PcmCapture): Uint8Array {
	const byteLength = capture.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(WAV_HEADER_BYTES + byteLength);
	const view = new DataView(bytes.buffer);
	writeAscii(view, 0, "RIFF");
	view.setUint32(4, bytes.byteLength - 8, true);
	writeAscii(view, 8, "WAVE");
	writeAscii(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, capture.sampleRate, true);
	view.setUint32(28, capture.sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(view, 36, "data");
	view.setUint32(40, byteLength, true);
	let offset = WAV_HEADER_BYTES;
	for (const chunk of capture.chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export function normalizeSpeechRms(rms: number): number {
	if (!Number.isFinite(rms) || rms <= 0) return 0;
	const decibels = 20 * Math.log10(rms);
	return Math.max(
		0,
		Math.min(
			1,
			(decibels - SPEECH_NOISE_FLOOR_DB) / (SPEECH_LOUD_LEVEL_DB - SPEECH_NOISE_FLOOR_DB),
		),
	);
}

export function analyzeFloatChannelsToPcm16(channels: readonly Float32Array[]): PcmChunkAnalysis {
	const frameCount = channels[0]?.length ?? 0;
	const bytes = new Uint8Array(frameCount * 2);
	const view = new DataView(bytes.buffer);
	let squareSum = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		let sample = 0;
		for (const channel of channels) sample += channel[frame] ?? 0;
		sample = Math.max(-1, Math.min(1, sample / Math.max(channels.length, 1)));
		squareSum += sample * sample;
		view.setInt16(frame * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
	}
	const rms = frameCount === 0 ? 0 : Math.sqrt(squareSum / frameCount);
	return { bytes, level: normalizeSpeechRms(rms) };
}

export function floatChannelsToPcm16(channels: readonly Float32Array[]): Uint8Array {
	return analyzeFloatChannelsToPcm16(channels).bytes;
}

export function analyzeInterleavedPcm16(data: ArrayBuffer, channels: number): PcmChunkAnalysis {
	const channelCount = Math.max(1, Math.floor(channels));
	const source = new DataView(data);
	const frameCount = Math.floor(data.byteLength / (channelCount * 2));
	const bytes = new Uint8Array(frameCount * 2);
	const output = new DataView(bytes.buffer);
	let squareSum = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		let sample = 0;
		for (let channel = 0; channel < channelCount; channel += 1) {
			sample += source.getInt16((frame * channelCount + channel) * 2, true);
		}
		const monoSample = Math.round(sample / channelCount);
		squareSum += (monoSample / 0x8000) ** 2;
		output.setInt16(frame * 2, monoSample, true);
	}
	const rms = frameCount === 0 ? 0 : Math.sqrt(squareSum / frameCount);
	return { bytes, level: normalizeSpeechRms(rms) };
}

export function downmixInterleavedPcm16(data: ArrayBuffer, channels: number): Uint8Array {
	return analyzeInterleavedPcm16(data, channels).bytes;
}
