import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
	FileChange,
	ResolvedVoiceCommand,
	VoiceCommandCapability,
} from "../../../shared/contracts.ts";
import type { CommandId } from "../../../shared/settings.ts";
import {
	VOICE_ACTION_DEFINITIONS,
	VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE,
	VOICE_COMMAND_MAX_RECORDING_MS,
} from "../../../shared/voiceCommands.ts";
import { api } from "../../api.ts";
import type { RuntimeCommand } from "../../commands.ts";
import { messageOf } from "../../lib/failures.ts";
import { type SpeechTarget, useSpeech } from "../speech/index.ts";
import { useVoiceRecordingControls } from "./useVoiceRecordingControls.ts";
import { voiceCommandDisposition } from "./voiceCommandDecision.ts";
import {
	applyVoiceUndo,
	contextMatches,
	executeVoiceActions,
	hasVoiceConfirmationContextChanged,
	type UndoPlan,
	type VoiceContext,
} from "./voiceCommandExecution.ts";

const VOICE_TARGET_ID = "voice-commands";
const RESULT_DURATION_MS = 10_000;

interface VoiceConfirmation {
	commands: ResolvedVoiceCommand[];
	confidence: number;
	context: VoiceContext;
	lowConfidence: boolean;
	reasoning: string | null;
	transcript: string;
}

export interface VoiceCommandResult {
	message: string;
	status: "success" | "error";
	undoAvailable: boolean;
}

export interface UseVoiceCommandsOptions {
	active: boolean;
	activeFile: FileChange | null;
	capability: VoiceCommandCapability;
	commands: Record<CommandId, RuntimeCommand>;
	csrfToken: string | null;
	enabled: boolean;
	getOperationRevision(): string;
	getReviewRevision(): number;
	getRepositoryId(): string | null;
	onCapability(capability: VoiceCommandCapability): void;
	openPaletteWithQuery(query: string): void;
	refreshChanges(): Promise<unknown>;
	refreshReviews(): Promise<unknown>;
}

export function useVoiceCommands(options: UseVoiceCommandsOptions) {
	const speech = useSpeech();
	const [capability, setCapability] = useState(options.capability);
	const [confirmation, setConfirmation] = useState<VoiceConfirmation | null>(null);
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
	const [resolving, setResolving] = useState(false);
	const [result, setResult] = useState<VoiceCommandResult | null>(null);
	const [undoPlan, setUndoPlan] = useState<UndoPlan | null>(null);
	const contextRef = useRef<VoiceContext | null>(null);
	const requestRef = useRef<AbortController | null>(null);
	const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latestRef = useRef(options);
	latestRef.current = options;

	useEffect(() => setCapability(options.capability), [options.capability]);
	useEffect(() => {
		if (!capability.enabled || capability.state !== "installing") return;
		let cancelled = false;
		const poll = async () => {
			try {
				const bootstrap = await api.bootstrap();
				if (cancelled) return;
				setCapability(bootstrap.voiceCommands);
				latestRef.current.onCapability(bootstrap.voiceCommands);
			} catch {
				// The regular connection UI owns host reachability failures.
			}
		};
		const timer = setInterval(() => void poll(), 1_500);
		void poll();
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [capability.enabled, capability.state]);

	const currentContext = useCallback((): VoiceContext => {
		const current = latestRef.current;
		return {
			repositoryId: current.getRepositoryId(),
			operationRevision: current.getOperationRevision(),
			reviewRevision: current.getReviewRevision(),
			file: current.activeFile,
		};
	}, []);

	const showResult = useCallback((next: VoiceCommandResult, undo: UndoPlan | null = null) => {
		if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
		setResult(next);
		setUndoPlan(undo);
		resultTimerRef.current = setTimeout(() => {
			setResult(null);
			setUndoPlan(null);
			resultTimerRef.current = null;
		}, RESULT_DURATION_MS);
	}, []);

	useEffect(() => {
		if (speech.outcome === "error" && speech.outcomeTargetId === VOICE_TARGET_ID && speech.error) {
			showResult({ message: speech.error, status: "error", undoAvailable: false });
		}
	}, [showResult, speech.error, speech.outcome, speech.outcomeTargetId]);

	const renderedContext: VoiceContext = {
		repositoryId: options.getRepositoryId(),
		operationRevision: options.getOperationRevision(),
		reviewRevision: options.getReviewRevision(),
		file: options.activeFile,
	};
	useEffect(() => {
		if (
			!confirmation ||
			!hasVoiceConfirmationContextChanged(
				confirmation.commands,
				confirmation.context,
				renderedContext,
			)
		) {
			return;
		}
		setConfirmation(null);
		showResult({
			message: "The repository or current file changed. Say the command again.",
			status: "error",
			undoAvailable: false,
		});
	}, [
		confirmation,
		renderedContext.file,
		renderedContext.operationRevision,
		renderedContext.repositoryId,
		renderedContext.reviewRevision,
		showResult,
	]);

	const execute = useCallback(
		async (resolved: ResolvedVoiceCommand[], context: VoiceContext) => {
			const current = latestRef.current;
			const contextual = resolved.some(
				(command) => VOICE_ACTION_DEFINITIONS[command.actionId].contextual,
			);
			if (contextual && !contextMatches(currentContext(), context)) {
				showResult({
					message: "The repository or current file changed. Say the command again.",
					status: "error",
					undoAvailable: false,
				});
				return;
			}
			try {
				const execution = await executeVoiceActions(resolved, context, current);
				showResult(
					{
						message: execution.message,
						status: "success",
						undoAvailable: Boolean(execution.undo),
					},
					execution.undo,
				);
			} catch (error) {
				await Promise.allSettled([current.refreshChanges(), current.refreshReviews()]);
				showResult({ message: messageOf(error), status: "error", undoAvailable: false });
			}
		},
		[currentContext, showResult],
	);

	const handleTranscript = useCallback(
		async (transcript: string) => {
			const context = contextRef.current ?? currentContext();
			const csrfToken = latestRef.current.csrfToken;
			if (!csrfToken) return;
			const controller = new AbortController();
			requestRef.current = controller;
			setResolving(true);
			try {
				const response = await api.resolveVoiceCommands(
					{ transcript },
					csrfToken,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				const disposition = voiceCommandDisposition(response.commands, response.confidence);
				if (disposition === "no-match") {
					latestRef.current.openPaletteWithQuery(transcript);
					showResult({
						message: "No reliable voice command found. Review the transcript in Commands.",
						status: "error",
						undoAvailable: false,
					});
					return;
				}
				if (disposition === "confirm") {
					setConfirmation({
						commands: response.commands,
						confidence: response.confidence,
						context,
						lowConfidence: response.confidence < VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE,
						reasoning: response.reasoning,
						transcript,
					});
					return;
				}
				await execute(response.commands, context);
			} catch (error) {
				if (!controller.signal.aborted) {
					showResult({ message: messageOf(error), status: "error", undoAvailable: false });
				}
			} finally {
				if (requestRef.current === controller) requestRef.current = null;
				setResolving(false);
			}
		},
		[currentContext, execute, showResult],
	);
	const transcriptHandlerRef = useRef(handleTranscript);
	transcriptHandlerRef.current = handleTranscript;

	const target = useMemo<SpeechTarget>(
		() => ({
			id: VOICE_TARGET_ID,
			language: "en",
			maxDurationMs: VOICE_COMMAND_MAX_RECORDING_MS,
			maxLength: 2_000,
			getSelection: () => ({ start: 0, end: 0 }),
			getValue: () => "",
			apply: (value) => void transcriptHandlerRef.current(value),
		}),
		[],
	);

	const cancel = useCallback(() => {
		requestRef.current?.abort();
		requestRef.current = null;
		setResolving(false);
		speech.cancel();
	}, [speech]);
	const captureContext = useCallback(() => {
		contextRef.current = currentContext();
	}, [currentContext]);
	const openDiagnostics = useCallback(() => setDiagnosticsOpen(true), []);
	const { toggle } = useVoiceRecordingControls({
		active: options.active,
		available: capability.ready && speech.available,
		cancel,
		captureContext,
		enabled: options.enabled,
		openDiagnostics,
		resolving,
		speech,
		target,
	});

	useEffect(() => {
		if (options.enabled && options.active) return;
		if (resolving || speech.targetId === VOICE_TARGET_ID) cancel();
		setConfirmation(null);
		setDiagnosticsOpen(false);
	}, [cancel, options.active, options.enabled, resolving, speech.targetId]);

	const confirm = useCallback(() => {
		if (!confirmation) return;
		const pending = confirmation;
		setConfirmation(null);
		void execute(pending.commands, pending.context);
	}, [confirmation, execute]);

	const undo = useCallback(async () => {
		const plan = undoPlan;
		const current = latestRef.current;
		if (!plan || !current.csrfToken) return;
		if (
			current.getRepositoryId() !== plan.repositoryId ||
			current.getOperationRevision() !== plan.operationRevision ||
			(plan.reviewRevision !== null && current.getReviewRevision() !== plan.reviewRevision)
		) {
			showResult({
				message: "Undo was not applied because the repository changed. The view was refreshed.",
				status: "error",
				undoAvailable: false,
			});
			await Promise.allSettled([current.refreshChanges(), current.refreshReviews()]);
			return;
		}
		try {
			await applyVoiceUndo(plan, current);
			showResult({ message: "Voice command undone", status: "success", undoAvailable: false });
		} catch (error) {
			await Promise.allSettled([current.refreshChanges(), current.refreshReviews()]);
			showResult({ message: messageOf(error), status: "error", undoAvailable: false });
		}
	}, [showResult, undoPlan]);

	const retry = useCallback(async () => {
		const csrfToken = latestRef.current.csrfToken;
		if (!csrfToken || !capability.enabled) return;
		setCapability((current) => ({
			...current,
			state: "installing",
			ready: false,
			reason: "Retrying the Needle 2 installation on the Couchview host.",
			canRetry: false,
		}));
		try {
			const next = await api.retryVoiceCommands(csrfToken);
			setCapability(next);
			latestRef.current.onCapability(next);
		} catch (error) {
			showResult({ message: messageOf(error), status: "error", undoAvailable: false });
		}
	}, [capability.enabled, showResult]);

	useEffect(
		() => () => {
			requestRef.current?.abort();
			if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
		},
		[],
	);

	return {
		available: capability.ready && speech.available,
		blockedByDictation: speech.phase !== "idle" && speech.targetId !== VOICE_TARGET_ID,
		cancel,
		capability,
		confirmation,
		confirm,
		diagnosticsOpen,
		dismissConfirmation: () => setConfirmation(null),
		dismissDiagnostics: () => setDiagnosticsOpen(false),
		dismissResult: () => setResult(null),
		enabled: options.enabled,
		phase:
			speech.targetId === VOICE_TARGET_ID && speech.phase !== "idle"
				? speech.phase
				: resolving
					? "resolving"
					: "idle",
		recordingEndsAt: speech.targetId === VOICE_TARGET_ID ? speech.recordingEndsAt : null,
		result,
		retry,
		toggle,
		undo,
	};
}

export type VoiceCommandController = ReturnType<typeof useVoiceCommands>;
