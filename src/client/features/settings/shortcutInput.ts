import {
	parseShortcutSequence,
	type ShortcutModifier,
	type ShortcutSequence,
} from "../../../shared/settings.ts";

const MODIFIER_ALIASES: Readonly<Record<string, ShortcutModifier>> = {
	alt: "alt",
	cmd: "mod",
	command: "mod",
	control: "ctrl",
	ctrl: "ctrl",
	meta: "meta",
	mod: "mod",
	option: "alt",
	shift: "shift",
};

const KEY_ALIASES: Readonly<Record<string, string>> = {
	down: "ArrowDown",
	esc: "Escape",
	left: "ArrowLeft",
	right: "ArrowRight",
	space: "Space",
	up: "ArrowUp",
};

function parseStroke(input: string) {
	const parts = input
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	const modifiers: ShortcutModifier[] = [];
	const keys: string[] = [];
	for (const part of parts) {
		const normalized = part.toLowerCase();
		const modifier = MODIFIER_ALIASES[normalized];
		if (modifier) modifiers.push(modifier);
		else keys.push(KEY_ALIASES[normalized] ?? (part.length === 1 ? normalized : part));
	}
	if (keys.length !== 1) throw new Error("Each shortcut stroke needs exactly one key.");
	return { key: keys[0]!, modifiers };
}

export function parseShortcutInput(input: string): ShortcutSequence {
	const strokes = input.trim().split(/\s+/).filter(Boolean);
	if (strokes.length === 0) throw new Error("Enter at least one shortcut stroke.");
	return parseShortcutSequence(strokes.map(parseStroke));
}

function displayKey(key: string): string {
	const labels: Readonly<Record<string, string>> = {
		ArrowDown: "Down",
		ArrowLeft: "Left",
		ArrowRight: "Right",
		ArrowUp: "Up",
		Escape: "Esc",
	};
	return labels[key] ?? (key.length === 1 ? key.toLocaleUpperCase() : key);
}

export function formatShortcutInput(sequence: ShortcutSequence | null): string {
	if (!sequence || sequence.length === 0) return "Unassigned";
	return sequence
		.map((stroke) => {
			const modifiers = stroke.modifiers.map((modifier) => {
				if (modifier === "mod") return "Mod";
				if (modifier === "ctrl") return "Ctrl";
				if (modifier === "alt") return "Alt";
				if (modifier === "shift") return "Shift";
				return "Meta";
			});
			return [...modifiers, displayKey(stroke.key)].join("+");
		})
		.join(" ");
}
