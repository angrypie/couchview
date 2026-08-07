import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	GitPullRequestArrow,
	Undo2,
} from "lucide-react-native";
import { View } from "react-native";

import type { FileChange } from "../../shared/contracts.ts";
import { Button, IconButton } from "./ui";

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
		<View
			accessibilityLabel="Review actions"
			className="min-h-14 flex-row items-center justify-center gap-1 border-t border-border bg-card px-safe-or-1 pb-safe-offset-1 pt-1"
			role="navigation"
		>
			<View accessibilityLabel="File navigation" className="flex-row gap-1">
				<IconButton
					accessibilityLabel="Previous file"
					disabled={activeFileIndex <= 0}
					icon={ChevronLeft}
					onPress={() => onNavigateFile(-1)}
					size="sm"
				/>
				<IconButton
					accessibilityLabel="Next file"
					disabled={activeFileIndex < 0 || activeFileIndex >= fileCount - 1}
					icon={ChevronRight}
					onPress={() => onNavigateFile(1)}
					size="sm"
				/>
			</View>
			<View accessibilityLabel="Hunk navigation" className="flex-row gap-1">
				<IconButton
					accessibilityLabel="Previous hunk"
					disabled={!canNavigatePreviousHunk}
					icon={ChevronUp}
					onPress={() => onNavigateHunk(-1)}
					size="sm"
				/>
				<IconButton
					accessibilityLabel="Next hunk"
					disabled={!canNavigateNextHunk}
					icon={ChevronDown}
					onPress={() => onNavigateHunk(1)}
					size="sm"
				/>
			</View>
			<Button
				accessibilityLabel={activeFile?.reviewed ? "Unreview current file" : "Review + next"}
				className="min-w-20 flex-1 sm:max-w-44"
				disabled={!activeFile}
				leftIcon={activeFile?.reviewed ? Undo2 : Check}
				loading={reviewBusy}
				onPress={onReview}
				size="sm"
				variant={activeFile?.reviewed ? "outline" : "primary"}
			>
				{activeFile?.reviewed ? "Unreview" : "Review"}
			</Button>
			<Button
				accessibilityLabel={activeFileFullyStaged ? "Unstage current file" : "Stage current file"}
				className="min-w-20 sm:max-w-36"
				disabled={!activeFile || bulkStageBusy}
				leftIcon={GitPullRequestArrow}
				loading={stageBusy}
				onPress={onToggleStage}
				size="sm"
				variant={activeFileFullyStaged ? "primary" : "outline"}
			>
				{activeFileFullyStaged ? "Unstage" : "Stage"}
			</Button>
		</View>
	);
}
