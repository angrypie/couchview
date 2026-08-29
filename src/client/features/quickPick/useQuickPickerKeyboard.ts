import { useEffect, useRef } from "react";

import { QUICK_PICKER_SEARCH_INPUT_ID, type QuickPickerKeyboardOptions } from "./types.ts";

function noModifiers(event: KeyboardEvent): boolean {
	return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function consume(event: KeyboardEvent): void {
	event.preventDefault();
	event.stopImmediatePropagation();
}

function exactControl(event: KeyboardEvent): boolean {
	return event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
}

export function isExactControlP(event: KeyboardEvent): boolean {
	return event.key.toLocaleLowerCase() === "p" && exactControl(event);
}

function searchInputIsTarget(event: KeyboardEvent): boolean {
	return (
		event.target instanceof Element &&
		Boolean(event.target.closest(`#${QUICK_PICKER_SEARCH_INPUT_ID}`))
	);
}

export function useQuickPickerKeyboard(options: QuickPickerKeyboardOptions): void {
	const optionsRef = useRef(options);
	const gHeldRef = useRef(false);
	const openingGHeldRef = useRef(false);
	optionsRef.current = options;

	useEffect(() => {
		const releaseHeldKeys = () => {
			gHeldRef.current = false;
			openingGHeldRef.current = false;
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key.toLocaleLowerCase() === "g") releaseHeldKeys();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing || event.keyCode === 229) return;
			const key = event.key.toLocaleLowerCase();
			const current = optionsRef.current;
			if (key === "g" && noModifiers(event)) {
				if (!gHeldRef.current) openingGHeldRef.current = current.mode === null;
				gHeldRef.current = true;
				if (openingGHeldRef.current && current.mode === "projects" && event.repeat) {
					consume(event);
				}
				return;
			}
			if (key === "p" && noModifiers(event) && gHeldRef.current && current.mode === "projects") {
				consume(event);
				current.onMove(1);
				return;
			}
			if (!current.mode) return;
			if (isExactControlP(event)) {
				consume(event);
				return;
			}
			if (key === "c" && exactControl(event)) {
				consume(event);
				current.onClose();
				return;
			}
			if (event.key === "Escape" && noModifiers(event)) {
				consume(event);
				current.onClose();
				return;
			}
			if (!searchInputIsTarget(event) || !noModifiers(event)) return;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				consume(event);
				current.onMove(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			if (event.key === "Enter") {
				consume(event);
				current.onSelect();
			}
		};

		window.addEventListener("blur", releaseHeldKeys);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
		return () => {
			window.removeEventListener("blur", releaseHeldKeys);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keyup", onKeyUp, true);
		};
	}, []);
}
