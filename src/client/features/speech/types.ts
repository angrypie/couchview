export type SpeechPhase = "idle" | "requestingPermission" | "recording" | "transcribing" | "error";

export interface PcmCapture {
	chunks: Uint8Array[];
	sampleRate: number;
}

export type SpeechLevelListener = (level: number) => void;

export interface SpeechLevelSource {
	getCurrentLevel(): number;
	subscribe(listener: SpeechLevelListener): () => void;
}

export interface SpeechRecordingAdapter {
	available: boolean;
	level?: SpeechLevelSource;
	start(): Promise<void>;
	stop(): Promise<PcmCapture>;
	cancel(): void;
}

export interface SpeechTarget {
	id: string;
	maxLength?: number;
	getSelection(): { start: number; end: number };
	getValue(): string;
	apply(value: string, selection: { start: number; end: number }): void;
}

export type SpeechFeedbackEvent = "started" | "stopped" | "inserted" | "failed";
