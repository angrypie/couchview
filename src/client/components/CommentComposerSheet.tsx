import { Check, LoaderCircle, X } from "lucide-react";
import type { FormEvent } from "react";
import type { ChangeFile, ReviewComment } from "../../shared/contracts.ts";
import { formatCommentReference } from "../commentExport.ts";
import { formatSelectionReference } from "../features/review/diffModel.ts";

interface CommentComposerSheetProps {
	activeFile: ChangeFile | null;
	body: string;
	busy: boolean;
	editingComment: ReviewComment | null;
	onBodyChange: (body: string) => void;
	onClose: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	open: boolean;
	selection: Parameters<typeof formatSelectionReference>[1] | null;
}

export function CommentComposerSheet({
	activeFile,
	body,
	busy,
	editingComment,
	onBodyChange,
	onClose,
	onSubmit,
	open,
	selection,
}: CommentComposerSheetProps) {
	if (!open) return null;

	return (
		<>
			<button
				aria-label="Close comment editor"
				className="sheet-scrim"
				onClick={onClose}
				type="button"
			/>
			<form
				aria-label={editingComment ? "Edit review comment" : "Add review comment"}
				aria-modal="true"
				className="bottom-sheet"
				onSubmit={onSubmit}
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">
							{editingComment ? "Edit comment" : "Add review comment"}
						</h2>
						<div className="repo-meta">
							{editingComment
								? formatCommentReference(editingComment)
								: selection && activeFile
									? formatSelectionReference(activeFile.path, selection)
									: "Selected lines"}
						</div>
					</div>
					<button
						aria-label="Close comment editor"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>
				<div style={{ minHeight: 0, overflow: "auto", padding: 9 }}>
					<textarea
						autoFocus
						className="comment-input"
						onChange={(event) => onBodyChange(event.target.value)}
						placeholder="Describe the issue and the expected correction…"
						value={body}
					/>
				</div>
				<div />
				<footer className="sheet-footer">
					<button
						className="action-button"
						disabled={!body.trim() || busy}
						style={{ width: "100%" }}
						type="submit"
					>
						{busy ? <LoaderCircle className="spinner" size={16} /> : <Check size={16} />}
						{editingComment ? "Save comment" : "Add comment"}
					</button>
				</footer>
			</form>
		</>
	);
}
