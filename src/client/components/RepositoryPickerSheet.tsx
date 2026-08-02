import { Check, FileCode2, LoaderCircle, MonitorUp, RefreshCw, Trash2, X } from "lucide-react";
import type { RepositoryCatalogEntry, RestartCapability } from "../../shared/contracts.ts";
import type { RestartPhase } from "./RestartOverlay.tsx";

interface RepositoryPickerSheetProps {
	currentRepositoryId: string | null;
	forgetBusy: string | null;
	nativeSetupAvailable: boolean;
	onClose: () => void;
	onForget: (repository: RepositoryCatalogEntry) => void;
	onOpenNativeSetup: () => void;
	onRebuild: () => void;
	onSelect: (repository: RepositoryCatalogEntry) => void;
	open: boolean;
	repositories: RepositoryCatalogEntry[];
	restart: RestartCapability | null;
	restartPhase: RestartPhase;
}

export function RepositoryPickerSheet({
	currentRepositoryId,
	forgetBusy,
	nativeSetupAvailable,
	onClose,
	onForget,
	onOpenNativeSetup,
	onRebuild,
	onSelect,
	open,
	repositories,
	restart,
	restartPhase,
}: RepositoryPickerSheetProps) {
	if (!open) return null;

	return (
		<>
			<button
				aria-label="Close repository picker"
				className="sheet-scrim"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label="Repositories"
				aria-modal="true"
				className="bottom-sheet repository-picker"
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">Repositories</h2>
						<div className="repo-meta">Switch projects without restarting the server</div>
					</div>
					<button
						aria-label="Close repository picker"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>
				<div className="repository-list">
					{repositories.length > 0 ? (
						repositories.map((entry) => (
							<div
								className={`repository-row ${entry.id === currentRepositoryId ? "current" : ""} ${entry.available ? "" : "unavailable"}`}
								key={entry.id}
							>
								<button
									aria-current={entry.id === currentRepositoryId ? "true" : undefined}
									className="repository-select"
									disabled={!entry.available}
									onClick={() => onSelect(entry)}
									type="button"
								>
									<span className="repository-row-name">
										{entry.name}
										{entry.id === currentRepositoryId && <Check size={14} />}
									</span>
									<span className="repository-row-path">{entry.root}</span>
									{!entry.available && <span className="repository-row-status">Unavailable</span>}
								</button>
								<button
									aria-label={`Forget ${entry.name}`}
									className="icon-button repository-forget"
									disabled={forgetBusy !== null}
									onClick={() => onForget(entry)}
									title="Forget repository and delete its saved review state"
									type="button"
								>
									{forgetBusy === entry.id ? (
										<LoaderCircle className="spinner" size={16} />
									) : (
										<Trash2 size={16} />
									)}
								</button>
							</div>
						))
					) : (
						<div className="empty-state" style={{ minHeight: 150 }}>
							<FileCode2 className="state-icon" size={26} />
							<p className="state-copy">No saved repositories.</p>
						</div>
					)}
				</div>
				<footer className="sheet-footer">
					{restart && (
						<>
							<button
								className="action-button secondary repository-restart-action"
								disabled={!restart.available || restartPhase !== null}
								onClick={onRebuild}
								type="button"
							>
								{restartPhase === "building" ? (
									<LoaderCircle className="spinner" size={16} />
								) : (
									<RefreshCw size={16} />
								)}
								Rebuild &amp; restart Couchview
							</button>
							<div className="progress-label">
								{restart.available
									? "Builds this Couchview checkout, then reloads the current review."
									: restart.reason}
							</div>
						</>
					)}
					{nativeSetupAvailable && (
						<button
							className="action-button secondary repository-remote-action"
							onClick={onOpenNativeSetup}
							type="button"
						>
							<MonitorUp size={16} /> Native IDE setup
						</button>
					)}
					<div className="progress-label">
						Run <code>couchview</code> inside another Git project to add it.
					</div>
				</footer>
			</section>
		</>
	);
}
