import { expect, test } from "bun:test";
import type { Terminal } from "ghostty-web";

import {
	installNativeTerminalThemeController,
	NATIVE_TERMINAL_THEMES,
} from "./nativeTerminalTheme.ts";

test("native terminal theme updates the existing renderer without replacing the terminal", () => {
	const calls: unknown[][] = [];
	const wasmTerminal = {
		getLine: () => [],
		getScrollbackLine: () => [],
	};
	const originalGetLine = wasmTerminal.getLine;
	const terminal = {
		renderer: {
			render: (...args: unknown[]) => calls.push(["render", ...args]),
			setTheme: (...args: unknown[]) => calls.push(["theme", ...args]),
		},
		viewportY: 12,
		wasmTerm: wasmTerminal,
	} as unknown as Terminal;

	const controller = installNativeTerminalThemeController(terminal, "dark");
	expect(controller).not.toBeNull();
	expect(wasmTerminal.getLine).not.toBe(originalGetLine);
	controller?.apply("light");
	expect(calls[0]).toEqual(["theme", NATIVE_TERMINAL_THEMES.light]);
	expect(calls[1]).toEqual(["render", terminal.wasmTerm, true, 12, terminal]);
	controller?.dispose();
	expect(wasmTerminal.getLine).toBe(originalGetLine);
});

test("native terminal themes provide distinct readable surface palettes", () => {
	expect(NATIVE_TERMINAL_THEMES.light.background).not.toBe(NATIVE_TERMINAL_THEMES.dark.background);
	expect(NATIVE_TERMINAL_THEMES.light.foreground).not.toBe(NATIVE_TERMINAL_THEMES.dark.foreground);
});
