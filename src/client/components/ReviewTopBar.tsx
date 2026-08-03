import {
	ChevronDown,
	ChevronUp,
	GitBranch,
	GitGraph,
	Menu,
	MessageSquareText,
	Minus,
	MonitorUp,
	Plus,
	Search,
	Settings2,
	SquareTerminal,
	WrapText,
} from "lucide-react";
import type {
	ChangeFile,
	FileDiff,
	RemoteBridgeCapability,
	RepositorySummary,
	TerminalCapability,
} from "../../shared/contracts.ts";
import type { RepositoryConnectionState } from "../features/repositories/types.ts";
import { changeLabel, stageLabel } from "../features/staging/changeFiles.ts";
import { TYPOGRAPHY_LIMITS } from "../typographyPreferences.ts";

interface ReviewTopBarProps {
	activeFile: ChangeFile | null;
	canNavigateNextHunk: boolean;
	canNavigatePreviousHunk: boolean;
	commandPaletteShortcut: string;
	compactLandscape: boolean;
	connectionState: RepositoryConnectionState;
	diff: FileDiff | null;
	fileCount: number;
	fontSize: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onComments: () => void;
	onFontSizeChange: (fontSize: number) => void;
	onLineNumbersChange: (visible: boolean) => void;
	onLineWrapChange: (enabled: boolean) => void;
	onNavigateHunk: (direction: -1 | 1) => void;
	onOpenCommandPalette: () => void;
	onOpenDrawer: () => void;
	onOpenGitHistory: () => void;
	onOpenRemoteBridge: () => void;
	onOpenRepositoryPicker: () => void;
	onOpenSettings: () => void;
	onOpenTerminal: () => void;
	remoteBridgeCapability: RemoteBridgeCapability;
	repository: RepositorySummary | null;
	repositoryId: string | null;
	reviewedCount: number;
	splitView: boolean;
	terminalActive: boolean;
	terminalCapability: TerminalCapability;
	totalCommentCount: number;
}

function connectionTitle(connectionState: RepositoryConnectionState): string {
	if (connectionState === "connected") return "Connected";
	if (connectionState === "reconnecting") return "Reconnecting to local server";
	return "Offline — local server unavailable";
}

export function ReviewTopBar({
	activeFile,
	canNavigateNextHunk,
	canNavigatePreviousHunk,
	commandPaletteShortcut,
	compactLandscape,
	connectionState,
	diff,
	fileCount,
	fontSize,
	lineNumbersVisible,
	lineWrapEnabled,
	onComments,
	onFontSizeChange,
	onLineNumbersChange,
	onLineWrapChange,
	onNavigateHunk,
	onOpenCommandPalette,
	onOpenDrawer,
	onOpenGitHistory,
	onOpenRemoteBridge,
	onOpenRepositoryPicker,
	onOpenSettings,
	onOpenTerminal,
	remoteBridgeCapability,
	repository,
	repositoryId,
	reviewedCount,
	splitView,
	terminalActive,
	terminalCapability,
	totalCommentCount,
}: ReviewTopBarProps) {
	return (
		<header className="top-bar">
			<button
				aria-label="Open changed files"
				className="icon-button menu-button"
				onClick={onOpenDrawer}
				type="button"
			>
				<Menu size={20} />
			</button>
			{compactLandscape ? (
				<div aria-label="Current file" className="compact-file-context" role="region">
					<span
						className={`connection-dot ${connectionState}`}
						data-testid="repository-connection-status"
						title={connectionTitle(connectionState)}
					/>
					<button
						aria-label="Select repository"
						aria-haspopup="dialog"
						className="compact-repo-name repository-trigger"
						onClick={onOpenRepositoryPicker}
						title={`${repository?.name ?? "Couchview"} · ${repository?.branch ?? "detached"}`}
						type="button"
					>
						<span>{repository?.name ?? "Couchview"}</span>
						<ChevronDown size={12} />
					</button>
					<span className="compact-context-divider">/</span>
					<span className="file-path" title={activeFile?.path}>
						{activeFile?.path ?? "No changed file"}
					</span>
					{activeFile && (
						<div className="compact-file-meta">
							<span className="status-pill compact-change-kind">{changeLabel(activeFile)}</span>
							<span className="additions">+{activeFile.additions ?? diff?.additions ?? 0}</span>
							<span className="deletions">−{activeFile.deletions ?? diff?.deletions ?? 0}</span>
							{activeFile.reviewed && <span className="status-pill reviewed">reviewed</span>}
							{stageLabel(activeFile) && (
								<span className={`status-pill ${stageLabel(activeFile)}`}>
									{stageLabel(activeFile)}
								</span>
							)}
						</div>
					)}
				</div>
			) : (
				<div className="repo-heading">
					<button
						aria-label="Select repository"
						aria-haspopup="dialog"
						className="repo-name repository-trigger"
						onClick={onOpenRepositoryPicker}
						type="button"
					>
						<span
							className={`connection-dot ${connectionState}`}
							data-testid="repository-connection-status"
							title={connectionTitle(connectionState)}
						/>
						<span>{repository?.name ?? "Couchview"}</span>
						<ChevronDown size={13} />
					</button>
					<div className="repo-meta">
						<GitBranch size={10} />
						<span>{repository?.branch ?? "detached"}</span>
						<span>·</span>
						<span>
							{reviewedCount}/{fileCount} reviewed
						</span>
					</div>
				</div>
			)}
			{compactLandscape && (
				<div className="landscape-tools">
					<div className="compact-hunk-nav" aria-label="Hunk navigation">
						<button
							aria-label="Previous hunk"
							className="icon-button"
							disabled={!canNavigatePreviousHunk}
							onClick={() => onNavigateHunk(-1)}
							title="Previous hunk (K)"
							type="button"
						>
							<ChevronUp size={16} />
						</button>
						<button
							aria-label="Next hunk"
							className="icon-button"
							disabled={!canNavigateNextHunk}
							onClick={() => onNavigateHunk(1)}
							title="Next hunk (J)"
							type="button"
						>
							<ChevronDown size={16} />
						</button>
					</div>
					<button
						aria-label={`Open comments (${totalCommentCount})`}
						className="icon-button compact-comments-button"
						onClick={onComments}
						title="Review comments"
						type="button"
					>
						<MessageSquareText size={17} />
						{totalCommentCount > 0 && <span className="badge">{totalCommentCount}</span>}
					</button>
				</div>
			)}
			<button
				aria-label="Open command palette"
				className="icon-button command-palette-trigger"
				onClick={onOpenCommandPalette}
				title={`Open command palette (${commandPaletteShortcut})`}
				type="button"
			>
				<Search size={18} />
				{splitView && <kbd>{commandPaletteShortcut}</kbd>}
			</button>
			<button
				aria-label="Open Git history"
				className="icon-button git-history-launch-button"
				disabled={!repositoryId || !repository}
				onClick={onOpenGitHistory}
				title="Git history and repository actions"
				type="button"
			>
				<GitGraph size={18} />
			</button>
			<button
				aria-label="Set up native IDE"
				className="icon-button remote-bridge-launch-button"
				disabled={!repositoryId || !repository}
				onClick={onOpenRemoteBridge}
				title={
					remoteBridgeCapability.available
						? "Pair a Mac and open this repository in Zed"
						: (remoteBridgeCapability.reason ?? "Native remote development is unavailable")
				}
				type="button"
			>
				<MonitorUp size={18} />
			</button>
			<button
				aria-label="Open tmux terminal"
				aria-pressed={terminalActive}
				className="icon-button terminal-launch-button"
				disabled={!terminalCapability.available || !repositoryId}
				onClick={onOpenTerminal}
				title={
					terminalCapability.available
						? "Open persistent tmux terminal"
						: (terminalCapability.reason ?? "The browser tmux terminal is unavailable")
				}
				type="button"
			>
				<SquareTerminal size={18} />
			</button>
			{compactLandscape && (
				<button
					aria-label="Open settings"
					className="icon-button settings-launch-button"
					onClick={onOpenSettings}
					title="Typography settings"
					type="button"
				>
					<Settings2 size={18} />
				</button>
			)}
			<div className="font-controls" aria-label="Diff display controls">
				<button
					aria-label={lineNumbersVisible ? "Hide line numbers" : "Show line numbers"}
					aria-pressed={lineNumbersVisible}
					className={`number-toggle ${lineNumbersVisible ? "active" : ""}`}
					onClick={() => onLineNumbersChange(!lineNumbersVisible)}
					title={lineNumbersVisible ? "Hide line numbers" : "Show line numbers"}
					type="button"
				>
					123
				</button>
				<button
					aria-label={lineWrapEnabled ? "Keep long lines on one line" : "Wrap long lines"}
					aria-pressed={lineWrapEnabled}
					className={`wrap-toggle ${lineWrapEnabled ? "active" : ""}`}
					onClick={() => onLineWrapChange(!lineWrapEnabled)}
					title={lineWrapEnabled ? "Keep long lines on one line" : "Wrap long lines"}
					type="button"
				>
					<WrapText aria-hidden="true" size={16} />
				</button>
				<button
					aria-label="Decrease diff font size"
					className="icon-button compact-button"
					disabled={fontSize <= TYPOGRAPHY_LIMITS.diff.fontSize.min}
					onClick={() =>
						onFontSizeChange(
							Math.max(
								TYPOGRAPHY_LIMITS.diff.fontSize.min,
								fontSize - TYPOGRAPHY_LIMITS.diff.fontSize.step,
							),
						)
					}
					type="button"
				>
					<Minus size={15} />
				</button>
				<span className="font-value">{fontSize}px</span>
				<button
					aria-label="Increase diff font size"
					className="icon-button compact-button"
					disabled={fontSize >= TYPOGRAPHY_LIMITS.diff.fontSize.max}
					onClick={() =>
						onFontSizeChange(
							Math.min(
								TYPOGRAPHY_LIMITS.diff.fontSize.max,
								fontSize + TYPOGRAPHY_LIMITS.diff.fontSize.step,
							),
						)
					}
					type="button"
				>
					<Plus size={15} />
				</button>
			</div>
		</header>
	);
}
