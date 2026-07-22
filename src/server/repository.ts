import { createHash, randomUUID } from "node:crypto";
import { constants, type FSWatcher, watch } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	stat,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
	ChangeFile,
	ChangesResponse,
	CommentResponse,
	CreateCommentRequest,
	DeleteCommentResponse,
	DiffResponse,
	FileDiff,
	RepositorySummary,
	ReviewStateResponse,
	SearchResponse,
	SetReviewRequest,
	SetReviewResponse,
	SourcePreviewResponse,
	StageFileRequest,
	StageFileResponse,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import {
	decodeGitOutput,
	type ParsedStatusEntry,
	parseGrepOutput,
	parsePorcelainV2,
	parseUnifiedDiff,
	runGit,
	sha256,
} from "./git.ts";
import { ReviewStore } from "./state.ts";

const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_ROWS = 20_000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_PREVIEW_CHARS = 512;
const EMPTY_SNAPSHOT_CONFIRMATIONS = 2;
const EMPTY_SNAPSHOT_CONFIRMATION_DELAY_MS = 75;
const STATUS_SNAPSHOT_ARGS = [
	"--no-optional-locks",
	"-c",
	"core.fsmonitor=false",
	"status",
	"--porcelain=v2",
	"-z",
	"--branch",
	"--untracked-files=all",
] as const;
const INDEX_SNAPSHOT_ARGS = [
	"diff",
	"--cached",
	"--raw",
	"-z",
	"--no-renames",
	"--no-ext-diff",
] as const;

class IncompleteStatusIdentityError extends Error {
	constructor() {
		super("Git status returned an incomplete repository identity");
		this.name = "IncompleteStatusIdentityError";
	}
}

interface Snapshot {
	repository: RepositorySummary;
	files: ChangeFile[];
	operationRevision: string;
	entries: Map<string, ParsedStatusEntry>;
}

interface WorkingFile {
	bytes: Uint8Array;
	mode: "100644" | "100755" | "120000";
}

function assertNonEmptyString(
	value: unknown,
	field: string,
	maximum = 10_000,
): asserts value is string {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > maximum
	) {
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
		if (
			(!before || !TOKEN_CHARACTER.test(before)) &&
			(!after || !TOKEN_CHARACTER.test(after))
		) {
			return index + 1;
		}
		offset = index + Math.max(1, query.length);
	}
	return null;
}

function boundedSearchPreview(
	line: string,
	query: string,
	column: number,
): string {
	if (line.length <= MAX_SEARCH_PREVIEW_CHARS) return line;
	const matchIndex = Math.max(0, column - 1);
	const surrounding = Math.max(0, MAX_SEARCH_PREVIEW_CHARS - query.length);
	let start = Math.max(0, matchIndex - Math.floor(surrounding / 2));
	const end = Math.min(line.length, start + MAX_SEARCH_PREVIEW_CHARS);
	start = Math.max(0, end - MAX_SEARCH_PREVIEW_CHARS);
	return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

export class GitRepository {
	readonly root: string;
	readonly gitDirectory: string;
	readonly indexPath: string;
	readonly id: string;
	readonly emptyTree: string;
	readonly store: ReviewStore;
	private stageQueue: Promise<void> = Promise.resolve();
	private watcher: FSWatcher | null = null;
	private watchTimer: ReturnType<typeof setTimeout> | null = null;
	private snapshotInFlight: Promise<Snapshot> | null = null;
	private lastSnapshot: Snapshot | null = null;

	private constructor(
		root: string,
		gitDirectory: string,
		indexPath: string,
		emptyTree: string,
	) {
		this.root = root;
		this.gitDirectory = gitDirectory;
		this.indexPath = indexPath;
		this.emptyTree = emptyTree;
		this.id = sha256(root, "\0", gitDirectory).slice(0, 24);
		this.store = new ReviewStore(gitDirectory);
	}

	static async open(candidate: string): Promise<GitRepository> {
		const candidateRoot = await realpath(candidate).catch(() => {
			throw new HttpError(
				400,
				"repository_not_found",
				"The repository directory does not exist",
			);
		});
		const rootResult = await runGit(candidateRoot, [
			"rev-parse",
			"--show-toplevel",
		]);
		const root = await realpath(decodeGitOutput(rootResult.stdout).trim());
		const gitDirectoryResult = await runGit(root, [
			"rev-parse",
			"--absolute-git-dir",
		]);
		const gitDirectory = await realpath(
			decodeGitOutput(gitDirectoryResult.stdout).trim(),
		);
		const indexPathResult = await runGit(root, [
			"rev-parse",
			"--git-path",
			"index",
		]);
		const rawIndexPath = decodeGitOutput(indexPathResult.stdout).trim();
		const indexPath = path.isAbsolute(rawIndexPath)
			? rawIndexPath
			: path.resolve(root, rawIndexPath);
		const emptyTreeResult = await runGit(
			root,
			["hash-object", "-t", "tree", "--stdin"],
			{
				input: new Uint8Array(),
			},
		);
		return new GitRepository(
			root,
			gitDirectory,
			indexPath,
			decodeGitOutput(emptyTreeResult.stdout).trim(),
		);
	}

	async bootstrap(csrfToken: string) {
		const snapshot = await this.getSnapshot();
		return {
			repository: snapshot.repository,
			csrfToken,
			operationRevision: snapshot.operationRevision,
		};
	}

	async changes(): Promise<ChangesResponse> {
		const snapshot = await this.getSnapshot();
		return {
			repository: snapshot.repository,
			files: snapshot.files,
			operationRevision: snapshot.operationRevision,
		};
	}

	async diff(fileId: string): Promise<DiffResponse> {
		const snapshot = await this.getSnapshot();
		const file = this.requireFile(snapshot, fileId);
		let patch = "";
		let tooLarge = false;
		let binary = false;

		if (file.kind === "untracked") {
			const working = await this.readWorkingFile(file.path, MAX_DIFF_BYTES + 1);
			tooLarge = working.bytes.byteLength > MAX_DIFF_BYTES;
			const visibleWorking = tooLarge
				? { ...working, bytes: working.bytes.subarray(0, MAX_DIFF_BYTES) }
				: working;
			binary = visibleWorking.bytes.includes(0);
			if (!binary) {
				const untrackedPatch = this.createUntrackedPatch(
					file.path,
					visibleWorking,
				);
				patch = untrackedPatch.patch;
				tooLarge ||= untrackedPatch.truncated;
			}
		} else if (
			file.indexStatus === "D" &&
			file.worktreeStatus === "?" &&
			snapshot.repository.head
		) {
			const replacement = await this.diffDeletedThenRecreated(
				file.path,
				snapshot.repository.head,
			);
			patch = replacement.patch;
			tooLarge = replacement.tooLarge;
		} else {
			const paths = [
				file.kind === "renamed" ? file.previousPath : null,
				file.path,
			].filter(
				(value, index, all): value is string =>
					Boolean(value) && all.indexOf(value) === index,
			);
			const result = await runGit(
				this.root,
				[
					"-c",
					"diff.suppressBlankEmpty=false",
					"diff",
					"--no-color",
					"--no-ext-diff",
					"--no-textconv",
					"--unified=3",
					"--find-renames",
					snapshot.repository.head ?? this.emptyTree,
					"--",
					...paths,
				],
				{ maxOutputBytes: MAX_DIFF_BYTES, truncateOutput: true },
			);
			tooLarge = result.stdoutTruncated;
			patch = decodeGitOutput(result.stdout);
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
		const buildDiff = (
			hunks: FileDiff["hunks"],
			truncated: boolean,
		): DiffResponse => ({
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
					...(truncated
						? ["Diff preview truncated at 2 MiB or 20,000 rendered rows."]
						: []),
					...parsed.header,
				],
				hunks,
				additions: parsed.additions,
				deletions: parsed.deletions,
			},
		});
		let response = buildDiff(parsed.hunks, tooLarge);
		if (
			new TextEncoder().encode(JSON.stringify(response)).byteLength >
			MAX_DIFF_BYTES
		) {
			const totalRows = parsed.hunks.reduce(
				(count, hunk) => count + hunk.lines.length,
				0,
			);
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
				if (
					new TextEncoder().encode(JSON.stringify(candidate)).byteLength <=
					MAX_DIFF_BYTES
				) {
					low = middle;
				} else {
					high = middle - 1;
				}
			}
			response = buildDiff(takeRows(low), true);
		}
		return response;
	}

	async search(query: string, currentPath: string): Promise<SearchResponse> {
		assertNonEmptyString(query, "query", 128);
		if (query.includes("\0") || /[\r\n]/.test(query)) {
			throw new HttpError(
				400,
				"invalid_query",
				"Search text must be a single line",
			);
		}
		if (currentPath) this.resolveProjectPath(currentPath);
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
		const truncated =
			result.stdoutTruncated || parsed.length > MAX_SEARCH_RESULTS;
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
		this.resolveProjectPath(pathName);
		if (!Number.isSafeInteger(focusLine) || focusLine < 1) {
			throw new HttpError(
				400,
				"invalid_line",
				"focus line must be a positive integer",
			);
		}
		const safeContext = Math.min(
			Math.max(Number.isSafeInteger(context) ? context : 4, 0),
			30,
		);
		if (!(await this.isProjectFile(pathName))) {
			throw new HttpError(
				404,
				"file_not_found",
				"File is not tracked or available to search",
			);
		}
		const working = await this.readWorkingFile(pathName, MAX_SOURCE_BYTES + 1);
		if (working.bytes.byteLength > MAX_SOURCE_BYTES) {
			throw new HttpError(
				413,
				"file_too_large",
				"Source file exceeds the 8 MiB preview limit",
			);
		}
		if (working.bytes.includes(0)) {
			throw new HttpError(
				422,
				"binary_file",
				"Binary files cannot be previewed as source",
			);
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

	async stage(input: StageFileRequest): Promise<StageFileResponse> {
		return this.withStageLock(async () => {
			if (!input || typeof input !== "object" || Array.isArray(input)) {
				throw new HttpError(
					400,
					"invalid_request",
					"Staging request is invalid",
				);
			}
			assertNonEmptyString(input.fileId, "file id", 100);
			assertNonEmptyString(input.operationRevision, "operation revision", 200);
			assertNonEmptyString(input.contentRevision, "content revision", 200);
			if (input.staged !== undefined && typeof input.staged !== "boolean") {
				throw new HttpError(
					400,
					"invalid_request",
					"Staging target is invalid",
				);
			}
			const shouldStage = input.staged ?? true;
			const before = await this.getSnapshot(true);
			if (before.operationRevision !== input.operationRevision) {
				throw new HttpError(
					409,
					"operation_changed",
					"Project changes changed; refresh before staging",
				);
			}
			const file = this.requireFile(before, input.fileId);
			if (file.contentRevision !== input.contentRevision) {
				throw new HttpError(
					409,
					"content_changed",
					"File content changed; refresh before staging",
				);
			}
			const lockPath = `${this.indexPath}.lock`;
			const temporaryIndex = path.join(
				path.dirname(this.indexPath),
				`.${path.basename(this.indexPath)}.couch-review.${process.pid}.${randomUUID()}.tmp`,
			);
			let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
			let ownsLock = false;
			try {
				await mkdir(path.dirname(this.indexPath), { recursive: true });
				try {
					lockHandle = await open(lockPath, "wx", 0o600);
					ownsLock = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "EEXIST") {
						throw new HttpError(
							423,
							"git_index_locked",
							"The Git index is busy; try again shortly",
						);
					}
					throw error;
				}

				const locked = await this.getSnapshot(true);
				if (locked.operationRevision !== input.operationRevision) {
					throw new HttpError(
						409,
						"operation_changed",
						"Project changes changed; refresh before staging",
					);
				}
				this.requireCurrentContent(locked, input.fileId, input.contentRevision);

				try {
					const indexMetadata = await stat(this.indexPath);
					await copyFile(this.indexPath, temporaryIndex);
					// copyFile gives the temporary index a new timestamp, which can hide
					// same-size working-tree edits from Git's racy-clean detection.
					await utimes(
						temporaryIndex,
						indexMetadata.atime,
						indexMetadata.mtime,
					);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					await runGit(this.root, ["read-tree", "--empty"], {
						env: { GIT_INDEX_FILE: temporaryIndex },
					});
				}
				if (shouldStage) {
					await this.stageExactPath(
						temporaryIndex,
						file.path,
						file.kind === "deleted",
					);
					if (
						file.kind === "renamed" &&
						file.previousPath &&
						!locked.files.some(
							(candidate) =>
								candidate.id !== file.id &&
								candidate.path === file.previousPath,
						)
					) {
						const previousExists = await lstat(
							this.resolveProjectPath(file.previousPath),
						)
							.then(() => true)
							.catch((error) => {
								if (
									["ENOENT", "ENOTDIR"].includes(
										(error as NodeJS.ErrnoException).code ?? "",
									)
								) {
									return false;
								}
								throw error;
							});
						if (!previousExists) {
							await runGit(
								this.root,
								["update-index", "--force-remove", "--", file.previousPath],
								{ env: { GIT_INDEX_FILE: temporaryIndex } },
							);
						}
					}
				} else {
					await this.unstageExactPath(
						temporaryIndex,
						file,
						locked.repository.head,
					);
				}

				const unchanged = await this.getSnapshot(true);
				const unchangedFile = this.requireFile(unchanged, input.fileId);
				if (
					unchanged.operationRevision !== input.operationRevision ||
					unchangedFile.contentRevision !== input.contentRevision
				) {
					throw new HttpError(
						409,
						"operation_changed",
						"Project changes changed while staging; refresh first",
					);
				}

				const prospectiveIndex = await readFile(temporaryIndex);
				await lockHandle.truncate(0);
				await lockHandle.writeFile(prospectiveIndex);
				await lockHandle.sync();
				await lockHandle.close();
				lockHandle = undefined;
				await rename(lockPath, this.indexPath);
				ownsLock = false;

				const after = await this.getSnapshot(true);
				return {
					file:
						after.files.find((candidate) => candidate.id === input.fileId) ??
						null,
					operationRevision: after.operationRevision,
				};
			} finally {
				await lockHandle?.close().catch(() => undefined);
				if (ownsLock) await unlink(lockPath).catch(() => undefined);
				await unlink(temporaryIndex).catch(() => undefined);
			}
		});
	}

	async reviewState(): Promise<ReviewStateResponse> {
		const [snapshot, state] = await Promise.all([
			this.getSnapshot(),
			this.store.snapshot(),
		]);
		const revisions = new Map(
			snapshot.files.map((file) => [file.id, file.contentRevision]),
		);
		return {
			reviews: state.reviews.map((review) => ({
				...review,
				reviewed:
					review.reviewed &&
					revisions.get(review.fileId) === review.contentRevision,
			})),
			comments: state.comments.map((comment) => ({
				...comment,
				stale: revisions.get(comment.fileId) !== comment.contentRevision,
			})),
		};
	}

	async setReview(input: SetReviewRequest): Promise<SetReviewResponse> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new HttpError(400, "invalid_request", "Review request is invalid");
		}
		assertNonEmptyString(input.fileId, "file id", 100);
		assertNonEmptyString(input.contentRevision, "content revision", 200);
		if (typeof input.reviewed !== "boolean") {
			throw new HttpError(400, "invalid_request", "reviewed must be a boolean");
		}
		const snapshot = await this.getSnapshot();
		const file = this.requireCurrentContent(
			snapshot,
			input.fileId,
			input.contentRevision,
		);
		const review = await this.store.setReview({
			fileId: file.id,
			path: file.path,
			contentRevision: file.contentRevision,
			reviewed: input.reviewed,
			updatedAt: new Date().toISOString(),
		});
		return { review };
	}

	async createComment(input: CreateCommentRequest): Promise<CommentResponse> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new HttpError(400, "invalid_request", "Comment request is invalid");
		}
		assertNonEmptyString(input.fileId, "file id", 100);
		assertNonEmptyString(input.contentRevision, "content revision", 200);
		assertNonEmptyString(input.hunkHeader, "hunk header", 1_000);
		const snapshot = await this.getSnapshot();
		const file = this.requireCurrentContent(
			snapshot,
			input.fileId,
			input.contentRevision,
		);
		if (
			input.side !== "new" &&
			input.side !== "old" &&
			input.side !== "mixed"
		) {
			throw new HttpError(400, "invalid_comment", "Comment side is invalid");
		}
		if (
			!Number.isSafeInteger(input.startLine) ||
			!Number.isSafeInteger(input.endLine) ||
			input.startLine < 1 ||
			input.endLine < input.startLine
		) {
			throw new HttpError(
				400,
				"invalid_comment",
				"Comment line range is invalid",
			);
		}
		const validOptionalRange = (
			start: number | undefined,
			end: number | undefined,
		) =>
			start === undefined && end === undefined
				? true
				: Number.isSafeInteger(start) &&
					Number.isSafeInteger(end) &&
					(start ?? 0) >= 1 &&
					(end ?? 0) >= (start ?? 0);
		if (
			!validOptionalRange(input.oldStartLine, input.oldEndLine) ||
			!validOptionalRange(input.newStartLine, input.newEndLine) ||
			(input.side === "mixed" &&
				(input.oldStartLine === undefined || input.newStartLine === undefined))
		) {
			throw new HttpError(
				400,
				"invalid_comment",
				"Comment side ranges are invalid",
			);
		}
		assertNonEmptyString(input.body, "comment body", 20_000);
		const currentDiff = (await this.diff(file.id)).diff;
		if (currentDiff.contentRevision !== file.contentRevision) {
			throw new HttpError(
				409,
				"content_changed",
				"File content changed; refresh the diff first",
			);
		}
		if (currentDiff.binary || currentDiff.hunks.length === 0) {
			throw new HttpError(
				400,
				"comment_not_supported",
				"Line comments require a textual diff hunk",
			);
		}

		const oldStart =
			input.side === "new"
				? undefined
				: (input.oldStartLine ?? input.startLine);
		const oldEnd =
			input.side === "new" ? undefined : (input.oldEndLine ?? input.endLine);
		const newStart =
			input.side === "old"
				? undefined
				: (input.newStartLine ?? input.startLine);
		const newEnd =
			input.side === "old" ? undefined : (input.newEndLine ?? input.endLine);
		const rangeContains = (
			value: number | null,
			start: number | undefined,
			end: number | undefined,
		) =>
			value !== null &&
			start !== undefined &&
			end !== undefined &&
			value >= start &&
			value <= end;
		const hasBoundary = (
			hunk: (typeof currentDiff.hunks)[number],
			side: "old" | "new",
			boundary: number | undefined,
		) =>
			boundary === undefined ||
			hunk.lines.some(
				(line) => (side === "old" ? line.oldLine : line.newLine) === boundary,
			);

		let selected:
			| {
					hunk: (typeof currentDiff.hunks)[number];
					lines: (typeof currentDiff.hunks)[number]["lines"];
			  }
			| undefined;
		for (const hunk of currentDiff.hunks) {
			if (hunk.header !== input.hunkHeader) continue;
			if (
				!hasBoundary(hunk, "old", oldStart) ||
				!hasBoundary(hunk, "old", oldEnd) ||
				!hasBoundary(hunk, "new", newStart) ||
				!hasBoundary(hunk, "new", newEnd)
			) {
				continue;
			}
			const indexedLines = hunk.lines.flatMap((line, index) => {
				if (line.kind === "metadata") return [];
				const matches =
					rangeContains(line.oldLine, oldStart, oldEnd) ||
					rangeContains(line.newLine, newStart, newEnd);
				return matches ? [{ line, index }] : [];
			});
			if (indexedLines.length === 0) continue;
			if (input.side === "mixed") {
				const first = indexedLines[0]?.index ?? -1;
				const last = indexedLines.at(-1)?.index ?? -1;
				const contiguous = hunk.lines
					.slice(first, last + 1)
					.every(
						(line) =>
							line.kind !== "metadata" &&
							(rangeContains(line.oldLine, oldStart, oldEnd) ||
								rangeContains(line.newLine, newStart, newEnd)),
					);
				if (!contiguous) continue;
			}
			selected = { hunk, lines: indexedLines.map(({ line }) => line) };
			break;
		}
		if (!selected) {
			throw new HttpError(
				400,
				"invalid_comment_anchor",
				"Comment lines must belong to one visible diff hunk",
			);
		}

		const excerpt = selected.lines
			.slice(0, 200)
			.map((line) =>
				input.side === "mixed"
					? `${line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "} ${line.text}`
					: line.text,
			);
		const normalizedStart = newStart ?? oldStart;
		const normalizedEnd = newEnd ?? oldEnd;
		if (normalizedStart === undefined || normalizedEnd === undefined) {
			throw new HttpError(
				400,
				"invalid_comment_anchor",
				"Comment line range is invalid",
			);
		}
		const comment = await this.store.createComment(
			{
				...input,
				startLine: normalizedStart,
				endLine: normalizedEnd,
				...(oldStart === undefined
					? { oldStartLine: undefined, oldEndLine: undefined }
					: { oldStartLine: oldStart, oldEndLine: oldEnd }),
				...(newStart === undefined
					? { newStartLine: undefined, newEndLine: undefined }
					: { newStartLine: newStart, newEndLine: newEnd }),
				body: input.body.trim(),
				hunkHeader: selected.hunk.header,
				excerpt,
			},
			file.path,
		);
		return { comment };
	}

	async updateComment(id: string, body: string): Promise<CommentResponse> {
		assertNonEmptyString(id, "comment id", 100);
		assertNonEmptyString(body, "comment body", 20_000);
		const comment = await this.store.updateComment(id, body.trim());
		const snapshot = await this.getSnapshot();
		const current = snapshot.files.find((file) => file.id === comment.fileId);
		return {
			comment: {
				...comment,
				stale: current?.contentRevision !== comment.contentRevision,
			},
		};
	}

	async deleteComment(id: string): Promise<DeleteCommentResponse> {
		assertNonEmptyString(id, "comment id", 100);
		await this.store.deleteComment(id);
		return { deletedId: id };
	}

	startWatching(onChange: (operationRevision: string) => void): void {
		if (this.watcher) return;
		try {
			this.watcher = watch(
				this.root,
				{ recursive: true },
				(_event, filename) => {
					const name = filename?.toString() ?? "";
					if (
						name.startsWith(`.git${path.sep}couch-review`) ||
						name.startsWith(".git/couch-review")
					)
						return;
					if (this.watchTimer) clearTimeout(this.watchTimer);
					this.watchTimer = setTimeout(() => {
						void this.getSnapshot()
							.then((snapshot) => onChange(snapshot.operationRevision))
							.catch(() => undefined);
					}, 180);
				},
			);
		} catch {
			this.watcher = null;
		}
	}

	close(): void {
		if (this.watchTimer) clearTimeout(this.watchTimer);
		this.watcher?.close();
		this.watcher = null;
	}

	private async getSnapshot(fresh = false): Promise<Snapshot> {
		if (fresh && this.snapshotInFlight) {
			await this.snapshotInFlight.catch(() => undefined);
		} else if (this.snapshotInFlight) {
			return this.snapshotInFlight;
		}
		const request = this.buildSnapshot().catch((error) => {
			// A transient empty stdout must never replace a valid repository state or
			// turn a background refresh into an application-wide error. Keep serving
			// the last verified snapshot; the next filesystem event or request retries.
			if (error instanceof IncompleteStatusIdentityError && this.lastSnapshot) {
				return this.lastSnapshot;
			}
			throw error;
		});
		this.snapshotInFlight = request;
		try {
			const snapshot = await request;
			this.lastSnapshot = snapshot;
			return snapshot;
		} finally {
			if (this.snapshotInFlight === request) this.snapshotInFlight = null;
		}
	}

	private async readSnapshotInputs() {
		return Promise.all([
			runGit(this.root, STATUS_SNAPSHOT_ARGS),
			runGit(this.root, INDEX_SNAPSHOT_ARGS),
		]);
	}

	private hasCompleteStatusIdentity(
		parsed: ReturnType<typeof parsePorcelainV2>,
	): boolean {
		return !(
			(!parsed.branch && !parsed.head && !parsed.unborn) ||
			(parsed.unborn && !parsed.branch)
		);
	}

	private validateStatusIdentity(
		parsed: ReturnType<typeof parsePorcelainV2>,
	): void {
		// `git status --branch` always identifies either a branch, a detached
		// commit, or an unborn branch. Treat an all-null identity as an incomplete
		// stdout read instead of publishing a false clean-working-tree snapshot.
		if (!this.hasCompleteStatusIdentity(parsed)) {
			throw new IncompleteStatusIdentityError();
		}
	}

	private async readValidatedSnapshotInputs() {
		let [statusResult, indexResult] = await this.readSnapshotInputs();
		let parsed = parsePorcelainV2(statusResult.stdout);
		if (!this.hasCompleteStatusIdentity(parsed)) {
			[statusResult, indexResult] = await this.readSnapshotInputs();
			parsed = parsePorcelainV2(statusResult.stdout);
		}
		this.validateStatusIdentity(parsed);
		return { indexResult, parsed };
	}

	private async buildSnapshot(): Promise<Snapshot> {
		let { indexResult, parsed } = await this.readValidatedSnapshotInputs();

		if (this.lastSnapshot?.files.length && parsed.entries.length === 0) {
			for (
				let attempt = 0;
				attempt < EMPTY_SNAPSHOT_CONFIRMATIONS;
				attempt += 1
			) {
				await new Promise((resolve) =>
					setTimeout(resolve, EMPTY_SNAPSHOT_CONFIRMATION_DELAY_MS),
				);
				({ indexResult, parsed } = await this.readValidatedSnapshotInputs());
				if (parsed.entries.length > 0) break;
			}
		}
		const state = await this.store.snapshot();
		const reviews = new Map(
			state.reviews.map((review) => [review.fileId, review]),
		);
		const commentCounts = new Map<string, number>();
		for (const comment of state.comments) {
			commentCounts.set(
				comment.fileId,
				(commentCounts.get(comment.fileId) ?? 0) + 1,
			);
		}

		const files = await Promise.all(
			parsed.entries.map(async (entry): Promise<ChangeFile> => {
				const id = sha256(entry.path).slice(0, 24);
				const contentRevision = await this.contentRevision(entry, parsed.head);
				const review = reviews.get(id);
				return {
					id,
					...entry,
					binary: null,
					additions: null,
					deletions: null,
					contentRevision,
					reviewed: Boolean(
						review?.reviewed && review.contentRevision === contentRevision,
					),
					commentCount: commentCounts.get(id) ?? 0,
				};
			}),
		);
		files.sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		);
		const repository: RepositorySummary = {
			id: this.id,
			name: path.basename(this.root),
			root: this.root,
			branch: parsed.branch,
			head: parsed.head,
			unborn: parsed.unborn,
		};
		const operationRevision = sha256(
			parsed.head ?? "unborn",
			"\0",
			parsed.branch ?? "detached",
			"\0",
			indexResult.stdout,
			"\0",
			files
				.map(
					(file) =>
						`${file.id}:${file.contentRevision}:${file.indexStatus}${file.worktreeStatus}`,
				)
				.join("\0"),
		);
		return {
			repository,
			files,
			operationRevision,
			entries: new Map(
				parsed.entries.map((entry) => [sha256(entry.path).slice(0, 24), entry]),
			),
		};
	}

	private requireFile(snapshot: Snapshot, fileId: string): ChangeFile {
		assertNonEmptyString(fileId, "file id", 100);
		const file = snapshot.files.find((candidate) => candidate.id === fileId);
		if (!file)
			throw new HttpError(404, "file_not_found", "Changed file not found");
		return file;
	}

	private requireCurrentContent(
		snapshot: Snapshot,
		fileId: string,
		revision: string,
	): ChangeFile {
		const file = this.requireFile(snapshot, fileId);
		if (file.contentRevision !== revision) {
			throw new HttpError(
				409,
				"content_changed",
				"File content changed; refresh the diff first",
			);
		}
		return file;
	}

	private async contentRevision(
		entry: ParsedStatusEntry,
		head: string | null,
	): Promise<string> {
		const relativePath = entry.path;
		const absolutePath = this.resolveProjectPath(relativePath);
		const hash = createHash("sha256");
		const basePath =
			entry.kind === "renamed" && entry.previousPath
				? entry.previousPath
				: relativePath;
		if (head) {
			const baseEntry = await runGit(this.root, [
				"ls-tree",
				"-z",
				head,
				"--",
				basePath,
			]);
			hash.update(baseEntry.stdout);
		} else {
			hash.update("unborn");
		}
		hash.update("\0");
		hash.update(relativePath);
		hash.update("\0");
		hash.update(entry.previousPath ?? "");
		try {
			const metadata = await lstat(absolutePath);
			const gitMode = metadata.isSymbolicLink()
				? "120000"
				: metadata.isFile()
					? metadata.mode & 0o100
						? "100755"
						: "100644"
					: metadata.isDirectory()
						? "160000"
						: "special";
			hash.update(`\0${gitMode}\0`);
			if (metadata.isSymbolicLink()) {
				hash.update("symlink\0");
				hash.update(await readlink(absolutePath));
			} else if (metadata.isFile()) {
				const containedPath = await this.assertSafeRegularPath(absolutePath);
				const handle = await open(
					containedPath,
					constants.O_RDONLY | constants.O_NOFOLLOW,
				);
				try {
					for await (const chunk of handle.createReadStream({
						autoClose: false,
					})) {
						hash.update(chunk);
					}
				} finally {
					await handle.close();
				}
			} else if (metadata.isDirectory()) {
				hash.update("directory");
				const nestedHead = await runGit(absolutePath, ["rev-parse", "HEAD"], {
					allowExitCodes: [0, 128],
					timeoutMs: 3_000,
				}).catch(() => null);
				if (nestedHead?.exitCode === 0) hash.update(nestedHead.stdout);
			} else {
				hash.update("special");
			}
		} catch (error) {
			if (
				!["ENOENT", "ENOTDIR"].includes(
					(error as NodeJS.ErrnoException).code ?? "",
				)
			) {
				throw error;
			}
			hash.update("\0deleted");
		}
		return hash.digest("hex");
	}

	private async stageExactPath(
		indexPath: string,
		relativePath: string,
		forceRemove = false,
	): Promise<void> {
		const absolutePath = this.resolveProjectPath(relativePath);
		if (forceRemove) {
			await runGit(
				this.root,
				["update-index", "--force-remove", "--", relativePath],
				{
					env: { GIT_INDEX_FILE: indexPath },
				},
			);
			return;
		}
		const metadata = await lstat(absolutePath).catch((error) => {
			if (
				["ENOENT", "ENOTDIR"].includes(
					(error as NodeJS.ErrnoException).code ?? "",
				)
			) {
				return null;
			}
			throw error;
		});
		if (!metadata) {
			await runGit(
				this.root,
				["update-index", "--force-remove", "--", relativePath],
				{
					env: { GIT_INDEX_FILE: indexPath },
				},
			);
			return;
		}

		let mode: string;
		let objectId: string;
		if (metadata.isSymbolicLink()) {
			mode = "120000";
			const result = await runGit(this.root, ["hash-object", "-w", "--stdin"], {
				input: await readlink(absolutePath),
			});
			objectId = decodeGitOutput(result.stdout).trim();
		} else if (metadata.isFile()) {
			const containedPath = await this.assertSafeRegularPath(absolutePath);
			mode = metadata.mode & 0o100 ? "100755" : "100644";
			const result = await runGit(
				this.root,
				["hash-object", "-w", "--", containedPath],
				{
					timeoutMs: 30_000,
				},
			);
			objectId = decodeGitOutput(result.stdout).trim();
		} else if (metadata.isDirectory()) {
			const result = await runGit(absolutePath, ["rev-parse", "HEAD"], {
				allowExitCodes: [0, 128],
			});
			if (result.exitCode !== 0) {
				throw new HttpError(
					422,
					"unsupported_file",
					"Only files and Git submodules can be staged",
				);
			}
			mode = "160000";
			objectId = decodeGitOutput(result.stdout).trim();
		} else {
			throw new HttpError(
				422,
				"unsupported_file",
				"This filesystem entry cannot be staged",
			);
		}
		await this.removeIndexPathConflicts(indexPath, relativePath);
		await runGit(
			this.root,
			["update-index", "--add", "--cacheinfo", mode, objectId, relativePath],
			{ env: { GIT_INDEX_FILE: indexPath } },
		);
	}

	private async unstageExactPath(
		indexPath: string,
		file: ChangeFile,
		head: string | null,
	): Promise<void> {
		const paths = [
			file.path,
			...(file.kind === "renamed" && file.previousPath
				? [file.previousPath]
				: []),
		];
		if (head) {
			await runGit(this.root, ["reset", "-q", head, "--", ...paths], {
				env: { GIT_INDEX_FILE: indexPath },
			});
			return;
		}
		await runGit(
			this.root,
			["update-index", "--force-remove", "-z", "--stdin"],
			{
				env: { GIT_INDEX_FILE: indexPath },
				input: new TextEncoder().encode(`${paths.join("\0")}\0`),
			},
		);
	}

	private async removeIndexPathConflicts(
		indexPath: string,
		relativePath: string,
	): Promise<void> {
		const result = await runGit(this.root, ["ls-files", "--cached", "-z"], {
			env: { GIT_INDEX_FILE: indexPath },
		});
		const descendantPrefix = `${relativePath}/`;
		const conflicts = [
			...new Set(
				decodeGitOutput(result.stdout)
					.split("\0")
					.filter(
						(trackedPath) =>
							trackedPath &&
							trackedPath !== relativePath &&
							(trackedPath.startsWith(descendantPrefix) ||
								relativePath.startsWith(`${trackedPath}/`)),
					),
			),
		];
		if (conflicts.length === 0) return;
		await runGit(
			this.root,
			["update-index", "--force-remove", "-z", "--stdin"],
			{
				env: { GIT_INDEX_FILE: indexPath },
				input: new TextEncoder().encode(`${conflicts.join("\0")}\0`),
			},
		);
	}

	private resolveProjectPath(relativePath: string): string {
		if (
			!relativePath ||
			relativePath.length > 4_096 ||
			relativePath.includes("\0") ||
			path.isAbsolute(relativePath) ||
			relativePath.split("/").includes("..")
		) {
			throw new HttpError(400, "invalid_path", "Project path is invalid");
		}
		const resolved = path.resolve(this.root, relativePath);
		const prefix = `${this.root}${path.sep}`;
		if (resolved !== this.root && !resolved.startsWith(prefix)) {
			throw new HttpError(
				400,
				"invalid_path",
				"Project path escapes the repository",
			);
		}
		return resolved;
	}

	private async assertSafeRegularPath(absolutePath: string): Promise<string> {
		const relativePath = path.relative(this.root, absolutePath);
		let parent = this.root;
		for (const segment of relativePath.split(path.sep).slice(0, -1)) {
			parent = path.join(parent, segment);
			const metadata = await lstat(parent).catch(() => null);
			if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
				throw new HttpError(
					400,
					"invalid_path",
					"Project file has an unsafe parent directory",
				);
			}
		}
		return absolutePath;
	}

	private async readWorkingFile(
		relativePath: string,
		maximum: number,
	): Promise<WorkingFile> {
		const absolutePath = this.resolveProjectPath(relativePath);
		const metadata = await lstat(absolutePath).catch((error) => {
			if (
				["ENOENT", "ENOTDIR"].includes(
					(error as NodeJS.ErrnoException).code ?? "",
				)
			) {
				throw new HttpError(
					404,
					"file_not_found",
					"Working file no longer exists",
				);
			}
			throw error;
		});
		if (metadata.isSymbolicLink()) {
			return {
				bytes: new TextEncoder().encode(await readlink(absolutePath)),
				mode: "120000",
			};
		}
		if (!metadata.isFile()) {
			throw new HttpError(
				422,
				"unsupported_file",
				"Only regular files can be displayed",
			);
		}
		const containedPath = await this.assertSafeRegularPath(absolutePath);
		const handle = await open(
			containedPath,
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			const openedMetadata = await handle.stat();
			if (!openedMetadata.isFile()) {
				throw new HttpError(
					422,
					"unsupported_file",
					"Only regular files can be displayed",
				);
			}
			const buffer = new Uint8Array(Math.min(openedMetadata.size, maximum));
			const mode = metadata.mode & 0o100 ? "100755" : "100644";
			if (buffer.byteLength === 0) return { bytes: buffer, mode };
			const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
			return { bytes: buffer.subarray(0, bytesRead), mode };
		} finally {
			await handle.close();
		}
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
	): Promise<{ patch: string; tooLarge: boolean }> {
		const treeEntry = await runGit(this.root, [
			"ls-tree",
			"-z",
			head,
			"--",
			relativePath,
		]);
		const entry = decodeGitOutput(treeEntry.stdout).split("\0")[0] ?? "";
		const objectMatch = /^[0-7]+\s+blob\s+([0-9a-f]+)\t/.exec(entry);
		if (!objectMatch?.[1]) {
			throw new HttpError(
				409,
				"content_changed",
				"The base file changed; refresh the diff",
			);
		}
		const [base, working] = await Promise.all([
			runGit(this.root, ["cat-file", "blob", objectMatch[1]], {
				maxOutputBytes: MAX_DIFF_BYTES + 1,
				truncateOutput: true,
			}),
			this.readWorkingFile(relativePath, MAX_DIFF_BYTES + 1),
		]);
		const tooLarge =
			base.stdoutTruncated ||
			base.stdout.byteLength > MAX_DIFF_BYTES ||
			working.bytes.byteLength > MAX_DIFF_BYTES;
		const temporaryDirectory = await mkdtemp(
			path.join(tmpdir(), "couch-review-diff-"),
		);
		const oldPath = path.join(temporaryDirectory, "old");
		const newPath = path.join(temporaryDirectory, "new");
		try {
			await Promise.all([
				writeFile(oldPath, base.stdout.subarray(0, MAX_DIFF_BYTES)),
				writeFile(newPath, working.bytes.subarray(0, MAX_DIFF_BYTES)),
			]);
			const result = await runGit(
				this.root,
				[
					"-c",
					"diff.suppressBlankEmpty=false",
					"diff",
					"--no-index",
					"--no-color",
					"--no-ext-diff",
					"--no-textconv",
					"--unified=3",
					"--",
					oldPath,
					newPath,
				],
				{
					allowExitCodes: [0, 1],
					maxOutputBytes: MAX_DIFF_BYTES,
					truncateOutput: true,
				},
			);
			return {
				patch: decodeGitOutput(result.stdout),
				tooLarge: tooLarge || result.stdoutTruncated,
			};
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	}

	private async isProjectFile(relativePath: string): Promise<boolean> {
		const result = await runGit(this.root, [
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z",
			"--",
			relativePath,
		]);
		return decodeGitOutput(result.stdout)
			.split("\0")
			.some((candidate) => candidate === relativePath);
	}

	private async withStageLock<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.stageQueue;
		let release!: () => void;
		this.stageQueue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}
}
