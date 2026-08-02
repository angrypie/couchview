import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import path from "node:path";

import type { ChangeFile, RepositorySummary } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import type { ParsedStatusEntry } from "./git.ts";
import { decodeGitOutput, runGit } from "./git.ts";

export interface RepositorySnapshot {
	repository: RepositorySummary;
	files: ChangeFile[];
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
	let binary = false;
	let newlines = 0;
	for (const byte of bytes) {
		binary ||= byte === 0;
		if (byte === 10) newlines += 1;
	}
	return {
		binary,
		lines: bytes.byteLength === 0 ? 0 : newlines + (bytes[bytes.byteLength - 1] === 10 ? 0 : 1),
	};
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

	requireFile(snapshot: RepositorySnapshot, fileId: string): ChangeFile {
		assertNonEmptyString(fileId, "file id", 100);
		const file = snapshot.files.find((candidate) => candidate.id === fileId);
		if (!file) throw new HttpError(404, "file_not_found", "Changed file not found");
		return file;
	}

	requireCurrentContent(
		snapshot: RepositorySnapshot,
		fileId: string,
		revision: string,
	): ChangeFile {
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
					let binary = false;
					let newlines = 0;
					let lastByte = -1;
					while (true) {
						const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
						if (bytesRead === 0) break;
						const bytes = chunk.subarray(0, bytesRead);
						hash.update(bytes);
						if (shouldMeasureWorkingFile) {
							for (const byte of bytes) {
								binary ||= byte === 0;
								if (byte === 10) newlines += 1;
								lastByte = byte;
							}
						}
						position += bytesRead;
					}
					if (shouldMeasureWorkingFile) {
						workingFileStatistics = {
							binary,
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

	async isProjectFile(relativePath: string): Promise<boolean> {
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
}
