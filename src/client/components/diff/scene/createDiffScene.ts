import type { FileDiff } from "../../../../shared/contracts.ts";
import type { ResolvedTheme } from "../../../../shared/theme.ts";
import type { DiffRow } from "../engine/types.ts";
import type {
	DiffLineSide,
	DiffScene,
	DiffSceneLayout,
	DiffSceneLineTarget,
	DiffSceneQueries,
	DiffSceneRow,
	DiffTokenReader,
} from "./types.ts";

interface DiffSceneGeometryInput {
	availableColumns: number;
	contentWidth: number;
	layout: DiffSceneLayout;
	rowHeights: readonly number[];
	rowOffsets: readonly number[];
}

interface CreateDiffSceneOptions {
	diff: FileDiff;
	generation: string;
	geometry: DiffSceneGeometryInput;
	layoutRevision: string;
	repositoryId: string;
	rows: readonly DiffRow[];
	stage: "full" | "preview";
	themeType: ResolvedTheme;
	viewport: { height: number; scale: number; width: number };
}

function validateSceneOptions(options: CreateDiffSceneOptions): void {
	const { geometry, rows, viewport } = options;
	if (geometry.rowHeights.length < rows.length || geometry.rowOffsets.length < rows.length) {
		throw new Error("Diff scene geometry must contain every row.");
	}
	if (!Number.isInteger(geometry.availableColumns) || geometry.availableColumns < 1) {
		throw new Error("Diff scene available columns must be a positive integer.");
	}
	for (const [name, value] of [
		["content width", geometry.contentWidth],
		["viewport width", viewport.width],
		["viewport height", viewport.height],
	] as const) {
		if (!Number.isFinite(value) || value < 0) throw new Error(`Diff scene ${name} is invalid.`);
	}
	if (!Number.isFinite(viewport.scale) || viewport.scale <= 0) {
		throw new Error("Diff scene viewport scale must be positive.");
	}
	const stride = geometry.layout.charWidth + geometry.layout.letterSpacing;
	if (
		!Number.isFinite(geometry.layout.lineHeight) ||
		geometry.layout.lineHeight <= 0 ||
		!Number.isFinite(stride) ||
		stride <= 0
	) {
		throw new Error("Diff scene text geometry must be positive.");
	}
	let expectedTop = 0;
	const rowIds = new Set<string>();
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		const height = geometry.rowHeights[index];
		const top = geometry.rowOffsets[index];
		if (!row || height === undefined || top === undefined) {
			throw new Error(`Diff scene row ${index} is missing geometry.`);
		}
		if (!Number.isFinite(height) || height < 0 || !Number.isFinite(top) || top < 0) {
			throw new Error(`Diff scene row ${index} has invalid geometry.`);
		}
		if (Math.abs(top - expectedTop) > 0.000_001) {
			throw new Error(`Diff scene row ${index} is not contiguous.`);
		}
		if (rowIds.has(row.id)) throw new Error(`Diff scene row id ${row.id} is duplicated.`);
		rowIds.add(row.id);
		expectedTop = top + height;
	}
}

function sceneRow(row: DiffRow, index: number, geometry: DiffSceneGeometryInput): DiffSceneRow {
	const visualKind = row.kind === "separator" ? "context" : row.kind;
	return {
		...row,
		backgroundColor:
			row.kind === "separator"
				? geometry.layout.separatorBackground
				: geometry.layout.lineBackgroundByKind[visualKind],
		height: geometry.rowHeights[index] ?? geometry.layout.lineHeight,
		indicator:
			row.noNewline || row.kind === "context" || row.kind === "separator" ? "none" : row.kind,
		lineNumber: row.newLine ?? row.oldLine,
		numberBackgroundColor: geometry.layout.numberCellByKind[visualKind],
		numberColor: geometry.layout.numberTextByKind[visualKind],
		top: geometry.rowOffsets[index] ?? 0,
	};
}

function rowIndexAtOffset(
	offsets: readonly number[],
	contentHeight: number,
	y: number,
): number | null {
	if (offsets.length === 0 || !Number.isFinite(y) || y < 0 || y >= contentHeight) return null;
	let low = 0;
	let high = offsets.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if ((offsets[middle] ?? 0) <= y) low = middle + 1;
		else high = middle - 1;
	}
	return Math.max(0, high);
}

function sortedLineRows(rows: readonly DiffSceneRow[], side: DiffLineSide) {
	const result: { index: number; line: number }[] = [];
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (!row || row.kind === "separator" || row.noNewline) continue;
		const line = side === "new" ? row.newLine : row.oldLine;
		if (line !== null) result.push({ index, line });
	}
	return result;
}

function nearestRowIndex(
	rows: readonly { index: number; line: number }[],
	lineNumber: number,
): number | null {
	if (rows.length === 0) return null;
	let low = 0;
	let high = rows.length - 1;
	while (low < high) {
		const middle = (low + high) >> 1;
		const entry = rows[middle];
		if (!entry || entry.line >= lineNumber) high = middle;
		else low = middle + 1;
	}
	return rows[low]?.index ?? null;
}

function alignedOffset(row: DiffSceneRow, viewportHeight: number, align: string): number {
	if (align === "center") return Math.max(0, row.top - (viewportHeight - row.height) / 2);
	if (align === "end") return Math.max(0, row.top - viewportHeight + row.height);
	return row.top;
}

function hunkLineTarget(
	diff: FileDiff,
	hunkIndex: number,
): { lineNumber: number; side: DiffLineSide } | null {
	const hunk = diff.hunks[hunkIndex];
	if (!hunk) return null;
	const firstLine = hunk.lines.find(
		(line) => line.kind !== "metadata" && (line.newLine !== null || line.oldLine !== null),
	);
	if (firstLine?.newLine !== null && firstLine?.newLine !== undefined) {
		return { lineNumber: firstLine.newLine, side: "new" };
	}
	if (firstLine?.oldLine !== null && firstLine?.oldLine !== undefined) {
		return { lineNumber: firstLine.oldLine, side: "old" };
	}
	if (hunk.newLines > 0) return { lineNumber: hunk.newStart, side: "new" };
	if (hunk.oldLines > 0) return { lineNumber: hunk.oldStart, side: "old" };
	return null;
}

function identifierAt(
	rows: readonly DiffSceneRow[],
	rowOffsets: readonly number[],
	contentHeight: number,
	layout: DiffSceneLayout,
	availableColumns: number,
	point: { x: number; y: number },
	tokens: DiffTokenReader,
): string | null {
	const rowIndex = rowIndexAtOffset(rowOffsets, contentHeight, point.y);
	if (rowIndex === null) return null;
	const row = rows[rowIndex];
	if (!row || row.kind === "separator" || row.noNewline) return null;
	const stride = layout.charWidth + layout.letterSpacing;
	const columnInLine = Math.floor((point.x - layout.gutterWidth - layout.contentPadding) / stride);
	if (columnInLine < 0) return null;
	if (layout.lineWrapEnabled && columnInLine >= availableColumns) return null;
	const visualLine = layout.lineWrapEnabled
		? Math.floor((point.y - row.top) / layout.lineHeight)
		: 0;
	const column = visualLine * availableColumns + columnInLine;
	let runStart = 0;
	for (const run of tokens.runsAt(rowIndex) ?? []) {
		const runEnd = runStart + run.text.length;
		if (column >= runStart && column < runEnd) return run.identifier ? run.text : null;
		runStart = runEnd;
	}
	return null;
}

function createQueries(
	diff: FileDiff,
	rows: readonly DiffSceneRow[],
	layout: DiffSceneLayout,
	availableColumns: number,
): DiffSceneQueries {
	const rowOffsets = rows.map((row) => row.top);
	const finalRow = rows.at(-1);
	const contentHeight = finalRow ? finalRow.top + finalRow.height : 0;
	const newRows = sortedLineRows(rows, "new");
	const oldRows = sortedLineRows(rows, "old");
	const offsetForLine = (target: DiffSceneLineTarget, viewportHeight: number): number | null => {
		const candidates = target.side === "new" ? newRows : oldRows;
		const rowIndex = nearestRowIndex(candidates, target.lineNumber);
		const row = rowIndex === null ? null : rows[rowIndex];
		return row ? alignedOffset(row, viewportHeight, target.align ?? "nearest") : null;
	};
	return {
		identifierAt: (point, tokens) =>
			identifierAt(rows, rowOffsets, contentHeight, layout, availableColumns, point, tokens),
		offsetForHunk: (hunkIndex, viewportHeight) => {
			const target = hunkLineTarget(diff, hunkIndex);
			return target ? offsetForLine({ ...target, align: "start" }, viewportHeight) : null;
		},
		offsetForLine,
		pointForColumn: (rowIndex, column) => {
			const row = rows[rowIndex];
			if (!row || column < 0 || column >= row.text.length) return null;
			const lineColumns = layout.lineWrapEnabled ? availableColumns : Number.MAX_SAFE_INTEGER;
			const visualLine = Math.floor(column / lineColumns);
			const columnInLine = column % lineColumns;
			return {
				x:
					layout.gutterWidth +
					layout.contentPadding +
					(columnInLine + 0.5) * (layout.charWidth + layout.letterSpacing),
				y: row.top + visualLine * layout.lineHeight + layout.lineHeight / 2,
			};
		},
		rowAtOffset: (y) => rowIndexAtOffset(rowOffsets, contentHeight, y),
		visibleLineAt: (y) => {
			const first = rowIndexAtOffset(rowOffsets, contentHeight, y);
			if (first === null) return null;
			for (let index = first; index < rows.length; index += 1) {
				const row = rows[index];
				if (!row || row.kind === "separator" || row.noNewline) continue;
				if (row.newLine !== null) return { lineNumber: row.newLine, side: "new" };
				if (row.oldLine !== null) return { lineNumber: row.oldLine, side: "old" };
			}
			return null;
		},
	};
}

export function createDiffScene(options: CreateDiffSceneOptions): DiffScene {
	validateSceneOptions(options);
	const rows = options.rows.map((row, index) => sceneRow(row, index, options.geometry));
	const finalRow = rows.at(-1);
	const contentHeight = finalRow ? finalRow.top + finalRow.height : 0;
	return {
		availableColumns: options.geometry.availableColumns,
		contentSize: { height: contentHeight, width: options.geometry.contentWidth },
		generation: options.generation,
		identity: {
			contentRevision: options.diff.contentRevision,
			fileId: options.diff.fileId,
			layoutRevision: options.layoutRevision,
			repositoryId: options.repositoryId,
		},
		layout: options.geometry.layout,
		queries: createQueries(
			options.diff,
			rows,
			options.geometry.layout,
			options.geometry.availableColumns,
		),
		rows,
		stage: options.stage,
		themeType: options.themeType,
		viewport: options.viewport,
	};
}
