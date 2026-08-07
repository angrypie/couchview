import type { DiffHunk, DiffLine, DiffSide, FileDiff } from "../../../shared/contracts.ts";

interface HunkRow {
	type: "hunk";
	key: string;
	hunk: DiffHunk;
	hunkIndex: number;
}

export interface LineRow {
	type: "line";
	key: string;
	line: DiffLine;
	hunk: DiffHunk;
	hunkIndex: number;
}

export type DisplayRow = HunkRow | LineRow;
export type SelectableSide = Exclude<DiffSide, "mixed">;

export interface HunkNavigation {
	previous: number | null;
	next: number | null;
}

export function rowsForDiff(diff: FileDiff | null): DisplayRow[] {
	if (!diff) return [];
	return diff.hunks.flatMap((hunk, hunkIndex): DisplayRow[] => [
		{ type: "hunk", key: `hunk:${hunk.id}`, hunk, hunkIndex },
		...hunk.lines.map(
			(line): LineRow => ({
				type: "line",
				key: `line:${hunk.id}:${line.id}`,
				line,
				hunk,
				hunkIndex,
			}),
		),
	]);
}

export function sideLine(line: DiffLine, side: SelectableSide): number | null {
	return side === "new" ? line.newLine : line.oldLine;
}

export function navigationBeforeFirstHunk(): HunkNavigation {
	return { previous: null, next: 0 };
}

export function navigationAtHunk(hunkIndex: number, hunkCount: number): HunkNavigation {
	return {
		previous: hunkIndex > 0 ? hunkIndex - 1 : null,
		next: hunkIndex + 1 < hunkCount ? hunkIndex + 1 : null,
	};
}

function hunkRange(hunk: DiffHunk, side: SelectableSide): { start: number; end: number } {
	const lineNumbers = hunk.lines.flatMap((line) => {
		const lineNumber = sideLine(line, side);
		return lineNumber === null ? [] : [lineNumber];
	});
	if (lineNumbers.length > 0) {
		return {
			start: Math.min(...lineNumbers),
			end: Math.max(...lineNumbers),
		};
	}
	const start = side === "new" ? hunk.newStart : hunk.oldStart;
	const lineCount = side === "new" ? hunk.newLines : hunk.oldLines;
	return { start, end: start + Math.max(1, lineCount) - 1 };
}

export function navigationAtVisibleLine(
	hunks: readonly DiffHunk[],
	lineNumber: number,
	side: SelectableSide,
): HunkNavigation {
	for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
		const range = hunkRange(hunks[hunkIndex]!, side);
		if (lineNumber < range.start) {
			return {
				previous: hunkIndex > 0 ? hunkIndex - 1 : null,
				next: hunkIndex,
			};
		}
		if (lineNumber <= range.end) {
			return navigationAtHunk(hunkIndex, hunks.length);
		}
	}
	return {
		previous: hunks.length > 0 ? hunks.length - 1 : null,
		next: null,
	};
}
