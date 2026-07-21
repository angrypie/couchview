import {
  API_ROUTES,
  CSRF_HEADER,
  type ApiErrorBody,
  type BootstrapResponse,
  type ChangesResponse,
  type CommentResponse,
  type CreateCommentRequest,
  type DeleteCommentRequest,
  type DeleteCommentResponse,
  type DiffResponse,
  type ReviewStateResponse,
  type SearchResponse,
  type SetReviewRequest,
  type SetReviewResponse,
  type SourcePreviewResponse,
  type StageFileRequest,
  type StageFileResponse,
  type UpdateCommentRequest,
} from "../shared/contracts.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "request_failed") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  csrfToken?: string,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set(CSRF_HEADER, csrfToken);

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    if (init?.signal?.aborted) {
      throw new DOMException("The request was aborted.", "AbortError");
    }
    throw new ApiError(
      "Could not reach the local Couch Review server.",
      0,
      "disconnected",
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code = "request_failed";
    try {
      const body = (await response.json()) as ApiErrorBody;
      message = body.error.message;
      code = body.error.code;
    } catch {
      // Keep the useful HTTP fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function withQuery(
  path: string,
  values: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export const api = {
  bootstrap(signal?: AbortSignal) {
    return request<BootstrapResponse>(API_ROUTES.bootstrap, { signal });
  },

  changes(signal?: AbortSignal) {
    return request<ChangesResponse>(API_ROUTES.files, { signal });
  },

  diff(fileId: string, signal?: AbortSignal) {
    return request<DiffResponse>(
      API_ROUTES.fileDiff(fileId),
      { signal },
    );
  },

  reviews(signal?: AbortSignal) {
    return request<ReviewStateResponse>(API_ROUTES.comments, { signal });
  },

  search(query: string, currentPath: string, signal?: AbortSignal) {
    return request<SearchResponse>(
      withQuery(API_ROUTES.search, { q: query, currentPath }),
      { signal },
    );
  },

  source(path: string, line: number, signal?: AbortSignal) {
    return request<SourcePreviewResponse>(
      withQuery(API_ROUTES.source, { path, line, context: 20 }),
      { signal },
    );
  },

  setReviewed(body: SetReviewRequest, csrfToken: string) {
    return request<SetReviewResponse>(
      API_ROUTES.fileReview(body.fileId),
      { method: "PUT", body: JSON.stringify(body) },
      csrfToken,
    );
  },

  stage(body: StageFileRequest, csrfToken: string) {
    return request<StageFileResponse>(
      API_ROUTES.fileStage(body.fileId),
      { method: "POST", body: JSON.stringify(body) },
      csrfToken,
    );
  },

  createComment(body: CreateCommentRequest, csrfToken: string) {
    return request<CommentResponse>(
      API_ROUTES.fileComments(body.fileId),
      { method: "POST", body: JSON.stringify(body) },
      csrfToken,
    );
  },

  updateComment(body: UpdateCommentRequest, csrfToken: string) {
    return request<CommentResponse>(
      API_ROUTES.comment(body.id),
      { method: "PUT", body: JSON.stringify(body) },
      csrfToken,
    );
  },

  deleteComment(body: DeleteCommentRequest, csrfToken: string) {
    return request<DeleteCommentResponse>(
      API_ROUTES.comment(body.id),
      { method: "DELETE", body: JSON.stringify(body) },
      csrfToken,
    );
  },
};
