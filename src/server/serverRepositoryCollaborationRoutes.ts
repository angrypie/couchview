import type {
	CodexApprovalRequest,
	CodexEvent,
	CodexThreadResponse,
	CodexThreadsResponse,
	CodexTurnResponse,
	CreateCommentRequest,
	DeleteCommentRequest,
	SetReviewRequest,
	SetReviewsRequest,
	UpdateCommentRequest,
} from "../shared/contracts.ts";
import { codexPrompt } from "./codexAppServer.ts";
import { HttpError } from "./errors.ts";
import type { GitRepository } from "./repository.ts";
import { decodeSegment, json, readJsonObject } from "./serverHttp.ts";
import type { RepositoryRouteContext } from "./serverRouteContext.ts";

const encoder = new TextEncoder();

export async function handleRepositoryCollaborationRoutes(
	context: RepositoryRouteContext,
	request: Request,
	url: URL,
	repositoryId: string,
	nestedPath: string,
	repository: GitRepository,
): Promise<Response | null> {
	const { codex, events } = context;
	const fileRoute = /^files\/([^/]+)\/(diff|stage|review|comments)$/.exec(nestedPath);
	const commentRoute = /^comments\/([^/]+)$/.exec(nestedPath);
	const codexThreadRoute =
		/^codex\/threads\/([^/]+)(?:\/(turns|events|approvals)(?:\/([^/]+))?(?:\/(interrupt))?)?$/.exec(
			nestedPath,
		);

	if (nestedPath === "comments" && request.method === "GET") {
		return json(await repository.reviewState());
	}
	if (nestedPath === "files/review" && request.method === "PUT") {
		const input = await readJsonObject<SetReviewsRequest>(request);
		const result = await repository.setReviews(input);
		await events.emitRepository(repositoryId, "state");
		return json(result);
	}

	if (nestedPath === "codex/threads" && request.method === "GET") {
		const limitValue = Number(url.searchParams.get("limit") ?? 40);
		const limit =
			Number.isSafeInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 40;
		const result = await codex.listThreads(repository.root, url.searchParams.get("cursor"), limit);
		const response: CodexThreadsResponse = {
			threads: result.threads.map(({ cwd: _cwd, ...thread }) => thread),
			nextCursor: result.nextCursor,
		};
		return json(response);
	}
	if (nestedPath === "codex/threads" && request.method === "POST") {
		const thread = await codex.startThread(repository.root);
		const { cwd: _cwd, ...summary } = thread;
		const response: CodexThreadResponse = { thread: summary };
		return json(response, { status: 201 });
	}
	if (codexThreadRoute) {
		const threadId = decodeSegment(codexThreadRoute[1] ?? "");
		const resource = codexThreadRoute[2] ?? "";
		const resourceId = codexThreadRoute[3] ? decodeSegment(codexThreadRoute[3]) : null;
		const action = codexThreadRoute[4] ?? "";
		if (!resource && request.method === "GET") {
			const thread = await codex.readThread(threadId);
			if (thread.cwd !== repository.root) {
				throw new HttpError(
					404,
					"codex_thread_not_found",
					"Codex thread is not part of this repository",
				);
			}
			const { cwd: _cwd, ...summary } = thread;
			return json({ thread: summary } satisfies CodexThreadResponse);
		}
		if (resource === "turns" && action === "interrupt" && request.method === "POST") {
			if (!resourceId) throw new HttpError(400, "codex_turn_required", "Codex turn ID is required");
			const thread = await codex.readThread(threadId);
			if (thread.cwd !== repository.root) {
				throw new HttpError(
					404,
					"codex_thread_not_found",
					"Codex thread is not part of this repository",
				);
			}
			await codex.interruptTurn(threadId, resourceId);
			return json({ status: "interrupting" });
		}
		if (resource === "turns" && !resourceId && request.method === "POST") {
			const thread = await codex.readThread(threadId);
			if (thread.cwd !== repository.root) {
				throw new HttpError(
					404,
					"codex_thread_not_found",
					"Codex thread is not part of this repository",
				);
			}
			if (thread.status === "active") {
				throw new HttpError(
					409,
					"codex_thread_in_use",
					"This Codex thread is currently active in another client",
				);
			}
			const reviewState = await repository.reviewState();
			const currentComments = reviewState.comments.filter((comment) => !comment.stale);
			if (currentComments.length === 0) {
				throw new HttpError(
					409,
					"codex_no_comments",
					"There are no current review comments to send",
				);
			}
			if (thread.status === "notLoaded") await codex.resumeThread(threadId);
			const response: CodexTurnResponse = await codex.startTurn(
				threadId,
				codexPrompt(currentComments),
			);
			return json(response, { status: 202 });
		}
		if (resource === "events" && request.method === "GET") {
			const thread = await codex.readThread(threadId);
			if (thread.cwd !== repository.root) {
				throw new HttpError(
					404,
					"codex_thread_not_found",
					"Codex thread is not part of this repository",
				);
			}
			const turnId = resourceId ?? url.searchParams.get("turnId");
			if (!turnId) throw new HttpError(400, "codex_turn_required", "Codex turn ID is required");
			const afterValue = Number(url.searchParams.get("after") ?? 0);
			const after = Number.isSafeInteger(afterValue) && afterValue >= 0 ? afterValue : 0;
			const available = codex.events(threadId, turnId, after);
			if (!available.found) {
				throw new HttpError(404, "codex_turn_not_found", "Codex turn is not available");
			}
			let closed = false;
			let cleanup: () => void = () => undefined;
			let keepAlive: ReturnType<typeof setInterval> | null = null;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const send = (event: CodexEvent): void => {
						if (closed) return;
						try {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
						} catch {
							closed = true;
							cleanup();
							if (keepAlive) clearInterval(keepAlive);
						}
					};
					const subscription = codex.events(threadId, turnId, after, send);
					cleanup = subscription.unsubscribe;
					for (const event of subscription.events) send(event);
					keepAlive = setInterval(() => {
						if (!closed) {
							try {
								controller.enqueue(encoder.encode(": keep-alive\n\n"));
							} catch {
								closed = true;
								cleanup();
								if (keepAlive) clearInterval(keepAlive);
							}
						}
					}, 5_000);
				},
				cancel() {
					closed = true;
					cleanup();
					if (keepAlive) clearInterval(keepAlive);
				},
			});
			request.signal.addEventListener(
				"abort",
				() => {
					closed = true;
					cleanup();
					if (keepAlive) clearInterval(keepAlive);
				},
				{ once: true },
			);
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream; charset=utf-8",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				},
			});
		}
		if (resource === "approvals" && request.method === "POST") {
			if (!resourceId)
				throw new HttpError(400, "codex_approval_required", "Codex approval ID is required");
			const thread = await codex.readThread(threadId);
			if (thread.cwd !== repository.root) {
				throw new HttpError(
					404,
					"codex_thread_not_found",
					"Codex thread is not part of this repository",
				);
			}
			const input = await readJsonObject<CodexApprovalRequest>(request);
			await codex.respondApproval(threadId, resourceId, input.decision);
			return json({ status: "submitted" });
		}
	}
	if (fileRoute?.[2] === "review" && request.method === "PUT") {
		const fileId = decodeSegment(fileRoute[1] ?? "");
		const input = await readJsonObject<SetReviewRequest>(request);
		if (input.fileId !== fileId) {
			throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
		}
		const result = await repository.setReview(input);
		await events.emitRepository(repositoryId, "state");
		return json(result);
	}
	if (fileRoute?.[2] === "comments" && request.method === "POST") {
		const fileId = decodeSegment(fileRoute[1] ?? "");
		const input = await readJsonObject<CreateCommentRequest>(request);
		if (input.fileId !== fileId) {
			throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
		}
		const result = await repository.createComment(input);
		await events.emitRepository(repositoryId, "state");
		return json(result, { status: 201 });
	}
	if (commentRoute && request.method === "PUT") {
		const commentId = decodeSegment(commentRoute[1] ?? "");
		const input = await readJsonObject<UpdateCommentRequest>(request);
		if (input.id !== commentId) {
			throw new HttpError(400, "comment_mismatch", "Request comment does not match the API path");
		}
		const result = await repository.updateComment(input.id, input.body);
		await events.emitRepository(repositoryId, "state");
		return json(result);
	}
	if (commentRoute && request.method === "DELETE") {
		const commentId = decodeSegment(commentRoute[1] ?? "");
		const input = await readJsonObject<DeleteCommentRequest>(request);
		if (input.id !== commentId) {
			throw new HttpError(400, "comment_mismatch", "Request comment does not match the API path");
		}
		const result = await repository.deleteComment(input.id);
		await events.emitRepository(repositoryId, "state");
		return json(result);
	}
	if (nestedPath === "events" && request.method === "GET") {
		return events.open(request, repositoryId, repository);
	}
	return null;
}
