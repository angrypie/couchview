import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	GitPullRequestArrow,
	LoaderCircle,
	MessageSquareText,
	Undo2,
} from "lucide-react";
import type { ChangeFile } from "../../shared/contracts.ts";

interface ReviewBottomBarProps {
	activeFile: ChangeFile | null;
	activeFileFullyStaged: boolean;
	activeFileIndex: number;
	bulkStageBusy: boolean;
	canNavigateNextHunk: boolean;
	canNavigatePreviousHunk: boolean;
	fileCount: number;
	onComments: () => void;
	onNavigateFile: (direction: -1 | 1) => void;
	onNavigateHunk: (direction: -1 | 1) => void;
	onReview: () => void;
	onToggleStage: () => void;
	reviewBusy: boolean;
	stageBusy: boolean;
	totalCommentCount: number;
}

export function ReviewBottomBar({
	activeFile,
	activeFileFullyStaged,
	activeFileIndex,
	bulkStageBusy,
	canNavigateNextHunk,
	canNavigatePreviousHunk,
	fileCount,
	onComments,
	onNavigateFile,
	onNavigateHunk,
	onReview,
	onToggleStage,
	reviewBusy,
	stageBusy,
	totalCommentCount,
}: ReviewBottomBarProps) {
	return (
		<nav className="bottom-bar" aria-label="Review actions">
			<div className="nav-pair file-nav" aria-label="File navigation">
				<button
					aria-label="Previous file"
					className="icon-button"
					disabled={activeFileIndex <= 0}
					onClick={() => onNavigateFile(-1)}
					type="button"
				>
					<ChevronLeft size={18} />
				</button>
				<button
					aria-label="Next file"
					className="icon-button"
					disabled={activeFileIndex < 0 || activeFileIndex >= fileCount - 1}
					onClick={() => onNavigateFile(1)}
					type="button"
				>
					<ChevronRight size={18} />
				</button>
			</div>
			<div className="nav-pair hunk-nav" aria-label="Hunk navigation">
				<button
					aria-label="Previous hunk"
					className="icon-button"
					disabled={!canNavigatePreviousHunk}
					onClick={() => onNavigateHunk(-1)}
					title="Previous hunk (K)"
					type="button"
				>
					<ChevronUp size={18} />
				</button>
				<button
					aria-label="Next hunk"
					className="icon-button"
					disabled={!canNavigateNextHunk}
					onClick={() => onNavigateHunk(1)}
					title="Next hunk (J)"
					type="button"
				>
					<ChevronDown size={18} />
				</button>
			</div>
			<button
				aria-label={activeFile?.reviewed ? "Unreview current file" : "Review + next"}
				className={`action-button review-action ${activeFile?.reviewed ? "success" : ""}`}
				disabled={!activeFile || reviewBusy}
				onClick={onReview}
				title="Mark reviewed and advance"
				type="button"
			>
				{reviewBusy ? (
					<LoaderCircle className="spinner" size={16} />
				) : activeFile?.reviewed ? (
					<Undo2 size={16} />
				) : (
					<Check size={16} />
				)}
				<span className="action-copy">{activeFile?.reviewed ? "Unreview" : "Review + next"}</span>
			</button>
			<button
				aria-label={activeFileFullyStaged ? "Unstage current file" : "Stage current file"}
				className="icon-button stage-action"
				disabled={!activeFile || stageBusy || bulkStageBusy}
				onClick={onToggleStage}
				title={activeFileFullyStaged ? "Unstage file" : "Stage file"}
				type="button"
			>
				{stageBusy || bulkStageBusy ? (
					<LoaderCircle className="spinner" size={19} />
				) : (
					<GitPullRequestArrow color={activeFile?.staged ? "var(--accent)" : undefined} size={19} />
				)}
				<span className="stage-copy">{activeFileFullyStaged ? "Unstage" : "Stage"}</span>
			</button>
			<button
				aria-label={`Open comments (${totalCommentCount})`}
				className="icon-button comments-action"
				onClick={onComments}
				title="Review comments"
				type="button"
			>
				<MessageSquareText size={19} />
				{totalCommentCount > 0 && <span className="badge">{totalCommentCount}</span>}
			</button>
		</nav>
	);
}
