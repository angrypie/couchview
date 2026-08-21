import {
	type CodexGenerationPreferences,
	DEFAULT_CODEX_GENERATION_PREFERENCES,
	parseCodexGenerationPreferences,
} from "./codexGeneration.ts";

const SETTINGS_PROFILE_DATA_VERSION = 1 as const;
export const DEFAULT_SETTINGS_PROFILE_ID = "default";
export const DEFAULT_SETTINGS_PROFILE_NAME = "Default";
export const SETTINGS_PROFILE_SELECTION_KEY = "couchview:settings-profile-id:v1";

export const COMMAND_IDS = [
	"palette.open",
	"navigate.review",
	"navigate.history",
	"navigate.artifacts",
	"navigate.terminal",
	"navigate.remote",
	"navigate.settings",
	"repository.switch",
	"panel.files",
	"panel.packageCommands",
	"search.open",
	"commit.open",
	"file.toggleStage",
	"file.toggleReviewed",
	"file.previous",
	"file.next",
	"hunk.previous",
	"hunk.next",
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];
export type KeyboardLayout = "qwerty" | "dvorak";
export type ShortcutModifier = "mod" | "ctrl" | "alt" | "shift" | "meta";

export interface ShortcutStroke {
	key: string;
	modifiers: ShortcutModifier[];
}

export type ShortcutSequence = ShortcutStroke[];

export type CodeFontFamily = "iosevka" | "system";

interface DiffTypographyPreferences {
	fontFamily: CodeFontFamily;
	fontSize: number;
	lineHeightAdjustment: number;
	widthAdjustment: number;
}

export interface TerminalTypographyPreferences {
	fontFamily: CodeFontFamily;
	fontSize: number;
	cellHeightAdjustment: number;
	cellWidthAdjustment: number;
}

export interface TypographyPreferences {
	diff: DiffTypographyPreferences;
	terminal: TerminalTypographyPreferences;
}

export interface DisplayPreferences {
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
}

export interface KeyboardPreferences {
	layout: KeyboardLayout;
	bindings: Partial<Record<CommandId, ShortcutSequence | null>>;
}

export interface VoicePreferences {
	commandsEnabled: boolean;
}

export interface SettingsProfileData {
	version: typeof SETTINGS_PROFILE_DATA_VERSION;
	codex: CodexGenerationPreferences;
	typography: TypographyPreferences;
	display: DisplayPreferences;
	keyboard: KeyboardPreferences;
	voice: VoicePreferences;
}

export interface SettingsProfile {
	id: string;
	name: string;
	data: SettingsProfileData;
	revision: number;
	createdAt: string;
	updatedAt: string;
}

export interface SettingsProfilesResponse {
	profiles: SettingsProfile[];
}

export interface SettingsProfileResponse {
	profile: SettingsProfile;
}

export interface CreateSettingsProfileRequest {
	name: string;
	sourceProfileId?: string;
}

export interface UpdateSettingsProfileRequest {
	name: string;
	data: SettingsProfileData;
	expectedRevision: number;
}

interface NumericLimit {
	min: number;
	max: number;
	step: number;
}

export const TYPOGRAPHY_LIMITS = {
	diff: {
		fontSize: { min: 9, max: 24, step: 1 },
		lineHeightAdjustment: { min: -5, max: 5, step: 0.5 },
		widthAdjustment: { min: -1, max: 2, step: 0.1 },
	},
	terminal: {
		fontSize: { min: 8, max: 32, step: 1 },
		cellHeightAdjustment: { min: -4, max: 16, step: 1 },
		cellWidthAdjustment: { min: -5, max: 5, step: 1 },
	},
} as const;

export const DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER = 1.55;

export const DEFAULT_TYPOGRAPHY_PREFERENCES: TypographyPreferences = {
	diff: {
		fontFamily: "iosevka",
		fontSize: 11,
		lineHeightAdjustment: 0,
		widthAdjustment: 0,
	},
	terminal: {
		fontFamily: "iosevka",
		fontSize: 15,
		cellHeightAdjustment: 0,
		cellWidthAdjustment: 0,
	},
};

const stroke = (key: string, modifiers: ShortcutModifier[] = []): ShortcutStroke => ({
	key,
	modifiers,
});
const sequence = (...strokes: ShortcutStroke[]): ShortcutSequence => strokes;

const COMMON_DEFAULT_KEYBINDINGS: Record<CommandId, ShortcutSequence | null> = {
	"palette.open": sequence(stroke("k", ["mod"])),
	"navigate.review": sequence(stroke("g"), stroke("d")),
	"navigate.history": sequence(stroke("g"), stroke("h")),
	"navigate.artifacts": null,
	"navigate.terminal": sequence(stroke("g"), stroke("t")),
	"navigate.remote": sequence(stroke("g"), stroke("r")),
	"navigate.settings": sequence(stroke("g"), stroke("s")),
	"repository.switch": sequence(stroke("g"), stroke("p")),
	"panel.files": sequence(stroke("g"), stroke("f")),
	"panel.packageCommands": sequence(stroke("g"), stroke("x")),
	"search.open": sequence(stroke("/")),
	"commit.open": sequence(stroke("c"), stroke("c")),
	"file.toggleStage": sequence(stroke("g"), stroke("a")),
	"file.toggleReviewed": sequence(stroke("r")),
	"file.previous": null,
	"file.next": null,
	"hunk.previous": null,
	"hunk.next": null,
};

export const DEFAULT_KEYBINDINGS: Record<
	KeyboardLayout,
	Record<CommandId, ShortcutSequence | null>
> = {
	qwerty: {
		...COMMON_DEFAULT_KEYBINDINGS,
		"file.previous": sequence(stroke("h")),
		"file.next": sequence(stroke("l")),
		"hunk.previous": sequence(stroke("k")),
		"hunk.next": sequence(stroke("j")),
	},
	dvorak: {
		...COMMON_DEFAULT_KEYBINDINGS,
		"file.previous": sequence(stroke("h")),
		"file.next": sequence(stroke("s")),
		"hunk.previous": sequence(stroke("n")),
		"hunk.next": sequence(stroke("t")),
	},
};

export function createDefaultSettingsProfileData(): SettingsProfileData {
	return {
		version: SETTINGS_PROFILE_DATA_VERSION,
		codex: { ...DEFAULT_CODEX_GENERATION_PREFERENCES },
		typography: {
			diff: { ...DEFAULT_TYPOGRAPHY_PREFERENCES.diff },
			terminal: { ...DEFAULT_TYPOGRAPHY_PREFERENCES.terminal },
		},
		display: {
			lineNumbersVisible: false,
			lineWrapEnabled: false,
		},
		keyboard: {
			layout: "qwerty",
			bindings: {},
		},
		voice: {
			commandsEnabled: false,
		},
	};
}

function boundedNumber(value: unknown, fallback: number, limit: NumericLimit): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const clamped = Math.min(limit.max, Math.max(limit.min, value));
	const stepped = Math.round(clamped / limit.step) * limit.step;
	return Number(stepped.toFixed(limit.step < 1 ? 2 : 0));
}

function fontFamily(value: unknown, fallback: CodeFontFamily): CodeFontFamily {
	return value === "iosevka" || value === "system" ? value : fallback;
}

export function normalizeTypographyPreferences(value: unknown): TypographyPreferences {
	const candidate =
		value && typeof value === "object" ? (value as Partial<TypographyPreferences>) : {};
	const diff: Partial<DiffTypographyPreferences> =
		candidate.diff && typeof candidate.diff === "object" ? candidate.diff : {};
	const terminal: Partial<TerminalTypographyPreferences> =
		candidate.terminal && typeof candidate.terminal === "object" ? candidate.terminal : {};
	const defaults = DEFAULT_TYPOGRAPHY_PREFERENCES;
	return {
		diff: {
			fontFamily: fontFamily(diff.fontFamily, defaults.diff.fontFamily),
			fontSize: boundedNumber(
				diff.fontSize,
				defaults.diff.fontSize,
				TYPOGRAPHY_LIMITS.diff.fontSize,
			),
			lineHeightAdjustment: boundedNumber(
				diff.lineHeightAdjustment,
				defaults.diff.lineHeightAdjustment,
				TYPOGRAPHY_LIMITS.diff.lineHeightAdjustment,
			),
			widthAdjustment: boundedNumber(
				diff.widthAdjustment,
				defaults.diff.widthAdjustment,
				TYPOGRAPHY_LIMITS.diff.widthAdjustment,
			),
		},
		terminal: {
			fontFamily: fontFamily(terminal.fontFamily, defaults.terminal.fontFamily),
			fontSize: boundedNumber(
				terminal.fontSize,
				defaults.terminal.fontSize,
				TYPOGRAPHY_LIMITS.terminal.fontSize,
			),
			cellHeightAdjustment: boundedNumber(
				terminal.cellHeightAdjustment,
				defaults.terminal.cellHeightAdjustment,
				TYPOGRAPHY_LIMITS.terminal.cellHeightAdjustment,
			),
			cellWidthAdjustment: boundedNumber(
				terminal.cellWidthAdjustment,
				defaults.terminal.cellWidthAdjustment,
				TYPOGRAPHY_LIMITS.terminal.cellWidthAdjustment,
			),
		},
	};
}

function commandIdIsValid(value: string): value is CommandId {
	return (COMMAND_IDS as readonly string[]).includes(value);
}

const MODIFIER_ORDER: readonly ShortcutModifier[] = ["mod", "ctrl", "alt", "shift", "meta"];

function shortcutStroke(value: unknown): ShortcutStroke {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Shortcut strokes must be objects");
	}
	const candidate = value as Partial<ShortcutStroke>;
	if (typeof candidate.key !== "string" || candidate.key.length < 1 || candidate.key.length > 32) {
		throw new Error("Shortcut keys must contain between 1 and 32 characters");
	}
	if (!Array.isArray(candidate.modifiers)) {
		throw new Error("Shortcut modifiers must be an array");
	}
	const modifiers = new Set<ShortcutModifier>();
	for (const modifier of candidate.modifiers) {
		if (!MODIFIER_ORDER.includes(modifier)) {
			throw new Error(`Unknown shortcut modifier: ${String(modifier)}`);
		}
		if (modifiers.has(modifier)) {
			throw new Error(`Duplicate shortcut modifier: ${modifier}`);
		}
		modifiers.add(modifier);
	}
	if (
		[
			"Alt",
			"AltGraph",
			"Control",
			"Dead",
			"Fn",
			"FnLock",
			"Hyper",
			"Meta",
			"OS",
			"Process",
			"Shift",
			"Super",
			"Symbol",
			"SymbolLock",
		].includes(candidate.key)
	) {
		throw new Error("Shortcuts cannot use a modifier, dead, or composition key alone");
	}
	return {
		key: candidate.key.length === 1 ? candidate.key.toLowerCase() : candidate.key,
		modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
	};
}

export function parseShortcutSequence(value: unknown): ShortcutSequence {
	if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
		throw new Error("Shortcuts must contain between one and four strokes");
	}
	return value.map(shortcutStroke);
}

export function shortcutSequenceKey(sequenceValue: ShortcutSequence): string {
	return sequenceValue.map((item) => `${item.modifiers.join("+")}+${item.key}`).join(" ");
}

function sequenceIsPrefix(left: ShortcutSequence, right: ShortcutSequence): boolean {
	if (left.length > right.length) return false;
	return left.every(
		(item, index) => shortcutSequenceKey([item]) === shortcutSequenceKey([right[index]!]),
	);
}

export interface KeybindingConflict {
	first: CommandId;
	second: CommandId;
}

export function effectiveKeybindings(
	keyboard: KeyboardPreferences,
): Record<CommandId, ShortcutSequence | null> {
	const defaults = DEFAULT_KEYBINDINGS[keyboard.layout];
	return Object.fromEntries(
		COMMAND_IDS.map((commandId) => [
			commandId,
			Object.prototype.hasOwnProperty.call(keyboard.bindings, commandId)
				? (keyboard.bindings[commandId] ?? null)
				: defaults[commandId],
		]),
	) as Record<CommandId, ShortcutSequence | null>;
}

export function keybindingConflicts(
	bindings: Record<CommandId, ShortcutSequence | null>,
): KeybindingConflict[] {
	const conflicts: KeybindingConflict[] = [];
	for (let leftIndex = 0; leftIndex < COMMAND_IDS.length; leftIndex += 1) {
		const first = COMMAND_IDS[leftIndex]!;
		const left = bindings[first];
		if (!left) continue;
		for (let rightIndex = leftIndex + 1; rightIndex < COMMAND_IDS.length; rightIndex += 1) {
			const second = COMMAND_IDS[rightIndex]!;
			const right = bindings[second];
			if (right && (sequenceIsPrefix(left, right) || sequenceIsPrefix(right, left))) {
				conflicts.push({ first, second });
			}
		}
	}
	return conflicts;
}

export function paletteShortcutHasRequiredModifier(binding: ShortcutSequence | null): boolean {
	return binding === null || binding[0]!.modifiers.some((modifier) => modifier !== "shift");
}

function validNumericPreference(value: unknown, limit: NumericLimit): value is number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < limit.min ||
		value > limit.max
	) {
		return false;
	}
	const stepOffset = (value - limit.min) / limit.step;
	return Math.abs(stepOffset - Math.round(stepOffset)) < 1e-8;
}

function validateProfileTypography(value: unknown): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Typography preferences are invalid");
	}
	const typography = value as Partial<TypographyPreferences>;
	if (
		!typography.diff ||
		typeof typography.diff !== "object" ||
		Array.isArray(typography.diff) ||
		!typography.terminal ||
		typeof typography.terminal !== "object" ||
		Array.isArray(typography.terminal)
	) {
		throw new Error("Typography preferences are invalid");
	}
	const diff = typography.diff;
	const terminal = typography.terminal;
	if (
		(diff.fontFamily !== "iosevka" && diff.fontFamily !== "system") ||
		!validNumericPreference(diff.fontSize, TYPOGRAPHY_LIMITS.diff.fontSize) ||
		!validNumericPreference(
			diff.lineHeightAdjustment,
			TYPOGRAPHY_LIMITS.diff.lineHeightAdjustment,
		) ||
		!validNumericPreference(diff.widthAdjustment, TYPOGRAPHY_LIMITS.diff.widthAdjustment) ||
		(terminal.fontFamily !== "iosevka" && terminal.fontFamily !== "system") ||
		!validNumericPreference(terminal.fontSize, TYPOGRAPHY_LIMITS.terminal.fontSize) ||
		!validNumericPreference(
			terminal.cellHeightAdjustment,
			TYPOGRAPHY_LIMITS.terminal.cellHeightAdjustment,
		) ||
		!validNumericPreference(
			terminal.cellWidthAdjustment,
			TYPOGRAPHY_LIMITS.terminal.cellWidthAdjustment,
		)
	) {
		throw new Error("Typography preferences are invalid");
	}
}

export function parseSettingsProfileData(value: unknown): SettingsProfileData {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Settings profile data must be an object");
	}
	const candidate = value as Partial<SettingsProfileData>;
	if (candidate.version !== SETTINGS_PROFILE_DATA_VERSION) {
		throw new Error("Unsupported settings profile data version");
	}
	validateProfileTypography(candidate.typography);
	const codex = parseCodexGenerationPreferences(candidate.codex);
	const display = candidate.display;
	if (
		!display ||
		typeof display !== "object" ||
		typeof display.lineNumbersVisible !== "boolean" ||
		typeof display.lineWrapEnabled !== "boolean"
	) {
		throw new Error("Display preferences are invalid");
	}
	const keyboard = candidate.keyboard;
	if (
		!keyboard ||
		typeof keyboard !== "object" ||
		(keyboard.layout !== "qwerty" && keyboard.layout !== "dvorak") ||
		!keyboard.bindings ||
		typeof keyboard.bindings !== "object" ||
		Array.isArray(keyboard.bindings)
	) {
		throw new Error("Keyboard preferences are invalid");
	}
	const bindings: Partial<Record<CommandId, ShortcutSequence | null>> = {};
	for (const [commandId, binding] of Object.entries(keyboard.bindings)) {
		if (!commandIdIsValid(commandId)) {
			throw new Error(`Unknown command ID: ${commandId}`);
		}
		bindings[commandId] = binding === null ? null : parseShortcutSequence(binding);
	}
	const voiceCandidate = candidate.voice;
	const voice: VoicePreferences = {
		commandsEnabled:
			voiceCandidate &&
			typeof voiceCandidate === "object" &&
			typeof voiceCandidate.commandsEnabled === "boolean"
				? voiceCandidate.commandsEnabled
				: false,
	};
	const result: SettingsProfileData = {
		version: SETTINGS_PROFILE_DATA_VERSION,
		codex,
		typography: normalizeTypographyPreferences(candidate.typography),
		display: {
			lineNumbersVisible: display.lineNumbersVisible,
			lineWrapEnabled: display.lineWrapEnabled,
		},
		keyboard: {
			layout: keyboard.layout,
			bindings,
		},
		voice,
	};
	const effective = effectiveKeybindings(result.keyboard);
	const conflicts = keybindingConflicts(effective);
	if (conflicts.length > 0) {
		throw new Error(`Shortcut conflict between ${conflicts[0]!.first} and ${conflicts[0]!.second}`);
	}
	const paletteBinding = effective["palette.open"];
	if (!paletteShortcutHasRequiredModifier(paletteBinding)) {
		throw new Error("The command palette shortcut must begin with a modifier");
	}
	return result;
}

export function normalizeSettingsProfileName(value: unknown): string {
	if (typeof value !== "string") throw new Error("Profile name must be text");
	const name = value.trim();
	if (name.length < 1 || name.length > 64) {
		throw new Error("Profile name must contain between 1 and 64 characters");
	}
	return name;
}
