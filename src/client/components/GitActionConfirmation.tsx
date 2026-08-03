import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { ChangeFile, GitWorkspaceStatus, RepositorySummary } from "../../shared/contracts.ts";
import type { GitPendingAction } from "../features/history/useGitWorkspace.ts";

interface GitActionConfirmationProps {
	busy: boolean;
	files: ChangeFile[];
	onCancel: () => void;
	onConfirm: () => void;
	onRequestStash: () => void;
	pending: GitPendingAction | null;
	repository: RepositorySummary | null;
	status: GitWorkspaceStatus | null;
}

function actionCopy(pending: GitPendingAction, status: GitWorkspaceStatus | null) {
	switch (pending.action) {
		case "checkout":
			return {
				title: `Checkout ${pending.commit.shortId}`,
				body: `Move this repository to “${pending.commit.subject}” in detached HEAD mode. You can return to the current branch afterward.`,
				confirm: "Checkout commit",
			};
		case "return":
			return {
				title: "Return to previous branch",
				body: `Checkout ${status?.previousBranch ?? "the previous branch"} and leave detached HEAD mode.`,
				confirm: "Return to branch",
			};
		case "stash":
			return {
				title: "Stash repository changes",
				body: "Save staged, unstaged, and untracked changes, then restore a clean working tree.",
				confirm: "Stash changes",
			};
		case "restore-stash":
			return {
				title: "Restore latest stash",
				body: "Apply and drop the latest stash. If Git reports conflicts, the stash will be kept.",
				confirm: "Restore stash",
			};
		case "undo-last-commit":
			return {
				title: "Undo last commit",
				body: "Move the current branch back one commit while keeping all file changes locally and unstaged. A pushed commit would require a force push to rewrite remotely.",
				confirm: "Undo commit",
			};
		case "clean":
			return {
				title: "Clean repository",
				body: `Permanently discard ${status?.trackedChangeCount ?? 0} tracked and ${status?.untrackedChangeCount ?? 0} untracked changes. Ignored files and nested repositories are preserved.`,
				confirm: "Clean repository",
			};
	}
}

export function GitActionConfirmation({
	busy,
	files,
	onCancel,
	onConfirm,
	onRequestStash,
	pending,
	repository,
	status,
}: GitActionConfirmationProps) {
	const [acknowledged, setAcknowledged] = useState(false);
	useEffect(() => setAcknowledged(false), [pending]);
	if (!pending) return null;
	const copy = actionCopy(pending, status);
	const checkoutBlocked = ["checkout", "return"].includes(pending.action) && files.length > 0;
	const destructive = pending.action === "clean";
	const disabled = busy || checkoutBlocked || (destructive && !acknowledged);

	return (
		<>
			<button
				aria-label="Cancel Git action"
				className="modal-scrim git-confirm-scrim"
				onClick={onCancel}
				type="button"
			/>
			<section
				aria-label={copy.title}
				aria-modal="true"
				className="git-confirm-dialog"
				role="dialog"
			>
				<header className="modal-header">
					<AlertTriangle color={destructive ? "var(--red)" : "var(--yellow)"} size={20} />
					<h2 className="modal-title">{copy.title}</h2>
				</header>
				<div className="git-confirm-copy">
					<p className={destructive ? "git-destructive-summary" : undefined}>{copy.body}</p>
					{checkoutBlocked && (
						<div className="git-action-warning">
							This checkout is blocked because the repository has {files.length} changed{" "}
							{files.length === 1 ? "file" : "files"}. Stash or clean them first.
						</div>
					)}
					{destructive && (
						<label className="git-clean-acknowledgment">
							<input
								checked={acknowledged}
								onChange={(event) => setAcknowledged(event.target.checked)}
								type="checkbox"
							/>
							<span>I understand these changes cannot be recovered by Couchview.</span>
						</label>
					)}
					{repository?.unborn && destructive && (
						<div className="git-action-warning">An unborn repository cannot be cleaned.</div>
					)}
				</div>
				<footer className="modal-footer git-confirm-actions">
					<button
						className="action-button secondary"
						disabled={busy}
						onClick={onCancel}
						type="button"
					>
						Cancel
					</button>
					{checkoutBlocked && (
						<button
							className="action-button secondary"
							disabled={busy}
							onClick={onRequestStash}
							type="button"
						>
							Stash changes…
						</button>
					)}
					<button
						className={`action-button ${destructive ? "danger" : ""}`}
						disabled={disabled || (destructive && Boolean(repository?.unborn))}
						onClick={onConfirm}
						type="button"
					>
						{busy && <LoaderCircle className="spinner" size={16} />}
						{copy.confirm}
					</button>
				</footer>
			</section>
		</>
	);
}
