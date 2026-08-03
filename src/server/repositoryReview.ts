import type {
	CommentResponse,
	CreateCommentRequest,
	DeleteCommentResponse,
	DiffResponse,
	GenerateCommitMessageRequest,
	ReviewStateResponse,
	SetReviewRequest,
	SetReviewResponse,
	SetReviewsRequest,
	SetReviewsResponse,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { decodeGitOutput, runGit } from "./git.ts";
import { RepositoryContent, type RepositorySnapshot as Snapshot } from "./repositoryContent.ts";
import { RepositorySnapshotService } from "./repositorySnapshot.ts";
import { ReviewStore } from "./state.ts";

const MAX_COMMIT_MESSAGE_PATCH_BYTES = 256 * 1024;
const MAX_COMMIT_MESSAGE_FILE_BYTES = 64 * 1024;
const MAX_COMMIT_MESSAGE_HISTORY_BYTES = 16 * 1024;

function assertNonEmptyString(
	value: unknown,
	field: string,
	maximum = 10_000,
): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
		throw new HttpError(400, "invalid_request", `${field} is invalid`);
	}
}

export class RepositoryReview {
	constructor(
		private readonly root: string,
		private readonly store: ReviewStore,
		private readonly content: RepositoryContent,
		private readonly snapshots: RepositorySnapshotService,
		private readonly diff: (fileId: string) => Promise<DiffResponse>,
	) {}

	async commitMessageContext(input: GenerateCommitMessageRequest): Promise<string> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new HttpError(400, "invalid_request", "Commit message request is invalid");
		}
		assertNonEmptyString(input.operationRevision, "operation revision", 200);
		const before = await this.snapshots.getSnapshot(true);
		this.validateCommitMessageSnapshot(before, input.operationRevision);
		const stagedFiles = before.files.filter((file) => file.staged);

		const fileLines: string[] = [];
		let fileBytes = 0;
		let filesTruncated = false;
		for (const file of stagedFiles) {
			const line = JSON.stringify({
				status: file.indexStatus,
				kind: file.kind,
				path: file.path,
				...(file.previousPath ? { previousPath: file.previousPath } : {}),
			});
			const lineBytes = Buffer.byteLength(`${line}\n`);
			if (fileBytes + lineBytes > MAX_COMMIT_MESSAGE_FILE_BYTES) {
				filesTruncated = true;
				break;
			}
			fileLines.push(line);
			fileBytes += lineBytes;
		}
		if (filesTruncated) fileLines.push("[additional staged files omitted]");

		const [patchResult, historyResult] = await Promise.all([
			runGit(
				this.root,
				[
					"diff",
					"--cached",
					"--no-color",
					"--no-ext-diff",
					"--no-textconv",
					"--find-renames",
					"--patch",
					"--",
				],
				{
					maxOutputBytes: MAX_COMMIT_MESSAGE_PATCH_BYTES,
					timeoutMs: 30_000,
					truncateOutput: true,
				},
			),
			before.repository.head
				? runGit(this.root, ["log", "-10", "--format=%s", before.repository.head], {
						maxOutputBytes: MAX_COMMIT_MESSAGE_HISTORY_BYTES,
						truncateOutput: true,
					})
				: Promise.resolve(null),
		]);
		const after = await this.snapshots.getSnapshot(true);
		this.validateCommitMessageSnapshot(after, input.operationRevision);

		const recentSubjects = historyResult
			? decodeGitOutput(historyResult.stdout)
					.split("\n")
					.filter(Boolean)
					.map((subject) => JSON.stringify(subject))
			: [];
		const patch = decodeGitOutput(patchResult.stdout);
		return [
			`Repository: ${JSON.stringify(before.repository.name)}`,
			`Branch: ${JSON.stringify(before.repository.branch ?? "detached")}`,
			"",
			"STAGED FILES:",
			...fileLines,
			"",
			"RECENT COMMIT SUBJECTS:",
			...(recentSubjects.length > 0 ? recentSubjects : ["[no previous commits]"]),
			"",
			`STAGED PATCH${patchResult.stdoutTruncated ? " (truncated)" : ""}:`,
			patch,
		].join("\n");
	}

	async assertCommitMessageRevision(operationRevision: string): Promise<void> {
		assertNonEmptyString(operationRevision, "operation revision", 200);
		this.validateCommitMessageSnapshot(await this.snapshots.getSnapshot(true), operationRevision);
	}

	async reviewState(): Promise<ReviewStateResponse> {
		const [snapshot, state] = await Promise.all([
			this.snapshots.getSnapshot(),
			this.store.snapshot(),
		]);
		const revisions = new Map(snapshot.files.map((file) => [file.id, file.contentRevision]));
		return {
			reviews: state.reviews.map((review) => ({
				...review,
				reviewed: review.reviewed && revisions.get(review.fileId) === review.contentRevision,
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
		const snapshot = await this.snapshots.getSnapshot();
		const file = this.content.requireCurrentContent(snapshot, input.fileId, input.contentRevision);
		const review = await this.store.setReview({
			fileId: file.id,
			path: file.path,
			contentRevision: file.contentRevision,
			reviewed: input.reviewed,
			updatedAt: new Date().toISOString(),
		});
		return { review };
	}

	async setReviews(input: SetReviewsRequest): Promise<SetReviewsResponse> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new HttpError(400, "invalid_request", "Review request is invalid");
		}
		if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 1_000) {
			throw new HttpError(400, "invalid_request", "Review files must be a non-empty array");
		}
		if (typeof input.reviewed !== "boolean") {
			throw new HttpError(400, "invalid_request", "reviewed must be a boolean");
		}

		const snapshot = await this.snapshots.getSnapshot();
		const seen = new Set<string>();
		const updatedAt = new Date().toISOString();
		const records = input.files.map((target) => {
			if (!target || typeof target !== "object" || Array.isArray(target)) {
				throw new HttpError(400, "invalid_request", "Review file is invalid");
			}
			assertNonEmptyString(target.fileId, "file id", 100);
			assertNonEmptyString(target.contentRevision, "content revision", 200);
			if (seen.has(target.fileId)) {
				throw new HttpError(400, "invalid_request", "Review files must be unique");
			}
			seen.add(target.fileId);
			const file = this.content.requireCurrentContent(
				snapshot,
				target.fileId,
				target.contentRevision,
			);
			return {
				fileId: file.id,
				path: file.path,
				contentRevision: file.contentRevision,
				reviewed: input.reviewed,
				updatedAt,
			};
		});
		return { reviews: await this.store.setReviews(records) };
	}

	async createComment(input: CreateCommentRequest): Promise<CommentResponse> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw new HttpError(400, "invalid_request", "Comment request is invalid");
		}
		assertNonEmptyString(input.fileId, "file id", 100);
		assertNonEmptyString(input.contentRevision, "content revision", 200);
		assertNonEmptyString(input.hunkHeader, "hunk header", 1_000);
		const snapshot = await this.snapshots.getSnapshot();
		const file = this.content.requireCurrentContent(snapshot, input.fileId, input.contentRevision);
		if (input.side !== "new" && input.side !== "old" && input.side !== "mixed") {
			throw new HttpError(400, "invalid_comment", "Comment side is invalid");
		}
		if (
			!Number.isSafeInteger(input.startLine) ||
			!Number.isSafeInteger(input.endLine) ||
			input.startLine < 1 ||
			input.endLine < input.startLine
		) {
			throw new HttpError(400, "invalid_comment", "Comment line range is invalid");
		}
		const validOptionalRange = (start: number | undefined, end: number | undefined) =>
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
			throw new HttpError(400, "invalid_comment", "Comment side ranges are invalid");
		}
		assertNonEmptyString(input.body, "comment body", 20_000);
		const currentDiff = (await this.diff(file.id)).diff;
		if (currentDiff.contentRevision !== file.contentRevision) {
			throw new HttpError(409, "content_changed", "File content changed; refresh the diff first");
		}
		if (currentDiff.binary || currentDiff.hunks.length === 0) {
			throw new HttpError(
				400,
				"comment_not_supported",
				"Line comments require a textual diff hunk",
			);
		}

		const oldStart = input.side === "new" ? undefined : (input.oldStartLine ?? input.startLine);
		const oldEnd = input.side === "new" ? undefined : (input.oldEndLine ?? input.endLine);
		const newStart = input.side === "old" ? undefined : (input.newStartLine ?? input.startLine);
		const newEnd = input.side === "old" ? undefined : (input.newEndLine ?? input.endLine);
		const rangeContains = (
			value: number | null,
			start: number | undefined,
			end: number | undefined,
		) =>
			value !== null && start !== undefined && end !== undefined && value >= start && value <= end;
		const hasBoundary = (
			hunk: (typeof currentDiff.hunks)[number],
			side: "old" | "new",
			boundary: number | undefined,
		) =>
			boundary === undefined ||
			hunk.lines.some((line) => (side === "old" ? line.oldLine : line.newLine) === boundary);

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
			throw new HttpError(400, "invalid_comment_anchor", "Comment line range is invalid");
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
		const snapshot = await this.snapshots.getSnapshot();
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

	private validateCommitMessageSnapshot(snapshot: Snapshot, operationRevision: string): void {
		if (snapshot.operationRevision !== operationRevision) {
			throw new HttpError(
				409,
				"operation_changed",
				"Project changes changed; refresh before generating a commit message",
			);
		}
		if (snapshot.files.some((file) => file.conflicted)) {
			throw new HttpError(
				409,
				"unresolved_conflicts",
				"Resolve Git conflicts before generating a commit message",
			);
		}
		if (!snapshot.files.some((file) => file.staged)) {
			throw new HttpError(409, "nothing_staged", "Nothing is staged to describe");
		}
	}
}
