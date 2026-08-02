import type { ReviewComment } from "../../../shared/contracts.ts";

export interface ViewerLineTarget {
	align?: "start" | "center" | "end" | "nearest";
	behavior?: "instant" | "smooth" | "smooth-auto";
	lineNumber: number;
	side: "old" | "new";
}

export interface DiffViewerHandle {
	scrollToComment(comment: ReviewComment): void;
	scrollToHunk(hunkIndex: number): void;
	scrollToLine(target: ViewerLineTarget): void;
	scrollToTop(): void;
}
