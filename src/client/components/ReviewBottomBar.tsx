import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	GitPullRequestArrow,
	LoaderCircle,
	Undo2,
} from "lucide-react";
import type { FileChange } from "../../shared/contracts.ts";

const BUTTON_MOTION_CLASSES =
	"group transition-colors transition-transform duration-150 active:scale-[0.98]";
const GROUP_CONTENT_MOTION_CLASSES =
	"transition-opacity duration-150 group-active:opacity-80 group-focus:opacity-90";

interface ReviewBottomBarProps {
	activeFile: FileChange | null;
	activeFileFullyStaged: boolean;
	activeFileIndex: number;
	bulkStageBusy: boolean;
	canNavigateNextHunk: boolean;
	canNavigatePreviousHunk: boolean;
	fileCount: number;
	onNavigateFile: (direction: -1 | 1) => void;
	onNavigateHunk: (direction: -1 | 1) => void;
	onReview: () => void;
	onToggleStage: () => void;
	reviewBusy: boolean;
	stageBusy: boolean;
}

export function ReviewBottomBar({
	activeFile,
	activeFileFullyStaged,
	activeFileIndex,
	bulkStageBusy,
	canNavigateNextHunk,
	canNavigatePreviousHunk,
	fileCount,
	onNavigateFile,
	onNavigateHunk,
	onReview,
	onToggleStage,
	reviewBusy,
	stageBusy,
}: ReviewBottomBarProps) {
	return (
		<nav
			className="bottom-bar min-h-[57px] px-safe-or-1 pt-1 pb-safe-offset-1"
			aria-label="Review actions"
		>
			<div className="nav-pair file-nav" aria-label="File navigation">
				<button
					aria-label="Previous file"
					className={`icon-button ${BUTTON_MOTION_CLASSES}`}
					disabled={activeFileIndex <= 0}
					onClick={() => onNavigateFile(-1)}
					type="button"
				>
					<ChevronLeft className={GROUP_CONTENT_MOTION_CLASSES} size={18} />
				</button>
				<button
					aria-label="Next file"
					className={`icon-button ${BUTTON_MOTION_CLASSES}`}
					disabled={activeFileIndex < 0 || activeFileIndex >= fileCount - 1}
					onClick={() => onNavigateFile(1)}
					type="button"
				>
					<ChevronRight className={GROUP_CONTENT_MOTION_CLASSES} size={18} />
				</button>
			</div>
			<div className="nav-pair hunk-nav" aria-label="Hunk navigation">
				<button
					aria-label="Previous hunk"
					className={`icon-button ${BUTTON_MOTION_CLASSES}`}
					disabled={!canNavigatePreviousHunk}
					onClick={() => onNavigateHunk(-1)}
					title="Previous hunk (K)"
					type="button"
				>
					<ChevronUp className={GROUP_CONTENT_MOTION_CLASSES} size={18} />
				</button>
				<button
					aria-label="Next hunk"
					className={`icon-button ${BUTTON_MOTION_CLASSES}`}
					disabled={!canNavigateNextHunk}
					onClick={() => onNavigateHunk(1)}
					title="Next hunk (J)"
					type="button"
				>
					<ChevronDown className={GROUP_CONTENT_MOTION_CLASSES} size={18} />
				</button>
			</div>
			<button
				aria-label={activeFile?.reviewed ? "Unreview current file" : "Review + next"}
				className={`action-button review-action ${BUTTON_MOTION_CLASSES} ${activeFile?.reviewed ? "success" : ""}`}
				disabled={!activeFile || reviewBusy}
				onClick={onReview}
				title="Mark reviewed and advance"
				type="button"
			>
				{reviewBusy ? (
					<LoaderCircle className="spinner" size={16} />
				) : activeFile?.reviewed ? (
					<Undo2 className={GROUP_CONTENT_MOTION_CLASSES} size={16} />
				) : (
					<Check className={GROUP_CONTENT_MOTION_CLASSES} size={16} />
				)}
				<span className={`action-copy ${GROUP_CONTENT_MOTION_CLASSES}`}>
					{activeFile?.reviewed ? "Unreview" : "Review + next"}
				</span>
			</button>
			<button
				aria-label={activeFileFullyStaged ? "Unstage current file" : "Stage current file"}
				className={`icon-button stage-action ${BUTTON_MOTION_CLASSES}`}
				disabled={!activeFile || stageBusy || bulkStageBusy}
				onClick={onToggleStage}
				title={activeFileFullyStaged ? "Unstage file" : "Stage file"}
				type="button"
			>
				{stageBusy || bulkStageBusy ? (
					<LoaderCircle className="spinner" size={19} />
				) : (
					<GitPullRequestArrow
						className={GROUP_CONTENT_MOTION_CLASSES}
						color={activeFile?.staged ? "var(--accent)" : undefined}
						size={19}
					/>
				)}
				<span className={`stage-copy ${GROUP_CONTENT_MOTION_CLASSES}`}>
					{activeFileFullyStaged ? "Unstage" : "Stage"}
				</span>
			</button>
		</nav>
	);
}
