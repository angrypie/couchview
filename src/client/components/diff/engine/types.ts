export type DiffRowKind = "context" | "addition" | "deletion" | "separator";

export interface DiffRowDecoration {
	start: number;
	end: number;
}

export interface DiffRow {
	id: string;
	kind: DiffRowKind;
	text: string;
	oldLine: number | null;
	newLine: number | null;
	hunkIndex: number | null;
	hunkSpecs: string | null;
	collapsedLines: number;
	noNewline: boolean;
	decorations: readonly DiffRowDecoration[];
	visualColumns: number;
}

export interface DiffRowMetrics {
	rowCount: number;
	lineRows: number;
	maxColumns: number;
	maxNumberDigits: number;
	firstRowByLineNumber: Map<string, number>;
	firstRowByHunkIndex: Map<number, number>;
	prefixOffsets: number[];
	totalHeight: number;
}

export type FontStyleBits = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface TokenRun {
	text: string;
	color: string;
	backgroundColor: string | null;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	identifier: boolean;
}

export interface TokenizeOptions {
	themeType: "dark" | "light";
	tokenizeMaxLength: number;
	tokenizeMaxLineLength: number;
	lineDiffType: "word-alt";
	maxLineDiffLength: number;
	chunkTargetChars: number;
	/**
	 * Above this many tokenizable rows, context rows render as plain text
	 * runs instead of syntax-highlighted spans. Changed lines keep full
	 * tokens; the grammar walk still visits every line for state continuity.
	 */
	plainContextThreshold: number;
}

export const DEFAULT_TOKENIZE_OPTIONS: TokenizeOptions = {
	themeType: "dark",
	tokenizeMaxLength: 100_000,
	tokenizeMaxLineLength: 2_000,
	lineDiffType: "word-alt",
	maxLineDiffLength: 1_000,
	chunkTargetChars: 24_000,
	plainContextThreshold: 3_000,
};

export interface TokenBatch {
	rows: ReadonlyMap<number, readonly TokenRun[]>;
	complete: boolean;
}

export interface TokenizeController {
	cancelled(): boolean;
}

export type ParsedDiffType = "new" | "deleted" | "change" | "rename-pure" | "rename-changed";

export type ParsedHunkContent =
	| {
			type: "context";
			lines: number;
			additionLineIndex: number;
			deletionLineIndex: number;
	  }
	| {
			type: "change";
			deletions: number;
			additions: number;
			additionLineIndex: number;
			deletionLineIndex: number;
	  };

export interface ParsedHunk {
	/** Number of unchanged lines between the previous hunk (or file start) and this hunk. */
	collapsedBefore: number;
	/** 1-based starting line number in the new file version. */
	additionStart: number;
	/** Total line count in the new file version for this hunk (context + additions). */
	additionCount: number;
	/** Number of `+` lines in this hunk. */
	additionLines: number;
	/** Index into `additionLines` where this hunk's content starts. */
	additionLineIndex: number;
	/** 1-based starting line number in the old file version. */
	deletionStart: number;
	/** Total line count in the old file version for this hunk (context + deletions). */
	deletionCount: number;
	/** Number of `-` lines in this hunk. */
	deletionLines: number;
	/** Index into `deletionLines` where this hunk's content starts. */
	deletionLineIndex: number;
	unifiedLineStart: number;
	unifiedLineCount: number;
	splitLineStart: number;
	splitLineCount: number;
	/** The hunk header line, e.g. `@@ -1,2 +1,2 @@`. */
	hunkSpecs: string | null;
	noEOFCRDeletions: boolean;
	noEOFCRAdditions: boolean;
	/** Runs of context lines and change groups in file order. */
	hunkContent: ParsedHunkContent[];
}

/**
 * Structured single-file diff metadata. Rows of the unified view are built
 * from this shape; lines always include their trailing newline unless a
 * `\ No newline at end of file` marker stripped it.
 */
export interface ParsedFileDiff {
	name: string;
	prevName?: string;
	type: ParsedDiffType;
	hunks: ParsedHunk[];
	splitLineCount: number;
	unifiedLineCount: number;
	isPartial: boolean;
	deletionLines: string[];
	additionLines: string[];
	cacheKey?: string;
}

/** A single Shiki token; offsets are line-relative. */
export interface HighlightToken {
	content: string;
	offset: number;
	color?: string;
	fontStyle?: number;
}
