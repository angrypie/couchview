import { Blob } from "expo-blob";
import {
	createContext,
	type PropsWithChildren,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppState } from "react-native";

import type { SpeechCapability, SpeechTranscriptionResponse } from "../../../shared/contracts.ts";
import { api, type SpeechTranscriptionOptions } from "../../api.ts";
import { insertTranscript } from "./insertion.ts";
import { emitSpeechFeedback } from "./speechFeedback.ts";
import { transitionSpeechPhase } from "./stateMachine.ts";
import type {
	SpeechFeedbackEvent,
	SpeechLevelSource,
	SpeechPhase,
	SpeechRecordingAdapter,
	SpeechTarget,
} from "./types.ts";
import { usePcmRecorder } from "./usePcmRecorder";
import { useReducedMotion } from "./useReducedMotion.ts";
import { silentSpeechLevelSource } from "./voiceLevel.ts";
import { createPcmWav } from "./wav.ts";

type SpeechOutcome = "success" | "error" | null;

export interface SpeechController {
	available: boolean;
	error: string | null;
	outcome: SpeechOutcome;
	outcomeTargetId: string | null;
	phase: SpeechPhase;
	reducedMotion: boolean;
	recordingEndsAt: number | null;
	targetId: string | null;
	voiceLevel: SpeechLevelSource;
	cancel(): void;
	detachTarget(id: string): void;
	start(target: SpeechTarget): void;
	stop(target: SpeechTarget): void;
	toggle(target: SpeechTarget): void;
}

interface SpeechProviderProps extends PropsWithChildren {
	capability: SpeechCapability;
	connected?: boolean;
	csrfToken: string | null;
	emitFeedback?(event: SpeechFeedbackEvent): Promise<void>;
	recordingAdapter?: SpeechRecordingAdapter;
	transcribeSpeech?(
		body: BodyInit,
		csrfToken: string,
		options?: SpeechTranscriptionOptions,
	): Promise<SpeechTranscriptionResponse>;
}

const unavailableSpeechController: SpeechController = {
	available: false,
	cancel: () => undefined,
	detachTarget: () => undefined,
	error: null,
	outcome: null,
	outcomeTargetId: null,
	phase: "idle",
	reducedMotion: false,
	recordingEndsAt: null,
	start: () => undefined,
	stop: () => undefined,
	targetId: null,
	toggle: () => undefined,
	voiceLevel: silentSpeechLevelSource,
};

const SpeechContext = createContext<SpeechController>(unavailableSpeechController);

export function SpeechProvider({
	capability,
	children,
	connected = true,
	csrfToken,
	emitFeedback = emitSpeechFeedback,
	recordingAdapter,
	transcribeSpeech = api.transcribeSpeech,
}: SpeechProviderProps) {
	const platformRecorder = usePcmRecorder();
	const recorder = recordingAdapter ?? platformRecorder;
	const reducedMotion = useReducedMotion();
	const [phase, setPhase] = useState<SpeechPhase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<SpeechOutcome>(null);
	const [outcomeTargetId, setOutcomeTargetId] = useState<string | null>(null);
	const [targetId, setTargetId] = useState<string | null>(null);
	const [recordingEndsAt, setRecordingEndsAt] = useState<number | null>(null);
	const phaseRef = useRef<SpeechPhase>("idle");
	const targetRef = useRef<SpeechTarget | null>(null);
	const generationRef = useRef(0);
	const requestRef = useRef<AbortController | null>(null);
	const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const outcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const stopRef = useRef<() => Promise<void>>(async () => undefined);

	const move = useCallback((next: SpeechPhase) => {
		phaseRef.current = transitionSpeechPhase(phaseRef.current, next);
		setPhase(next);
	}, []);

	const clearRecordingTimer = useCallback(() => {
		if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
		recordingTimerRef.current = null;
	}, []);

	const showOutcome = useCallback((next: Exclude<SpeechOutcome, null>, id: string | null) => {
		if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
		setOutcome(next);
		setOutcomeTargetId(id);
		outcomeTimerRef.current = setTimeout(() => {
			setOutcome(null);
			setOutcomeTargetId(null);
			outcomeTimerRef.current = null;
		}, 2_000);
	}, []);

	const clearTarget = useCallback(() => {
		targetRef.current = null;
		setTargetId(null);
	}, []);

	const fail = useCallback(
		(caught: unknown, generation: number) => {
			if (generationRef.current !== generation) return;
			const failedTargetId = targetRef.current?.id ?? null;
			const message =
				caught instanceof Error ? caught.message : "Speech transcription could not be completed.";
			if (phaseRef.current !== "error") move("error");
			setError(message);
			clearTarget();
			showOutcome("error", failedTargetId);
			void emitFeedback("failed");
			if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
			errorTimerRef.current = setTimeout(() => {
				if (generationRef.current === generation && phaseRef.current === "error") move("idle");
				errorTimerRef.current = null;
			}, 1_500);
		},
		[clearTarget, emitFeedback, move, showOutcome],
	);

	const cancel = useCallback(() => {
		const wasRecording = phaseRef.current === "recording";
		generationRef.current += 1;
		clearRecordingTimer();
		setRecordingEndsAt(null);
		requestRef.current?.abort();
		requestRef.current = null;
		recorder.cancel();
		if (phaseRef.current !== "idle") move("idle");
		setError(null);
		clearTarget();
		if (wasRecording) void emitFeedback("stopped");
	}, [clearRecordingTimer, clearTarget, emitFeedback, move, recorder.cancel]);

	const stopRecording = useCallback(async () => {
		if (phaseRef.current !== "recording") return;
		const target = targetRef.current;
		if (!target || !csrfToken) {
			cancel();
			return;
		}
		const generation = generationRef.current;
		clearRecordingTimer();
		setRecordingEndsAt(null);
		try {
			const capture = await recorder.stop();
			if (generationRef.current !== generation) return;
			move("transcribing");
			void emitFeedback("stopped");
			const wav = createPcmWav(capture);
			if (wav.byteLength > capability.maxUploadBytes) {
				throw new Error("The recording is too large to transcribe.");
			}
			const controller = new AbortController();
			requestRef.current = controller;
			const blob = new Blob([wav], { type: "audio/wav" });
			const transcriptionOptions: SpeechTranscriptionOptions = { signal: controller.signal };
			if (target.language) transcriptionOptions.language = target.language;
			const result = await transcribeSpeech(
				blob as unknown as BodyInit,
				csrfToken,
				transcriptionOptions,
			);
			if (generationRef.current !== generation || targetRef.current?.id !== target.id) return;
			if (
				target.language &&
				result.language &&
				result.language.toLowerCase().split(/[-_]/, 1)[0] !== target.language.toLowerCase()
			) {
				const language = target.language.toLowerCase() === "en" ? "English" : target.language;
				const transcript = result.text.trim();
				throw new Error(
					`This voice input currently supports ${language} only.${
						transcript ? ` You said: “${transcript}”` : ""
					}`,
				);
			}
			const insertion = insertTranscript(
				target.getValue(),
				target.getSelection(),
				result.text,
				target.maxLength,
			);
			if (insertion.changed) {
				target.apply(insertion.value, insertion.selection);
				void emitFeedback("inserted");
				showOutcome("success", target.id);
			}
			requestRef.current = null;
			setError(null);
			clearTarget();
			move("idle");
		} catch (caught) {
			requestRef.current = null;
			fail(caught, generation);
		}
	}, [
		capability.maxUploadBytes,
		cancel,
		clearRecordingTimer,
		clearTarget,
		csrfToken,
		fail,
		move,
		recorder.stop,
		showOutcome,
		emitFeedback,
		transcribeSpeech,
	]);
	stopRef.current = stopRecording;

	const startRecording = useCallback(
		async (target: SpeechTarget) => {
			if (!capability.ready || !recorder.available || !csrfToken) return;
			const generation = generationRef.current + 1;
			generationRef.current = generation;
			targetRef.current = target;
			setTargetId(target.id);
			setError(null);
			setOutcome(null);
			setOutcomeTargetId(null);
			move("requestingPermission");
			try {
				await recorder.start();
				if (generationRef.current !== generation) {
					recorder.cancel();
					return;
				}
				move("recording");
				void emitFeedback("started");
				const recordingDuration = Math.min(
					target.maxDurationMs ?? capability.maxDurationMs,
					capability.maxDurationMs,
				);
				setRecordingEndsAt(Date.now() + recordingDuration);
				recordingTimerRef.current = setTimeout(() => void stopRef.current(), recordingDuration);
			} catch (caught) {
				recorder.cancel();
				fail(caught, generation);
			}
		},
		[
			capability.maxDurationMs,
			capability.ready,
			csrfToken,
			fail,
			emitFeedback,
			move,
			recorder.available,
			recorder.cancel,
			recorder.start,
		],
	);

	const toggle = useCallback(
		(target: SpeechTarget) => {
			if (phaseRef.current === "idle" || phaseRef.current === "error") void startRecording(target);
			else if (targetRef.current?.id === target.id) {
				if (phaseRef.current === "recording") void stopRecording();
				else cancel();
			}
		},
		[cancel, startRecording, stopRecording],
	);
	const start = useCallback(
		(target: SpeechTarget) => {
			if (phaseRef.current === "idle" || phaseRef.current === "error") void startRecording(target);
		},
		[startRecording],
	);
	const stop = useCallback(
		(target: SpeechTarget) => {
			if (targetRef.current?.id !== target.id) return;
			if (phaseRef.current === "recording") void stopRecording();
			else if (phaseRef.current === "requestingPermission") cancel();
		},
		[cancel, stopRecording],
	);

	const detachTarget = useCallback(
		(id: string) => {
			if (targetRef.current?.id === id) cancel();
		},
		[cancel],
	);

	useEffect(() => {
		if ((!capability.ready || !connected || !recorder.available) && phaseRef.current !== "idle") {
			cancel();
		}
	}, [capability.ready, cancel, connected, recorder.available]);

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active" && phaseRef.current !== "idle") cancel();
		});
		return () => subscription.remove();
	}, [cancel]);

	useEffect(
		() => () => {
			generationRef.current += 1;
			clearRecordingTimer();
			if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
			if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
			requestRef.current?.abort();
			recorder.cancel();
		},
		[clearRecordingTimer, recorder.cancel],
	);

	const value = useMemo<SpeechController>(
		() => ({
			available: capability.ready && connected && recorder.available && Boolean(csrfToken),
			cancel,
			detachTarget,
			error,
			outcome,
			outcomeTargetId,
			phase,
			reducedMotion,
			recordingEndsAt,
			start,
			stop,
			targetId,
			toggle,
			voiceLevel: recorder.level ?? silentSpeechLevelSource,
		}),
		[
			capability.ready,
			cancel,
			connected,
			csrfToken,
			detachTarget,
			error,
			outcome,
			outcomeTargetId,
			phase,
			recorder.available,
			recorder.level,
			reducedMotion,
			recordingEndsAt,
			start,
			stop,
			targetId,
			toggle,
		],
	);
	return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>;
}

export function useSpeech(): SpeechController {
	return useContext(SpeechContext);
}
