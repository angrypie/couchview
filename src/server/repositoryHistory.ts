import type {
	DiffResponse,
	FileDiff,
	GitCommitChangesResponse,
	GitCommitSummary,
	GitHistoryFile,
	GitHistoryResponse,
	GitHistoryScope,
	GitWorkspaceStatus,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { decodeGitOutput, parseNumstat, parseUnifiedDiff, runGit, sha256 } from "./git.ts";
import type { RepositorySnapshot } from "./repositoryContent.ts";

const HISTORY_PAGE_SIZE = 50;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_ROWS = 20_000;
const COMMIT_FORMAT = "%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%aI%x1f%D%x1e";
const COMMIT_ID = /^[0-9a-f]{40}$/;
const LOCAL_DECORATIONS = [
	"--decorate=short",
	"--decorate-refs=HEAD",
	"--decorate-refs=refs/heads",
	"--decorate-refs=refs/tags",
] as const;

interface HistoryCursor {
	offset: number;
	revision: string;
	scope: GitHistoryScope;
}

function parseCommitRecords(output: Uint8Array): GitCommitSummary[] {
	return decodeGitOutput(output)
		.split("\x1e")
		.flatMap((rawRecord) => {
			const record = rawRecord.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
			if (!record) return [];
			const [id, shortId, parents, subject, authorName, authoredAt, decorations] =
				record.split("\x1f");
			if (!id || !COMMIT_ID.test(id)) return [];
			return [
				{
					id,
					shortId: shortId || id.slice(0, 7),
					parents: parents ? parents.split(" ").filter(Boolean) : [],
					subject: subject ?? "",
					authorName: authorName ?? "",
					authoredAt: authoredAt ?? "",
					decorations: decorations ? decorations.split(", ").filter(Boolean) : [],
				},
			];
		});
}

function changeKind(status: string): GitHistoryFile["kind"] {
	switch (status[0]) {
		case "A":
			return "added";
		case "C":
			return "copied";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "T":
			return "type-changed";
		case "U":
			return "unmerged";
		default:
			return "modified";
	}
}

function parseNameStatus(output: Uint8Array): Array<{
	kind: GitHistoryFile["kind"];
	path: string;
	previousPath: string | null;
}> {
	const records = decodeGitOutput(output).split("\0");
	const files: Array<{
		kind: GitHistoryFile["kind"];
		path: string;
		previousPath: string | null;
	}> = [];
	for (let index = 0; index < records.length; ) {
		const status = records[index++] ?? "";
		if (!status) continue;
		if (status.startsWith("R") || status.startsWith("C")) {
			const previousPath = records[index++] ?? "";
			const path = records[index++] ?? "";
			if (path) files.push({ kind: changeKind(status), path, previousPath: previousPath || null });
			continue;
		}
		const path = records[index++] ?? "";
		if (path) files.push({ kind: changeKind(status), path, previousPath: null });
	}
	return files;
}

function encodeCursor(cursor: HistoryCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string, scope: GitHistoryScope, revision: string): number {
	if (!value || value.length > 1_000) {
		throw new HttpError(400, "invalid_cursor", "History cursor is invalid");
	}
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as HistoryCursor;
		if (
			parsed.scope !== scope ||
			parsed.revision !== revision ||
			!Number.isSafeInteger(parsed.offset) ||
			parsed.offset < 0
		) {
			throw new Error("stale cursor");
		}
		return parsed.offset;
	} catch {
		throw new HttpError(409, "history_changed", "Git history changed; reload the commit list");
	}
}

export class RepositoryHistory {
	constructor(
		private readonly root: string,
		private readonly repositoryId: string,
		private readonly emptyTree: string,
		private readonly getSnapshot: (fresh?: boolean) => Promise<RepositorySnapshot>,
	) {}

	async list(scope: GitHistoryScope, cursor: string | null): Promise<GitHistoryResponse> {
		if (scope !== "current" && scope !== "all") {
			throw new HttpError(400, "invalid_history_scope", "History scope is invalid");
		}
		const snapshot = await this.getSnapshot();
		const historyRevision = await this.readHistoryRevision(snapshot);
		const offset = cursor ? decodeCursor(cursor, scope, historyRevision) : 0;
		const commits = await this.readCommits(scope, offset, snapshot);
		const visible = commits.slice(0, HISTORY_PAGE_SIZE);
		return {
			commits: visible,
			nextCursor:
				commits.length > HISTORY_PAGE_SIZE
					? encodeCursor({ offset: offset + HISTORY_PAGE_SIZE, revision: historyRevision, scope })
					: null,
			historyRevision,
			scope,
			status: await this.status(snapshot),
		};
	}

	async commit(commit: string): Promise<GitCommitChangesResponse> {
		await this.assertCommit(commit);
		return {
			commit: await this.readCommit(commit),
			files: await this.readCommitFiles(commit),
		};
	}

	async diff(commit: string, fileId: string): Promise<DiffResponse> {
		await this.assertCommit(commit);
		const files = await this.readCommitFiles(commit);
		const file = files.find((candidate) => candidate.id === fileId);
		if (!file) throw new HttpError(404, "file_not_found", "Commit file not found");
		const base = await this.firstParent(commit);
		const paths = [file.previousPath, file.path].filter(
			(value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
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
				base,
				commit,
				"--",
				...paths,
			],
			{ maxOutputBytes: MAX_DIFF_BYTES, truncateOutput: true },
		);
		const parsed = parseUnifiedDiff(decodeGitOutput(result.stdout), MAX_DIFF_ROWS);
		const tooLarge = result.stdoutTruncated || parsed.truncated;
		const diff: FileDiff = {
			fileId: file.id,
			path: file.path,
			previousPath: file.previousPath,
			kind: file.kind,
			contentRevision: sha256(commit, "\0", file.previousPath ?? "", "\0", file.path),
			operationRevision: commit,
			binary: file.binary || parsed.binary,
			tooLarge,
			header: [
				...(tooLarge ? ["Diff preview truncated at 2 MiB or 20,000 rendered rows."] : []),
				...parsed.header,
			],
			hunks: parsed.hunks,
			additions: parsed.additions,
			deletions: parsed.deletions,
		};
		return { diff };
	}

	async status(snapshot?: RepositorySnapshot): Promise<GitWorkspaceStatus> {
		const current = snapshot ?? (await this.getSnapshot());
		const [previousBranch, stashCount, canUndoLastCommit] = await Promise.all([
			this.previousBranch(current),
			this.stashCount(),
			this.canUndo(current),
		]);
		return {
			previousBranch,
			stashCount,
			canUndoLastCommit,
			trackedChangeCount: current.files.filter((file) => file.kind !== "untracked").length,
			untrackedChangeCount: current.files.filter((file) => file.kind === "untracked").length,
		};
	}

	async assertCommit(commit: string): Promise<void> {
		if (!COMMIT_ID.test(commit)) {
			throw new HttpError(400, "invalid_commit", "Commit identifier is invalid");
		}
		const result = await runGit(this.root, ["cat-file", "-e", `${commit}^{commit}`], {
			allowExitCodes: [0, 1, 128],
		});
		if (result.exitCode !== 0) throw new HttpError(404, "commit_not_found", "Commit not found");
	}

	async assertCheckoutCommit(commit: string): Promise<void> {
		await this.assertCommit(commit);
		const [fromHead, fromBranches, fromTags] = await Promise.all([
			runGit(this.root, ["merge-base", "--is-ancestor", commit, "HEAD"], {
				allowExitCodes: [0, 1, 128],
			}),
			runGit(this.root, ["branch", "--format=%(refname)", "--contains", commit]),
			runGit(this.root, ["tag", "--format=%(refname)", "--contains", commit]),
		]);
		if (
			fromHead.exitCode !== 0 &&
			!decodeGitOutput(fromBranches.stdout).trim() &&
			!decodeGitOutput(fromTags.stdout).trim()
		) {
			throw new HttpError(
				409,
				"commit_not_in_history",
				"Select a commit from the current local branch or tag history",
			);
		}
	}

	private async readHistoryRevision(snapshot: RepositorySnapshot): Promise<string> {
		const [refs, symbolicHead] = await Promise.all([
			runGit(this.root, ["show-ref", "--heads", "--tags", "-d"], { allowExitCodes: [0, 1] }),
			runGit(this.root, ["symbolic-ref", "-q", "HEAD"], { allowExitCodes: [0, 1] }),
		]);
		return sha256(
			snapshot.repository.head ?? "unborn",
			"\0",
			decodeGitOutput(symbolicHead.stdout),
			"\0",
			refs.stdout,
		);
	}

	private async readCommits(
		scope: GitHistoryScope,
		offset: number,
		snapshot: RepositorySnapshot,
	): Promise<GitCommitSummary[]> {
		if (scope === "current" && snapshot.repository.unborn) return [];
		const targets = scope === "current" ? ["HEAD"] : ["--branches", "--tags"];
		const result = await runGit(this.root, [
			"log",
			`--format=${COMMIT_FORMAT}`,
			...LOCAL_DECORATIONS,
			`--skip=${offset}`,
			`--max-count=${HISTORY_PAGE_SIZE + 1}`,
			...targets,
		]);
		return parseCommitRecords(result.stdout);
	}

	private async readCommit(commit: string): Promise<GitCommitSummary> {
		const result = await runGit(this.root, [
			"show",
			"--no-patch",
			`--format=${COMMIT_FORMAT}`,
			...LOCAL_DECORATIONS,
			commit,
		]);
		const summary = parseCommitRecords(result.stdout)[0];
		if (!summary) throw new HttpError(404, "commit_not_found", "Commit not found");
		return summary;
	}

	private async firstParent(commit: string): Promise<string> {
		const result = await runGit(this.root, ["rev-list", "--parents", "--max-count=1", commit]);
		return decodeGitOutput(result.stdout).trim().split(" ")[1] ?? this.emptyTree;
	}

	private async readCommitFiles(commit: string): Promise<GitHistoryFile[]> {
		const base = await this.firstParent(commit);
		const [names, stats] = await Promise.all([
			runGit(this.root, ["diff", "--name-status", "-z", "--find-renames", base, commit, "--"]),
			runGit(this.root, ["diff", "--numstat", "-z", "--find-renames", base, commit, "--"]),
		]);
		const statistics = parseNumstat(stats.stdout);
		return parseNameStatus(names.stdout).map((file) => {
			const stat = statistics.find(
				(candidate) => candidate.path === file.path && candidate.previousPath === file.previousPath,
			);
			return {
				...file,
				id: sha256(this.repositoryId, "\0", commit, "\0", file.path).slice(0, 24),
				binary: stat?.binary ?? false,
				additions: stat?.additions ?? null,
				deletions: stat?.deletions ?? null,
			};
		});
	}

	private async previousBranch(snapshot: RepositorySnapshot): Promise<string | null> {
		if (snapshot.repository.branch) return null;
		const result = await runGit(this.root, ["rev-parse", "--symbolic-full-name", "@{-1}"], {
			allowExitCodes: [0, 128],
		});
		const ref = decodeGitOutput(result.stdout).trim();
		return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
	}

	private async stashCount(): Promise<number> {
		const result = await runGit(
			this.root,
			["rev-list", "--walk-reflogs", "--count", "refs/stash"],
			{
				allowExitCodes: [0, 128],
			},
		);
		return result.exitCode === 0 ? Number(decodeGitOutput(result.stdout).trim()) || 0 : 0;
	}

	private async canUndo(snapshot: RepositorySnapshot): Promise<boolean> {
		if (!snapshot.repository.branch || !snapshot.repository.head) return false;
		const result = await runGit(this.root, ["rev-parse", "--verify", "HEAD^"], {
			allowExitCodes: [0, 128],
		});
		return result.exitCode === 0;
	}
}
