"use dom";

import { useEffect, useRef } from "react";

import type { FileDiff, ReviewComment } from "../../../shared/contracts.ts";
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
	dom?: import("expo/dom").DOMProps;
}

export default function NativeDiffSurface({
	diff,
	comments,
	fontSize,
	lineNumbersVisible,
	lineWrapEnabled,
	scrollTarget,
	onCommentOpen,
	onLinePress,
}: NativeDiffSurfaceProps) {
	const viewer = useRef<DiffViewerHandle>(null);
	useEffect(() => {
		if (scrollTarget) viewer.current?.scrollToLine(scrollTarget);
	}, [scrollTarget]);
	return (
		<main
			style={{
				background: "#0d1014",
				color: "#e7edf5",
				height: "100vh",
				overflow: "auto",
			}}
		>
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
				widthAdjustment={0}
			/>
		</main>
	);
}
