import type { SetReviewRequest, SetReviewsRequest } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import type { GitRepository } from "./repository.ts";
import { decodeSegment, json, readJsonObject } from "./serverHttp.ts";
import type { RepositoryRouteContext } from "./serverRouteContext.ts";

export async function handleRepositoryCollaborationRoutes(
	context: RepositoryRouteContext,
	request: Request,
	_url: URL,
	repositoryId: string,
	nestedPath: string,
	repository: GitRepository,
): Promise<Response | null> {
	const { events } = context;
	const fileReviewRoute = /^files\/([^/]+)\/review$/.exec(nestedPath);

	if (nestedPath === "files/review" && request.method === "GET") {
		return json(await repository.reviewState());
	}
	if (nestedPath === "files/review" && request.method === "PUT") {
		const input = await readJsonObject<SetReviewsRequest>(request);
		const result = await repository.setReviews(input);
		await events.emitRepository(repositoryId, "state");
		return json(result);
	}
	if (fileReviewRoute && request.method === "PUT") {
		const fileId = decodeSegment(fileReviewRoute[1] ?? "");
		const input = await readJsonObject<SetReviewRequest>(request);
		if (input.fileId !== fileId) {
			throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
		}
		const result = await repository.setReview(input);
		await events.emitRepository(repositoryId, "state");
		return json(result);
	}
	if (nestedPath === "events" && request.method === "GET") {
		return events.open(request, repositoryId, repository);
	}
	return null;
}
