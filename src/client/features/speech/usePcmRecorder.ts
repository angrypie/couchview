import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PcmCapture, SpeechRecordingAdapter } from "./types.ts";
import { createSpeechLevelSignal } from "./voiceLevel.ts";
import { analyzeFloatChannelsToPcm16 } from "./wav.ts";

interface ActiveWebCapture {
	context: AudioContext;
	processor: ScriptProcessorNode;
	source: MediaStreamAudioSourceNode;
	stream: MediaStream;
}

function stopCapture(capture: ActiveWebCapture | null): void {
	if (!capture) return;
	capture.processor.disconnect();
	capture.source.disconnect();
	for (const track of capture.stream.getTracks()) track.stop();
	void capture.context.close().catch(() => undefined);
}

export function usePcmRecorder(): SpeechRecordingAdapter {
	const activeRef = useRef<ActiveWebCapture | null>(null);
	const chunksRef = useRef<Uint8Array[]>([]);
	const sampleRateRef = useRef(16_000);
	const [available, setAvailable] = useState(false);
	const level = useMemo(createSpeechLevelSignal, []);

	useEffect(() => {
		setAvailable(
			globalThis.isSecureContext === true &&
				typeof navigator !== "undefined" &&
				typeof navigator.mediaDevices?.getUserMedia === "function",
		);
		return () => {
			stopCapture(activeRef.current);
			level.reset();
		};
	}, [level]);

	const start = useCallback(async () => {
		if (activeRef.current) throw new Error("A microphone recording is already active.");
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				autoGainControl: true,
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
				sampleRate: 16_000,
			},
			video: false,
		});
		try {
			const context = new AudioContext({ sampleRate: 16_000 });
			const source = context.createMediaStreamSource(stream);
			const processor = context.createScriptProcessor(2048, source.channelCount, 1);
			chunksRef.current = [];
			sampleRateRef.current = context.sampleRate;
			level.reset();
			processor.onaudioprocess = (event) => {
				const channels = Array.from({ length: event.inputBuffer.numberOfChannels }, (_, index) =>
					event.inputBuffer.getChannelData(index),
				);
				const analyzed = analyzeFloatChannelsToPcm16(channels);
				chunksRef.current.push(analyzed.bytes);
				level.push(analyzed.level);
			};
			source.connect(processor);
			processor.connect(context.destination);
			activeRef.current = { context, processor, source, stream };
			await context.resume();
		} catch (error) {
			for (const track of stream.getTracks()) track.stop();
			throw error;
		}
	}, [level]);

	const stop = useCallback(async (): Promise<PcmCapture> => {
		if (!activeRef.current) throw new Error("No microphone recording is active.");
		const capture = activeRef.current;
		activeRef.current = null;
		stopCapture(capture);
		level.reset();
		const chunks = chunksRef.current;
		chunksRef.current = [];
		return { chunks, sampleRate: sampleRateRef.current };
	}, [level]);

	const cancel = useCallback(() => {
		const capture = activeRef.current;
		activeRef.current = null;
		chunksRef.current = [];
		stopCapture(capture);
		level.reset();
	}, [level]);

	return useMemo(
		() => ({ available, cancel, level, start, stop }),
		[available, cancel, level, start, stop],
	);
}
