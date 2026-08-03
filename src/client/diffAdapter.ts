import {
	type DiffLineAnnotation,
	type FileDiffMetadata,
	parsePatchFiles,
	type SelectedLineRange,
} from "@pierre/diffs";
import type { DiffSide, FileDiff, ReviewComment } from "../shared/contracts.ts";

const TRUNCATION_HEADER = "Diff preview truncated at 2 MiB or 20,000 rendered rows.";
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

export interface CommentAnnotationMetadata {
	comment: ReviewComment;
}

export interface AdaptedFileDiff {
	fileDiff: FileDiffMetadata;
	patch: string;
}

interface DiffHighlightCache {
	primeDiffHighlightCache(diff: FileDiffMetadata): void;
}

export interface SelectionEndpoint {
	lineNumber: number;
	rowIndex: number;
	side: "old" | "new";
}

const adaptedFileDiffCache = new WeakMap<FileDiff, AdaptedFileDiff>();

function quotePatchPath(path: string): string {
	const prefixed = path;
	if (/^[A-Za-z0-9_./@%+=:,~-]+$/.test(prefixed)) return prefixed;
	return JSON.stringify(prefixed);
}

function syntheticHeader(diff: FileDiff): string[] {
	const oldPath = diff.previousPath ?? diff.path;
	const oldHeader =
		diff.kind === "added" || diff.kind === "untracked" ? "/dev/null" : `a/${oldPath}`;
	const newHeader = diff.kind === "deleted" ? "/dev/null" : `b/${diff.path}`;

	return [
		`diff --git ${quotePatchPath(`a/${oldPath}`)} ${quotePatchPath(`b/${diff.path}`)}`,
		`--- ${quotePatchPath(oldHeader)}`,
		`+++ ${quotePatchPath(newHeader)}`,
	];
}

/**
 * Rebuild the single-file unified patch that Pierre expects from Couchview's
 * structured API response. The structured rows remain the source of truth for
 * comments and side conversion; this patch is only a rendering adapter.
 */
export function reconstructUnifiedPatch(diff: FileDiff): string {
	const suppliedHeader = diff.header.filter((line) => line !== TRUNCATION_HEADER);
	const header = suppliedHeader.some((line) => line.startsWith("diff --git "))
		? suppliedHeader
		: [...syntheticHeader(diff), ...suppliedHeader];
	const lines = [...header];

	for (const hunk of diff.hunks) {
		lines.push(hunk.header);
		for (let index = 0; index < hunk.lines.length; index += 1) {
			const line = hunk.lines[index];
			if (!line) continue;
			if (line.kind === "addition") lines.push(`+${line.text}`);
			else if (line.kind === "deletion") lines.push(`-${line.text}`);
			else if (line.kind === "context") lines.push(` ${line.text}`);
			else lines.push(line.text);

			const next = hunk.lines[index + 1];
			if (line.noNewline && !(next?.kind === "metadata" && next.text === NO_NEWLINE_MARKER)) {
				lines.push(NO_NEWLINE_MARKER);
			}
		}
	}

	return `${lines.join("\n")}\n`;
}

export function adaptFileDiff(diff: FileDiff): AdaptedFileDiff {
	const cached = adaptedFileDiffCache.get(diff);
	if (cached) return cached;

	const patch = diff.fullFilePatch || reconstructUnifiedPatch(diff);
	const parsedPatches = parsePatchFiles(patch, diff.contentRevision, !diff.tooLarge);
	const parsedFiles = parsedPatches.flatMap((parsed) => parsed.files);
	const parsed = parsedFiles[0];
	if (!parsed) throw new Error("Pierre could not parse this patch.");

	const type =
		diff.kind === "added" || diff.kind === "untracked"
			? "new"
			: diff.kind === "deleted"
				? "deleted"
				: diff.kind === "renamed"
					? diff.hunks.length > 0
						? "rename-changed"
						: "rename-pure"
					: parsed.type;

	const adapted = {
		patch,
		fileDiff: {
			...parsed,
			name: diff.path,
			...(diff.previousPath ? { prevName: diff.previousPath } : {}),
			cacheKey: diff.contentRevision,
			type,
		},
	};
	adaptedFileDiffCache.set(diff, adapted);
	return adapted;
}

export function preloadFileDiffRendering(
	diff: FileDiff,
	highlightCache?: DiffHighlightCache,
): boolean {
	const hasText = diff.hunks.some((hunk) => hunk.lines.some((line) => line.kind !== "metadata"));
	if (diff.binary || diff.tooLarge || !hasText) return false;
	const adapted = adaptFileDiff(diff);
	highlightCache?.primeDiffHighlightCache(adapted.fileDiff);
	return true;
}

export function toPierreSide(side: Exclude<DiffSide, "mixed">) {
	return side === "old" ? ("deletions" as const) : ("additions" as const);
}

export function fromPierreSide(side: "deletions" | "additions") {
	return side === "deletions" ? ("old" as const) : ("new" as const);
}

export function selectedRangeFromEndpoints(
	anchor: SelectionEndpoint,
	focus: SelectionEndpoint,
): SelectedLineRange {
	const anchorFirst = anchor.rowIndex <= focus.rowIndex;
	const start = anchorFirst ? anchor : focus;
	const end = anchorFirst ? focus : anchor;
	return {
		start: start.lineNumber,
		side: toPierreSide(start.side),
		end: end.lineNumber,
		endSide: toPierreSide(end.side),
	};
}

export function commentAnnotation(
	comment: ReviewComment,
): DiffLineAnnotation<CommentAnnotationMetadata> | null {
	if (comment.stale) return null;

	if (comment.side === "old") {
		return {
			side: "deletions",
			lineNumber: comment.oldEndLine ?? comment.endLine,
			metadata: { comment },
		};
	}

	if (comment.side === "new") {
		return {
			side: "additions",
			lineNumber: comment.newEndLine ?? comment.endLine,
			metadata: { comment },
		};
	}

	if (comment.newEndLine !== undefined) {
		return {
			side: "additions",
			lineNumber: comment.newEndLine,
			metadata: { comment },
		};
	}
	if (comment.oldEndLine !== undefined) {
		return {
			side: "deletions",
			lineNumber: comment.oldEndLine,
			metadata: { comment },
		};
	}
	return null;
}

export function annotationsForFile(
	comments: readonly ReviewComment[],
	fileId: string,
): DiffLineAnnotation<CommentAnnotationMetadata>[] {
	return comments.flatMap((comment) => {
		if (comment.fileId !== fileId) return [];
		const annotation = commentAnnotation(comment);
		return annotation ? [annotation] : [];
	});
}

export function commentAnnotationsVersion(
	comments: readonly ReviewComment[],
	fileId: string,
	contentRevision = "",
): number {
	let hash = 2166136261;
	for (let index = 0; index < contentRevision.length; index += 1) {
		hash ^= contentRevision.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	for (const comment of comments) {
		if (comment.fileId !== fileId || comment.stale) continue;
		const value = `${comment.id}\0${comment.updatedAt}\0${comment.body}\0`;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
	}
	return hash >>> 0;
}
