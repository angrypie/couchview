import { X } from "lucide-react";

interface ManualCopySheetProps {
	onClose: () => void;
	text: string;
}

export function ManualCopySheet({ onClose, text }: ManualCopySheetProps) {
	if (!text) return null;

	return (
		<>
			<button
				aria-label="Close manual copy dialog"
				className="modal-scrim"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label="Copy comments manually"
				aria-modal="true"
				className="bottom-sheet copy-sheet"
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">Copy comments manually</h2>
						<div className="repo-meta">Select the text and copy it into Codex.</div>
					</div>
					<button
						aria-label="Close manual copy dialog"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>
				<div className="copy-field-wrap">
					<textarea
						autoFocus
						className="copy-field"
						onFocus={(event) => event.currentTarget.select()}
						readOnly
						rows={14}
						value={text}
					/>
				</div>
			</section>
		</>
	);
}
