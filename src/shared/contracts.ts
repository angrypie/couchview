export const API_ROUTES = {
  bootstrap: "/api/bootstrap",
  files: "/api/files",
  fileDiff: (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/diff`,
  fileStage: (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/stage`,
  fileReview: (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/review`,
  fileComments: (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/comments`,
  search: "/api/search",
  source: "/api/source",
  comments: "/api/comments",
  comment: (commentId: string) => `/api/comments/${encodeURIComponent(commentId)}`,
  events: "/api/events",
} as const;

export const CSRF_HEADER = "x-couch-review-csrf";

export type ChangeKind =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "type-changed"
  | "unmerged"
  | "untracked"
  | "unknown";

export type DiffLineKind = "addition" | "context" | "deletion" | "metadata";
export type DiffSide = "new" | "old" | "mixed";

export interface RepositorySummary {
  id: string;
  name: string;
  root: string;
  branch: string | null;
  head: string | null;
  unborn: boolean;
}

export interface ChangeFile {
  id: string;
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  binary: boolean | null;
  additions: number | null;
  deletions: number | null;
  contentRevision: string;
  reviewed: boolean;
  commentCount: number;
}

// FileChange is the public contract name; ChangeFile remains as a compatibility
// alias for the first internal implementation.
export type FileChange = ChangeFile;

export interface BootstrapResponse {
  repository: RepositorySummary;
  csrfToken: string;
  operationRevision: string;
}

export interface ChangesResponse {
  repository: RepositorySummary;
  files: ChangeFile[];
  operationRevision: string;
}

export interface DiffLine {
  id: string;
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  noNewline: boolean;
}

export interface DiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  fileId: string;
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
  contentRevision: string;
  operationRevision: string;
  binary: boolean;
  tooLarge: boolean;
  header: string[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffResponse {
  diff: FileDiff;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchGroups {
  currentFile: SearchMatch[];
  otherFiles: SearchMatch[];
}

export interface SearchResponse extends SearchGroups {
  query: string;
  currentPath: string;
  truncated: boolean;
}

export interface SourceLine {
  line: number;
  text: string;
}

export interface SourcePreviewResponse {
  path: string;
  focusLine: number;
  startLine: number;
  endLine: number;
  lines: SourceLine[];
  truncated: boolean;
}

export interface ReviewRecord {
  fileId: string;
  path: string;
  contentRevision: string;
  reviewed: boolean;
  updatedAt: string;
}

export interface CommentAnchor {
  side: DiffSide;
  startLine: number;
  endLine: number;
  oldStartLine?: number;
  oldEndLine?: number;
  newStartLine?: number;
  newEndLine?: number;
  hunkHeader: string;
  excerpt: string[];
}

export interface ReviewComment extends CommentAnchor {
  id: string;
  fileId: string;
  path: string;
  body: string;
  contentRevision: string;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewStateResponse {
  reviews: ReviewRecord[];
  comments: ReviewComment[];
}

export interface SetReviewRequest {
  fileId: string;
  contentRevision: string;
  reviewed: boolean;
}

export interface SetReviewResponse {
  review: ReviewRecord;
}

export interface CreateCommentRequest extends CommentAnchor {
  fileId: string;
  contentRevision: string;
  body: string;
}

export interface UpdateCommentRequest {
  id: string;
  body: string;
}

export interface DeleteCommentRequest {
  id: string;
}

export interface CommentResponse {
  comment: ReviewComment;
}

export interface DeleteCommentResponse {
  deletedId: string;
}

export interface StageFileRequest {
  fileId: string;
  operationRevision: string;
  contentRevision: string;
}

export interface StageFileResponse {
  file: ChangeFile | null;
  operationRevision: string;
}

export type ServerEventType = "changes" | "comments" | "reviews" | "ready";

export interface ServerEvent {
  type: ServerEventType;
  operationRevision: string;
  at: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
