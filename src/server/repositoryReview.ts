import type {
	GenerateCommitMessageRequest,
	ReviewStateResponse,
	SetReviewRequest,
	SetReviewResponse,
	SetReviewsRequest,
	SetReviewsResponse,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { decodeGitOutput, runGit } from "./git/index.ts";
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
