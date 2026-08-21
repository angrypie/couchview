import type { DiffSide, FileDiff } from "../../../../shared/contracts.ts";
import { parseContractHunks, parseFullPatch } from "./parsePatch.ts";
import type { ParsedDiffType, ParsedFileDiff } from "./types.ts";

const TRUNCATION_HEADER = "Diff preview truncated at 2 MiB or 20,000 rendered rows.";
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

export interface AdaptedFileDiff {
	fileDiff: ParsedFileDiff;
	patch: string;
}

const adaptedFileDiffCache = new WeakMap<FileDiff, AdaptedFileDiff>();

function quotePatchPath(path: string): string {
	if (/^[A-Za-z0-9_./@%+=:,~-]+$/.test(path)) return path;
	return JSON.stringify(path);
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
 * Rebuild the single-file unified patch for diagnostics and the parser error
 * fallback. The structured hunks remain the source of truth for rendering.
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

function resolveType(diff: FileDiff, parsedType: ParsedDiffType): ParsedDiffType {
	if (diff.kind === "added" || diff.kind === "untracked") return "new";
	if (diff.kind === "deleted") return "deleted";
	if (diff.kind === "renamed") return diff.hunks.length > 0 ? "rename-changed" : "rename-pure";
	return parsedType;
}

/**
 * Convert the API contract into the engine's parsed diff model. Full-context
 * patches are parsed once; compact hunks are built directly from the
 * structured contract without a text round-trip.
 */
export function adaptFileDiff(diff: FileDiff): AdaptedFileDiff {
	const cached = adaptedFileDiffCache.get(diff);
	if (cached) return cached;

	const patch = diff.fullFilePatch || reconstructUnifiedPatch(diff);
	const parsedBase =
		diff.fullFilePatch != null
			? parseFullPatch(diff.fullFilePatch)
			: parseContractHunks(diff.hunks);
	if (parsedBase.hunks.length === 0 && diff.hunks.length > 0) {
		// Fallback for malformed full patches: the compact contract still renders.
		const fallback = parseContractHunks(diff.hunks);
		parsedBase.hunks.push(...fallback.hunks);
		parsedBase.deletionLines.push(...fallback.deletionLines);
		parsedBase.additionLines.push(...fallback.additionLines);
		parsedBase.unifiedLineCount = fallback.unifiedLineCount;
		parsedBase.splitLineCount = fallback.splitLineCount;
	}

	const fileDiff: ParsedFileDiff = {
		...parsedBase,
		name: diff.path,
		...(diff.previousPath ? { prevName: diff.previousPath } : {}),
		cacheKey: diff.contentRevision,
		type: resolveType(diff, parsedBase.type),
	};

	const adapted = { patch, fileDiff };
	adaptedFileDiffCache.set(diff, adapted);
	return adapted;
}

export function toDiffSide(side: Exclude<DiffSide, "mixed">): "deletions" | "additions" {
	return side === "old" ? ("deletions" as const) : ("additions" as const);
}

export function fromDiffSide(side: "deletions" | "additions"): "old" | "new" {
	return side === "deletions" ? ("old" as const) : ("new" as const);
}
