const repositoryApiPath = (repositoryId: string) =>
  `/api/repositories/${encodeURIComponent(repositoryId)}`;
const repositoryFilesApiPath = (repositoryId: string) =>
  `${repositoryApiPath(repositoryId)}/files`;

export const API_ROUTES = {
  bootstrap: "/api/bootstrap",
  instance: "/api/instance",
  restart: "/api/restart",
  repositories: "/api/repositories",
  controlRepositories: "/api/control/repositories",
  repository: repositoryApiPath,
  files: repositoryFilesApiPath,
  fileDiff: (repositoryId: string, fileId: string) =>
    `${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/diff`,
  fileStage: (repositoryId: string, fileId: string) =>
    `${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/stage`,
  fileStages: (repositoryId: string) =>
    `${repositoryFilesApiPath(repositoryId)}/stage`,
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
  commitMessage: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/commit-message`,
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
  terminal: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/terminal`,
  terminalAttachments: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/terminal/attachments`,
  terminalOpen: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/terminal/open`,
  terminalEnd: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/terminal/end`,
  terminalSocket: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/terminal/socket`,
  codexThreads: (repositoryId: string) =>
    `${repositoryApiPath(repositoryId)}/codex/threads`,
  codexThread: (repositoryId: string, threadId: string) =>
    `${repositoryApiPath(repositoryId)}/codex/threads/${encodeURIComponent(threadId)}`,
  codexThreadTurns: (repositoryId: string, threadId: string) =>
    `${repositoryApiPath(repositoryId)}/codex/threads/${encodeURIComponent(threadId)}/turns`,
  codexThreadTurn: (repositoryId: string, threadId: string, turnId: string) =>
    `${repositoryApiPath(repositoryId)}/codex/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}`,
  codexThreadTurnInterrupt: (repositoryId: string, threadId: string, turnId: string) =>
    `${repositoryApiPath(repositoryId)}/codex/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
  codexThreadEvents: (repositoryId: string, threadId: string) =>
    `${repositoryApiPath(repositoryId)}/codex/threads/${encodeURIComponent(threadId)}/events`,
  codexApproval: (repositoryId: string, threadId: string, approvalId: string) =>
    `${repositoryApiPath(repositoryId)}/codex/threads/${encodeURIComponent(threadId)}/approvals/${encodeURIComponent(approvalId)}`,
} as const;

export const CSRF_HEADER = "x-couchview-csrf";
export const TERMINAL_ENDED_CLOSE_CODE = 4002;

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
  restart: RestartCapability;
  commitMessage: CommitMessageCapability;
  codex: CodexCapability;
  terminal: TerminalCapability;
}

export interface InstanceResponse {
  service: "couchview";
  protocolVersion: number;
  version: string;
  instanceId: string;
  bindHost: string;
  port: number;
  accessOrigins: string[];
  terminalEnabled: boolean;
}

export interface RestartCapability {
  available: boolean;
  reason: string | null;
}

export interface RestartResponse {
  status: "restarting";
  previousInstanceId: string;
}

export interface CommitMessageCapability {
  available: boolean;
  reason: string | null;
}

export interface CodexCapability {
  available: boolean;
  reason: string | null;
}

export interface TerminalProfileSummary {
  id: string;
  label: string;
  available: boolean;
  reason: string | null;
}

export interface TerminalCapability {
  available: boolean;
  reason: string | null;
  persistence: "tmux";
  profiles: TerminalProfileSummary[];
}

export interface TerminalSessionStatus {
  profileId: "nvim";
  running: boolean;
  controllerConnected: boolean;
}

export interface TerminalFileTarget {
  fileId: string;
  contentRevision: string;
  line: number;
}

export interface TerminalAttachmentRequest {
  clientId: string;
  profileId: "nvim";
  cols: number;
  rows: number;
  takeover: boolean;
  target?: TerminalFileTarget;
}

export interface TerminalAttachmentResponse {
  ticket: string;
  expiresAt: string;
  protocol: "couchview-terminal-v1";
  session: TerminalSessionStatus;
}

export interface TerminalOpenRequest {
  target: TerminalFileTarget;
}

export interface TerminalOpenResponse {
  status: "opened";
}

export interface TerminalEndRequest {
  force: boolean;
}

export interface TerminalEndResponse {
  status: "ended";
}

export type CodexThreadStatus =
  | "notLoaded"
  | "idle"
  | "active"
  | "systemError";

export interface CodexThreadSummary {
  id: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  recencyAt: string | null;
  modelProvider: string;
  status: CodexThreadStatus;
}

/** Paginated threads available for sending the repository's review comments. */
export interface CodexThreadsResponse {
  threads: CodexThreadSummary[];
  nextCursor: string | null;
}

/** A thread returned after it is created or loaded. */
export interface CodexThreadResponse {
  thread: CodexThreadSummary;
}

/** Identifies the turn started to send the current review comments to Codex. */
export interface CodexTurnResponse {
  threadId: string;
  turnId: string;
  status: "started";
}

export type CodexEventType =
  | "notification"
  | "approval"
  | "completed"
  | "error";

export interface CodexEvent {
  sequence: number;
  type: CodexEventType;
  threadId: string;
  turnId: string | null;
  method?: string;
  data?: unknown;
  approvalId?: string;
  approvalMethod?: string;
}

export type CodexApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } }
  | {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: { action: "allow" | "deny"; host: string };
      };
    };

/** The user's answer to an approval prompt raised while Codex handles comments. */
export interface CodexApprovalRequest {
  decision:
    | CodexApprovalDecision
    | {
        permissions: unknown;
        scope?: "turn" | "session";
        strictAutoReview?: boolean;
      };
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

export interface StageFileTarget {
  fileId: string;
  contentRevision: string;
}

export interface StageFileRequest extends StageFileTarget {
  operationRevision: string;
  staged?: boolean;
}

export interface StageFilesRequest {
  files: StageFileTarget[];
  operationRevision: string;
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

export interface StageFilesResponse {
  files: ChangeFile[];
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

export interface GenerateCommitMessageRequest {
  operationRevision: string;
}

export interface GenerateCommitMessageResponse {
  message: string;
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
