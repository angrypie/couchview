import { GitCommitHorizontal, LoaderCircle, Sparkles, X } from "lucide-react";
import type { FormEvent } from "react";
import type { CommitMessageCapability } from "../../shared/contracts.ts";

interface CommitComposerSheetProps {
	busy: boolean;
	capability: CommitMessageCapability;
	message: string;
	messageBusy: boolean;
	onClose: () => void;
	onGenerate: () => void;
	onMessageChange: (message: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	open: boolean;
	stagedCount: number;
}

export function CommitComposerSheet({
	busy,
	capability,
	message,
	messageBusy,
	onClose,
	onGenerate,
	onMessageChange,
	onSubmit,
	open,
	stagedCount,
}: CommitComposerSheetProps) {
	if (!open) return null;

	return (
		<>
			<button
				aria-label="Close commit editor"
				className="sheet-scrim"
				onClick={onClose}
				type="button"
			/>
			<form
				aria-label="Commit staged changes"
				aria-modal="true"
				className="bottom-sheet"
				onSubmit={onSubmit}
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">Commit staged changes</h2>
						<div className="repo-meta">
							{stagedCount} staged {stagedCount === 1 ? "file" : "files"} · unstaged edits stay
							local
						</div>
					</div>
					<button
						aria-label="Close commit editor"
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
						className="composer-input commit-input"
						maxLength={20_000}
						onChange={(event) => onMessageChange(event.target.value)}
						placeholder="Commit message…"
						readOnly={messageBusy}
						value={message}
					/>
				</div>
				<div />
				<footer className="sheet-footer commit-footer">
					<div className="commit-actions">
						<button
							className="action-button secondary"
							disabled={!capability.available || messageBusy || busy || stagedCount === 0}
							onClick={onGenerate}
							title={capability.reason ?? undefined}
							type="button"
						>
							{messageBusy ? (
								<LoaderCircle className="spinner" size={16} />
							) : (
								<Sparkles size={16} />
							)}
							{messageBusy
								? "Generating…"
								: message.trim()
									? "Regenerate with Codex"
									: "Generate with Codex"}
						</button>
						<button
							className="action-button"
							disabled={!message.trim() || busy || messageBusy}
							type="submit"
						>
							{busy ? (
								<LoaderCircle className="spinner" size={16} />
							) : (
								<GitCommitHorizontal size={16} />
							)}
							Commit staged changes
						</button>
					</div>
					<div className="progress-label commit-generation-copy">
						{capability.available
							? messageBusy
								? "Generating a one-line Conventional Commit from staged changes…"
								: "Only staged changes are sent to Codex. Committing remains a separate action."
							: capability.reason}
					</div>
				</footer>
			</form>
		</>
	);
}
