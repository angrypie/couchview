import type { SpeechCapability } from "../../shared/contracts.ts";

export const SPEECH_MODEL = "parakeet-tdt-0.6b-v3-int8";
export const SPEECH_MAX_DURATION_MS = 300_000;
export const SPEECH_MIN_DURATION_MS = 300;
export const SPEECH_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export interface SpeechTranscriberResult {
	text: string;
	language: string | null;
	inferenceMs: number;
}

export interface SpeechTranscriber {
	readonly model: string;
	readonly ready: boolean;
	transcribe(audioPath: string, signal?: AbortSignal): Promise<SpeechTranscriberResult>;
	close(): void;
}

export function disabledSpeechCapability(reason: string): SpeechCapability {
	return {
		enabled: false,
		ready: false,
		model: SPEECH_MODEL,
		maxDurationMs: SPEECH_MAX_DURATION_MS,
		maxUploadBytes: SPEECH_MAX_UPLOAD_BYTES,
		reason,
	};
}
