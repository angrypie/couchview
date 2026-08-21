import type { GhosttyCell, GhosttyTerminal, ITheme } from "ghostty-web";

interface GhosttyRendererTheme {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
	selectionForeground: string;
	palette: readonly string[];
}

interface GhosttyCellThemeAdapter {
	update(theme: ITheme): void;
	dispose(): void;
}

const CELL_COLOR_KEYS = [
	"foreground",
	"background",
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

type Rgb = readonly [number, number, number];

function parseHexColor(color: string | undefined): Rgb | null {
	if (!color) return null;
	const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/i.exec(color);
	if (!match) return null;
	return [
		Number.parseInt(match[1]!, 16),
		Number.parseInt(match[2]!, 16),
		Number.parseInt(match[3]!, 16),
	];
}

function rgbKey(red: number, green: number, blue: number): number {
	return (red << 16) | (green << 8) | blue;
}

function createCellColorMap(source: ITheme, target: ITheme): ReadonlyMap<number, Rgb> | null {
	const colors = new Map<number, Rgb>();
	const seenSourceColors = new Set<number>();
	for (const key of CELL_COLOR_KEYS) {
		const sourceRgb = parseHexColor(source[key]);
		const targetRgb = parseHexColor(target[key]);
		if (!sourceRgb || !targetRgb) continue;
		const sourceKey = rgbKey(...sourceRgb);
		if (seenSourceColors.has(sourceKey)) continue;
		seenSourceColors.add(sourceKey);
		if (sourceKey === rgbKey(...targetRgb)) continue;
		colors.set(sourceKey, targetRgb);
	}
	return colors.size > 0 ? colors : null;
}

function remapCells(
	cells: GhosttyCell[] | null,
	colors: ReadonlyMap<number, Rgb> | null,
): GhosttyCell[] | null {
	if (!cells || !colors) return cells;
	for (const cell of cells) {
		const foreground = colors.get(rgbKey(cell.fg_r, cell.fg_g, cell.fg_b));
		if (foreground) [cell.fg_r, cell.fg_g, cell.fg_b] = foreground;
		const background = colors.get(rgbKey(cell.bg_r, cell.bg_g, cell.bg_b));
		if (background) [cell.bg_r, cell.bg_g, cell.bg_b] = background;
	}
	return cells;
}

export function toGhosttyTheme(theme: GhosttyRendererTheme): ITheme {
	const palette = theme.palette;
	return {
		background: theme.background,
		foreground: theme.foreground,
		cursor: theme.cursor,
		cursorAccent: theme.background,
		selectionBackground: theme.selectionBackground,
		selectionForeground: theme.selectionForeground,
		black: palette[0],
		red: palette[1],
		green: palette[2],
		yellow: palette[3],
		blue: palette[4],
		magenta: palette[5],
		cyan: palette[6],
		white: palette[7],
		brightBlack: palette[8],
		brightRed: palette[9],
		brightGreen: palette[10],
		brightYellow: palette[11],
		brightBlue: palette[12],
		brightMagenta: palette[13],
		brightCyan: palette[14],
		brightWhite: palette[15],
	};
}

/**
 * Ghostty 0.4 freezes its parser palette when a terminal opens. Its renderer theme API updates
 * canvas chrome but not the RGB values already resolved into cells. Both line methods return
 * copies, so remap those copies while preserving the live parser, scrollback, and transport.
 */
export function installGhosttyCellThemeAdapter(
	terminal: GhosttyTerminal,
	sourceTheme: ITheme,
): GhosttyCellThemeAdapter {
	const originalGetLine = terminal.getLine;
	const originalGetScrollbackLine = terminal.getScrollbackLine;
	let colors: ReadonlyMap<number, Rgb> | null = null;
	const getLine = (row: number) => remapCells(originalGetLine.call(terminal, row), colors);
	const getScrollbackLine = (offset: number) =>
		remapCells(originalGetScrollbackLine.call(terminal, offset), colors);
	terminal.getLine = getLine;
	terminal.getScrollbackLine = getScrollbackLine;

	return {
		update(theme) {
			colors = createCellColorMap(sourceTheme, theme);
		},
		dispose() {
			colors = null;
			if (terminal.getLine === getLine) terminal.getLine = originalGetLine;
			if (terminal.getScrollbackLine === getScrollbackLine) {
				terminal.getScrollbackLine = originalGetScrollbackLine;
			}
		},
	};
}
