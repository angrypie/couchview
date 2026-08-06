"use dom";

import { useEffect, useLayoutEffect, useRef } from "react";

import type { FileDiff, ReviewComment } from "../../../shared/contracts.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import { DiffViewer, type DiffViewerHandle, type ViewerLineTarget } from "../../DiffViewer.tsx";
import "./nativeDiffSurface.css";

interface NativeDiffSurfaceProps {
	diff: FileDiff;
	comments: ReviewComment[];
	fontSize: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	scrollTarget: ViewerLineTarget | null;
	onCommentOpen(commentId: string): Promise<void>;
	onLinePress(lineNumber: number, side: "old" | "new"): Promise<void>;
	theme: ResolvedTheme;
	dom?: import("expo/dom").DOMProps;
}

export default function NativeDiffSurface({
	diff,
	comments,
	fontSize,
	lineNumbersVisible,
	lineWrapEnabled,
	scrollTarget,
	theme,
	onCommentOpen,
	onLinePress,
}: NativeDiffSurfaceProps) {
	const viewer = useRef<DiffViewerHandle>(null);
	useLayoutEffect(() => {
		document.documentElement.dataset.resolvedTheme = theme;
		document.documentElement.style.colorScheme = theme;
	}, [theme]);
	useEffect(() => {
		if (scrollTarget) viewer.current?.scrollToLine(scrollTarget);
	}, [scrollTarget]);
	return (
		<main className="native-diff-root">
			<DiffViewer
				ref={viewer}
				comments={comments}
				diff={diff}
				fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
				fontSize={fontSize}
				interactive
				lineHeightAdjustment={0}
				lineNumbersVisible={lineNumbersVisible}
				lineWrapEnabled={lineWrapEnabled}
				onCommentClick={(comment) => void onCommentOpen(comment.id)}
				onIdentifierClick={() => undefined}
				onLineNumberClick={(lineNumber, side) => void onLinePress(lineNumber, side)}
				onVisibleLineChange={() => undefined}
				selectedRange={null}
				themeType={theme}
				widthAdjustment={0}
			/>
		</main>
	);
}
