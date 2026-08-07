import { AlertTriangle, CheckCircle2, FileCode2, LoaderCircle, RefreshCw } from "lucide-react";
import type { RefObject } from "react";
import type { FileDiff } from "../../shared/contracts.ts";
import type { TypographyPreferences } from "../../shared/settings.ts";
import type { ResolvedTheme } from "../../shared/theme.ts";
import { DiffViewer, type DiffViewerHandle } from "../DiffViewer.tsx";
import { codeFontStack } from "../typographyPreferences.ts";

interface DiffWorkspaceProps {
	diff: FileDiff | null;
	diffError: string;
	diffLoading: boolean;
	failureAvailable: boolean;
	fileCount: number;
	fontSize: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onIdentifierClick: (identifier: string) => void;
	onOpenFailure: () => void;
	onRetry: () => void;
	onVisibleLineChange: (lineNumber: number, side: "old" | "new") => void;
	rowCount: number;
	retryAvailable: boolean;
	themeType: ResolvedTheme;
	typography: TypographyPreferences["diff"];
	viewerRef: RefObject<DiffViewerHandle | null>;
}

export function DiffWorkspace({
	diff,
	diffError,
	diffLoading,
	failureAvailable,
	fileCount,
	fontSize,
	lineNumbersVisible,
	lineWrapEnabled,
	onIdentifierClick,
	onOpenFailure,
	onRetry,
	onVisibleLineChange,
	rowCount,
	retryAvailable,
	themeType,
	typography,
	viewerRef,
}: DiffWorkspaceProps) {
	return (
		<section className="workspace" aria-label="Unified diff">
			{fileCount === 0 ? (
				<div className="empty-state">
					<CheckCircle2 className="state-icon" color="var(--green)" size={34} />
					<h2 className="state-title">Working tree is clean</h2>
					<p className="state-copy">New changes will appear here automatically.</p>
				</div>
			) : diffLoading && !diff ? (
				<div className="loading-state">
					<LoaderCircle className="state-icon spinner" size={27} />
					<p className="state-copy">Loading diff…</p>
				</div>
			) : diffError && !diff ? (
				<div className="error-state">
					<AlertTriangle className="state-icon" size={28} />
					<h2 className="state-title">Couldn’t load this diff</h2>
					<p className="state-copy">{diffError}</p>
					{failureAvailable && (
						<button className="action-button secondary" onClick={onOpenFailure} type="button">
							Error details
						</button>
					)}
					{retryAvailable && (
						<button className="action-button secondary" onClick={onRetry} type="button">
							<RefreshCw size={15} /> Retry
						</button>
					)}
				</div>
			) : diff?.binary ? (
				<div className="empty-state">
					<FileCode2 className="state-icon" size={31} />
					<h2 className="state-title">Binary file</h2>
					<p className="state-copy">A line-by-line preview isn’t available for this change.</p>
					{diff.header.length > 0 && (
						<pre className="metadata-preview">{diff.header.join("\n")}</pre>
					)}
				</div>
			) : diff?.tooLarge && rowCount === 0 ? (
				<div className="empty-state">
					<AlertTriangle className="state-icon" size={31} />
					<h2 className="state-title">Diff is too large to display</h2>
					<p className="state-copy">Review this file using your local Git tools.</p>
				</div>
			) : rowCount === 0 ? (
				<div className="empty-state">
					<FileCode2 className="state-icon" size={31} />
					<h2 className="state-title">No textual hunks</h2>
					<p className="state-copy">Review the file metadata below.</p>
					{diff?.header.length ? (
						<pre className="metadata-preview">{diff.header.join("\n")}</pre>
					) : null}
				</div>
			) : diff ? (
				<DiffViewer
					diff={diff}
					fontFamily={codeFontStack(typography.fontFamily)}
					fontSize={fontSize}
					lineHeightAdjustment={typography.lineHeightAdjustment}
					lineNumbersVisible={lineNumbersVisible}
					lineWrapEnabled={lineWrapEnabled}
					onIdentifierClick={onIdentifierClick}
					onVisibleLineChange={onVisibleLineChange}
					ref={viewerRef}
					themeType={themeType}
					widthAdjustment={typography.widthAdjustment}
				/>
			) : null}

			{diffLoading && diff && (
				<div className="diff-refresh-indicator" role="status">
					<LoaderCircle className="spinner" size={14} />
					<span>Refreshing diff…</span>
				</div>
			)}
		</section>
	);
}
