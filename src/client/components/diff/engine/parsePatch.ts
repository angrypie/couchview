import type { ParsedFileDiff, ParsedHunk, ParsedHunkContent } from "./types.ts";

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

interface HunkBuilder {
	hunk: ParsedHunk;
	group: ParsedHunkContent | null;
	lastLineType: "context" | "addition" | "deletion" | null;
}

interface ParseState {
	fileDiff: ParsedFileDiff;
	lastHunkEnd: number;
}

function stripNewlineAtEnd(text: string): string {
	return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function applyNoNewlineMarker(builder: HunkBuilder, fileDiff: ParsedFileDiff): void {
	const lastType = builder.lastLineType;
	if (lastType === "context") {
		builder.hunk.noEOFCRDeletions = true;
		builder.hunk.noEOFCRAdditions = true;
	} else if (lastType === "deletion") {
		builder.hunk.noEOFCRDeletions = true;
	} else if (lastType === "addition") {
		builder.hunk.noEOFCRAdditions = true;
	}
	if (lastType === "context" || lastType === "deletion") {
		const lastIndex = fileDiff.deletionLines.length - 1;
		const lastLine = fileDiff.deletionLines[lastIndex];
		if (lastIndex >= 0 && lastLine !== undefined)
			fileDiff.deletionLines[lastIndex] = stripNewlineAtEnd(lastLine);
	}
	if (lastType === "context" || lastType === "addition") {
		const lastIndex = fileDiff.additionLines.length - 1;
		const lastLine = fileDiff.additionLines[lastIndex];
		if (lastIndex >= 0 && lastLine !== undefined)
			fileDiff.additionLines[lastIndex] = stripNewlineAtEnd(lastLine);
	}
}

function newContentGroup(
	builder: HunkBuilder,
	type: "context",
	deletionLineIndex: number,
	additionLineIndex: number,
): Extract<ParsedHunkContent, { type: "context" }>;
function newContentGroup(
	builder: HunkBuilder,
	type: "change",
	deletionLineIndex: number,
	additionLineIndex: number,
): Extract<ParsedHunkContent, { type: "change" }>;
function newContentGroup(
	builder: HunkBuilder,
	type: "context" | "change",
	deletionLineIndex: number,
	additionLineIndex: number,
): ParsedHunkContent {
	const content: ParsedHunkContent =
		type === "context"
			? { type, lines: 0, additionLineIndex, deletionLineIndex }
			: { type, deletions: 0, additions: 0, additionLineIndex, deletionLineIndex };
	builder.hunk.hunkContent.push(content);
	builder.group = content;
	return content;
}

function closeHunk(state: ParseState, builder: HunkBuilder): void {
	const { hunk } = builder;
	for (const content of hunk.hunkContent) {
		if (content.type === "context") {
			hunk.splitLineCount += content.lines;
			hunk.unifiedLineCount += content.lines;
		} else {
			hunk.splitLineCount += Math.max(content.additions, content.deletions);
			hunk.unifiedLineCount += content.deletions + content.additions;
		}
	}
	hunk.collapsedBefore = Math.max(hunk.additionStart - 1 - state.lastHunkEnd, 0);
	state.lastHunkEnd = hunk.additionStart + hunk.additionCount - 1;
	hunk.splitLineStart = state.fileDiff.splitLineCount + hunk.collapsedBefore;
	hunk.unifiedLineStart = state.fileDiff.unifiedLineCount + hunk.collapsedBefore;
	state.fileDiff.splitLineCount += hunk.collapsedBefore + hunk.splitLineCount;
	state.fileDiff.unifiedLineCount += hunk.collapsedBefore + hunk.unifiedLineCount;
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse single-file git unified diff text (the server's `fullFilePatch`) into
 * the engine's structured diff model. Only the pieces the row model needs are
 * extracted; path headers are ignored because the caller already knows the
 * authoritative path from the API contract. Lines are stored with trailing
 * newlines except after a no-newline marker.
 */
export function parseFullPatch(patch: string): Omit<ParsedFileDiff, "name" | "cacheKey"> {
	const fileDiff: Omit<ParsedFileDiff, "name" | "cacheKey"> = {
		type: "change",
		hunks: [],
		splitLineCount: 0,
		unifiedLineCount: 0,
		isPartial: true,
		deletionLines: [],
		additionLines: [],
	};
	const state: ParseState = { fileDiff: fileDiff as ParsedFileDiff, lastHunkEnd: 0 };
	let builder: HunkBuilder | null = null;
	let deletionLineIndex = 0;
	let additionLineIndex = 0;

	const lines = patch.split("\n");
	for (const rawLine of lines) {
		const headerMatch = HUNK_HEADER_PATTERN.exec(rawLine);
		if (headerMatch !== null) {
			if (builder !== null) closeHunk(state, builder);
			const hunk: ParsedHunk = {
				collapsedBefore: 0,
				splitLineCount: 0,
				splitLineStart: 0,
				unifiedLineCount: 0,
				unifiedLineStart: 0,
				additionCount: Number(headerMatch[4] ?? 1),
				additionStart: Number(headerMatch[3]),
				additionLines: 0,
				additionLineIndex,
				deletionCount: Number(headerMatch[2] ?? 1),
				deletionStart: Number(headerMatch[1]),
				deletionLines: 0,
				deletionLineIndex,
				hunkSpecs: rawLine,
				noEOFCRAdditions: false,
				noEOFCRDeletions: false,
				hunkContent: [],
			};
			builder = { hunk, group: null, lastLineType: null };
			state.fileDiff.hunks.push(hunk);
			continue;
		}
		if (builder === null) continue;
		const firstChar = rawLine[0];
		if (firstChar === "\\") {
			if (rawLine === NO_NEWLINE_MARKER) applyNoNewlineMarker(builder, state.fileDiff);
			continue;
		}
		if (firstChar === "+") {
			const line = `${rawLine.slice(1)}\n`;
			state.fileDiff.additionLines.push(line);
			builder.hunk.additionLines += 1;
			const existing = builder.group;
			const group =
				existing?.type === "change"
					? existing
					: newContentGroup(builder, "change", deletionLineIndex, additionLineIndex);
			group.additions += 1;
			additionLineIndex += 1;
			builder.lastLineType = "addition";
			continue;
		}
		if (firstChar === "-") {
			const line = `${rawLine.slice(1)}\n`;
			state.fileDiff.deletionLines.push(line);
			builder.hunk.deletionLines += 1;
			const existing = builder.group;
			const group =
				existing?.type === "change"
					? existing
					: newContentGroup(builder, "change", deletionLineIndex, additionLineIndex);
			group.deletions += 1;
			deletionLineIndex += 1;
			builder.lastLineType = "deletion";
			continue;
		}
		if (firstChar === " ") {
			const line = `${rawLine.slice(1)}\n`;
			state.fileDiff.deletionLines.push(line);
			state.fileDiff.additionLines.push(line);
			const existing = builder.group;
			const group =
				existing?.type === "context"
					? existing
					: newContentGroup(builder, "context", deletionLineIndex, additionLineIndex);
			group.lines += 1;
			additionLineIndex += 1;
			deletionLineIndex += 1;
			builder.lastLineType = "context";
		}
	}
	if (builder !== null) closeHunk(state, builder);
	return fileDiff;
}

/**
 * Build the engine's structured diff model directly from the API contract's
 * compact hunks, used when the server did not supply a full-context patch
 * (truncated, added, deleted, and untracked files).
 */
export function parseContractHunks(
	hunks: readonly {
		header: string;
		oldStart: number;
		oldLines: number;
		newStart: number;
		newLines: number;
		lines: readonly {
			kind: string;
			text: string;
			noNewline: boolean;
		}[];
	}[],
): Omit<ParsedFileDiff, "name" | "cacheKey"> {
	const fileDiff: Omit<ParsedFileDiff, "name" | "cacheKey"> = {
		type: "change",
		hunks: [],
		splitLineCount: 0,
		unifiedLineCount: 0,
		isPartial: true,
		deletionLines: [],
		additionLines: [],
	};
	const state: ParseState = { fileDiff: fileDiff as ParsedFileDiff, lastHunkEnd: 0 };
	let deletionLineIndex = 0;
	let additionLineIndex = 0;

	for (const contractHunk of hunks) {
		const hunk: ParsedHunk = {
			collapsedBefore: 0,
			splitLineCount: 0,
			splitLineStart: 0,
			unifiedLineCount: 0,
			unifiedLineStart: 0,
			additionCount: contractHunk.newLines,
			additionStart: contractHunk.newStart,
			additionLines: 0,
			additionLineIndex,
			deletionCount: contractHunk.oldLines,
			deletionStart: contractHunk.oldStart,
			deletionLines: 0,
			deletionLineIndex,
			hunkSpecs: contractHunk.header,
			noEOFCRAdditions: false,
			noEOFCRDeletions: false,
			hunkContent: [],
		};
		const builder: HunkBuilder = { hunk, group: null, lastLineType: null };
		for (const line of contractHunk.lines) {
			if (line.kind === "metadata") {
				if (line.text === NO_NEWLINE_MARKER) {
					applyNoNewlineMarker(builder, state.fileDiff);
				}
				continue;
			}
			if (line.kind === "addition") {
				const text = `${line.text}\n`;
				state.fileDiff.additionLines.push(text);
				hunk.additionLines += 1;
				const existing = builder.group;
				const group =
					existing?.type === "change"
						? existing
						: newContentGroup(builder, "change", deletionLineIndex, additionLineIndex);
				group.additions += 1;
				additionLineIndex += 1;
				builder.lastLineType = "addition";
			} else if (line.kind === "deletion") {
				const text = `${line.text}\n`;
				state.fileDiff.deletionLines.push(text);
				hunk.deletionLines += 1;
				const existing = builder.group;
				const group =
					existing?.type === "change"
						? existing
						: newContentGroup(builder, "change", deletionLineIndex, additionLineIndex);
				group.deletions += 1;
				deletionLineIndex += 1;
				builder.lastLineType = "deletion";
			} else if (line.kind === "context") {
				const text = `${line.text}\n`;
				state.fileDiff.deletionLines.push(text);
				state.fileDiff.additionLines.push(text);
				const existing = builder.group;
				const group =
					existing?.type === "context"
						? existing
						: newContentGroup(builder, "context", deletionLineIndex, additionLineIndex);
				group.lines += 1;
				additionLineIndex += 1;
				deletionLineIndex += 1;
				builder.lastLineType = "context";
			} else {
				continue;
			}
			if (line.noNewline) applyNoNewlineMarker(builder, state.fileDiff);
		}
		closeHunk(state, builder);
		state.fileDiff.hunks.push(hunk);
	}
	return fileDiff;
}
