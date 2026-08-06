import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	ChevronLeft,
	FileCode2,
	GitBranch,
	GitCommitHorizontal,
	History,
	LoaderCircle,
	MoreHorizontal,
	RotateCcw,
	Search,
	Trash2,
} from "lucide-react";
import { useState } from "react";

import type { ChangeFile, RepositorySummary } from "../../../shared/contracts.ts";
import type { GitHistoryFile } from "../../../shared/git/index.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import { DiffViewer } from "../../DiffViewer.tsx";
import type { GitWorkspaceController } from "../../features/git/index.ts";
import type { useDisplayPreferences } from "../../features/settings/useDisplayPreferences.ts";
import { codeFontStack } from "../../typographyPreferences.ts";
import { GitActionConfirmation } from "./GitActionConfirmation.tsx";

interface GitHistoryPageProps {
	commandPaletteShortcut: string;
	controller: GitWorkspaceController;
	display: ReturnType<typeof useDisplayPreferences>;
	files: ChangeFile[];
	onBack(): void;
	onOpenCommandPalette(): void;
	repository: RepositorySummary | null;
	themeType: ResolvedTheme;
}

const commitDate = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

function formatCommitDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : commitDate.format(date);
}

function fileKindLabel(file: GitHistoryFile): string {
	return file.kind === "type-changed" ? "type" : file.kind;
}

function HistoricalDiff({
	controller,
	display,
	themeType,
}: Pick<GitHistoryPageProps, "controller" | "display" | "themeType">) {
	if (controller.diffBusy && !controller.diff) {
		return (
			<div className="loading-state git-diff-state">
				<LoaderCircle className="spinner" size={24} />
				<p className="state-copy">Loading commit diff…</p>
			</div>
		);
	}
	if (!controller.diff) {
		return (
			<div className="empty-state git-diff-state">
				<FileCode2 className="state-icon" size={28} />
				<p className="state-copy">Select a changed file to preview its commit diff.</p>
			</div>
		);
	}
	if (controller.diff.binary) {
		return (
			<div className="empty-state git-diff-state">
				<FileCode2 className="state-icon" size={28} />
				<h3 className="state-title">Binary file</h3>
				<p className="state-copy">A line-by-line preview is not available.</p>
			</div>
		);
	}
	if (controller.diff.hunks.length === 0) {
		return (
			<div className="empty-state git-diff-state">
				<FileCode2 className="state-icon" size={28} />
				<p className="state-copy">This change has no textual hunks.</p>
			</div>
		);
	}
	return (
		<div className="git-diff-viewer">
			<DiffViewer
				comments={[]}
				diff={controller.diff}
				fontFamily={codeFontStack(display.typography.diff.fontFamily)}
				fontSize={display.fontSize}
				interactive={false}
				lineHeightAdjustment={display.typography.diff.lineHeightAdjustment}
				lineNumbersVisible={display.lineNumbersVisible}
				lineWrapEnabled={display.lineWrapEnabled}
				onCommentClick={() => undefined}
				onIdentifierClick={() => undefined}
				onLineNumberClick={() => undefined}
				onVisibleLineChange={() => undefined}
				selectedRange={null}
				themeType={themeType}
				widthAdjustment={display.typography.diff.widthAdjustment}
			/>
			{controller.diffBusy && (
				<div className="diff-refresh-indicator" role="status">
					<LoaderCircle className="spinner" size={14} /> Refreshing diff…
				</div>
			)}
		</div>
	);
}

export function GitHistoryPage({
	commandPaletteShortcut,
	controller,
	display,
	files,
	onBack,
	onOpenCommandPalette,
	repository,
	themeType,
}: GitHistoryPageProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const mobileView = controller.selectedFileId
		? "diff"
		: controller.selectedCommitId
			? "files"
			: "commits";
	const requestAction = (pending: Parameters<typeof controller.requestAction>[0]) => {
		setMenuOpen(false);
		controller.requestAction(pending);
	};
	const back = () => {
		setMenuOpen(false);
		controller.requestAction(null);
		onBack();
	};

	return (
		<main
			aria-label="Git history and repository actions"
			className={`git-history-page git-mobile-view-${mobileView}`}
		>
			<header className="git-history-toolbar">
				<button className="git-history-back" onClick={back} type="button">
					<ArrowLeft size={16} /> <span>Review</span>
				</button>
				<div className="git-history-heading">
					<h1>Git history</h1>
					<div>
						<div className="repo-meta">
							<GitBranch size={11} />{" "}
							{repository?.branch ?? `detached at ${repository?.head?.slice(0, 7) ?? "HEAD"}`}
						</div>
					</div>
				</div>
				<div className="git-header-actions">
					<button
						aria-label="Open command palette"
						className="icon-button command-palette-trigger"
						onClick={onOpenCommandPalette}
						title={`Open command palette (${commandPaletteShortcut})`}
						type="button"
					>
						<Search size={18} />
					</button>
					<div className="git-action-menu-wrap">
						<button
							aria-expanded={menuOpen}
							aria-haspopup="menu"
							aria-label="Repository actions"
							className="icon-button"
							onClick={() => setMenuOpen((current) => !current)}
							type="button"
						>
							<MoreHorizontal size={20} />
						</button>
						{menuOpen && (
							<div className="git-action-menu" role="menu">
								<button
									disabled={files.length === 0}
									onClick={() => requestAction({ action: "stash" })}
									role="menuitem"
									type="button"
								>
									<Archive size={16} /> Stash changes
								</button>
								<button
									disabled={!controller.status?.stashCount || files.length > 0}
									onClick={() => requestAction({ action: "restore-stash" })}
									role="menuitem"
									type="button"
								>
									<ArchiveRestore size={16} /> Restore latest stash (
									{controller.status?.stashCount ?? 0})
								</button>
								<button
									disabled={!controller.status?.canUndoLastCommit}
									onClick={() => requestAction({ action: "undo-last-commit" })}
									role="menuitem"
									type="button"
								>
									<RotateCcw size={16} /> Undo last commit
								</button>
								<button
									className="danger"
									disabled={Boolean(repository?.unborn) || files.length === 0}
									onClick={() => requestAction({ action: "clean" })}
									role="menuitem"
									type="button"
								>
									<Trash2 size={16} /> Clean repository
								</button>
							</div>
						)}
					</div>
				</div>
			</header>

			<div className="git-history-body">
				{!repository?.branch && controller.status?.previousBranch && (
					<div className="git-detached-banner">
						<span>Detached HEAD · previous branch {controller.status.previousBranch}</span>
						<button
							disabled={Boolean(controller.actionBusy)}
							onClick={() =>
								files.length > 0
									? requestAction({ action: "return" })
									: void controller.returnToPreviousBranch()
							}
							type="button"
						>
							Return
						</button>
					</div>
				)}

				<div className="git-workspace-content">
					<section aria-label="Commit history" className="git-history-pane">
						<div className="segmented git-history-scope">
							<button
								className={controller.scope === "current" ? "active" : ""}
								onClick={() => controller.setScope("current")}
								type="button"
							>
								Current
							</button>
							<button
								className={controller.scope === "all" ? "active" : ""}
								onClick={() => controller.setScope("all")}
								type="button"
							>
								All refs
							</button>
						</div>
						<div className="git-commit-list">
							{controller.loading && controller.commits.length === 0 ? (
								<div className="loading-state git-list-state">
									<LoaderCircle className="spinner" size={23} />
								</div>
							) : controller.commits.length === 0 ? (
								<div className="empty-state git-list-state">
									<History className="state-icon" size={25} />
									<p className="state-copy">No commits in this scope.</p>
								</div>
							) : (
								controller.commits.map((commit) => (
									<button
										className={`git-commit-row ${controller.selectedCommitId === commit.id ? "current" : ""}`}
										key={commit.id}
										onClick={() => void controller.selectCommit(commit)}
										type="button"
									>
										<GitCommitHorizontal size={16} />
										<span className="git-commit-copy">
											<strong>{commit.subject || "Untitled commit"}</strong>
											<small>
												{commit.shortId} · {commit.authorName} ·{" "}
												{formatCommitDate(commit.authoredAt)}
											</small>
											{commit.decorations.length > 0 && (
												<span className="git-ref-list">
													{commit.decorations.map((decoration) => (
														<span key={decoration}>{decoration}</span>
													))}
												</span>
											)}
										</span>
									</button>
								))
							)}
							{controller.nextCursor && (
								<button
									className="action-button secondary git-load-more"
									disabled={controller.loadMoreBusy}
									onClick={() => void controller.loadMore()}
									type="button"
								>
									{controller.loadMoreBusy && <LoaderCircle className="spinner" size={15} />} Load
									more
								</button>
							)}
						</div>
					</section>

					<section aria-label="Commit files" className="git-files-pane">
						<header className="git-pane-header">
							<button
								aria-label="Back to commits"
								className="icon-button git-mobile-back"
								onClick={controller.showCommits}
								type="button"
							>
								<ChevronLeft size={18} />
							</button>
							<div>
								<strong>{controller.details?.commit.subject ?? "Commit changes"}</strong>
								{controller.details && (
									<small>
										{controller.details.commit.shortId} · {controller.details.files.length} changed{" "}
										{controller.details.files.length === 1 ? "file" : "files"}
									</small>
								)}
							</div>
							{controller.details && (
								<button
									className="action-button git-checkout-action"
									disabled={Boolean(controller.actionBusy)}
									onClick={() =>
										requestAction({ action: "checkout", commit: controller.details!.commit })
									}
									type="button"
								>
									Checkout
								</button>
							)}
						</header>
						<div className="git-file-list">
							{controller.detailsBusy ? (
								<div className="loading-state git-list-state">
									<LoaderCircle className="spinner" size={23} />
								</div>
							) : controller.details ? (
								controller.details.files.map((file) => (
									<button
										className={`git-file-row ${controller.selectedFileId === file.id ? "current" : ""}`}
										key={file.id}
										onClick={() => void controller.selectFile(file.id)}
										type="button"
									>
										<FileCode2 size={15} />
										<span>
											<strong>{file.path}</strong>
											<small>
												{fileKindLabel(file)} · +{file.additions ?? "–"} −{file.deletions ?? "–"}
											</small>
										</span>
									</button>
								))
							) : (
								<div className="empty-state git-list-state">
									<p className="state-copy">Select a commit to inspect its files.</p>
								</div>
							)}
						</div>
					</section>

					<section aria-label="Historical diff" className="git-diff-pane">
						<header className="git-pane-header git-diff-header">
							<button
								aria-label="Back to commit files"
								className="icon-button git-mobile-back"
								onClick={controller.showFiles}
								type="button"
							>
								<ChevronLeft size={18} />
							</button>
							<div>
								<strong>{controller.diff?.path ?? "Commit diff"}</strong>
								{controller.diff && <small>Read-only historical preview</small>}
							</div>
						</header>
						<HistoricalDiff controller={controller} display={display} themeType={themeType} />
					</section>
				</div>
			</div>

			<GitActionConfirmation
				busy={Boolean(controller.actionBusy)}
				files={files}
				onCancel={() => controller.requestAction(null)}
				onConfirm={() => void controller.performPendingAction()}
				onRequestStash={() => controller.requestAction({ action: "stash" })}
				pending={controller.pendingAction}
				repository={repository}
				status={controller.status}
			/>
		</main>
	);
}
