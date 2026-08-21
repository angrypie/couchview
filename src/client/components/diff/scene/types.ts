import type { ResolvedTheme } from "../../../../shared/theme.ts";
import type { DiffRow, TokenRun } from "../engine/types.ts";

export type DiffLineSide = "old" | "new";
export type DiffScrollAlign = "start" | "center" | "end" | "nearest";

export interface DiffSceneLayout {
	lineHeight: number;
	fontSize: number;
	charWidth: number;
	letterSpacing: number;
	gutterWidth: number;
	gutterBorderWidth: number;
	gutterPadding: number;
	contentPadding: number;
	separatorHeight: number;
	separatorBackground: string;
	separatorTextColor: string;
	rowBackground: string;
	textColor: string;
	additionIndicatorColor: string;
	deletionIndicatorBackground: string;
	deletionIndicatorColor: string;
	fontFamily: string;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	lineBackgroundByKind: Readonly<Record<"context" | "addition" | "deletion", string>>;
	numberCellByKind: Readonly<Record<"context" | "addition" | "deletion", string>>;
	numberTextByKind: Readonly<Record<"context" | "addition" | "deletion", string>>;
}

export interface DiffSceneRow extends DiffRow {
	backgroundColor: string;
	height: number;
	indicator: "addition" | "deletion" | "none";
	lineNumber: number | null;
	numberBackgroundColor: string;
	numberColor: string;
	top: number;
}

export interface DiffTokenReader {
	runsAt(rowIndex: number): readonly TokenRun[] | null;
}

export interface DiffSceneLineTarget {
	align?: DiffScrollAlign;
	lineNumber: number;
	side: DiffLineSide;
}

export interface DiffSceneQueries {
	identifierAt(point: { x: number; y: number }, tokens: DiffTokenReader): string | null;
	offsetForHunk(hunkIndex: number, viewportHeight: number): number | null;
	offsetForLine(target: DiffSceneLineTarget, viewportHeight: number): number | null;
	pointForColumn(rowIndex: number, column: number): { x: number; y: number } | null;
	rowAtOffset(y: number): number | null;
	visibleLineAt(y: number): { lineNumber: number; side: DiffLineSide } | null;
}

export interface DiffScene {
	availableColumns: number;
	contentSize: { height: number; width: number };
	generation: string;
	identity: {
		contentRevision: string;
		fileId: string;
		layoutRevision: string;
		repositoryId: string;
	};
	layout: DiffSceneLayout;
	queries: DiffSceneQueries;
	rows: readonly DiffSceneRow[];
	stage: "full" | "preview";
	themeType: ResolvedTheme;
	viewport: { height: number; scale: number; width: number };
}
