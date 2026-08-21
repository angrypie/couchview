import type { ReviewRecord } from "../shared/contracts.ts";
import { StateDatabase, type StoredReviewMutation, type StoredReviewState } from "./database.ts";

export class ReviewStore {
	constructor(
		private readonly database: StateDatabase,
		readonly repositoryId: string,
	) {}

	async snapshot(): Promise<StoredReviewState> {
		return structuredClone(this.database.reviewState(this.repositoryId));
	}

	async setReview(
		record: ReviewRecord,
		expectedRevision?: number,
	): Promise<StoredReviewMutation | null> {
		return this.database.setReview(this.repositoryId, record, expectedRevision);
	}

	async setReviews(
		records: ReviewRecord[],
	): Promise<{ reviews: ReviewRecord[]; revision: number }> {
		const reviews: ReviewRecord[] = [];
		let revision = this.database.stateRevision(this.repositoryId) ?? 0;
		for (const record of records) {
			const result = await this.setReview(record);
			if (!result) throw new Error("Review state changed unexpectedly");
			reviews.push(result.review);
			revision = result.revision;
		}
		return { reviews, revision };
	}
}
