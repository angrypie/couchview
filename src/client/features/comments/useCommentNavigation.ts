import { type Dispatch, type RefObject, type SetStateAction, useEffect } from "react";
import type { FileDiff, ReviewComment } from "../../../shared/contracts.ts";
import {
	type DisplayRow,
	type LineRow,
	type LineSelection,
	lineMatchesComment,
	type SelectableSide,
} from "../review/diffModel.ts";
import type { DiffViewerHandle } from "../review/types.ts";

interface UseCommentNavigationOptions {
	diff: FileDiff | null;
	focusedCommentId: string | null;
	pendingComment: ReviewComment | null;
	rows: DisplayRow[];
	setPendingComment: Dispatch<SetStateAction<ReviewComment | null>>;
	setSelection: Dispatch<SetStateAction<LineSelection | null>>;
	trayOpen: boolean;
	viewerRef: RefObject<DiffViewerHandle | null>;
}

function sideForCommentRow(
	comment: ReviewComment,
	row: LineRow,
	boundary: "first" | "last",
): SelectableSide {
	if (comment.side === "old") return "old";
	if (comment.side === "new") return "new";
	if (boundary === "last" && row.line.newLine !== null) return "new";
	if (row.line.oldLine !== null) return "old";
	return "new";
}

export function useCommentNavigation({
	diff,
	focusedCommentId,
	pendingComment,
	rows,
	setPendingComment,
	setSelection,
	trayOpen,
	viewerRef,
}: UseCommentNavigationOptions) {
	useEffect(() => {
		if (!trayOpen || !focusedCommentId) return;
		const frame = window.requestAnimationFrame(() => {
			const card = [...document.querySelectorAll<HTMLElement>("[data-comment-id]")].find(
				(element) => element.dataset.commentId === focusedCommentId,
			);
			card?.scrollIntoView?.({ block: "nearest" });
			card?.focus();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusedCommentId, trayOpen]);

	useEffect(() => {
		if (!pendingComment || !diff || pendingComment.fileId !== diff.fileId) return;
		const matchingRowIndexes = rows.flatMap((row, index) =>
			row.type === "line" && lineMatchesComment(row.line, pendingComment) ? [index] : [],
		);
		const firstRowIndex = matchingRowIndexes[0];
		const lastRowIndex = matchingRowIndexes.at(-1);
		if (firstRowIndex !== undefined && lastRowIndex !== undefined) {
			viewerRef.current?.scrollToComment(pendingComment);
			const firstRow = rows[firstRowIndex];
			const lastRow = rows[lastRowIndex];
			if (firstRow?.type === "line" && lastRow?.type === "line") {
				const anchorSide = sideForCommentRow(pendingComment, firstRow, "first");
				const focusSide = sideForCommentRow(pendingComment, lastRow, "last");
				setSelection({
					side: pendingComment.side,
					hunkId: firstRow.hunk.id,
					anchorIndex: firstRowIndex,
					focusIndex: lastRowIndex,
					anchorSide,
					focusSide,
				});
			}
		}
		setPendingComment(null);
	}, [diff, pendingComment, rows, setPendingComment, setSelection, viewerRef]);
}
