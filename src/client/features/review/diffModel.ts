import type {
	DiffHunk,
	DiffLine,
	DiffSide,
	FileDiff,
	ReviewComment,
} from "../../../shared/contracts.ts";

export interface CommentSelection {
	side: DiffSide;
	start: number;
	end: number;
	oldStartLine?: number;
	oldEndLine?: number;
	newStartLine?: number;
	newEndLine?: number;
	hunk?: DiffHunk;
	excerpt: string[];
}

export interface HunkRow {
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

export interface LineSelection {
	side: DiffSide;
	hunkId: string;
	anchorIndex: number;
	focusIndex: number;
	anchorSide: SelectableSide;
	focusSide: SelectableSide;
}

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

export function workingTreeLineAtRow(rows: readonly DisplayRow[], rowIndex: number): number {
	const target = rows[rowIndex];
	if (target?.type !== "line") return 1;
	if (target.line.newLine !== null) return Math.max(1, target.line.newLine);
	for (let distance = 1; distance < rows.length; distance += 1) {
		for (const candidateIndex of [rowIndex + distance, rowIndex - distance]) {
			const candidate = rows[candidateIndex];
			if (
				candidate?.type === "line" &&
				candidate.hunk.id === target.hunk.id &&
				candidate.line.newLine !== null
			) {
				return Math.max(1, candidate.line.newLine);
			}
		}
	}
	return Math.max(1, target.hunk.newStart);
}

export function lineMatchesComment(line: DiffLine, comment: ReviewComment): boolean {
	if (comment.side === "mixed") {
		const oldMatches =
			line.oldLine !== null &&
			comment.oldStartLine !== undefined &&
			comment.oldEndLine !== undefined &&
			line.oldLine >= comment.oldStartLine &&
			line.oldLine <= comment.oldEndLine;
		const newMatches =
			line.newLine !== null &&
			comment.newStartLine !== undefined &&
			comment.newEndLine !== undefined &&
			line.newLine >= comment.newStartLine &&
			line.newLine <= comment.newEndLine;
		return oldMatches || newMatches;
	}
	const lineNumber = sideLine(line, comment.side);
	return lineNumber !== null && lineNumber >= comment.startLine && lineNumber <= comment.endLine;
}

export function formatSelectionReference(
	path: string,
	selection: {
		side: DiffSide;
		start: number;
		end: number;
		oldStartLine?: number;
		oldEndLine?: number;
		newStartLine?: number;
		newEndLine?: number;
	},
): string {
	const formatRange = (start: number, end: number) =>
		start === end ? `L${start}` : `L${start}-L${end}`;
	if (
		selection.side === "mixed" &&
		selection.oldStartLine !== undefined &&
		selection.oldEndLine !== undefined &&
		selection.newStartLine !== undefined &&
		selection.newEndLine !== undefined
	) {
		return `${path}:old ${formatRange(selection.oldStartLine, selection.oldEndLine)} / new ${formatRange(selection.newStartLine, selection.newEndLine)}`;
	}
	const side = selection.side === "old" ? " (old)" : "";
	return `${path}:${formatRange(selection.start, selection.end)}${side}`;
}
