import {
	CheckCircle2,
	Circle,
	GitCommitHorizontal,
	GitPullRequestArrow,
	ListFilter,
	LoaderCircle,
	Play,
	SquareTerminal,
	Undo2,
	X,
} from "lucide-react";
import type {
	FileChange,
	PackageRunSummary,
	PackageScriptDefinition,
	PackageScriptsPackage,
	PackageScriptsResponse,
} from "../../shared/contracts.ts";
import { packageLabel, runStatusLabel } from "../features/packages/packageRuns.ts";
import { changeLabel, stageLabel } from "../features/staging/changeFiles.ts";
import type {
	BulkStageScope,
	DrawerView,
	ReviewFilter,
	StageFilter,
} from "../features/staging/types.ts";

export type { DrawerView };

interface ChangedFilesDrawerProps {
	bulkStageBusy: BulkStageScope | null;
	bulkReviewBusy: boolean;
	changeTotals: { additions: number; deletions: number };
	commandsAvailable: boolean;
	commandsLoading: boolean;
	commitBusy: boolean;
	currentFileId: string | null;
	fileQuery: string;
	files: FileChange[];
	filteredFiles: FileChange[];
	onClose: () => void;
	onCommit: () => void;
	onFileQueryChange: (query: string) => void;
	onOpenRun: (run: PackageRunSummary) => void;
	onReviewFilterChange: (filter: ReviewFilter) => void;
	onSelectFile: (fileId: string) => void;
	onStageFilterChange: (filter: StageFilter) => void;
	onStageMultiple: (scope: BulkStageScope) => void;
	onUnreviewMultiple: () => void;
	onStartScript: (packageEntry: PackageScriptsPackage, script: PackageScriptDefinition) => void;
	onViewChange: (view: DrawerView) => void;
	open: boolean;
	packageRunBusy: string | null;
	packageRuns: PackageRunSummary[];
	packageScripts: PackageScriptsResponse;
	reviewFilter: ReviewFilter;
	filteredReviewedCount: number;
	splitView: boolean;
	stageBusy: boolean;
	stageFilter: StageFilter;
	stageableCount: number;
	stageableReviewedCount: number;
	stagedCount: number;
	view: DrawerView;
}

function FilePath({ path }: { path: string }) {
	const separatorIndex = path.lastIndexOf("/");
	const directory = separatorIndex >= 0 ? path.slice(0, separatorIndex + 1) : "";
	const name = path.slice(separatorIndex + 1);
	return (
		<span aria-label={path} className="file-row-path" title={path}>
			{directory && (
				<span aria-hidden="true" className="file-row-directory">
					{directory}
				</span>
			)}
			<span aria-hidden="true" className="file-row-name">
				{name}
			</span>
		</span>
	);
}

export function ChangedFilesDrawer({
	bulkReviewBusy,
	bulkStageBusy,
	changeTotals,
	commandsAvailable,
	commandsLoading,
	commitBusy,
	currentFileId,
	fileQuery,
	files,
	filteredFiles,
	onClose,
	onCommit,
	onFileQueryChange,
	onOpenRun,
	onReviewFilterChange,
	onSelectFile,
	onStageFilterChange,
	onStageMultiple,
	onStartScript,
	onUnreviewMultiple,
	onViewChange,
	open,
	packageRunBusy,
	packageRuns,
	packageScripts,
	reviewFilter,
	filteredReviewedCount,
	splitView,
	stageBusy,
	stageFilter,
	stageableCount,
	stageableReviewedCount,
	stagedCount,
	view,
}: ChangedFilesDrawerProps) {
	if (!open) return null;

	return (
		<>
			{!splitView && (
				<button
					aria-label="Close changed files"
					className="drawer-scrim"
					onClick={onClose}
					type="button"
				/>
			)}
			<aside aria-label="Changed files" className="drawer">
				<header className="drawer-header">
					<div>
						<h2 className="drawer-title">
							{view === "files" ? "Changed files" : "Package commands"}
						</h2>
						{view === "files" ? (
							<div
								aria-label={`${files.length} changed ${files.length === 1 ? "file" : "files"}, ${changeTotals.additions} ${changeTotals.additions === 1 ? "addition" : "additions"}, ${changeTotals.deletions} ${changeTotals.deletions === 1 ? "deletion" : "deletions"}`}
								className="repo-meta"
							>
								<span>
									{files.length} {files.length === 1 ? "file" : "files"}
								</span>
								<span aria-hidden="true">·</span>
								<span className="additions">+{changeTotals.additions}</span>
								<span className="deletions">−{changeTotals.deletions}</span>
							</div>
						) : (
							<div className="repo-meta">
								{packageScripts.packages.length}{" "}
								{packageScripts.packages.length === 1 ? "package" : "packages"}
							</div>
						)}
					</div>
					<button
						aria-label="Close changed files"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>

				<div className="filter-area">
					{commandsAvailable && (
						<div className="drawer-tabs" aria-label="Project drawer views">
							<button
								aria-pressed={view === "files"}
								className={view === "files" ? "active" : ""}
								onClick={() => onViewChange("files")}
								type="button"
							>
								Files
							</button>
							<button
								aria-pressed={view === "commands"}
								className={view === "commands" ? "active" : ""}
								onClick={() => onViewChange("commands")}
								type="button"
							>
								<SquareTerminal size={13} /> Commands
							</button>
						</div>
					)}
					{view === "files" ? (
						<>
							<label className="sr-only" htmlFor="file-filter">
								Filter changed files
							</label>
							<input
								className="filter-input"
								id="file-filter"
								onChange={(event) => onFileQueryChange(event.target.value)}
								placeholder="Filter paths…"
								type="search"
								value={fileQuery}
							/>
							<div className="drawer-filter-selects">
								<label>
									<span>Review</span>
									<select
										aria-label="Review filter"
										onChange={(event) => onReviewFilterChange(event.target.value as ReviewFilter)}
										value={reviewFilter}
									>
										<option value="all">All</option>
										<option value="unreviewed">Unreviewed</option>
										<option value="reviewed">Reviewed</option>
									</select>
								</label>
								<label>
									<span>Stage</span>
									<select
										aria-label="Stage filter"
										onChange={(event) => onStageFilterChange(event.target.value as StageFilter)}
										value={stageFilter}
									>
										<option value="all">Any</option>
										<option value="unstaged">Unstaged</option>
										<option value="staged">Staged</option>
									</select>
								</label>
							</div>
						</>
					) : (
						<div className="command-warning">
							Package scripts run on this computer as your user. Only run commands from repositories
							and networks you trust.
						</div>
					)}
				</div>

				{view === "files" ? (
					<div className="file-list">
						{filteredFiles.map((file) => (
							<button
								className={`file-row ${file.id === currentFileId ? "current" : ""}`}
								key={file.id}
								onClick={() => onSelectFile(file.id)}
								type="button"
							>
								{file.reviewed ? (
									<CheckCircle2 color="var(--green)" size={16} />
								) : (
									<Circle size={16} />
								)}
								<span className="file-row-copy">
									<FilePath path={file.path} />
									<span className="file-row-meta">
										<span>{changeLabel(file)}</span>
										{stageLabel(file) && stageLabel(file) !== changeLabel(file) && (
											<span>{stageLabel(file)}</span>
										)}
										{file.additions !== null && (
											<span className="additions">+{file.additions}</span>
										)}
										{file.deletions !== null && (
											<span className="deletions">−{file.deletions}</span>
										)}
									</span>
								</span>
								<span className="file-state-icons">
									{file.staged && <GitPullRequestArrow aria-label="Staged" size={13} />}
								</span>
							</button>
						))}
						{filteredFiles.length === 0 && (
							<div className="empty-state" style={{ minHeight: 160 }}>
								<ListFilter className="state-icon" size={24} />
								<p className="state-copy">No files match these filters.</p>
							</div>
						)}
					</div>
				) : (
					<div className="commands-list">
						{commandsLoading && packageScripts.packages.length === 0 ? (
							<div className="loading-state" style={{ minHeight: 140 }}>
								<LoaderCircle className="state-icon spinner" size={23} />
								<p className="state-copy">Finding package scripts…</p>
							</div>
						) : (
							<>
								{packageRuns.length > 0 && (
									<section className="command-group" aria-label="Recent package runs">
										<h3 className="command-group-title">Active and recent runs</h3>
										{packageRuns.map((run) => (
											<button
												className="package-run-row"
												key={run.id}
												onClick={() => onOpenRun(run)}
												type="button"
											>
												<span>
													<span className="package-script-name">{run.scriptName}</span>
													<span className="package-script-command">
														{run.directory} · {run.invocation}
													</span>
												</span>
												<span className={`run-status ${run.status}`}>
													{runStatusLabel(run.status)}
												</span>
											</button>
										))}
									</section>
								)}
								{packageScripts.packages.map((packageEntry) => (
									<section className="command-group" key={packageEntry.packagePath}>
										<h3 className="command-group-title">
											<span>{packageLabel(packageEntry)}</span>
											<code>{packageEntry.directory}</code>
										</h3>
										{packageEntry.scripts.length > 0 ? (
											packageEntry.scripts.map((script) => {
												const busyKey = `${packageEntry.packagePath}\0${script.name}`;
												const active = packageRuns.some(
													(run) =>
														run.packagePath === packageEntry.packagePath &&
														run.scriptName === script.name &&
														["running", "stopping"].includes(run.status),
												);
												return (
													<div className="package-script-row" key={script.name}>
														<span>
															<span className="package-script-name">{script.name}</span>
															<span className="package-script-command">{script.command}</span>
														</span>
														<button
															aria-label={`Run ${script.name} in ${packageEntry.directory}`}
															className="icon-button command-run-button"
															disabled={active || packageRunBusy === busyKey}
															onClick={() => onStartScript(packageEntry, script)}
															title={active ? "This script is already running" : "Run script"}
															type="button"
														>
															{packageRunBusy === busyKey ? (
																<LoaderCircle className="spinner" size={16} />
															) : (
																<Play size={15} />
															)}
														</button>
													</div>
												);
											})
										) : (
											<p className="command-empty">No scripts in this package.</p>
										)}
									</section>
								))}
								{packageScripts.warnings.map((warning) => (
									<div
										className="package-warning"
										key={`${warning.packagePath}:${warning.message}`}
									>
										<strong>{warning.packagePath}</strong>
										<span>{warning.message}</span>
									</div>
								))}
								{packageScripts.packages.length === 0 &&
									packageRuns.length === 0 &&
									packageScripts.warnings.length === 0 && (
										<div className="empty-state" style={{ minHeight: 160 }}>
											<SquareTerminal className="state-icon" size={26} />
											<p className="state-copy">No package.json files were detected.</p>
										</div>
									)}
							</>
						)}
					</div>
				)}

				<footer className="drawer-footer">
					{view === "files" ? (
						<>
							{(filteredReviewedCount > 0 || stageableCount > 0 || stageableReviewedCount > 0) && (
								<div className="bulk-file-actions">
									{filteredReviewedCount > 0 && (
										<button
											aria-label={`Unreview shown files (${filteredReviewedCount})`}
											className="action-button secondary"
											disabled={bulkReviewBusy || stageBusy || bulkStageBusy !== null}
											onClick={onUnreviewMultiple}
											title="Unreview files shown by the current filters"
											type="button"
										>
											{bulkReviewBusy ? (
												<LoaderCircle className="spinner" size={15} />
											) : (
												<Undo2 size={15} />
											)}
											<span>Unreview {filteredReviewedCount}</span>
										</button>
									)}
									{stageableCount > 0 && (
										<button
											aria-label={`Stage all files (${stageableCount})`}
											className="action-button secondary"
											disabled={stageBusy || bulkStageBusy !== null || bulkReviewBusy}
											onClick={() => onStageMultiple("all")}
											type="button"
										>
											{bulkStageBusy === "all" ? (
												<LoaderCircle className="spinner" size={15} />
											) : (
												<GitPullRequestArrow size={15} />
											)}
											<span>All {stageableCount}</span>
										</button>
									)}
									{stageableReviewedCount > 0 && (
										<button
											aria-label={`Stage reviewed files (${stageableReviewedCount})`}
											className="action-button secondary"
											disabled={stageBusy || bulkStageBusy !== null || bulkReviewBusy}
											onClick={() => onStageMultiple("reviewed")}
											type="button"
										>
											{bulkStageBusy === "reviewed" ? (
												<LoaderCircle className="spinner" size={15} />
											) : (
												<CheckCircle2 size={15} />
											)}
											<span>Reviewed {stageableReviewedCount}</span>
										</button>
									)}
								</div>
							)}
							{stagedCount > 0 ? (
								<button
									className="action-button commit-action"
									disabled={commitBusy}
									onClick={onCommit}
									type="button"
								>
									<GitCommitHorizontal size={16} />
									Commit {stagedCount} staged {stagedCount === 1 ? "file" : "files"}
								</button>
							) : (
								<div className="commit-status">
									<GitCommitHorizontal size={15} /> No staged changes
								</div>
							)}
						</>
					) : (
						<div className="progress-label command-footer-copy">
							Commands keep running when this panel closes. Open a recent run to reconnect to its
							output.
						</div>
					)}
				</footer>
			</aside>
		</>
	);
}
