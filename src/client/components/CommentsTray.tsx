import { Copy, MessageSquareText, Pencil, Send, Trash2, X } from "lucide-react";
import type { CodexCapability, ReviewComment } from "../../shared/contracts.ts";
import { formatCommentReference } from "../commentExport.ts";

interface CommentsTrayProps {
	activeCommentCount: number;
	capability: CodexCapability;
	comments: ReviewComment[];
	currentCommentCount: number;
	focusedCommentId: string | null;
	onClose: () => void;
	onCopy: () => void;
	onDelete: (comment: ReviewComment) => void;
	onEdit: (comment: ReviewComment) => void;
	onJump: (comment: ReviewComment) => void;
	onSendToCodex: () => void;
	open: boolean;
}

export function CommentsTray({
	activeCommentCount,
	capability,
	comments,
	currentCommentCount,
	focusedCommentId,
	onClose,
	onCopy,
	onDelete,
	onEdit,
	onJump,
	onSendToCodex,
	open,
}: CommentsTrayProps) {
	if (!open) return null;

	return (
		<>
			<button
				aria-label="Close comment tray"
				className="sheet-scrim"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label="Review comments"
				aria-modal="true"
				className="bottom-sheet"
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">Review comments</h2>
						<div className="repo-meta">
							{activeCommentCount} on this file · {comments.length} total
						</div>
					</div>
					<button
						aria-label="Close comment tray"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>
				<div className="filter-area">
					<div className="progress-label" style={{ marginTop: 0, textAlign: "left" }}>
						Current comments from every file are copied together; stale comments stay visible but
						are excluded.
					</div>
				</div>
				<div className="comment-list">
					{comments.length === 0 ? (
						<div className="empty-state" style={{ minHeight: 170 }}>
							<MessageSquareText className="state-icon" size={26} />
							<p className="state-copy">
								Tap a line number, then another, to select a range and add a comment.
							</p>
						</div>
					) : (
						comments.map((comment) => (
							<article
								className={`comment-card ${focusedCommentId === comment.id ? "focused" : ""}`}
								data-comment-id={comment.id}
								key={comment.id}
								tabIndex={-1}
							>
								<button
									className="text-button"
									disabled={comment.stale}
									onClick={() => onJump(comment)}
									style={{ minHeight: 0, padding: 0 }}
									type="button"
								>
									<span className="comment-reference">
										{formatCommentReference(comment)} {comment.stale ? "· stale" : ""}
									</span>
								</button>
								<p className="comment-body">{comment.body}</p>
								<div className="comment-actions">
									<button
										aria-label={`Edit comment at ${formatCommentReference(comment)}`}
										className="text-button"
										onClick={() => onEdit(comment)}
										type="button"
									>
										<Pencil size={13} /> Edit
									</button>
									<button
										aria-label={`Delete comment at ${formatCommentReference(comment)}`}
										className="text-button danger"
										onClick={() => onDelete(comment)}
										type="button"
									>
										<Trash2 size={13} /> Delete
									</button>
								</div>
							</article>
						))
					)}
				</div>
				<footer className="sheet-footer">
					<button
						className="action-button"
						disabled={currentCommentCount === 0}
						onClick={onCopy}
						style={{ width: "100%" }}
						type="button"
					>
						<Copy size={16} /> Copy {currentCommentCount || "current"} for Codex
					</button>
					<button
						className="action-button secondary"
						onClick={onSendToCodex}
						title={capability.reason ?? undefined}
						style={{ width: "100%" }}
						type="button"
					>
						<Send size={16} /> Send to Codex
					</button>
				</footer>
			</section>
		</>
	);
}
