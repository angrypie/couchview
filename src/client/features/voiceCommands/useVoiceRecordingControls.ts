import { useCallback, useMemo, useRef } from "react";

import type { SpeechController, SpeechTarget } from "../speech/index.ts";
import { useVoiceKeyboardActivation } from "./useVoiceKeyboardActivation";
import type { VoiceKeyboardController } from "./voiceKeyboardTypes.ts";

interface VoiceRecordingControlOptions {
	active: boolean;
	available: boolean;
	cancel(): void;
	captureContext(): void;
	enabled: boolean;
	openDiagnostics(): void;
	resolving: boolean;
	speech: SpeechController;
	target: SpeechTarget;
}

export function useVoiceRecordingControls({
	active,
	available,
	cancel,
	captureContext,
	enabled,
	openDiagnostics,
	resolving,
	speech,
	target,
}: VoiceRecordingControlOptions) {
	const pushToTalkActiveRef = useRef(false);
	const speechRef = useRef(speech);
	speechRef.current = speech;

	const toggle = useCallback(() => {
		if (!enabled || !active || pushToTalkActiveRef.current) return;
		if (!available) {
			openDiagnostics();
			return;
		}
		if (resolving) {
			cancel();
			return;
		}
		const current = speechRef.current;
		if (current.phase === "idle") captureContext();
		if (current.phase === "idle" || current.targetId === target.id) current.toggle(target);
	}, [active, available, cancel, captureContext, enabled, openDiagnostics, resolving, target]);

	const beginPushToTalk = useCallback(() => {
		if (!enabled || !active) return false;
		if (!available) {
			openDiagnostics();
			return true;
		}
		const current = speechRef.current;
		if (resolving || (current.phase !== "idle" && current.phase !== "error")) return true;
		pushToTalkActiveRef.current = true;
		captureContext();
		current.start(target);
		return true;
	}, [active, available, captureContext, enabled, openDiagnostics, resolving, target]);

	const cancelPushToTalk = useCallback(() => {
		if (!pushToTalkActiveRef.current) return;
		pushToTalkActiveRef.current = false;
		cancel();
	}, [cancel]);

	const finishPushToTalk = useCallback(() => {
		if (!pushToTalkActiveRef.current) return;
		pushToTalkActiveRef.current = false;
		speechRef.current.stop(target);
	}, [target]);

	const keyboardController = useMemo<VoiceKeyboardController>(
		() => ({ beginPushToTalk, cancelPushToTalk, finishPushToTalk, toggle }),
		[beginPushToTalk, cancelPushToTalk, finishPushToTalk, toggle],
	);
	useVoiceKeyboardActivation({ active: enabled && active, controller: keyboardController });

	return { toggle };
}
