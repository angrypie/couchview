import { requestRecordingPermissionsAsync, useAudioStream } from "expo-audio";
import { useCallback, useMemo, useRef } from "react";

import type { PcmCapture, SpeechRecordingAdapter } from "./types.ts";
import { createSpeechLevelSignal } from "./voiceLevel.ts";
import { analyzeInterleavedPcm16 } from "./wav.ts";

export function usePcmRecorder(): SpeechRecordingAdapter {
	const chunksRef = useRef<Uint8Array[]>([]);
	const recordingRef = useRef(false);
	const sampleRateRef = useRef(16_000);
	const level = useMemo(createSpeechLevelSignal, []);
	const { stream } = useAudioStream({
		channels: 1,
		encoding: "int16",
		onBuffer(buffer) {
			if (!recordingRef.current) return;
			sampleRateRef.current = buffer.sampleRate;
			const analyzed = analyzeInterleavedPcm16(buffer.data, buffer.channels);
			chunksRef.current.push(analyzed.bytes);
			level.push(analyzed.level);
		},
		sampleRate: 16_000,
	});

	const start = useCallback(async () => {
		if (recordingRef.current) throw new Error("A microphone recording is already active.");
		const permission = await requestRecordingPermissionsAsync();
		if (!permission.granted) throw new Error("Microphone permission was not granted.");
		chunksRef.current = [];
		level.reset();
		recordingRef.current = true;
		try {
			await stream.start();
			sampleRateRef.current = stream.sampleRate || 16_000;
		} catch (error) {
			recordingRef.current = false;
			level.reset();
			throw error;
		}
	}, [level, stream]);

	const stop = useCallback(async (): Promise<PcmCapture> => {
		if (!recordingRef.current) throw new Error("No microphone recording is active.");
		stream.stop();
		recordingRef.current = false;
		level.reset();
		const chunks = chunksRef.current;
		chunksRef.current = [];
		return { chunks, sampleRate: sampleRateRef.current };
	}, [level, stream]);

	const cancel = useCallback(() => {
		if (recordingRef.current) stream.stop();
		recordingRef.current = false;
		chunksRef.current = [];
		level.reset();
	}, [level, stream]);

	return useMemo(
		() => ({ available: true, cancel, level, start, stop }),
		[cancel, level, start, stop],
	);
}
