import { useCallback, useEffect, useRef } from "react";

import type { VoiceKeyboardActivationOptions } from "./voiceKeyboardTypes.ts";

export type { VoiceKeyboardController } from "./voiceKeyboardTypes.ts";

export const VOICE_PUSH_TO_TALK_MIN_MS = 250;

function isTypingSurface(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		Boolean(
			target.closest("input, textarea, select, [contenteditable=true], [data-shortcut-capture]"),
		)
	);
}

function isVoiceKey(event: KeyboardEvent): boolean {
	return (
		!event.isComposing &&
		event.keyCode !== 229 &&
		event.key.toLowerCase() === "v" &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey
	);
}

function claim(event: KeyboardEvent): void {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
}

export function useVoiceKeyboardActivation({
	active,
	controller,
}: VoiceKeyboardActivationOptions): void {
	const controllerRef = useRef(controller);
	const heldAtRef = useRef<number | null>(null);
	controllerRef.current = controller;

	const cancelHeld = useCallback(() => {
		if (heldAtRef.current === null) return;
		heldAtRef.current = null;
		controllerRef.current.cancelPushToTalk();
	}, []);

	useEffect(() => {
		if (!active) {
			cancelHeld();
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && heldAtRef.current !== null) {
				claim(event);
				cancelHeld();
				return;
			}
			if (!isVoiceKey(event) || isTypingSurface(event.target)) return;
			claim(event);
			if (event.repeat) return;
			if (event.shiftKey) {
				controllerRef.current.toggle();
				return;
			}
			if (heldAtRef.current !== null) return;
			if (controllerRef.current.beginPushToTalk()) heldAtRef.current = Date.now();
		};
		const onKeyUp = (event: KeyboardEvent) => {
			const heldAt = heldAtRef.current;
			if (heldAt === null || !isVoiceKey(event)) return;
			claim(event);
			heldAtRef.current = null;
			if (Date.now() - heldAt < VOICE_PUSH_TO_TALK_MIN_MS) controllerRef.current.cancelPushToTalk();
			else controllerRef.current.finishPushToTalk();
		};
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") cancelHeld();
		};
		window.addEventListener("blur", cancelHeld);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			window.removeEventListener("blur", cancelHeld);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keyup", onKeyUp, true);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			cancelHeld();
		};
	}, [active, cancelHeld]);
}
