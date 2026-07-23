import {
  API_ROUTES,
  CSRF_HEADER,
  type ApiErrorBody,
  type ApiErrorDiagnostic,
  type BootstrapResponse,
  type ChangesResponse,
  type CommitRequest,
  type CommitResponse,
  type CommentResponse,
  type CreateCommentRequest,
  type DeleteCommentRequest,
  type DeleteCommentResponse,
  type DiffResponse,
  type ReviewStateResponse,
  type RepositoryCatalogResponse,
  type ForgetRepositoryResponse,
  type PackageRunResponse,
  type PackageRunsResponse,
  type PackageScriptsResponse,
  type SearchResponse,
  type SetReviewRequest,
  type SetReviewResponse,
  type SourcePreviewResponse,
  type StageFileRequest,
  type StageFileResponse,
  type StageFilesRequest,
  type StageFilesResponse,
  type StartPackageRunRequest,
  type UpdateCommentRequest,
} from "../shared/contracts.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly diagnostic?: ApiErrorDiagnostic;

  constructor(
    message: string,
    status: number,
    code = "request_failed",
    diagnostic?: ApiErrorDiagnostic,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.diagnostic = diagnostic;
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
      "Could not reach the local Couchview server.",
      0,
      "disconnected",
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code = "request_failed";
    let diagnostic: ApiErrorDiagnostic | undefined;
    try {
      const body = (await response.json()) as ApiErrorBody;
      message = body.error.message;
      code = body.error.code;
      diagnostic = body.error.diagnostic;
    } catch {
      // Keep the useful HTTP fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status, code, diagnostic);
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

  repositories(signal?: AbortSignal) {
    return request<RepositoryCatalogResponse>(API_ROUTES.repositories, { signal });
  },

  changes(repositoryId: string, signal?: AbortSignal) {
    return request<ChangesResponse>(API_ROUTES.files(repositoryId), { signal });
  },

  diff(repositoryId: string, fileId: string, signal?: AbortSignal) {
    return request<DiffResponse>(
      API_ROUTES.fileDiff(repositoryId, fileId),
      { signal },
    );
  },

  reviews(repositoryId: string, signal?: AbortSignal) {
    return request<ReviewStateResponse>(API_ROUTES.comments(repositoryId), { signal });
  },

  packageScripts(repositoryId: string, signal?: AbortSignal) {
    return request<PackageScriptsResponse>(
      API_ROUTES.packageScripts(repositoryId),
      { signal },
    );
  },

  packageRuns(repositoryId: string, signal?: AbortSignal) {
    return request<PackageRunsResponse>(
      API_ROUTES.packageRuns(repositoryId),
      { signal },
    );
  },

  search(repositoryId: string, query: string, currentPath: string, signal?: AbortSignal) {
    return request<SearchResponse>(
      withQuery(API_ROUTES.search(repositoryId), { q: query, currentPath }),
      { signal },
    );
  },

  source(repositoryId: string, path: string, line: number, signal?: AbortSignal) {
    return request<SourcePreviewResponse>(
      withQuery(API_ROUTES.source(repositoryId), { path, line, context: 20 }),
      { signal },
    );
  },

  setReviewed(
    repositoryId: string,
    body: SetReviewRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<SetReviewResponse>(
      API_ROUTES.fileReview(repositoryId, body.fileId),
      { method: "PUT", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  stage(
    repositoryId: string,
    body: StageFileRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<StageFileResponse>(
      API_ROUTES.fileStage(repositoryId, body.fileId),
      { method: "POST", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  stageFiles(
    repositoryId: string,
    body: StageFilesRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<StageFilesResponse>(
      API_ROUTES.fileStages(repositoryId),
      { method: "POST", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  commit(
    repositoryId: string,
    body: CommitRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<CommitResponse>(
      API_ROUTES.commit(repositoryId),
      { method: "POST", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  startPackageRun(
    repositoryId: string,
    body: StartPackageRunRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<PackageRunResponse>(
      API_ROUTES.packageRuns(repositoryId),
      { method: "POST", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  stopPackageRun(
    repositoryId: string,
    runId: string,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<PackageRunResponse>(
      API_ROUTES.packageRunStop(repositoryId, runId),
      { method: "POST", body: JSON.stringify({}), signal },
      csrfToken,
    );
  },

  createComment(
    repositoryId: string,
    body: CreateCommentRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<CommentResponse>(
      API_ROUTES.fileComments(repositoryId, body.fileId),
      { method: "POST", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  updateComment(
    repositoryId: string,
    body: UpdateCommentRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<CommentResponse>(
      API_ROUTES.comment(repositoryId, body.id),
      { method: "PUT", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  deleteComment(
    repositoryId: string,
    body: DeleteCommentRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ) {
    return request<DeleteCommentResponse>(
      API_ROUTES.comment(repositoryId, body.id),
      { method: "DELETE", body: JSON.stringify(body), signal },
      csrfToken,
    );
  },

  forgetRepository(repositoryId: string, csrfToken: string, signal?: AbortSignal) {
    return request<ForgetRepositoryResponse>(
      API_ROUTES.repository(repositoryId),
      { method: "DELETE", body: JSON.stringify({ repositoryId }), signal },
      csrfToken,
    );
  },
};
