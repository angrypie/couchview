import { randomUUID } from "node:crypto";

import type { CreateCommentRequest, ReviewComment, ReviewRecord } from "../shared/contracts.ts";
import { StateDatabase, type StoredReviewState } from "./database.ts";
import { HttpError } from "./errors.ts";

export class ReviewStore {
	constructor(
		private readonly database: StateDatabase,
		readonly repositoryId: string,
	) {}

	async snapshot(): Promise<StoredReviewState> {
		return structuredClone(this.database.reviewState(this.repositoryId));
	}

	async setReview(record: ReviewRecord): Promise<ReviewRecord> {
		return this.database.setReview(this.repositoryId, record);
	}

	async createComment(input: CreateCommentRequest, pathName: string): Promise<ReviewComment> {
		const now = new Date().toISOString();
		return this.database.insertComment(this.repositoryId, {
			id: randomUUID(),
			fileId: input.fileId,
			path: pathName,
			side: input.side,
			startLine: input.startLine,
			endLine: input.endLine,
			...(input.oldStartLine === undefined ? {} : { oldStartLine: input.oldStartLine }),
			...(input.oldEndLine === undefined ? {} : { oldEndLine: input.oldEndLine }),
			...(input.newStartLine === undefined ? {} : { newStartLine: input.newStartLine }),
			...(input.newEndLine === undefined ? {} : { newEndLine: input.newEndLine }),
			hunkHeader: input.hunkHeader,
			excerpt: input.excerpt,
			body: input.body,
			contentRevision: input.contentRevision,
			stale: false,
			createdAt: now,
			updatedAt: now,
		});
	}

	async updateComment(id: string, body: string): Promise<ReviewComment> {
		const comment = this.database.updateComment(
			this.repositoryId,
			id,
			body,
			new Date().toISOString(),
		);
		if (!comment) {
			throw new HttpError(404, "comment_not_found", "Comment not found");
		}
		return comment;
	}

	async deleteComment(id: string): Promise<void> {
		if (!this.database.deleteComment(this.repositoryId, id)) {
			throw new HttpError(404, "comment_not_found", "Comment not found");
		}
	}
}
