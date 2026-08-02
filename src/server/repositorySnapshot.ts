import { type FSWatcher, watch } from "node:fs";
import path from "node:path";

import type { ChangeFile, ChangesResponse, RepositorySummary } from "../shared/contracts.ts";
import {
	decodeGitOutput,
	GitCommandError,
	type ParsedStatusEntry,
	parseNumstat,
	parsePorcelainV2,
	runGit,
	sha256,
} from "./git.ts";
import { RepositoryContent, type RepositorySnapshot } from "./repositoryContent.ts";
import { ReviewStore } from "./state.ts";

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

function basePathForEntry(entry: ParsedStatusEntry): string {
	return entry.kind === "renamed" && entry.previousPath ? entry.previousPath : entry.path;
}

export class RepositorySnapshotService {
	private watcher: FSWatcher | null = null;
	private watchTimer: ReturnType<typeof setTimeout> | null = null;
	private snapshotInFlight: Promise<RepositorySnapshot> | null = null;
	private lastSnapshot: RepositorySnapshot | null = null;

	constructor(
		private readonly root: string,
		private readonly id: string,
		private readonly emptyTree: string,
		private readonly store: ReviewStore,
		private readonly content: RepositoryContent,
	) {}

	async changes(): Promise<ChangesResponse> {
		const snapshot = await this.getSnapshot();
		return {
			repository: snapshot.repository,
			files: snapshot.files,
			operationRevision: snapshot.operationRevision,
		};
	}

	startWatching(onChange: (operationRevision: string) => void): void {
		if (this.watcher) return;
		try {
			this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
				const name = filename?.toString() ?? "";
				if (
					name.startsWith(`.git${path.sep}couchview`) ||
					name.startsWith(".git/couchview") ||
					name.startsWith(`.git${path.sep}couch-review`) ||
					name.startsWith(".git/couch-review")
				)
					return;
				if (this.watchTimer) clearTimeout(this.watchTimer);
				this.watchTimer = setTimeout(() => {
					void this.refreshWatcher(onChange).catch(() => undefined);
				}, 180);
			});
		} catch {
			this.watcher = null;
		}
	}

	close(): void {
		if (this.watchTimer) clearTimeout(this.watchTimer);
		this.watcher?.close();
		this.watcher = null;
	}

	private async refreshWatcher(onChange: (operationRevision: string) => void): Promise<void> {
		const previousRevision = this.lastSnapshot?.operationRevision ?? null;
		const snapshot = await this.getSnapshot();
		if (snapshot.operationRevision !== previousRevision) {
			onChange(snapshot.operationRevision);
		}
	}

	async getSnapshot(fresh = false): Promise<RepositorySnapshot> {
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

	private hasCompleteStatusIdentity(parsed: ReturnType<typeof parsePorcelainV2>): boolean {
		return !(
			(!parsed.branch && !parsed.head && !parsed.unborn) ||
			(parsed.unborn && !parsed.branch)
		);
	}

	private validateStatusIdentity(parsed: ReturnType<typeof parsePorcelainV2>): void {
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

	async readBaseEntries(
		entries: readonly ParsedStatusEntry[],
		head: string | null,
	): Promise<Map<string, string>> {
		const baseEntries = new Map<string, string>();
		if (!head) return baseEntries;
		const paths = [...new Set(entries.map((entry) => basePathForEntry(entry)))];
		const pathsByDepth = new Map<number, string[]>();
		for (const filePath of paths) {
			const depth = filePath.split("/").length;
			pathsByDepth.set(depth, [...(pathsByDepth.get(depth) ?? []), filePath]);
		}
		for (const sameDepthPaths of pathsByDepth.values()) {
			for (let offset = 0; offset < sameDepthPaths.length; offset += 256) {
				const result = await runGit(this.root, [
					"ls-tree",
					"-z",
					head,
					"--",
					...sameDepthPaths.slice(offset, offset + 256),
				]);
				for (const record of decodeGitOutput(result.stdout).split("\0")) {
					if (!record) continue;
					const separator = record.indexOf("\t");
					if (separator < 0) continue;
					baseEntries.set(record.slice(separator + 1), `${record}\0`);
				}
			}
		}
		return baseEntries;
	}

	private async buildSnapshot(): Promise<RepositorySnapshot> {
		let { indexResult, parsed } = await this.readValidatedSnapshotInputs();

		if (this.lastSnapshot?.files.length && parsed.entries.length === 0) {
			for (let attempt = 0; attempt < EMPTY_SNAPSHOT_CONFIRMATIONS; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, EMPTY_SNAPSHOT_CONFIRMATION_DELAY_MS));
				({ indexResult, parsed } = await this.readValidatedSnapshotInputs());
				if (parsed.entries.length > 0) break;
			}
		}
		const baseEntries = await this.readBaseEntries(parsed.entries, parsed.head);
		const state = await this.store.snapshot();
		const reviews = new Map(state.reviews.map((review) => [review.fileId, review]));
		const commentCounts = new Map<string, number>();
		for (const comment of state.comments) {
			commentCounts.set(comment.fileId, (commentCounts.get(comment.fileId) ?? 0) + 1);
		}

		const files = await Promise.all(
			parsed.entries.map(async (entry): Promise<ChangeFile> => {
				const id = sha256(this.id, "\0", entry.path).slice(0, 24);
				const contentRevision = await this.content.contentRevision(
					entry,
					parsed.head,
					baseEntries.get(basePathForEntry(entry)) ?? "",
				);
				const workingFileStatistics =
					entry.kind === "untracked"
						? this.content.workingFileStatistics(entry, parsed.head)
						: null;
				const review = reviews.get(id);
				return {
					id,
					...entry,
					binary: workingFileStatistics?.binary ?? null,
					additions:
						workingFileStatistics && !workingFileStatistics.binary
							? workingFileStatistics.lines
							: null,
					deletions: workingFileStatistics && !workingFileStatistics.binary ? 0 : null,
					contentRevision,
					reviewed: Boolean(review?.reviewed && review.contentRevision === contentRevision),
					commentCount: commentCounts.get(id) ?? 0,
				};
			}),
		);
		await this.populateTrackedLineStatistics(files, parsed.entries, parsed.head);
		this.content.pruneContentRevisions(parsed.entries, parsed.head);
		files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
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
					(file) => `${file.id}:${file.contentRevision}:${file.indexStatus}${file.worktreeStatus}`,
				)
				.join("\0"),
		);
		return {
			repository,
			files,
			operationRevision,
			entries: new Map(
				parsed.entries.map((entry) => [sha256(this.id, "\0", entry.path).slice(0, 24), entry]),
			),
		};
	}

	private async populateTrackedLineStatistics(
		files: ChangeFile[],
		entries: readonly ParsedStatusEntry[],
		head: string | null,
	): Promise<void> {
		const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
		const trackedFiles = files.filter((file) => {
			const entry = entriesByPath.get(file.path);
			return (
				entry?.kind !== "untracked" && !(entry?.indexStatus === "D" && entry.worktreeStatus === "?")
			);
		});
		if (trackedFiles.length === 0) return;

		const previousById = new Map((this.lastSnapshot?.files ?? []).map((file) => [file.id, file]));
		const canReusePrevious =
			this.lastSnapshot?.repository.head === head &&
			trackedFiles.every((file) => {
				const previous = previousById.get(file.id);
				return (
					previous?.contentRevision === file.contentRevision &&
					previous.previousPath === file.previousPath
				);
			});
		if (canReusePrevious) {
			for (const file of trackedFiles) {
				const previous = previousById.get(file.id);
				if (!previous) continue;
				file.binary = previous.binary;
				file.additions = previous.additions;
				file.deletions = previous.deletions;
			}
			return;
		}

		const result = await runGit(this.root, [
			"-c",
			"diff.suppressBlankEmpty=false",
			"diff",
			"--numstat",
			"-z",
			"--no-ext-diff",
			"--no-textconv",
			"--find-renames",
			head ?? this.emptyTree,
			"--",
		]).catch((error) => {
			if (error instanceof GitCommandError) return null;
			throw error;
		});
		if (!result) return;
		const statisticsByPath = new Map(
			parseNumstat(result.stdout).map((statistics) => [statistics.path, statistics]),
		);
		for (const file of trackedFiles) {
			const statistics = statisticsByPath.get(file.path);
			if (!statistics) continue;
			file.binary = statistics.binary;
			file.additions = statistics.additions;
			file.deletions = statistics.deletions;
		}
	}
}
