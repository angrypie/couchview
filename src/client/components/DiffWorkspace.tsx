import type { SelectedLineRange } from "@pierre/diffs";
import {
	AlertTriangle,
	CheckCircle2,
	FileCode2,
	LoaderCircle,
	MessageSquareText,
	RefreshCw,
} from "lucide-react";
import type { RefObject } from "react";
import type { FileDiff, ReviewComment } from "../../shared/contracts.ts";
import type { TypographyPreferences } from "../../shared/settings.ts";
import { DiffViewer, type DiffViewerHandle } from "../DiffViewer.tsx";
import type { CommentSelection } from "../features/review/diffModel.ts";
import { codeFontStack } from "../typographyPreferences.ts";

interface DiffWorkspaceProps {
	commentComposerOpen: boolean;
	comments: ReviewComment[];
	diff: FileDiff | null;
	diffError: string;
	diffLoading: boolean;
	failureAvailable: boolean;
	fileCount: number;
	fontSize: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onClearSelection: () => void;
	onCommentClick: (comment: ReviewComment) => void;
	onIdentifierClick: (identifier: string) => void;
	onLineNumberClick: (lineNumber: number, side: "old" | "new") => void;
	onOpenCommentComposer: () => void;
	onOpenFailure: () => void;
	onRetry: () => void;
	onVisibleLineChange: (lineNumber: number, side: "old" | "new") => void;
	rowCount: number;
	retryAvailable: boolean;
	selection: CommentSelection | null;
	typography: TypographyPreferences["diff"];
	viewerRef: RefObject<DiffViewerHandle | null>;
	viewerSelection: SelectedLineRange | null;
}

function selectionLabel(selection: CommentSelection) {
	if (
		selection.side === "mixed" &&
		selection.oldStartLine !== undefined &&
		selection.oldEndLine !== undefined &&
		selection.newStartLine !== undefined &&
		selection.newEndLine !== undefined
	) {
		const oldEnd =
			selection.oldEndLine === selection.oldStartLine ? "" : `–${selection.oldEndLine}`;
		const newEnd =
			selection.newEndLine === selection.newStartLine ? "" : `–${selection.newEndLine}`;
		return `Old lines ${selection.oldStartLine}${oldEnd} / new lines ${selection.newStartLine}${newEnd}`;
	}
	const end = selection.end === selection.start ? "" : `–${selection.end}`;
	return `${selection.side === "old" ? "Old" : "New"} lines ${selection.start}${end}`;
}

export function DiffWorkspace({
	commentComposerOpen,
	comments,
	diff,
	diffError,
	diffLoading,
	failureAvailable,
	fileCount,
	fontSize,
	lineNumbersVisible,
	lineWrapEnabled,
	onClearSelection,
	onCommentClick,
	onIdentifierClick,
	onLineNumberClick,
	onOpenCommentComposer,
	onOpenFailure,
	onRetry,
	onVisibleLineChange,
	rowCount,
	retryAvailable,
	selection,
	typography,
	viewerRef,
	viewerSelection,
}: DiffWorkspaceProps) {
	return (
		<section className="workspace" aria-label="Unified diff">
			{fileCount === 0 ? (
				<div className="empty-state">
					<CheckCircle2 className="state-icon" color="var(--green)" size={34} />
					<h2 className="state-title">Working tree is clean</h2>
					<p className="state-copy">New changes will appear here automatically.</p>
				</div>
			) : diffLoading && !diff ? (
				<div className="loading-state">
					<LoaderCircle className="state-icon spinner" size={27} />
					<p className="state-copy">Loading diff…</p>
				</div>
			) : diffError && !diff ? (
				<div className="error-state">
					<AlertTriangle className="state-icon" size={28} />
					<h2 className="state-title">Couldn’t load this diff</h2>
					<p className="state-copy">{diffError}</p>
					{failureAvailable && (
						<button className="action-button secondary" onClick={onOpenFailure} type="button">
							Error details
						</button>
					)}
					{retryAvailable && (
						<button className="action-button secondary" onClick={onRetry} type="button">
							<RefreshCw size={15} /> Retry
						</button>
					)}
				</div>
			) : diff?.binary ? (
				<div className="empty-state">
					<FileCode2 className="state-icon" size={31} />
					<h2 className="state-title">Binary file</h2>
					<p className="state-copy">A line-by-line preview isn’t available for this change.</p>
					{diff.header.length > 0 && (
						<pre className="metadata-preview">{diff.header.join("\n")}</pre>
					)}
				</div>
			) : diff?.tooLarge && rowCount === 0 ? (
				<div className="empty-state">
					<AlertTriangle className="state-icon" size={31} />
					<h2 className="state-title">Diff is too large to display</h2>
					<p className="state-copy">Review this file using your local Git tools.</p>
				</div>
			) : rowCount === 0 ? (
				<div className="empty-state">
					<FileCode2 className="state-icon" size={31} />
					<h2 className="state-title">No textual hunks</h2>
					<p className="state-copy">Review the file metadata below.</p>
					{diff?.header.length ? (
						<pre className="metadata-preview">{diff.header.join("\n")}</pre>
					) : null}
				</div>
			) : diff ? (
				<DiffViewer
					comments={comments}
					diff={diff}
					fontFamily={codeFontStack(typography.fontFamily)}
					fontSize={fontSize}
					lineHeightAdjustment={typography.lineHeightAdjustment}
					lineNumbersVisible={lineNumbersVisible}
					lineWrapEnabled={lineWrapEnabled}
					onCommentClick={onCommentClick}
					onIdentifierClick={onIdentifierClick}
					onLineNumberClick={onLineNumberClick}
					onVisibleLineChange={onVisibleLineChange}
					ref={viewerRef}
					selectedRange={viewerSelection}
					widthAdjustment={typography.widthAdjustment}
				/>
			) : null}

			{diffLoading && diff && (
				<div className="diff-refresh-indicator" role="status">
					<LoaderCircle className="spinner" size={14} />
					<span>Refreshing diff…</span>
				</div>
			)}

			{selection && !commentComposerOpen && (
				<div className="selection-banner" role="status">
					<div className="selection-copy">{selectionLabel(selection)}</div>
					<div className="selection-actions">
						<button className="text-button" onClick={onClearSelection} type="button">
							Clear
						</button>
						<button className="text-button" onClick={onOpenCommentComposer} type="button">
							<MessageSquareText size={14} /> Comment
						</button>
					</div>
				</div>
			)}
		</section>
	);
}
