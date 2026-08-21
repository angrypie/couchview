import type { DiffRow, DiffRowMetrics } from "./types.ts";

export const SEPARATOR_ROW_HEIGHT = 32;

export interface DiffMetricsConfig {
	lineHeight: number;
	rowHeight(): number;
}

export interface RowGeometry {
	heights: number[];
	offsets: number[];
	totalHeight: number;
}

/**
 * Compute fixed row heights and prefix offsets. Line rows and no-newline rows
 * use the configured line height; metadata separators are 32 px, matching
 * Pierre's `[data-separator="metadata"]` rule.
 */
export function rowGeometry(rows: readonly DiffRow[], lineHeight: number): RowGeometry {
	const heights: number[] = new Array(rows.length);
	const offsets: number[] = new Array(rows.length);
	let offset = 0;
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (!row) continue;
		const height = row.kind === "separator" ? SEPARATOR_ROW_HEIGHT : lineHeight;
		heights[index] = height;
		offsets[index] = offset;
		offset += height;
	}
	return { heights, offsets, totalHeight: offset };
}

export function buildRowMetrics(
	rows: readonly DiffRow[],
	lineHeight: number,
): DiffRowMetrics & RowGeometry {
	const geometry = rowGeometry(rows, lineHeight);
	const firstRowByLineNumber = new Map<string, number>();
	const firstRowByHunkIndex = new Map<number, number>();
	let lineRows = 0;
	let maxColumns = 0;
	let maxNumberDigits = 0;
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (!row) continue;
		if (row.kind !== "separator" && !row.noNewline) {
			lineRows += 1;
			maxColumns = Math.max(maxColumns, row.visualColumns);
			if (row.newLine !== null && !firstRowByLineNumber.has(`new:${row.newLine}`)) {
				firstRowByLineNumber.set(`new:${row.newLine}`, index);
			}
			if (row.oldLine !== null && !firstRowByLineNumber.has(`old:${row.oldLine}`)) {
				firstRowByLineNumber.set(`old:${row.oldLine}`, index);
			}
			const digits = Math.max(Math.max(row.newLine ?? 0, row.oldLine ?? 0).toString().length, 1);
			maxNumberDigits = Math.max(maxNumberDigits, digits);
		}
		if (row.hunkIndex !== null && !firstRowByHunkIndex.has(row.hunkIndex)) {
			firstRowByHunkIndex.set(row.hunkIndex, index);
		}
	}
	return {
		rowCount: rows.length,
		lineRows,
		maxColumns,
		maxNumberDigits,
		firstRowByLineNumber,
		firstRowByHunkIndex,
		prefixOffsets: geometry.offsets,
		totalHeight: geometry.totalHeight,
		heights: geometry.heights,
		offsets: geometry.offsets,
	};
}

export function charWidthFor(fontSize: number, letterSpacing: number): number {
	return fontSize * 0.5 + letterSpacing;
}

/**
 * Number of visual lines a row occupies under `white-space: pre-wrap` with
 * `word-break: break-word`, matching the DOM viewer's wrap mode. Wrapping
 * happens at spaces; words longer than the line width break mid-word.
 */
export function wrappedLineCount(text: string, columnsPerLine: number): number {
	const perLine = Math.max(1, columnsPerLine);
	if (text.length === 0) return 1;
	let lines = 1;
	let column = 0;
	const parts = text.split(/( +)/);
	for (const part of parts) {
		if (part === "") continue;
		if (part.startsWith(" ")) {
			column += part.length;
			if (column > perLine) {
				lines += Math.floor(column / perLine);
				column %= perLine;
			}
			continue;
		}
		let word = part;
		while (word.length > perLine) {
			lines += 1;
			column = 0;
			word = word.slice(perLine);
		}
		if (column > 0 && column + word.length > perLine) {
			lines += 1;
			column = 0;
		}
		column += word.length;
	}
	return lines;
}
