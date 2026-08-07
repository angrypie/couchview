import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import type { DiffSide, FileDiff } from "../shared/contracts.ts";

const TRUNCATION_HEADER = "Diff preview truncated at 2 MiB or 20,000 rendered rows.";
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

export interface AdaptedFileDiff {
	fileDiff: FileDiffMetadata;
	patch: string;
}

interface DiffHighlightCache {
	primeDiffHighlightCache(diff: FileDiffMetadata): void;
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
 * side conversion; this patch is only a rendering adapter.
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
