import { randomUUID } from "node:crypto";
import {
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
	ChangesResponse,
	CommitRequest,
	CommitResponse,
	DiffResponse,
	FileChange,
	FileChangeDelta,
	GenerateCommitMessageRequest,
	ProjectFilesResponse,
	ReviewStateResponse,
	SearchResponse,
	SetReviewRequest,
	SetReviewResponse,
	SetReviewsRequest,
	SetReviewsResponse,
	SourceFileResponse,
	SourcePreviewResponse,
	StageFileRequest,
	StageFileResponse,
	StageFilesRequest,
	StageFilesResponse,
	StageFileTarget,
} from "../shared/contracts.ts";
import type {
	GitActionRequest,
	GitActionResponse,
	GitCommitChangesResponse,
	GitHistoryResponse,
	GitHistoryScope,
} from "../shared/git/index.ts";
import { StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import {
	createRepositoryGitModule,
	decodeGitOutput,
	GitCommandError,
	type ParsedStatusEntry,
	type RepositoryGitModule,
	runGit,
	sha256,
} from "./git/index.ts";
import { RepositoryContent } from "./repositoryContent.ts";
import { RepositoryDiff } from "./repositoryDiff.ts";
import { RepositoryReview } from "./repositoryReview.ts";
import { RepositorySnapshotService } from "./repositorySnapshot.ts";
import { ReviewStore } from "./state.ts";

function basePathForEntry(entry: ParsedStatusEntry): string {
	return entry.kind === "renamed" && entry.previousPath ? entry.previousPath : entry.path;
}

function changeFileDelta(
	before: readonly FileChange[],
	after: readonly FileChange[],
): FileChangeDelta {
	const beforeById = new Map(before.map((file) => [file.id, file]));
	const afterIds = new Set(after.map((file) => file.id));
	return {
		upserted: after.filter(
			(file) => JSON.stringify(beforeById.get(file.id)) !== JSON.stringify(file),
		),
		removedFileIds: before.filter((file) => !afterIds.has(file.id)).map((file) => file.id),
		orderedFileIds: after.map((file) => file.id),
	};
}

function bytesEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
	if (left === null || right === null) return left === right;
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
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

export class GitRepository {
	readonly root: string;
	readonly gitDirectory: string;
	readonly indexPath: string;
	readonly id: string;
	readonly emptyTree: string;
	readonly store: ReviewStore;
	readonly catalogAdded: boolean;
	private readonly ownedDatabase: StateDatabase | null;
	private readonly content: RepositoryContent;
	private readonly diffs: RepositoryDiff;
	private readonly snapshots: RepositorySnapshotService;
	private readonly reviews: RepositoryReview;
	private readonly gitWorkspace: RepositoryGitModule;

	private constructor(
		root: string,
		gitDirectory: string,
		indexPath: string,
		emptyTree: string,
		database: StateDatabase,
		ownedDatabase: StateDatabase | null,
	) {
		this.root = root;
		this.gitDirectory = gitDirectory;
		this.indexPath = indexPath;
		this.emptyTree = emptyTree;
		this.id = sha256(root, "\0", gitDirectory).slice(0, 24);
		this.ownedDatabase = ownedDatabase;
		this.catalogAdded = database.registerRepository({
			id: this.id,
			name: path.basename(root),
			root,
			gitDirectory,
		}).added;
		this.store = new ReviewStore(database, this.id);
		this.content = new RepositoryContent(root);
		this.snapshots = new RepositorySnapshotService(
			root,
			this.id,
			emptyTree,
			this.store,
			this.content,
		);
		this.diffs = new RepositoryDiff(root, emptyTree, this.content, (fresh) =>
			this.snapshots.getSnapshot(fresh),
		);
		this.gitWorkspace = createRepositoryGitModule({
			root,
			repositoryId: this.id,
			emptyTree,
			getSnapshot: (fresh) => this.snapshots.getSnapshot(fresh),
		});
		this.reviews = new RepositoryReview(root, this.store, this.content, this.snapshots);
	}

	static async open(candidate: string, database?: StateDatabase): Promise<GitRepository> {
		const ownedDatabase = database ? null : StateDatabase.memory();
		const stateDatabase = database ?? ownedDatabase;
		if (!stateDatabase) throw new Error("State database is unavailable");
		try {
			const candidateRoot = await realpath(candidate).catch(() => {
				throw new HttpError(400, "repository_not_found", "The repository directory does not exist");
			});
			const rootResult = await runGit(candidateRoot, ["rev-parse", "--show-toplevel"]);
			const root = await realpath(decodeGitOutput(rootResult.stdout).trim());
			const gitDirectoryResult = await runGit(root, ["rev-parse", "--absolute-git-dir"]);
			const gitDirectory = await realpath(decodeGitOutput(gitDirectoryResult.stdout).trim());
			const indexPathResult = await runGit(root, ["rev-parse", "--git-path", "index"]);
			const rawIndexPath = decodeGitOutput(indexPathResult.stdout).trim();
			const indexPath = path.isAbsolute(rawIndexPath)
				? rawIndexPath
				: path.resolve(root, rawIndexPath);
			const emptyTreeDirectory = await mkdtemp(path.join(tmpdir(), "couchview-empty-tree-"));
			let emptyTreeResult;
			try {
				const emptyTreeFile = path.join(emptyTreeDirectory, "empty");
				await writeFile(emptyTreeFile, new Uint8Array());
				emptyTreeResult = await runGit(root, ["hash-object", "-t", "tree", "--", emptyTreeFile]);
			} finally {
				await rm(emptyTreeDirectory, { recursive: true, force: true });
			}
			return new GitRepository(
				root,
				gitDirectory,
				indexPath,
				decodeGitOutput(emptyTreeResult.stdout).trim(),
				stateDatabase,
				ownedDatabase,
			);
		} catch (error) {
			ownedDatabase?.close();
			throw error;
		}
	}

	async changes(): Promise<ChangesResponse> {
		const snapshot = await this.snapshots.getSnapshot();
		return {
			repository: snapshot.repository,
			files: snapshot.files,
			operationRevision: snapshot.operationRevision,
		};
	}

	async projectFiles(): Promise<ProjectFilesResponse> {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const before = await this.snapshots.getSnapshot(true);
			const catalog = await this.content.projectFiles();
			const after = await this.snapshots.getSnapshot(true);
			if (before.operationRevision === after.operationRevision) {
				return {
					repositoryId: this.id,
					operationRevision: after.operationRevision,
					...catalog,
				};
			}
		}
		throw new HttpError(
			409,
			"project_files_changed",
			"Project files changed while the file list was loading; try again",
		);
	}

	async diff(fileId: string): Promise<DiffResponse> {
		return this.diffs.diff(fileId);
	}

	async history(scope: GitHistoryScope, cursor: string | null): Promise<GitHistoryResponse> {
		return this.gitWorkspace.history(scope, cursor);
	}

	async historyCommit(commit: string): Promise<GitCommitChangesResponse> {
		return this.gitWorkspace.historyCommit(commit);
	}

	async historyDiff(commit: string, fileId: string): Promise<DiffResponse> {
		return this.gitWorkspace.historyDiff(commit, fileId);
	}

	async gitAction(input: GitActionRequest): Promise<GitActionResponse> {
		return this.gitWorkspace.action(input);
	}

	async search(query: string, currentPath: string): Promise<SearchResponse> {
		return this.diffs.search(query, currentPath);
	}

	async source(
		pathName: string,
		focusLine: number,
		context: number,
	): Promise<SourcePreviewResponse> {
		return this.diffs.source(pathName, focusLine, context);
	}

	async sourceFile(pathName: string, focusLine: number): Promise<SourceFileResponse> {
		return this.diffs.sourceFile(pathName, focusLine);
	}

	async stage(input: StageFileRequest): Promise<StageFileResponse> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new HttpError(400, "invalid_request", "Staging request is invalid");
		}
		assertNonEmptyString(input.fileId, "file id", 100);
		assertNonEmptyString(input.operationRevision, "operation revision", 200);
		assertNonEmptyString(input.contentRevision, "content revision", 200);
		if (input.staged !== undefined && typeof input.staged !== "boolean") {
			throw new HttpError(400, "invalid_request", "Staging target is invalid");
		}
		const result = await this.updateStageTargets(
			[
				{
					fileId: input.fileId,
					contentRevision: input.contentRevision,
				},
			],
			input.operationRevision,
			input.staged ?? true,
		);
		return {
			file: result.files.find((candidate) => candidate.id === input.fileId) ?? null,
			changes: result.changes,
			operationRevision: result.operationRevision,
		};
	}

	async stageFiles(input: StageFilesRequest): Promise<StageFilesResponse> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new HttpError(400, "invalid_request", "Bulk staging request is invalid");
		}
		assertNonEmptyString(input.operationRevision, "operation revision", 200);
		if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 10_000) {
			throw new HttpError(
				400,
				"invalid_request",
				"Bulk staging requires between 1 and 10,000 files",
			);
		}
		const seen = new Set<string>();
		for (const target of input.files) {
			if (!target || typeof target !== "object" || Array.isArray(target)) {
				throw new HttpError(400, "invalid_request", "Bulk staging file is invalid");
			}
			assertNonEmptyString(target.fileId, "file id", 100);
			assertNonEmptyString(target.contentRevision, "content revision", 200);
			if (seen.has(target.fileId)) {
				throw new HttpError(400, "invalid_request", "Bulk staging contains a duplicate file");
			}
			seen.add(target.fileId);
		}
		return this.updateStageTargets(input.files, input.operationRevision, true);
	}

	private async updateStageTargets(
		targets: readonly StageFileTarget[],
		operationRevision: string,
		shouldStage: boolean,
	): Promise<StageFilesResponse> {
		return this.gitWorkspace.runMutation(async () => {
			const lockPath = `${this.indexPath}.lock`;
			const temporaryIndex = path.join(
				path.dirname(this.indexPath),
				`.${path.basename(this.indexPath)}.couchview.${process.pid}.${randomUUID()}.tmp`,
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

				const locked = await this.snapshots.getSnapshot(true);
				if (locked.operationRevision !== operationRevision) {
					throw new HttpError(
						409,
						"operation_changed",
						"Project changes changed; refresh before staging",
					);
				}
				const targetsById = new Map(targets.map((target) => [target.fileId, target]));
				const selectedById = new Map<string, { file: FileChange; entry: ParsedStatusEntry }>();
				for (const target of targets) {
					const file = this.content.requireCurrentContent(
						locked,
						target.fileId,
						target.contentRevision,
					);
					const entry = locked.entries.get(file.id);
					if (!entry) {
						throw new HttpError(
							409,
							"content_changed",
							"The file is no longer available for staging",
						);
					}
					selectedById.set(file.id, { file, entry });
				}
				const selected = locked.files.flatMap((file) => {
					const target = selectedById.get(file.id);
					return target ? [target] : [];
				});

				let originalIndex: Uint8Array | null = null;
				try {
					const indexMetadata = await stat(this.indexPath);
					originalIndex = Uint8Array.from(await readFile(this.indexPath));
					await writeFile(temporaryIndex, originalIndex, {
						flag: "wx",
						mode: 0o600,
					});
					// Writing gives the temporary index a new timestamp, which can hide
					// same-size working-tree edits from Git's racy-clean detection.
					await utimes(temporaryIndex, indexMetadata.atime, indexMetadata.mtime);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					await runGit(this.root, ["read-tree", "--empty"], {
						env: { GIT_INDEX_FILE: temporaryIndex },
					});
				}

				const candidateConflictPaths = locked.files.flatMap((candidate) => [
					candidate.path,
					...(candidate.previousPath ? [candidate.previousPath] : []),
				]);
				for (const { file } of selected) {
					if (shouldStage) {
						await this.stageExactPath(
							temporaryIndex,
							file.path,
							file.kind === "deleted",
							candidateConflictPaths,
						);
						if (
							file.kind === "renamed" &&
							file.previousPath &&
							!locked.files.some(
								(candidate) => candidate.id !== file.id && candidate.path === file.previousPath,
							)
						) {
							const previousExists = await lstat(this.content.resolveProjectPath(file.previousPath))
								.then(() => true)
								.catch((error) => {
									if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
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
						await this.unstageExactPath(temporaryIndex, file, locked.repository.head);
					}
				}

				const currentBaseEntries = await this.snapshots.readBaseEntries(
					selected.map(({ entry }) => entry),
					locked.repository.head,
				);
				const currentContentRevisions = await Promise.all(
					selected.map(({ entry }) =>
						this.content.contentRevision(
							entry,
							locked.repository.head,
							currentBaseEntries.get(basePathForEntry(entry)) ?? "",
							false,
						),
					),
				);
				for (const [index, { file }] of selected.entries()) {
					if (currentContentRevisions[index] !== targetsById.get(file.id)?.contentRevision) {
						throw new HttpError(
							409,
							"content_changed",
							"A file changed while it was being staged; refresh first",
						);
					}
				}
				const currentIndex = await readFile(this.indexPath)
					.then((bytes) => Uint8Array.from(bytes))
					.catch((error) => {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
						throw error;
					});
				if (!bytesEqual(originalIndex, currentIndex)) {
					throw new HttpError(
						409,
						"operation_changed",
						"The Git index changed while staging; refresh first",
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

				const after = await this.snapshots.getSnapshot(true);
				return {
					files: after.files.filter((candidate) => targetsById.has(candidate.id)),
					changes: changeFileDelta(locked.files, after.files),
					operationRevision: after.operationRevision,
				};
			} finally {
				await lockHandle?.close().catch(() => undefined);
				if (ownsLock) await unlink(lockPath).catch(() => undefined);
				await unlink(temporaryIndex).catch(() => undefined);
			}
		});
	}

	async commit(input: CommitRequest): Promise<CommitResponse> {
		return this.gitWorkspace.runMutation(async () => {
			if (!input || typeof input !== "object" || Array.isArray(input)) {
				throw new HttpError(400, "invalid_request", "Commit request is invalid");
			}
			assertNonEmptyString(input.message, "commit message", 20_000);
			assertNonEmptyString(input.operationRevision, "operation revision", 200);
			if (input.message.includes("\0")) {
				throw new HttpError(400, "invalid_request", "Commit message is invalid");
			}

			const before = await this.snapshots.getSnapshot(true);
			if (before.operationRevision !== input.operationRevision) {
				throw new HttpError(
					409,
					"operation_changed",
					"Project changes changed; refresh before committing",
				);
			}
			if (before.files.some((file) => file.conflicted)) {
				throw new HttpError(409, "unresolved_conflicts", "Resolve Git conflicts before committing");
			}
			if (!before.files.some((file) => file.staged)) {
				throw new HttpError(409, "nothing_staged", "Nothing is staged to commit");
			}

			const message = input.message.replace(/\r\n?/g, "\n").trim();
			try {
				await runGit(this.root, ["commit", "--message", message, "--cleanup=whitespace"], {
					maxOutputBytes: 1024 * 1024,
					timeoutMs: 120_000,
				});
			} catch (error) {
				if (error instanceof GitCommandError) {
					if (
						/Author identity unknown|unable to auto-detect email address|Please tell me who you are|empty ident (?:name|email)/i.test(
							error.stderr,
						)
					) {
						throw new HttpError(
							409,
							"git_identity_missing",
							"Configure Git user.name and user.email before committing",
						);
					}
					if (/nothing to commit|no changes added to commit/i.test(error.stderr)) {
						throw new HttpError(409, "nothing_staged", "Nothing is staged to commit");
					}
					if (/index\.lock|another git process/i.test(error.stderr)) {
						throw new HttpError(
							423,
							"git_index_locked",
							"The Git index is busy; try again shortly",
						);
					}
				}
				throw error;
			}

			const head = await runGit(this.root, ["rev-parse", "HEAD"]);
			const after = await this.snapshots.getSnapshot(true);
			return {
				commit: decodeGitOutput(head.stdout).trim(),
				operationRevision: after.operationRevision,
			};
		});
	}

	async commitMessageContext(input: GenerateCommitMessageRequest): Promise<string> {
		return this.reviews.commitMessageContext(input);
	}

	async assertCommitMessageRevision(operationRevision: string): Promise<void> {
		return this.reviews.assertCommitMessageRevision(operationRevision);
	}

	async reviewState(): Promise<ReviewStateResponse> {
		return this.reviews.reviewState();
	}

	async setReview(input: SetReviewRequest): Promise<SetReviewResponse> {
		return this.reviews.setReview(input);
	}

	async setReviews(input: SetReviewsRequest): Promise<SetReviewsResponse> {
		return this.reviews.setReviews(input);
	}

	startWatching(onChange: (operationRevision: string) => void): void {
		this.snapshots.startWatching(onChange);
	}

	close(): void {
		this.snapshots.close();
		this.ownedDatabase?.close();
	}

	private async stageExactPath(
		indexPath: string,
		relativePath: string,
		forceRemove = false,
		candidateConflictPaths: readonly string[] = [],
	): Promise<void> {
		const absolutePath = this.content.resolveProjectPath(relativePath);
		if (forceRemove) {
			await runGit(this.root, ["update-index", "--force-remove", "--", relativePath], {
				env: { GIT_INDEX_FILE: indexPath },
			});
			return;
		}
		const metadata = await lstat(absolutePath).catch((error) => {
			if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
				return null;
			}
			throw error;
		});
		if (!metadata) {
			await runGit(this.root, ["update-index", "--force-remove", "--", relativePath], {
				env: { GIT_INDEX_FILE: indexPath },
			});
			return;
		}

		let mode: string;
		let objectId: string;
		if (metadata.isSymbolicLink()) {
			mode = "120000";
			const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "couchview-symlink-"));
			try {
				const temporaryFile = path.join(temporaryDirectory, "target");
				await writeFile(temporaryFile, await readlink(absolutePath));
				const result = await runGit(this.root, ["hash-object", "-w", "--", temporaryFile]);
				objectId = decodeGitOutput(result.stdout).trim();
			} finally {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		} else if (metadata.isFile()) {
			const containedPath = await this.content.assertSafeRegularPath(absolutePath);
			mode = metadata.mode & 0o100 ? "100755" : "100644";
			const result = await runGit(this.root, ["hash-object", "-w", "--", containedPath], {
				timeoutMs: 30_000,
			});
			objectId = decodeGitOutput(result.stdout).trim();
		} else if (metadata.isDirectory()) {
			const result = await runGit(absolutePath, ["rev-parse", "HEAD"], {
				allowExitCodes: [0, 128],
			});
			if (result.exitCode !== 0) {
				throw new HttpError(422, "unsupported_file", "Only files and Git submodules can be staged");
			}
			mode = "160000";
			objectId = decodeGitOutput(result.stdout).trim();
		} else {
			throw new HttpError(422, "unsupported_file", "This filesystem entry cannot be staged");
		}
		await this.removeIndexPathConflicts(indexPath, relativePath, candidateConflictPaths);
		await runGit(
			this.root,
			["update-index", "--add", "--cacheinfo", mode, objectId, relativePath],
			{ env: { GIT_INDEX_FILE: indexPath } },
		);
	}

	private async unstageExactPath(
		indexPath: string,
		file: FileChange,
		head: string | null,
	): Promise<void> {
		const paths = [
			file.path,
			...(file.kind === "renamed" && file.previousPath ? [file.previousPath] : []),
		];
		if (head) {
			await runGit(this.root, ["reset", "-q", head, "--", ...paths], {
				env: { GIT_INDEX_FILE: indexPath },
			});
			return;
		}
		await runGit(this.root, ["update-index", "--force-remove", "--", ...paths], {
			env: { GIT_INDEX_FILE: indexPath },
		});
	}

	private async removeIndexPathConflicts(
		indexPath: string,
		relativePath: string,
		candidatePaths: readonly string[],
	): Promise<void> {
		const descendantPrefix = `${relativePath}/`;
		const conflicts = [
			...new Set(
				candidatePaths.filter(
					(trackedPath) =>
						trackedPath &&
						trackedPath !== relativePath &&
						(trackedPath.startsWith(descendantPrefix) ||
							relativePath.startsWith(`${trackedPath}/`)),
				),
			),
		];
		if (conflicts.length === 0) return;
		for (let offset = 0; offset < conflicts.length; offset += 256) {
			await runGit(
				this.root,
				["update-index", "--force-remove", "--", ...conflicts.slice(offset, offset + 256)],
				{ env: { GIT_INDEX_FILE: indexPath } },
			);
		}
	}
}
