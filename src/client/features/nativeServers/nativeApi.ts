import { fetch as expoFetch } from "expo/fetch";

import {
	API_ROUTES,
	type ApiErrorBody,
	type BootstrapResponse,
	type ChangesResponse,
	type ClaimNativeClientPairingRequest,
	type CommentResponse,
	type CreateCommentRequest,
	type DiffResponse,
	type InstanceResponse,
	NATIVE_CLIENT_TOKEN_HEADER,
	type NativeClientClaimResponse,
	type ReviewStateResponse,
	type SetReviewRequest,
	type SetReviewResponse,
	type StageFileRequest,
	type StageFileResponse,
	type TerminalAttachmentRequest,
	type TerminalAttachmentResponse,
	type TerminalEndResponse,
} from "../../../shared/contracts.ts";

export class NativeApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
	) {
		super(message);
		this.name = "NativeApiError";
	}
}

async function responseError(response: Response): Promise<NativeApiError> {
	try {
		const body = (await response.json()) as ApiErrorBody;
		return new NativeApiError(body.error.message, response.status, body.error.code);
	} catch {
		return new NativeApiError(
			`Request failed (${response.status})`,
			response.status,
			"request_failed",
		);
	}
}

async function readResponse<T>(response: Response): Promise<T> {
	if (!response.ok) throw await responseError(response);
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export async function claimNativePairing(
	baseUrl: string,
	input: ClaimNativeClientPairingRequest,
	signal?: AbortSignal,
): Promise<NativeClientClaimResponse> {
	const response = await expoFetch(`${baseUrl}${API_ROUTES.nativeClientPairingClaim}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
		signal,
	});
	return readResponse(response);
}

export class NativeApiClient {
	constructor(
		readonly baseUrl: string,
		private readonly token: string,
	) {}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const headers = new Headers(init.headers);
		headers.set("accept", "application/json");
		headers.set(NATIVE_CLIENT_TOKEN_HEADER, this.token);
		if (init.body) headers.set("content-type", "application/json");
		let response: Response;
		try {
			response = await expoFetch(`${this.baseUrl}${path}`, { ...init, headers });
		} catch (error) {
			if (init.signal?.aborted) throw error;
			throw new NativeApiError("Could not reach this Couchview server", 0, "disconnected");
		}
		return readResponse(response);
	}

	instance(signal?: AbortSignal): Promise<InstanceResponse> {
		return this.request(API_ROUTES.instance, { signal });
	}

	bootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
		return this.request(API_ROUTES.bootstrap, { signal });
	}

	files(repositoryId: string, signal?: AbortSignal): Promise<ChangesResponse> {
		return this.request(API_ROUTES.files(repositoryId), { signal });
	}

	diff(repositoryId: string, fileId: string, signal?: AbortSignal): Promise<DiffResponse> {
		return this.request(API_ROUTES.fileDiff(repositoryId, fileId), { signal });
	}

	reviewState(repositoryId: string, signal?: AbortSignal): Promise<ReviewStateResponse> {
		return this.request(API_ROUTES.comments(repositoryId), { signal });
	}

	setReview(
		repositoryId: string,
		fileId: string,
		input: SetReviewRequest,
		signal?: AbortSignal,
	): Promise<SetReviewResponse> {
		return this.request(API_ROUTES.fileReview(repositoryId, fileId), {
			method: "POST",
			body: JSON.stringify(input),
			signal,
		});
	}

	stageFile(
		repositoryId: string,
		fileId: string,
		input: StageFileRequest,
		signal?: AbortSignal,
	): Promise<StageFileResponse> {
		return this.request(API_ROUTES.fileStage(repositoryId, fileId), {
			method: "POST",
			body: JSON.stringify(input),
			signal,
		});
	}

	createComment(
		repositoryId: string,
		fileId: string,
		input: CreateCommentRequest,
		signal?: AbortSignal,
	): Promise<CommentResponse> {
		return this.request(API_ROUTES.fileComments(repositoryId, fileId), {
			method: "POST",
			body: JSON.stringify(input),
			signal,
		});
	}

	issueTerminalAttachment(
		repositoryId: string,
		input: TerminalAttachmentRequest,
		signal?: AbortSignal,
	): Promise<TerminalAttachmentResponse> {
		return this.request(API_ROUTES.terminalAttachments(repositoryId), {
			method: "POST",
			body: JSON.stringify(input),
			signal,
		});
	}

	endTerminal(repositoryId: string, signal?: AbortSignal): Promise<TerminalEndResponse> {
		return this.request(API_ROUTES.terminalEnd(repositoryId), { method: "POST", signal });
	}

	async openEventStream(path: string, signal: AbortSignal): Promise<Response> {
		const response = await expoFetch(`${this.baseUrl}${path}`, {
			headers: {
				accept: "text/event-stream",
				[NATIVE_CLIENT_TOKEN_HEADER]: this.token,
			},
			signal,
		});
		if (!response.ok) throw await responseError(response);
		return response;
	}
}
