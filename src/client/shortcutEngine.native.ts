import { useCallback } from "react";
import { Platform } from "react-native";

import type { ShortcutSequence } from "../shared/settings.ts";

function keyLabel(key: string): string {
	const labels: Record<string, string> = {
		ArrowDown: "↓",
		ArrowLeft: "←",
		ArrowRight: "→",
		ArrowUp: "↑",
		Escape: "Esc",
		Space: "Space",
	};
	return labels[key] ?? (key.length === 1 ? key.toLocaleUpperCase() : key);
}

export function formatShortcut(
	sequence: ShortcutSequence | null,
	isApple = Platform.OS === "ios" || Platform.OS === "macos",
): string {
	if (!sequence || sequence.length === 0) return "Unassigned";
	return sequence
		.map((stroke) => {
			const modifiers = stroke.modifiers.map((modifier) => {
				if (modifier === "mod") return isApple ? "⌘" : "Ctrl";
				if (modifier === "ctrl") return isApple ? "⌃" : "Ctrl";
				if (modifier === "alt") return isApple ? "⌥" : "Alt";
				if (modifier === "shift") return isApple ? "⇧" : "Shift";
				return isApple ? "⌘" : "Meta";
			});
			return [...modifiers, keyLabel(stroke.key)].join(isApple ? "" : "+");
		})
		.join(" ");
}

export function useShortcutEngine() {
	return {
		pending: [] as ShortcutSequence,
		clearPending: useCallback(() => undefined, []),
	};
}
