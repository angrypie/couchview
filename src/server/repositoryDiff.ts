import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
	DiffResponse,
	FileDiff,
	SearchResponse,
	SourcePreviewResponse,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import {
	decodeGitOutput,
	GitCommandError,
	type GitResult,
	parseGrepOutput,
	parseUnifiedDiff,
	runGit,
} from "./git.ts";
import {
	RepositoryContent,
	type RepositorySnapshot,
	type WorkingFile,
} from "./repositoryContent.ts";

const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_ROWS = 20_000;
const FULL_DIFF_CONTEXT_LINES = 2_147_483_647;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_PREVIEW_CHARS = 512;

function assertNonEmptyString(
	value: unknown,
	field: string,
	maximum = 10_000,
): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
		throw new HttpError(400, "invalid_request", `${field} is invalid`);
	}
}

const CLICKABLE_TOKEN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;
const TOKEN_CHARACTER = /[A-Za-z0-9_$-]/;

function exactTokenColumn(line: string, query: string): number | null {
	if (!CLICKABLE_TOKEN.test(query)) {
		const index = line.indexOf(query);
		return index < 0 ? null : index + 1;
	}
	let offset = 0;
	while (offset <= line.length - query.length) {
		const index = line.indexOf(query, offset);
		if (index < 0) return null;
		const before = index === 0 ? "" : (line[index - 1] ?? "");
		const after = line[index + query.length] ?? "";
		if ((!before || !TOKEN_CHARACTER.test(before)) && (!after || !TOKEN_CHARACTER.test(after))) {
			return index + 1;
		}
		offset = index + Math.max(1, query.length);
	}
	return null;
}

function boundedSearchPreview(line: string, query: string, column: number): string {
	if (line.length <= MAX_SEARCH_PREVIEW_CHARS) return line;
	const matchIndex = Math.max(0, column - 1);
	const surrounding = Math.max(0, MAX_SEARCH_PREVIEW_CHARS - query.length);
	let start = Math.max(0, matchIndex - Math.floor(surrounding / 2));
	const end = Math.min(line.length, start + MAX_SEARCH_PREVIEW_CHARS);
	start = Math.max(0, end - MAX_SEARCH_PREVIEW_CHARS);
	return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

export class RepositoryDiff {
	constructor(
		private readonly root: string,
		private readonly emptyTree: string,
		private readonly content: RepositoryContent,
		private readonly getSnapshot: (fresh?: boolean) => Promise<RepositorySnapshot>,
	) {}

	async diff(fileId: string): Promise<DiffResponse> {
		const snapshot = await this.getSnapshot();
		const file = this.content.requireFile(snapshot, fileId);
		let patch = "";
		let tooLarge = false;
		let binary = false;
		let fullFilePatch: string | null | undefined;

		if (file.kind === "untracked") {
			const working = await this.content.readWorkingFile(file.path, MAX_DIFF_BYTES + 1);
			tooLarge = working.bytes.byteLength > MAX_DIFF_BYTES;
			const visibleWorking = tooLarge
				? { ...working, bytes: working.bytes.subarray(0, MAX_DIFF_BYTES) }
				: working;
			binary = visibleWorking.bytes.includes(0);
			if (!binary) {
				const untrackedPatch = this.createUntrackedPatch(file.path, visibleWorking);
				patch = untrackedPatch.patch;
				tooLarge ||= untrackedPatch.truncated;
			}
		} else if (
			file.indexStatus === "D" &&
			file.worktreeStatus === "?" &&
			snapshot.repository.head
		) {
			const replacement = await this.diffDeletedThenRecreated(file.path, snapshot.repository.head);
			patch = replacement.patch;
			fullFilePatch = replacement.fullFilePatch;
			tooLarge = replacement.tooLarge;
		} else {
			const paths = [file.kind === "renamed" ? file.previousPath : null, file.path].filter(
				(value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
			);
			const diffArgs = (contextLines: number) =>
				[
					"-c",
					"diff.suppressBlankEmpty=false",
					"diff",
					"--no-color",
					"--no-ext-diff",
					"--no-textconv",
					`--unified=${contextLines}`,
					"--find-renames",
					snapshot.repository.head ?? this.emptyTree,
					"--",
					...paths,
				] as const;
			const needsFullFilePatch = !["added", "deleted"].includes(file.kind);
			let [result, fullResult] = await this.readTrackedDiff(diffArgs, needsFullFilePatch);
			if (result.stdout.byteLength === 0) {
				const refreshed = await this.getSnapshot(true);
				const refreshedFile = refreshed.files.find((candidate) => candidate.id === file.id);
				if (!refreshedFile) {
					throw new HttpError(
						409,
						"content_changed",
						"The file is no longer changed; refresh the review queue",
					);
				}
				if (refreshedFile.contentRevision !== file.contentRevision) {
					throw new HttpError(
						409,
						"content_changed",
						"The file changed while its diff was loading; try again",
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 40));
				[result, fullResult] = await this.readTrackedDiff(diffArgs, needsFullFilePatch);
				if (result.stdout.byteLength === 0) {
					throw new GitCommandError(
						diffArgs(3),
						0,
						"Git reported this path as changed but returned no diff output on two attempts.",
						"empty_output",
					);
				}
			}
			tooLarge = result.stdoutTruncated;
			patch = decodeGitOutput(result.stdout);
			if (fullResult) {
				fullFilePatch = this.completeFullFilePatch(fullResult);
			}
		}

		const parsed = patch
			? parseUnifiedDiff(patch, MAX_DIFF_ROWS)
			: {
					header: [],
					hunks: [],
					additions: 0,
					deletions: 0,
					binary,
					truncated: false,
				};
		tooLarge ||= parsed.truncated;
		const buildDiff = (hunks: FileDiff["hunks"], truncated: boolean): DiffResponse => ({
			diff: {
				fileId: file.id,
				path: file.path,
				previousPath: file.previousPath,
				kind: file.kind,
				contentRevision: file.contentRevision,
				operationRevision: snapshot.operationRevision,
				binary: binary || parsed.binary,
				tooLarge: truncated,
				header: [
					...(truncated ? ["Diff preview truncated at 2 MiB or 20,000 rendered rows."] : []),
					...parsed.header,
				],
				...(fullFilePatch !== undefined ? { fullFilePatch } : {}),
				hunks,
				additions: parsed.additions,
				deletions: parsed.deletions,
			},
		});
		let response = buildDiff(parsed.hunks, tooLarge);
		if (
			fullFilePatch &&
			new TextEncoder().encode(JSON.stringify(response)).byteLength > MAX_DIFF_BYTES
		) {
			fullFilePatch = null;
			response = buildDiff(parsed.hunks, tooLarge);
		}
		if (new TextEncoder().encode(JSON.stringify(response)).byteLength > MAX_DIFF_BYTES) {
			const totalRows = parsed.hunks.reduce((count, hunk) => count + hunk.lines.length, 0);
			const takeRows = (maximum: number): FileDiff["hunks"] => {
				let remaining = maximum;
				return parsed.hunks.flatMap((hunk) => {
					if (remaining <= 0) return [];
					const lines = hunk.lines.slice(0, remaining);
					remaining -= lines.length;
					return lines.length > 0 ? [{ ...hunk, lines }] : [];
				});
			};
			let low = 0;
			let high = totalRows;
			while (low < high) {
				const middle = Math.ceil((low + high) / 2);
				const candidate = buildDiff(takeRows(middle), true);
				if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength <= MAX_DIFF_BYTES) {
					low = middle;
				} else {
					high = middle - 1;
				}
			}
			response = buildDiff(takeRows(low), true);
		}
		return response;
	}

	private completeFullFilePatch(result: {
		stdout: Uint8Array;
		stdoutTruncated: boolean;
	}): string | null {
		if (result.stdoutTruncated) return null;
		const fullPatch = decodeGitOutput(result.stdout);
		return parseUnifiedDiff(fullPatch, MAX_DIFF_ROWS).truncated ? null : fullPatch;
	}

	private async readTrackedDiff(
		diffArgs: (contextLines: number) => readonly string[],
		needsFullFilePatch: boolean,
	): Promise<[GitResult, GitResult | null]> {
		return Promise.all([
			runGit(this.root, diffArgs(3), {
				maxOutputBytes: MAX_DIFF_BYTES,
				truncateOutput: true,
			}),
			needsFullFilePatch
				? runGit(this.root, diffArgs(FULL_DIFF_CONTEXT_LINES), {
						maxOutputBytes: MAX_DIFF_BYTES,
						truncateOutput: true,
					})
				: Promise.resolve(null),
		]);
	}

	async search(query: string, currentPath: string): Promise<SearchResponse> {
		assertNonEmptyString(query, "query", 128);
		if (query.includes("\0") || /[\r\n]/.test(query)) {
			throw new HttpError(400, "invalid_query", "Search text must be a single line");
		}
		if (currentPath) this.content.resolveProjectPath(currentPath);
		const result = await runGit(
			this.root,
			[
				"grep",
				"--no-color",
				"--untracked",
				"--exclude-standard",
				"--no-textconv",
				"--full-name",
				"-n",
				"--column",
				"-I",
				"-F",
				"-z",
				"-e",
				query,
				"--",
				".",
			],
			{
				allowExitCodes: [0, 1],
				maxOutputBytes: 8 * 1024 * 1024,
				truncateOutput: true,
			},
		);
		const parsed = parseGrepOutput(result.stdout).flatMap((match) => {
			const column = exactTokenColumn(match.preview, query);
			return column === null
				? []
				: [
						{
							...match,
							column,
							preview: boundedSearchPreview(match.preview, query, column),
						},
					];
		});
		const truncated = result.stdoutTruncated || parsed.length > MAX_SEARCH_RESULTS;
		const currentMatches = parsed.filter((match) => match.path === currentPath);
		const otherMatches = parsed.filter((match) => match.path !== currentPath);
		const currentFile = currentMatches.slice(0, MAX_SEARCH_RESULTS);
		const remaining = Math.max(0, MAX_SEARCH_RESULTS - currentFile.length);
		return {
			query,
			currentPath,
			currentFile,
			otherFiles: otherMatches.slice(0, remaining),
			truncated,
		};
	}

	async source(
		pathName: string,
		focusLine: number,
		context: number,
	): Promise<SourcePreviewResponse> {
		this.content.resolveProjectPath(pathName);
		if (!Number.isSafeInteger(focusLine) || focusLine < 1) {
			throw new HttpError(400, "invalid_line", "focus line must be a positive integer");
		}
		const safeContext = Math.min(Math.max(Number.isSafeInteger(context) ? context : 4, 0), 30);
		if (!(await this.content.isProjectFile(pathName))) {
			throw new HttpError(404, "file_not_found", "File is not tracked or available to search");
		}
		const working = await this.content.readWorkingFile(pathName, MAX_SOURCE_BYTES + 1);
		if (working.bytes.byteLength > MAX_SOURCE_BYTES) {
			throw new HttpError(413, "file_too_large", "Source file exceeds the 8 MiB preview limit");
		}
		if (working.bytes.includes(0)) {
			throw new HttpError(422, "binary_file", "Binary files cannot be previewed as source");
		}
		const text = decodeGitOutput(working.bytes).replace(/\r\n/g, "\n");
		const allLines = text.split("\n");
		if (allLines.at(-1) === "") allLines.pop();
		const clampedFocus = Math.min(focusLine, Math.max(allLines.length, 1));
		const startLine = Math.max(1, clampedFocus - safeContext);
		const endLine = Math.min(allLines.length, clampedFocus + safeContext);
		return {
			path: pathName,
			focusLine: clampedFocus,
			startLine,
			endLine,
			lines: allLines.slice(startLine - 1, endLine).map((line, index) => ({
				line: startLine + index,
				text: line,
			})),
			truncated: startLine > 1 || endLine < allLines.length,
		};
	}

	private createUntrackedPatch(
		relativePath: string,
		working: WorkingFile,
	): { patch: string; truncated: boolean } {
		const displayPath = relativePath.replace(/[\r\n]/g, "?");
		const content = decodeGitOutput(working.bytes).replace(/\r\n/g, "\n");
		const trailingNewline = content.endsWith("\n");
		const contentEnd = trailingNewline ? content.length - 1 : content.length;
		let totalLines = content.length === 0 ? 0 : trailingNewline ? 0 : 1;
		for (let index = 0; index < content.length; index += 1) {
			if (content.charCodeAt(index) === 10) totalLines += 1;
		}
		const sourceLines: string[] = [];
		let offset = 0;
		const visibleLineCount = Math.min(totalLines, MAX_DIFF_ROWS);
		while (sourceLines.length < visibleLineCount) {
			const newline = content.indexOf("\n", offset);
			const end = newline < 0 || newline > contentEnd ? contentEnd : newline;
			sourceLines.push(content.slice(offset, end));
			offset = end < contentEnd ? end + 1 : contentEnd;
		}
		const lines = [
			`diff --git a/${displayPath} b/${displayPath}`,
			`new file mode ${working.mode}`,
			"--- /dev/null",
			`+++ b/${displayPath}`,
		];
		if (totalLines > 0) {
			lines.push(`@@ -0,0 +1,${totalLines} @@`);
			lines.push(...sourceLines.map((line) => `+${line}`));
			if (!trailingNewline && totalLines <= MAX_DIFF_ROWS) {
				lines.push("\\ No newline at end of file");
			}
		}
		return {
			patch: `${lines.join("\n")}\n`,
			truncated: totalLines > MAX_DIFF_ROWS,
		};
	}

	private async diffDeletedThenRecreated(
		relativePath: string,
		head: string,
	): Promise<{
		patch: string;
		fullFilePatch: string | null;
		tooLarge: boolean;
	}> {
		const treeEntry = await runGit(this.root, ["ls-tree", "-z", head, "--", relativePath]);
		const entry = decodeGitOutput(treeEntry.stdout).split("\0")[0] ?? "";
		const objectMatch = /^[0-7]+\s+blob\s+([0-9a-f]+)\t/.exec(entry);
		if (!objectMatch?.[1]) {
			throw new HttpError(409, "content_changed", "The base file changed; refresh the diff");
		}
		const [base, working] = await Promise.all([
			runGit(this.root, ["cat-file", "blob", objectMatch[1]], {
				binaryOutput: true,
				maxOutputBytes: MAX_DIFF_BYTES + 1,
				truncateOutput: true,
			}),
			this.content.readWorkingFile(relativePath, MAX_DIFF_BYTES + 1),
		]);
		const tooLarge =
			base.stdoutTruncated ||
			base.stdout.byteLength > MAX_DIFF_BYTES ||
			working.bytes.byteLength > MAX_DIFF_BYTES;
		const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "couchview-diff-"));
		const oldPath = path.join(temporaryDirectory, "old");
		const newPath = path.join(temporaryDirectory, "new");
		try {
			await Promise.all([
				writeFile(oldPath, base.stdout.subarray(0, MAX_DIFF_BYTES)),
				writeFile(newPath, working.bytes.subarray(0, MAX_DIFF_BYTES)),
			]);
			const diffArgs = (contextLines: number) =>
				[
					"-c",
					"diff.suppressBlankEmpty=false",
					"diff",
					"--no-index",
					"--no-color",
					"--no-ext-diff",
					"--no-textconv",
					`--unified=${contextLines}`,
					"--",
					oldPath,
					newPath,
				] as const;
			const [result, fullResult] = await Promise.all([
				runGit(this.root, diffArgs(3), {
					allowExitCodes: [0, 1],
					maxOutputBytes: MAX_DIFF_BYTES,
					truncateOutput: true,
				}),
				tooLarge
					? Promise.resolve(null)
					: runGit(this.root, diffArgs(FULL_DIFF_CONTEXT_LINES), {
							allowExitCodes: [0, 1],
							maxOutputBytes: MAX_DIFF_BYTES,
							truncateOutput: true,
						}),
			]);
			return {
				patch: decodeGitOutput(result.stdout),
				fullFilePatch: fullResult ? this.completeFullFilePatch(fullResult) : null,
				tooLarge: tooLarge || result.stdoutTruncated,
			};
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	}
}
