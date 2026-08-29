import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import path from "node:path";

import type { FileChange, ProjectFileEntry, RepositorySummary } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import type { ParsedStatusEntry } from "./git/index.ts";
import { decodeGitOutput, runGit } from "./git/index.ts";

export interface RepositorySnapshot {
	repository: RepositorySummary;
	files: FileChange[];
	operationRevision: string;
	entries: Map<string, ParsedStatusEntry>;
}

export interface WorkingFile {
	bytes: Uint8Array;
	mode: "100644" | "100755" | "120000";
}

interface WorkingFileStatistics {
	binary: boolean;
	lines: number;
}

interface ContentRevisionCacheEntry {
	signature: string;
	revision: string;
	workingFileStatistics: WorkingFileStatistics | null;
}

function statisticsForBytes(bytes: Uint8Array): WorkingFileStatistics {
	const binary = looksBinary(bytes);
	let newlines = 0;
	for (const byte of bytes) {
		if (byte === 10) newlines += 1;
	}
	return {
		binary,
		lines: bytes.byteLength === 0 ? 0 : newlines + (bytes[bytes.byteLength - 1] === 10 ? 0 : 1),
	};
}

const BINARY_UTF8_PROBE_BYTES = 64 * 1024;
const PROJECT_FILE_ARGS = ["ls-files", "--cached", "--others", "--exclude-standard", "-z"] as const;
const DELETED_PROJECT_FILE_ARGS = ["ls-files", "--deleted", "-z"] as const;

export interface ProjectFileCatalogLimits {
	maxOutputBytes: number;
	maxResults: number;
}

export interface ProjectFileCatalog {
	files: ProjectFileEntry[];
	truncated: boolean;
}

const DEFAULT_PROJECT_FILE_CATALOG_LIMITS: ProjectFileCatalogLimits = {
	maxOutputBytes: 8 * 1024 * 1024,
	maxResults: 50_000,
};

function nulTerminatedPaths(output: Uint8Array): string[] {
	const lastTerminator = output.lastIndexOf(0);
	if (lastTerminator < 0) return [];
	return decodeGitOutput(output.subarray(0, lastTerminator + 1))
		.split("\0")
		.filter(Boolean);
}

/**
 * Classify bytes as binary. A NUL byte anywhere in the bounded buffer is
 * binary (Git's documented heuristic). Without NULs, a strict UTF-8 decode on
 * a bounded prefix decides; an undecodable prefix is binary only when control
 * characters dominate, so legacy single-byte encodings stay text. The probe
 * retries with trimmed tails so a chunk boundary that splits a multi-byte
 * sequence does not misclassify text files.
 */
export function looksBinary(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) return true;
	return utf8ProbeLooksBinary(bytes.subarray(0, Math.min(bytes.length, BINARY_UTF8_PROBE_BYTES)));
}

export function utf8ProbeLooksBinary(probe: Uint8Array): boolean {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		decoder.decode(probe);
		return false;
	} catch {
		// The final multi-byte sequence may be cut at the probe boundary; a
		// truncated tail is not enough to call the file binary.
		for (let trim = 1; trim <= 3; trim += 1) {
			try {
				decoder.decode(probe.subarray(0, probe.length - trim));
				return false;
			} catch {
				// still undecodable; try a shorter tail
			}
		}
	}
	const decoded = new TextDecoder("utf-8").decode(probe);
	let suspicious = 0;
	for (const char of decoded) {
		const code = char.charCodeAt(0);
		if (char === "\uFFFD" || (code < 0x20 && char !== "\t" && char !== "\n" && char !== "\r")) {
			suspicious += 1;
		}
	}
	return suspicious >= 2 && suspicious > decoded.length / 4;
}

function assertNonEmptyString(
	value: unknown,
	field: string,
	maximum = 10_000,
): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
		throw new HttpError(400, "invalid_request", `${field} is invalid`);
	}
}

export class RepositoryContent {
	private readonly contentRevisionCache = new Map<string, ContentRevisionCacheEntry>();

	constructor(private readonly root: string) {}

	requireFile(snapshot: RepositorySnapshot, fileId: string): FileChange {
		assertNonEmptyString(fileId, "file id", 100);
		const file = snapshot.files.find((candidate) => candidate.id === fileId);
		if (!file) throw new HttpError(404, "file_not_found", "Changed file not found");
		return file;
	}

	requireCurrentContent(
		snapshot: RepositorySnapshot,
		fileId: string,
		revision: string,
	): FileChange {
		const file = this.requireFile(snapshot, fileId);
		if (file.contentRevision !== revision) {
			throw new HttpError(409, "content_changed", "File content changed; refresh the diff first");
		}
		return file;
	}

	async contentRevision(
		entry: ParsedStatusEntry,
		head: string | null,
		baseEntry: string,
		useCache = true,
	): Promise<string> {
		const relativePath = entry.path;
		const absolutePath = this.resolveProjectPath(relativePath);
		const cacheKey = this.contentRevisionCacheKey(entry, head);
		const hash = createHash("sha256");
		const shouldMeasureWorkingFile = entry.kind === "untracked";
		hash.update(head ? baseEntry : "unborn");
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
			const cacheSignature = [
				head ?? "unborn",
				baseEntry,
				gitMode,
				metadata.dev,
				metadata.ino,
				metadata.size,
				metadata.mtimeMs,
				metadata.ctimeMs,
			].join("\0");
			const cached = this.contentRevisionCache.get(cacheKey);
			if (
				useCache &&
				!metadata.isDirectory() &&
				cached?.signature === cacheSignature &&
				(!shouldMeasureWorkingFile || cached.workingFileStatistics !== null)
			) {
				return cached.revision;
			}
			let workingFileStatistics: WorkingFileStatistics | null = null;
			if (metadata.isSymbolicLink()) {
				const target = await readlink(absolutePath);
				hash.update("symlink\0");
				hash.update(target);
				if (shouldMeasureWorkingFile) {
					workingFileStatistics = statisticsForBytes(new TextEncoder().encode(target));
				}
			} else if (metadata.isFile()) {
				const containedPath = await this.assertSafeRegularPath(absolutePath);
				const handle = await open(containedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
				try {
					const chunk = Buffer.allocUnsafe(64 * 1024);
					let position = 0;
					let nulSeen = false;
					let firstChunk: Uint8Array | null = null;
					let newlines = 0;
					let lastByte = -1;
					while (true) {
						const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
						if (bytesRead === 0) break;
						const bytes = chunk.subarray(0, bytesRead);
						hash.update(bytes);
						if (shouldMeasureWorkingFile) {
							if (firstChunk === null) {
								firstChunk = bytes.subarray(0, Math.min(bytes.length, BINARY_UTF8_PROBE_BYTES));
							}
							for (const byte of bytes) {
								nulSeen ||= byte === 0;
								if (byte === 10) newlines += 1;
								lastByte = byte;
							}
						}
						position += bytesRead;
					}
					if (shouldMeasureWorkingFile) {
						workingFileStatistics = {
							binary: nulSeen || (firstChunk !== null ? utf8ProbeLooksBinary(firstChunk) : false),
							lines: position === 0 ? 0 : newlines + (lastByte === 10 ? 0 : 1),
						};
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
			const revision = hash.digest("hex");
			if (!metadata.isDirectory()) {
				this.contentRevisionCache.set(cacheKey, {
					signature: cacheSignature,
					revision,
					workingFileStatistics,
				});
			}
			return revision;
		} catch (error) {
			if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
				throw error;
			}
			hash.update("\0deleted");
			const signature = `${head ?? "unborn"}\0${baseEntry}\0deleted`;
			const cached = this.contentRevisionCache.get(cacheKey);
			if (useCache && cached?.signature === signature) return cached.revision;
			const revision = hash.digest("hex");
			this.contentRevisionCache.set(cacheKey, {
				signature,
				revision,
				workingFileStatistics: null,
			});
			return revision;
		}
	}

	private contentRevisionCacheKey(entry: ParsedStatusEntry, head: string | null): string {
		return [head ?? "unborn", entry.path, entry.previousPath ?? ""].join("\0");
	}

	workingFileStatistics(
		entry: ParsedStatusEntry,
		head: string | null,
	): WorkingFileStatistics | null {
		return (
			this.contentRevisionCache.get(this.contentRevisionCacheKey(entry, head))
				?.workingFileStatistics ?? null
		);
	}

	pruneContentRevisions(entries: readonly ParsedStatusEntry[], head: string | null): void {
		const activeKeys = new Set(entries.map((entry) => this.contentRevisionCacheKey(entry, head)));
		for (const key of this.contentRevisionCache.keys()) {
			if (!activeKeys.has(key)) this.contentRevisionCache.delete(key);
		}
	}

	resolveProjectPath(relativePath: string): string {
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
			throw new HttpError(400, "invalid_path", "Project path escapes the repository");
		}
		return resolved;
	}

	async assertSafeRegularPath(absolutePath: string): Promise<string> {
		const relativePath = path.relative(this.root, absolutePath);
		let parent = this.root;
		for (const segment of relativePath.split(path.sep).slice(0, -1)) {
			parent = path.join(parent, segment);
			const metadata = await lstat(parent).catch(() => null);
			if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
				throw new HttpError(400, "invalid_path", "Project file has an unsafe parent directory");
			}
		}
		return absolutePath;
	}

	async readWorkingFile(relativePath: string, maximum: number): Promise<WorkingFile> {
		const absolutePath = this.resolveProjectPath(relativePath);
		const metadata = await lstat(absolutePath).catch((error) => {
			if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
				throw new HttpError(404, "file_not_found", "Working file no longer exists");
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
			throw new HttpError(422, "unsupported_file", "Only regular files can be displayed");
		}
		const containedPath = await this.assertSafeRegularPath(absolutePath);
		const handle = await open(containedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const openedMetadata = await handle.stat();
			if (!openedMetadata.isFile()) {
				throw new HttpError(422, "unsupported_file", "Only regular files can be displayed");
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

	async projectFiles(
		limits: ProjectFileCatalogLimits = DEFAULT_PROJECT_FILE_CATALOG_LIMITS,
	): Promise<ProjectFileCatalog> {
		const options = {
			maxOutputBytes: limits.maxOutputBytes,
			truncateOutput: true,
		} as const;
		const [includedResult, deletedResult] = await Promise.all([
			runGit(this.root, PROJECT_FILE_ARGS, options),
			runGit(this.root, DELETED_PROJECT_FILE_ARGS, options),
		]);
		const deletedPaths = new Set(nulTerminatedPaths(deletedResult.stdout));
		const paths = [
			...new Set(
				nulTerminatedPaths(includedResult.stdout).filter(
					(candidate) => !deletedPaths.has(candidate),
				),
			),
		].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
		return {
			files: paths.slice(0, limits.maxResults).map((path) => ({ path })),
			truncated:
				includedResult.stdoutTruncated ||
				deletedResult.stdoutTruncated ||
				paths.length > limits.maxResults,
		};
	}

	async isProjectFile(relativePath: string): Promise<boolean> {
		const result = await runGit(this.root, [...PROJECT_FILE_ARGS, "--", relativePath]);
		return decodeGitOutput(result.stdout)
			.split("\0")
			.some((candidate) => candidate === relativePath);
	}
}
