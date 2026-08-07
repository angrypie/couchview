import {
	type CodeFontFamily,
	DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER,
	DEFAULT_TYPOGRAPHY_PREFERENCES,
	normalizeTypographyPreferences,
	type TerminalTypographyPreferences,
	TYPOGRAPHY_LIMITS,
} from "../shared/settings.ts";
import type { ResolvedTheme } from "../shared/theme.ts";

export type {
	CodeFontFamily,
	TerminalTypographyPreferences,
} from "../shared/settings.ts";
export {
	DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER,
	DEFAULT_TYPOGRAPHY_PREFERENCES,
	normalizeTypographyPreferences,
	TYPOGRAPHY_LIMITS,
};

export interface TerminalRendererTheme {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
	selectionForeground: string;
	palette: readonly string[];
}

export interface TerminalRendererConfig extends TerminalTypographyPreferences {
	cursorStyle: "block" | "underline" | "bar";
	cursorBlink: boolean;
	theme: TerminalRendererTheme;
}

const DARK_TERMINAL_THEME: TerminalRendererTheme = {
	background: "#1e1e2e",
	foreground: "#cdd6f4",
	cursor: "#ced5f1",
	selectionBackground: "#353749",
	selectionForeground: "#cdd6f4",
	palette: [
		"#11111b",
		"#f38ba8",
		"#a6e3a1",
		"#f9e2af",
		"#89b4fa",
		"#f5c2e7",
		"#94e2d5",
		"#bac2de",
		"#585b70",
		"#f38ba8",
		"#a6e3a1",
		"#f9e2af",
		"#89b4fa",
		"#f5c2e7",
		"#94e2d5",
		"#a6adc8",
	],
};

const LIGHT_TERMINAL_THEME: TerminalRendererTheme = {
	background: "#fbfcfe",
	foreground: "#233044",
	cursor: "#315fc4",
	selectionBackground: "#c9d9fa",
	selectionForeground: "#172033",
	palette: [
		"#172033",
		"#c4363d",
		"#188a51",
		"#95671a",
		"#315fc4",
		"#8b4eb0",
		"#0e7f8a",
		"#d9e0e8",
		"#69778a",
		"#dc4c53",
		"#21965d",
		"#ad791e",
		"#4774d0",
		"#9f63be",
		"#188e9a",
		"#ffffff",
	],
};

export function terminalRendererTheme(themeType: ResolvedTheme): TerminalRendererTheme {
	return themeType === "dark" ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
}

const CODE_FONT_STACKS: Record<CodeFontFamily, string> = {
	iosevka:
		'"Iosevka", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
	system:
		'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

export function codeFontStack(fontFamily: CodeFontFamily): string {
	return CODE_FONT_STACKS[fontFamily];
}

export function terminalRendererConfig(
	preferences: TerminalTypographyPreferences,
	themeType: ResolvedTheme = "dark",
): TerminalRendererConfig {
	const normalized = normalizeTypographyPreferences({ terminal: preferences }).terminal;
	return {
		...normalized,
		cursorStyle: "block",
		cursorBlink: false,
		theme: terminalRendererTheme(themeType),
	};
}

export const SAFE_TERMINAL_RENDERER_CONFIG = terminalRendererConfig(
	DEFAULT_TYPOGRAPHY_PREFERENCES.terminal,
);
