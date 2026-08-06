import { expect, test } from "bun:test";
import { Ghostty, type GhosttyCell, type ITheme } from "ghostty-web";
import ghosttyWasmPath from "ghostty-web/ghostty-vt.wasm";

import { installGhosttyCellThemeAdapter, toGhosttyTheme } from "./ghosttyThemeRuntime.ts";
import { terminalRendererTheme } from "./typographyPreferences.ts";

const PALETTE_KEYS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const satisfies readonly (keyof ITheme)[];

function colorNumber(color: string | undefined): number {
	return Number.parseInt(color?.slice(1) ?? "0", 16);
}

function parserConfig(theme: ITheme) {
	return {
		bgColor: colorNumber(theme.background),
		cursorColor: colorNumber(theme.cursor),
		fgColor: colorNumber(theme.foreground),
		palette: PALETTE_KEYS.map((key) => colorNumber(theme[key])),
		scrollbackLimit: 100,
	};
}

function cellRgb(cell: GhosttyCell, layer: "background" | "foreground") {
	return layer === "foreground"
		? [cell.fg_r, cell.fg_g, cell.fg_b]
		: [cell.bg_r, cell.bg_g, cell.bg_b];
}

test("recolors real Ghostty cells and scrollback without replacing the terminal", async () => {
	const darkTheme = toGhosttyTheme(terminalRendererTheme("dark"));
	const lightTheme = toGhosttyTheme(terminalRendererTheme("light"));
	const ghostty = await Ghostty.load(ghosttyWasmPath as unknown as string);
	const terminal = ghostty.createTerminal(32, 2, parserConfig(darkTheme));
	terminal.write(
		new TextEncoder().encode(
			"D\x1b[31mR\x1b[91mB\x1b[38;2;1;2;3mT\x1b[0m\r\nline-two\r\nline-three",
		),
	);
	terminal.update();
	const originalTerminal = terminal;
	const originalScrollback = terminal.getScrollbackLine(0)!;
	expect(cellRgb(originalScrollback[0]!, "foreground")).toEqual([205, 214, 244]);
	expect(cellRgb(originalScrollback[1]!, "foreground")).toEqual([243, 139, 168]);
	expect(cellRgb(originalScrollback[2]!, "foreground")).toEqual([243, 139, 168]);
	expect(cellRgb(originalScrollback[3]!, "foreground")).toEqual([1, 2, 3]);

	const adapter = installGhosttyCellThemeAdapter(terminal, darkTheme);
	try {
		adapter.update(lightTheme);
		const lightScrollback = terminal.getScrollbackLine(0)!;
		expect(terminal).toBe(originalTerminal);
		expect(cellRgb(terminal.getLine(0)![0]!, "foreground")).toEqual([35, 48, 68]);
		expect(cellRgb(lightScrollback[0]!, "foreground")).toEqual([35, 48, 68]);
		expect(cellRgb(lightScrollback[0]!, "background")).toEqual([251, 252, 254]);
		expect(cellRgb(lightScrollback[1]!, "foreground")).toEqual([196, 54, 61]);
		expect(cellRgb(lightScrollback[2]!, "foreground")).toEqual([196, 54, 61]);
		expect(cellRgb(lightScrollback[3]!, "foreground")).toEqual([1, 2, 3]);
		expect(cellRgb(originalScrollback[0]!, "foreground")).toEqual([205, 214, 244]);

		adapter.update(darkTheme);
		expect(cellRgb(terminal.getScrollbackLine(0)![0]!, "foreground")).toEqual([205, 214, 244]);
	} finally {
		adapter.dispose();
		terminal.free();
	}
});
