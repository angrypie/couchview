import type { SelectedLineRange } from "@pierre/diffs";
import type { DiffSide } from "../../../shared/contracts.ts";
import { selectedRangeFromEndpoints } from "../../diffAdapter.ts";
import {
	type CommentSelection,
	type DisplayRow,
	type LineSelection,
	sideLine,
} from "./diffModel.ts";

function selectedRows(rows: DisplayRow[], selection: LineSelection) {
	const low = Math.min(selection.anchorIndex, selection.focusIndex);
	const high = Math.max(selection.anchorIndex, selection.focusIndex);
	return rows.slice(low, high + 1).flatMap((row) => {
		if (
			row.type !== "line" ||
			row.hunk.id !== selection.hunkId ||
			row.line.kind === "metadata" ||
			(selection.side === "mixed"
				? row.line.oldLine === null && row.line.newLine === null
				: sideLine(row.line, selection.side) === null)
		) {
			return [];
		}
		return [row];
	});
}

export function commentSelectionForRows(
	rows: DisplayRow[],
	selection: LineSelection | null,
): CommentSelection | null {
	if (!selection) return null;
	const selected = selectedRows(rows, selection);
	if (selected.length === 0) return null;
	const oldLineNumbers =
		selection.side === "new"
			? []
			: selected.flatMap((row) => (row.line.oldLine === null ? [] : [row.line.oldLine]));
	const newLineNumbers =
		selection.side === "old"
			? []
			: selected.flatMap((row) => (row.line.newLine === null ? [] : [row.line.newLine]));
	const resolvedSide: DiffSide =
		oldLineNumbers.length > 0 && newLineNumbers.length > 0
			? "mixed"
			: oldLineNumbers.length > 0
				? "old"
				: "new";
	const primaryLineNumbers = newLineNumbers.length > 0 ? newLineNumbers : oldLineNumbers;
	if (primaryLineNumbers.length === 0) return null;
	return {
		side: resolvedSide,
		start: Math.min(...primaryLineNumbers),
		end: Math.max(...primaryLineNumbers),
		...(oldLineNumbers.length > 0
			? {
					oldStartLine: Math.min(...oldLineNumbers),
					oldEndLine: Math.max(...oldLineNumbers),
				}
			: {}),
		...(newLineNumbers.length > 0
			? {
					newStartLine: Math.min(...newLineNumbers),
					newEndLine: Math.max(...newLineNumbers),
				}
			: {}),
		hunk: selected[0]?.hunk,
		excerpt: selected
			.slice(0, 200)
			.map((row) =>
				resolvedSide === "mixed"
					? `${row.line.kind === "addition" ? "+" : row.line.kind === "deletion" ? "-" : " "} ${row.line.text}`
					: row.line.text,
			),
	};
}

export function viewerSelectionForRows(
	rows: DisplayRow[],
	selection: LineSelection | null,
): SelectedLineRange | null {
	if (!selection) return null;
	const anchorRow = rows[selection.anchorIndex];
	const focusRow = rows[selection.focusIndex];
	if (anchorRow?.type !== "line" || focusRow?.type !== "line") return null;

	const anchorLine = sideLine(anchorRow.line, selection.anchorSide);
	const focusLine = sideLine(focusRow.line, selection.focusSide);
	if (anchorLine === null || focusLine === null) return null;

	return selectedRangeFromEndpoints(
		{
			lineNumber: anchorLine,
			rowIndex: selection.anchorIndex,
			side: selection.anchorSide,
		},
		{
			lineNumber: focusLine,
			rowIndex: selection.focusIndex,
			side: selection.focusSide,
		},
	);
}
