import type { ReviewRecord } from "../shared/contracts.ts";
import { StateDatabase, type StoredReviewState } from "./database.ts";

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

	async setReviews(records: ReviewRecord[]): Promise<ReviewRecord[]> {
		return Promise.all(records.map((record) => this.setReview(record)));
	}
}
