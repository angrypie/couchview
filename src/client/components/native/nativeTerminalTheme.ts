import type { ITheme, Terminal } from "ghostty-web";

import type { ResolvedTheme } from "../../../shared/theme.ts";
import { installGhosttyCellThemeAdapter, toGhosttyTheme } from "../../ghosttyThemeRuntime.ts";
import { terminalRendererTheme } from "../../typographyPreferences.ts";

const darkRendererTheme = {
	...terminalRendererTheme("dark"),
	background: "#0d1014",
	cursor: "#7da6ff",
	foreground: "#e7edf5",
};
const lightRendererTheme = {
	...terminalRendererTheme("light"),
	background: "#f6f8fb",
	cursor: "#315fc4",
	foreground: "#1d2633",
};

export const NATIVE_TERMINAL_THEMES: Record<ResolvedTheme, ITheme> = {
	dark: toGhosttyTheme(darkRendererTheme),
	light: toGhosttyTheme(lightRendererTheme),
};

export interface NativeTerminalThemeController {
	apply(theme: ResolvedTheme): void;
	dispose(): void;
}

export function installNativeTerminalThemeController(
	terminal: Terminal,
	initialTheme: ResolvedTheme,
): NativeTerminalThemeController | null {
	const renderer = terminal?.renderer;
	const wasmTerminal = terminal?.wasmTerm;
	if (!wasmTerminal || !renderer) return null;
	const cellThemeAdapter = installGhosttyCellThemeAdapter(
		wasmTerminal,
		NATIVE_TERMINAL_THEMES[initialTheme],
	);
	return {
		apply(theme) {
			const nextTheme = NATIVE_TERMINAL_THEMES[theme];
			cellThemeAdapter.update(nextTheme);
			renderer.setTheme(nextTheme);
			renderer.render(wasmTerminal, true, terminal.viewportY, terminal);
		},
		dispose() {
			cellThemeAdapter.dispose();
		},
	};
}
