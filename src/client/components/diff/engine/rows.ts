import { diffWordsWithSpace } from "diff";

import type { DiffRow, DiffRowDecoration, ParsedFileDiff } from "./types.ts";

export const NO_NEWLINE_MARKER = "\\ No newline at end of file";
const MAX_WORD_DIFF_LENGTH = 1_000;
const TAB_SIZE = 2;

export function expandTabs(text: string): string {
	let expanded = "";
	let column = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "\t") {
			const width = TAB_SIZE - (column % TAB_SIZE);
			expanded += " ".repeat(width);
			column += width;
		} else {
			expanded += char;
			column += 1;
		}
	}
	return expanded;
}

export function visualColumns(text: string): number {
	let columns = 0;
	let max = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "\t") columns += TAB_SIZE - (columns % TAB_SIZE);
		else columns += 1;
		if (char !== "\n") max = Math.max(max, columns);
	}
	return max;
}

function joinWordSpans(
	items: { value: string; added?: boolean; removed?: boolean }[],
): [0 | 1, string][] {
	const spans: [0 | 1, string][] = [];
	const lastItem = items.at(-1);
	for (const item of items) {
		const changed = Boolean(item.added || item.removed);
		const isLastItem = item === lastItem;
		const last = spans.at(-1);
		if (last == null || isLastItem) {
			spans.push([changed ? 1 : 0, item.value]);
			continue;
		}
		const lastChanged = last[0] === 1;
		if (changed === lastChanged || (!changed && item.value.length === 1 && lastChanged)) {
			last[1] += item.value;
			continue;
		}
		spans.push([changed ? 1 : 0, item.value]);
	}
	return spans;
}

function decorationsFromSpans(spans: [0 | 1, string][]): DiffRowDecoration[] {
	const decorations: DiffRowDecoration[] = [];
	let offset = 0;
	for (const [changed, text] of spans) {
		if (changed === 1) decorations.push({ start: offset, end: offset + text.length });
		offset += text.length;
	}
	return decorations;
}

/**
 * Word-level diff decorations for a paired deletion/addition line, mirroring
 * Pierre's `computeLineDiffDecorations` with `lineDiffType: "word-alt"` and
 * `maxLineDiffLength: 1000`. Offsets are character offsets within the lines
 * without their trailing newline.
 */
export function wordDiffDecorations(
	deletionLine: string,
	additionLine: string,
): { deletion: DiffRowDecoration[]; addition: DiffRowDecoration[] } {
	const deletions = stripNewline(deletionLine);
	const additions = stripNewline(additionLine);
	if (deletions.length > MAX_WORD_DIFF_LENGTH || additions.length > MAX_WORD_DIFF_LENGTH) {
		return { deletion: [], addition: [] };
	}
	const items = diffWordsWithSpace(deletions, additions);
	const deletionSpans = joinWordSpans(
		items
			.filter((item) => !item.added)
			.map((item) => ({ value: item.value, removed: item.removed })),
	);
	const additionSpans = joinWordSpans(
		items.filter((item) => !item.removed).map((item) => ({ value: item.value, added: item.added })),
	);
	return {
		deletion: decorationsFromSpans(deletionSpans),
		addition: decorationsFromSpans(additionSpans),
	};
}

function stripNewline(text: string): string {
	return text.endsWith("\n") ? text.slice(0, -1) : text;
}

interface Builder {
	rows: DiffRow[];
}

function pushLine(
	builder: Builder,
	kind: "context" | "addition" | "deletion",
	hunkIndex: number,
	text: string,
	oldLine: number | null,
	newLine: number | null,
	decorations: DiffRowDecoration[],
	noNewline: boolean,
): void {
	const stripped = stripNewline(text);
	const expanded = expandTabs(stripped);
	builder.rows.push({
		id: `r${builder.rows.length}`,
		kind,
		text: expanded,
		oldLine,
		newLine,
		hunkIndex,
		hunkSpecs: null,
		collapsedLines: 0,
		noNewline,
		decorations,
		visualColumns: visualColumns(expanded),
	});
}

function pushNoNewline(
	builder: Builder,
	kind: "context" | "addition" | "deletion",
	hunkIndex: number,
): void {
	const row: DiffRow = {
		id: `r${builder.rows.length}`,
		kind,
		text: NO_NEWLINE_MARKER,
		oldLine: null,
		newLine: null,
		hunkIndex,
		hunkSpecs: null,
		collapsedLines: 0,
		noNewline: true,
		decorations: [],
		visualColumns: visualColumns(NO_NEWLINE_MARKER),
	};
	builder.rows.push(row);
}

function pushSeparator(
	builder: Builder,
	hunkIndex: number,
	hunkSpecs: string,
	collapsedLines: number,
): void {
	builder.rows.push({
		id: `r${builder.rows.length}`,
		kind: "separator",
		text: hunkSpecs,
		oldLine: null,
		newLine: null,
		hunkIndex,
		hunkSpecs,
		collapsedLines,
		noNewline: false,
		decorations: [],
		visualColumns: visualColumns(hunkSpecs),
	});
}

/**
 * Build the unified view row model for a parsed file diff, mirroring Pierre's
 * `iterateOverDiff` in unified mode with `expandUnchanged: true` and
 * `hunkSeparators: "metadata"`. Row ids are stable for a given diff, which
 * keeps list reconciliation cheap. Deletion and addition rows are paired by
 * position within each change group for word-level decorations, matching the
 * pairing Pierre performs in `renderDiffWithHighlighter`.
 */
export function buildDiffRows(fileDiff: ParsedFileDiff): DiffRow[] {
	const builder: Builder = { rows: [] };
	for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex += 1) {
		const hunk = fileDiff.hunks[hunkIndex];
		if (!hunk) throw new Error(`buildDiffRows: missing hunk ${hunkIndex}`);
		if (hunk.collapsedBefore > 0) {
			if (fileDiff.isPartial) {
				if (hunk.hunkSpecs) pushSeparator(builder, hunkIndex, hunk.hunkSpecs, hunk.collapsedBefore);
			} else {
				for (let index = 0; index < hunk.collapsedBefore; index += 1) {
					const text =
						fileDiff.deletionLines[hunk.deletionLineIndex - hunk.collapsedBefore + index] ??
						fileDiff.additionLines[hunk.additionLineIndex - hunk.collapsedBefore + index] ??
						"";
					pushLine(
						builder,
						"context",
						hunkIndex,
						text,
						hunk.deletionStart - hunk.collapsedBefore + index,
						hunk.additionStart - hunk.collapsedBefore + index,
						[],
						false,
					);
				}
			}
		}
		let deletionLineIndex = hunk.deletionLineIndex;
		let additionLineIndex = hunk.additionLineIndex;
		let deletionLineNumber = hunk.deletionStart;
		let additionLineNumber = hunk.additionStart;
		const contentCount = hunk.hunkContent.length;
		for (let contentIndex = 0; contentIndex < contentCount; contentIndex += 1) {
			const content = hunk.hunkContent[contentIndex];
			if (!content) continue;
			const isLastContent = contentIndex === contentCount - 1;
			if (content.type === "context") {
				for (let index = 0; index < content.lines; index += 1) {
					const text =
						fileDiff.deletionLines[deletionLineIndex + index] ??
						fileDiff.additionLines[additionLineIndex + index] ??
						"";
					pushLine(
						builder,
						"context",
						hunkIndex,
						text,
						deletionLineNumber + index,
						additionLineNumber + index,
						[],
						false,
					);
				}
				if (isLastContent) {
					if (hunk.noEOFCRDeletions) pushNoNewline(builder, "context", hunkIndex);
					if (hunk.noEOFCRAdditions) pushNoNewline(builder, "context", hunkIndex);
				}
				deletionLineIndex += content.lines;
				additionLineIndex += content.lines;
				deletionLineNumber += content.lines;
				additionLineNumber += content.lines;
				continue;
			}
			for (let index = 0; index < content.deletions; index += 1) {
				const deletionLine = fileDiff.deletionLines[deletionLineIndex + index] ?? "";
				const paired =
					index < content.additions ? fileDiff.additionLines[additionLineIndex + index] : null;
				const decorations = paired ? wordDiffDecorations(deletionLine, paired).deletion : [];
				pushLine(
					builder,
					"deletion",
					hunkIndex,
					deletionLine,
					deletionLineNumber + index,
					null,
					decorations,
					false,
				);
				if (isLastContent && index === content.deletions - 1 && hunk.noEOFCRDeletions) {
					pushNoNewline(builder, "deletion", hunkIndex);
				}
			}
			for (let index = 0; index < content.additions; index += 1) {
				const additionLine = fileDiff.additionLines[additionLineIndex + index] ?? "";
				const paired =
					index < content.deletions ? fileDiff.deletionLines[deletionLineIndex + index] : null;
				const decorations = paired ? wordDiffDecorations(paired, additionLine).addition : [];
				pushLine(
					builder,
					"addition",
					hunkIndex,
					additionLine,
					null,
					additionLineNumber + index,
					decorations,
					false,
				);
				if (isLastContent && index === content.additions - 1 && hunk.noEOFCRAdditions) {
					pushNoNewline(builder, "addition", hunkIndex);
				}
			}
			deletionLineIndex += content.deletions;
			additionLineIndex += content.additions;
			deletionLineNumber += content.deletions;
			additionLineNumber += content.additions;
		}
	}
	for (const line of trailingContextLines(fileDiff)) {
		pushLine(
			builder,
			"context",
			fileDiff.hunks.length,
			line.text,
			line.oldLine,
			line.newLine,
			[],
			false,
		);
	}
	return builder.rows;
}

interface TrailingLine {
	text: string;
	oldLine: number;
	newLine: number;
}

function trailingContextLines(fileDiff: ParsedFileDiff): TrailingLine[] {
	if (fileDiff.isPartial || fileDiff.hunks.length === 0) return [];
	const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
	if (!lastHunk) return [];
	const additionRemaining =
		fileDiff.additionLines.length - (lastHunk.additionLineIndex + lastHunk.additionCount);
	const deletionRemaining =
		fileDiff.deletionLines.length - (lastHunk.deletionLineIndex + lastHunk.deletionCount);
	const count = Math.min(additionRemaining, deletionRemaining);
	if (count <= 0) return [];
	const lines: TrailingLine[] = [];
	for (let index = 0; index < count; index += 1) {
		lines.push({
			text:
				fileDiff.deletionLines[lastHunk.deletionLineIndex + lastHunk.deletionCount + index] ?? "",
			oldLine: lastHunk.deletionStart + lastHunk.deletionCount + index,
			newLine: lastHunk.additionStart + lastHunk.additionCount + index,
		});
	}
	return lines;
}

export function lineNumberKey(lineNumber: number, side: "old" | "new"): string {
	return `${side}:${lineNumber}`;
}
