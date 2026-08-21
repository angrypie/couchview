import { forwardRef } from "react";

import type { ResolvedTheme } from "../shared/theme.ts";
import { DiffView } from "./components/diff/DiffView.tsx";
import type { DiffViewerHandle, ViewerLineTarget } from "./features/review/types.ts";

export type { DiffViewerHandle, ViewerLineTarget };

interface DiffViewerProps {
	diff: import("../shared/contracts.ts").FileDiff;
	fontFamily: string;
	fontSize: number;
	interactive?: boolean;
	lineHeightAdjustment: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onIdentifierClick(identifier: string): void;
	onVisibleLineChange(lineNumber: number, side: "old" | "new"): void;
	repositoryId?: string | null;
	themeType?: ResolvedTheme;
	widthAdjustment: number;
}

export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(function DiffViewer(
	{
		diff,
		fontFamily,
		fontSize,
		interactive = true,
		lineHeightAdjustment,
		lineNumbersVisible,
		lineWrapEnabled,
		onIdentifierClick,
		onVisibleLineChange,
		repositoryId,
		themeType = "dark",
		widthAdjustment,
	},
	ref,
) {
	return (
		<DiffView
			diff={diff}
			fontFamily={fontFamily}
			fontSize={fontSize}
			interactive={interactive}
			lineHeightAdjustment={lineHeightAdjustment}
			lineNumbersVisible={lineNumbersVisible}
			lineWrapEnabled={lineWrapEnabled}
			onIdentifierClick={onIdentifierClick}
			onVisibleLineChange={onVisibleLineChange}
			ref={ref}
			repositoryId={repositoryId}
			themeType={themeType}
			widthAdjustment={widthAdjustment}
		/>
	);
});
