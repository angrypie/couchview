import { ChevronLeft, LoaderCircle, Search, X } from "lucide-react";
import type { RefObject } from "react";
import type { SearchMatch, SearchResponse, SourcePreviewResponse } from "../../shared/contracts.ts";
import type { SearchScope } from "../features/search/useRepositorySearch.ts";
import { HighlightedMatch } from "./HighlightedMatch.tsx";

interface SearchSheetProps {
	busy: boolean;
	inputRef: RefObject<HTMLInputElement | null>;
	onClose: () => void;
	onQueryChange: (query: string) => void;
	onScopeChange: (scope: SearchScope) => void;
	onShowResults: () => void;
	onShowSource: (match: SearchMatch) => void;
	open: boolean;
	query: string;
	result: SearchResponse | null;
	scope: SearchScope;
	sourceBusy: boolean;
	sourcePreview: SourcePreviewResponse | null;
}

export function SearchSheet({
	busy,
	inputRef,
	onClose,
	onQueryChange,
	onScopeChange,
	onShowResults,
	onShowSource,
	open,
	query,
	result,
	scope,
	sourceBusy,
	sourcePreview,
}: SearchSheetProps) {
	if (!open) return null;
	const activeMatches = scope === "current" ? result?.currentFile : result?.otherFiles;

	return (
		<>
			<button aria-label="Close search" className="sheet-scrim" onClick={onClose} type="button" />
			<section aria-label="Project search" aria-modal="true" className="bottom-sheet" role="dialog">
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">Find in project</h2>
						<div className="repo-meta">Click any code word to search</div>
					</div>
					<button aria-label="Close search" className="icon-button" onClick={onClose} type="button">
						<X size={19} />
					</button>
				</header>
				<div className="search-form">
					<label className="sr-only" htmlFor="project-search">
						Search project
					</label>
					<input
						className="search-input"
						id="project-search"
						onChange={(event) => onQueryChange(event.target.value)}
						ref={inputRef}
						spellCheck={false}
						type="search"
						value={query}
					/>
					<div className="segmented">
						<button
							className={scope === "current" ? "active" : ""}
							onClick={() => onScopeChange("current")}
							type="button"
						>
							Current file ({result?.currentFile.length ?? 0})
						</button>
						<button
							className={scope === "other" ? "active" : ""}
							onClick={() => onScopeChange("other")}
							type="button"
						>
							Other files ({result?.otherFiles.length ?? 0})
						</button>
					</div>
				</div>
				{sourcePreview ? (
					<div className="source-preview">
						<div className="source-path">{sourcePreview.path}</div>
						{sourcePreview.lines.map((line) => (
							<div
								className={`source-line ${line.line === sourcePreview.focusLine ? "active" : ""}`}
								key={line.line}
							>
								<span className="source-number">{line.line}</span>
								<code className="source-code">
									<HighlightedMatch query={query} text={line.text} />
								</code>
							</div>
						))}
					</div>
				) : (
					<div className="search-results">
						{busy || sourceBusy ? (
							<div className="loading-state" style={{ minHeight: 140 }}>
								<LoaderCircle className="state-icon spinner" size={23} />
							</div>
						) : query.trim().length < 1 ? (
							<div className="empty-state" style={{ minHeight: 140 }}>
								<Search className="state-icon" size={24} />
								<p className="state-copy">Enter a search term.</p>
							</div>
						) : activeMatches?.length ? (
							activeMatches.map((match) => (
								<button
									className="search-result"
									key={`${match.path}:${match.line}:${match.column}`}
									onClick={() => onShowSource(match)}
									type="button"
								>
									<div className="result-path">
										{match.path}:{match.line}:{match.column}
									</div>
									<div className="result-preview">
										<HighlightedMatch query={query} text={match.preview} />
									</div>
								</button>
							))
						) : (
							<div className="empty-state" style={{ minHeight: 140 }}>
								<Search className="state-icon" size={24} />
								<p className="state-copy">No matches in this scope.</p>
							</div>
						)}
					</div>
				)}
				<footer className="sheet-footer">
					{sourcePreview ? (
						<button
							className="action-button secondary"
							onClick={onShowResults}
							style={{ width: "100%" }}
							type="button"
						>
							<ChevronLeft size={16} /> Back to results
						</button>
					) : (
						<div className="progress-label">
							{result?.truncated ? "Showing the first matches" : "Searches tracked project files"}
						</div>
					)}
				</footer>
			</section>
		</>
	);
}
