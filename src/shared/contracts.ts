const repositoryApiPath = (repositoryId: string) =>
  `/api/repositories/${encodeURIComponent(repositoryId)}`;
const repositoryFilesApiPath = (repositoryId: string) =>
  `${repositoryApiPath(repositoryId)}/files`;

export const API_ROUTES = {
  bootstrap: "/api/bootstrap",
  instance: "/api/instance",
  repositories: "/api/repositories",
  controlRepositories: "/api/control/repositories",
  repository: repositoryApiPath,
  files: repositoryFilesApiPath,
  fileDiff: (repositoryId: string, fileId: string) =>
    `${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/diff`,
  fileStage: (repositoryId: string, fileId: string) =>
    `${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/stage`,
  fileReview: (repositoryId: string, fileId: string) =>
    `${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/review`,
  fileComments: (repositoryId: string, fileId: string) =>
    `${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/comments`,
  search: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/search`,
  source: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/source`,
  commit: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/commit`,
  comments: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/comments`,
  comment: (repositoryId: string, commentId: string) =>
    `${repositoryApiPath(repositoryId)}/comments/${encodeURIComponent(commentId)}`,
  packageScripts: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/package-scripts`,
  packageRuns: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/package-runs`,
  packageRun: (repositoryId: string, runId: string) =>
    `${repositoryApiPath(repositoryId)}/package-runs/${encodeURIComponent(runId)}`,
  packageRunStop: (repositoryId: string, runId: string) =>
    `${repositoryApiPath(repositoryId)}/package-runs/${encodeURIComponent(runId)}/stop`,
  packageRunEvents: (repositoryId: string, runId: string) =>
    `${repositoryApiPath(repositoryId)}/package-runs/${encodeURIComponent(runId)}/events`,
  events: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/events`,
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

export interface RepositoryCatalogEntry {
  id: string;
  name: string;
  root: string;
  available: boolean;
  addedAt: string;
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
  csrfToken: string;
  repositories: RepositoryCatalogEntry[];
  defaultRepositoryId: string | null;
  catalogRevision: number;
}

export interface InstanceResponse {
  service: "couch-review";
  protocolVersion: number;
  version: string;
  instanceId: string;
  bindHost: string;
  port: number;
  accessOrigins: string[];
}

export interface RegisterRepositoryRequest {
  root: string;
}

export interface RegisterRepositoryResponse {
  repository: RepositoryCatalogEntry;
  added: boolean;
}

export interface RepositoryCatalogResponse {
  repositories: RepositoryCatalogEntry[];
  catalogRevision: number;
}

export interface ForgetRepositoryResponse {
  deletedId: string;
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
  /**
   * A full-context patch used only for rendering complete modified files.
   * The compact hunks remain the source of truth for navigation and comments.
   * Null means the complete file exceeded the diff response limits.
   */
  fullFilePatch?: string | null;
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
  staged?: boolean;
}

export interface ChangeFileDelta {
  upserted: ChangeFile[];
  removedFileIds: string[];
  orderedFileIds: string[];
}

export interface StageFileResponse {
  file: ChangeFile | null;
  changes: ChangeFileDelta;
  operationRevision: string;
}

export interface CommitRequest {
  message: string;
  operationRevision: string;
}

export interface CommitResponse {
  commit: string;
  operationRevision: string;
}

export type PackageRunner = "bun" | "npm" | "pnpm" | "yarn";

export interface PackageScriptDefinition {
  name: string;
  command: string;
}

export interface PackageScriptsPackage {
  packagePath: string;
  directory: string;
  name: string | null;
  manifestRevision: string;
  runner: PackageRunner;
  scripts: PackageScriptDefinition[];
}

export interface PackageScriptWarning {
  packagePath: string;
  message: string;
}

export interface PackageScriptsResponse {
  packages: PackageScriptsPackage[];
  warnings: PackageScriptWarning[];
}

export interface StartPackageRunRequest {
  packagePath: string;
  scriptName: string;
  manifestRevision: string;
}

export type PackageRunStatus =
  | "running"
  | "stopping"
  | "succeeded"
  | "failed"
  | "stopped";

export interface PackageRunSummary {
  id: string;
  repositoryId: string;
  packagePath: string;
  packageName: string | null;
  directory: string;
  scriptName: string;
  command: string;
  runner: PackageRunner;
  invocation: string;
  status: PackageRunStatus;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  outputTruncated: boolean;
}

export interface PackageRunsResponse {
  runs: PackageRunSummary[];
}

export interface PackageRunResponse {
  run: PackageRunSummary;
}

export interface PackageRunOutputChunk {
  sequence: number;
  stream: "stdout" | "stderr";
  text: string;
}

export interface PackageRunSnapshot {
  run: PackageRunSummary;
  output: PackageRunOutputChunk[];
}

export type PackageRunEvent =
  | { type: "snapshot"; snapshot: PackageRunSnapshot }
  | { type: "output"; chunk: PackageRunOutputChunk }
  | { type: "status"; run: PackageRunSummary };

export type ServerEventType = "changes" | "state" | "repositories" | "ready";

export interface ServerEvent {
  type: ServerEventType;
  repositoryId: string;
  operationRevision: string;
  stateRevision: number;
  catalogRevision: number;
  at: string;
}

export interface ApiErrorDiagnostic {
  id: string;
  source: "git";
  operation: string;
  kind: "exit" | "timeout" | "spawn" | "capture" | "output_limit" | "empty_output";
  exitCode: number | null;
  stderr: string;
  retryable: boolean;
  timeoutMs: number | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    diagnostic?: ApiErrorDiagnostic;
  };
}
