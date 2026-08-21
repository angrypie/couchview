import type { FileDiff } from "../../../shared/contracts.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import type { DiffViewerHandle, ViewerLineTarget } from "../../features/review/types.ts";

export interface DiffViewProps {
	diff: FileDiff;
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

export type { DiffViewerHandle, ViewerLineTarget };
