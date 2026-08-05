import { ArrowLeft, ChevronRight, Folder, LoaderCircle, MoveUp, Plus, X } from "lucide-react";
import type { useRepositoryDirectoryBrowser } from "../features/repositories/useRepositoryDirectoryBrowser.ts";

interface RepositoryDirectoryPickerSheetProps {
	addBusy: boolean;
	browser: ReturnType<typeof useRepositoryDirectoryBrowser>;
	onBack: () => void;
	onChoose: (path: string) => void;
	onClose: () => void;
}

export function RepositoryDirectoryPickerSheet({
	addBusy,
	browser,
	onBack,
	onChoose,
	onClose,
}: RepositoryDirectoryPickerSheetProps) {
	const listing = browser.listing;
	return (
		<section
			aria-label="Choose project folder"
			aria-modal="true"
			className="bottom-sheet repository-directory-picker"
			role="dialog"
		>
			<span className="sheet-grabber" />
			<header className="sheet-header">
				<button
					aria-label="Back to add project"
					className="icon-button"
					onClick={onBack}
					type="button"
				>
					<ArrowLeft size={19} />
				</button>
				<div className="repository-directory-heading">
					<h2 className="sheet-title">Choose project folder</h2>
					<div className="repo-meta">Folders on the Couchview server</div>
				</div>
				{browser.busy && <LoaderCircle className="spinner" size={17} />}
				<button
					aria-label="Close project folder picker"
					className="icon-button"
					onClick={onClose}
					type="button"
				>
					<X size={19} />
				</button>
			</header>
			<div className="repository-directory-path" title={listing?.path}>
				<code>{listing?.path ?? "Opening server folders…"}</code>
			</div>
			<div className="repository-directory-list">
				{listing?.parent && (
					<button
						className="repository-directory-row parent"
						disabled={browser.busy}
						onClick={() => void browser.browse(listing.parent ?? undefined)}
						type="button"
					>
						<MoveUp size={17} />
						<span>Parent folder</span>
						<ChevronRight size={16} />
					</button>
				)}
				{listing?.directories.map((directory) => (
					<button
						className="repository-directory-row"
						disabled={browser.busy}
						key={directory.path}
						onClick={() => void browser.browse(directory.path)}
						type="button"
					>
						<Folder size={17} />
						<span>{directory.name}</span>
						<ChevronRight size={16} />
					</button>
				))}
				{listing && listing.directories.length === 0 && (
					<div className="repository-directory-empty">No subfolders</div>
				)}
			</div>
			<footer className="sheet-footer repository-directory-footer">
				{listing?.truncated && <div className="progress-label">Showing the first 500 folders.</div>}
				<button
					className="action-button"
					disabled={!listing || browser.busy || addBusy}
					onClick={() => listing && onChoose(listing.path)}
					type="button"
				>
					{addBusy ? <LoaderCircle className="spinner" size={16} /> : <Plus size={16} />}
					Add this project
				</button>
			</footer>
		</section>
	);
}
