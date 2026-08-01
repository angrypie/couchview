import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Copy,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  ListFilter,
  LoaderCircle,
  LogIn,
  Menu,
  MessageSquareText,
  Minus,
  MonitorUp,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Undo2,
  WifiOff,
  WrapText,
  X,
} from "lucide-react";
import {
  API_ROUTES,
  type ApiErrorDiagnostic,
  type BootstrapResponse,
  type ChangeFile,
  type ChangeFileDelta,
  type DiffHunk,
  type DiffLine,
  type DiffSide,
  type FileDiff,
  type PackageRunEvent,
  type PackageRunSnapshot,
  type PackageRunSummary,
  type PackageScriptDefinition,
  type PackageScriptsPackage,
  type PackageScriptsResponse,
  type ReviewComment,
  type RepositoryCatalogEntry,
  type RepositorySummary,
  type SearchMatch,
  type SearchResponse,
  type ServerEvent,
  type SettingsProfile,
  type SettingsProfileData,
  type SourcePreviewResponse,
} from "../shared/contracts.ts";
import {
  createDefaultSettingsProfileData,
  DEFAULT_SETTINGS_PROFILE_ID,
  effectiveKeybindings,
  SETTINGS_PROFILE_SELECTION_KEY,
  type CommandId,
} from "../shared/settings.ts";
import { ApiError, api } from "./api.ts";
import { CodexCommentsPanel } from "./CodexCommentsPanel.tsx";
import {
  exportCommentsForCodex,
  formatCommentReference,
} from "./commentExport.ts";
import { usePwaUpdate } from "./usePwaUpdate.ts";
import { clearPwaStorage } from "./offlineApp.ts";
import {
  DiffViewer,
  type DiffViewerHandle,
} from "./DiffViewer.tsx";
import {
  preloadFileDiffRendering,
  selectedRangeFromEndpoints,
} from "./diffAdapter.ts";
import { TerminalWorkspace } from "./TerminalWorkspace.tsx";
import { ProfileSettingsPage } from "./ProfileSettingsWorkspace.tsx";
import { RemoteBridgeSheet } from "./RemoteBridgeSheet.tsx";
import {
  codeFontStack,
  terminalRendererConfig,
  TYPOGRAPHY_LIMITS,
} from "./typographyPreferences.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import {
  COMMAND_DEFINITIONS,
  type RuntimeCommand,
} from "./commands.ts";
import { formatShortcut, useShortcutEngine } from "./shortcutEngine.ts";

type AppPhase = "loading" | "ready" | "error";
type ReviewFilter = "all" | "unreviewed" | "reviewed";
type StageFilter = "all" | "unstaged" | "staged";
type SearchScope = "current" | "other";
type DrawerView = "files" | "commands";
type BulkStageScope = "all" | "reviewed";
type RestartPhase = "building" | "restarting" | "loading" | null;
type WorkspaceMode = "review" | "terminal" | "settings";

const SETTINGS_PATH = "/settings";

function fallbackSettingsProfile(): SettingsProfile {
  return {
    id: DEFAULT_SETTINGS_PROFILE_ID,
    name: "Default",
    data: createDefaultSettingsProfileData(),
    revision: 1,
    createdAt: "",
    updatedAt: "",
  };
}

function storedSettingsProfileId(): string {
  try {
    return localStorage.getItem(SETTINGS_PROFILE_SELECTION_KEY) ??
      DEFAULT_SETTINGS_PROFILE_ID;
  } catch {
    return DEFAULT_SETTINGS_PROFILE_ID;
  }
}

function isSettingsPath(pathname = window.location.pathname): boolean {
  return pathname.replace(/\/+$/, "") === SETTINGS_PATH;
}

interface HunkRow {
  type: "hunk";
  key: string;
  hunk: DiffHunk;
  hunkIndex: number;
}

interface LineRow {
  type: "line";
  key: string;
  line: DiffLine;
  hunk: DiffHunk;
  hunkIndex: number;
}

type DisplayRow = HunkRow | LineRow;
type SelectableSide = Exclude<DiffSide, "mixed">;

interface LineSelection {
  side: DiffSide;
  hunkId: string;
  anchorIndex: number;
  focusIndex: number;
  anchorSide: SelectableSide;
  focusSide: SelectableSide;
}

interface HunkNavigation {
  previous: number | null;
  next: number | null;
}

interface UndoReview {
  fileId: string;
  contentRevision: string;
  reviewed: boolean;
}

interface ToastState {
  id: number;
  message: string;
  undo?: UndoReview;
  details?: boolean;
}

interface FailureState {
  context: string;
  message: string;
  code: string;
  status: number | null;
  diagnostic?: ApiErrorDiagnostic;
}

interface PendingStageMutation {
  repositoryId: string;
  queuedOperationRevision: string | null;
}

const emptyPackageScripts: PackageScriptsResponse = {
  packages: [],
  warnings: [],
};

const DIFF_CACHE_LIMIT = 8;

function diffCacheKey(
  repositoryId: string,
  fileId: string,
  contentRevision: string,
): string {
  return `${repositoryId}\0${fileId}\0${contentRevision}`;
}

function readCachedDiff(
  cache: Map<string, FileDiff>,
  repositoryId: string,
  file: ChangeFile,
): FileDiff | null {
  const key = diffCacheKey(repositoryId, file.id, file.contentRevision);
  const cached = cache.get(key) ?? null;
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
  }
  return cached;
}

function rememberDiff(
  cache: Map<string, FileDiff>,
  repositoryId: string,
  diff: FileDiff,
): void {
  const key = diffCacheKey(repositoryId, diff.fileId, diff.contentRevision);
  cache.delete(key);
  cache.set(key, diff);
  while (cache.size > DIFF_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The request was aborted.", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("The request was aborted.", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function failureOf(error: unknown, context: string): FailureState {
  if (error instanceof ApiError) {
    return {
      context,
      message: error.message,
      code: error.code,
      status: error.status,
      diagnostic: error.diagnostic,
    };
  }
  return {
    context,
    message: messageOf(error),
    code: "client_error",
    status: null,
  };
}

function formatFailureDiagnostics(failure: FailureState): string {
  const lines = [
    `Context: ${failure.context}`,
    `Message: ${failure.message}`,
    `Code: ${failure.code}`,
    `HTTP status: ${failure.status ?? "n/a"}`,
  ];
  if (failure.diagnostic) {
    lines.push(
      `Diagnostic ID: ${failure.diagnostic.id}`,
      `Git operation: ${failure.diagnostic.operation}`,
      `Failure kind: ${failure.diagnostic.kind}`,
      `Exit code: ${failure.diagnostic.exitCode ?? "n/a"}`,
      `Retryable: ${failure.diagnostic.retryable ? "yes" : "no"}`,
      `Timeout: ${failure.diagnostic.timeoutMs ?? "n/a"} ms`,
    );
    if (failure.diagnostic.stderr) {
      lines.push("", "Git output:", failure.diagnostic.stderr);
    }
  }
  return lines.join("\n");
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function useStoredBoolean(
  key: string,
  fallback: boolean,
  legacyKey?: string,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const current = localStorage.getItem(key);
      const stored = current ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
      if (current === null && stored !== null) localStorage.setItem(key, stored);
      return stored === null ? fallback : stored === "true";
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // The toggle still works when persistent storage is unavailable.
      }
    },
    [key],
  );

  return [value, update];
}

function rowsForDiff(diff: FileDiff | null): DisplayRow[] {
  if (!diff) return [];
  return diff.hunks.flatMap((hunk, hunkIndex): DisplayRow[] => [
    { type: "hunk", key: `hunk:${hunk.id}`, hunk, hunkIndex },
    ...hunk.lines.map(
      (line): LineRow => ({
        type: "line",
        key: `line:${hunk.id}:${line.id}`,
        line,
        hunk,
        hunkIndex,
      }),
    ),
  ]);
}

function sideLine(line: DiffLine, side: SelectableSide): number | null {
  return side === "new" ? line.newLine : line.oldLine;
}

function navigationBeforeFirstHunk(): HunkNavigation {
  return { previous: null, next: 0 };
}

function navigationAtHunk(hunkIndex: number, hunkCount: number): HunkNavigation {
  return {
    previous: hunkIndex > 0 ? hunkIndex - 1 : null,
    next: hunkIndex + 1 < hunkCount ? hunkIndex + 1 : null,
  };
}

function hunkRange(
  hunk: DiffHunk,
  side: SelectableSide,
): { start: number; end: number } {
  const lineNumbers = hunk.lines.flatMap((line) => {
    const lineNumber = sideLine(line, side);
    return lineNumber === null ? [] : [lineNumber];
  });
  if (lineNumbers.length > 0) {
    return {
      start: Math.min(...lineNumbers),
      end: Math.max(...lineNumbers),
    };
  }
  const start = side === "new" ? hunk.newStart : hunk.oldStart;
  const lineCount = side === "new" ? hunk.newLines : hunk.oldLines;
  return { start, end: start + Math.max(1, lineCount) - 1 };
}

function navigationAtVisibleLine(
  hunks: readonly DiffHunk[],
  lineNumber: number,
  side: SelectableSide,
): HunkNavigation {
  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
    const range = hunkRange(hunks[hunkIndex]!, side);
    if (lineNumber < range.start) {
      return {
        previous: hunkIndex > 0 ? hunkIndex - 1 : null,
        next: hunkIndex,
      };
    }
    if (lineNumber <= range.end) {
      return navigationAtHunk(hunkIndex, hunks.length);
    }
  }
  return {
    previous: hunks.length > 0 ? hunks.length - 1 : null,
    next: null,
  };
}

function workingTreeLineAtRow(rows: readonly DisplayRow[], rowIndex: number): number {
  const target = rows[rowIndex];
  if (target?.type !== "line") return 1;
  if (target.line.newLine !== null) return Math.max(1, target.line.newLine);
  for (let distance = 1; distance < rows.length; distance += 1) {
    for (const candidateIndex of [rowIndex + distance, rowIndex - distance]) {
      const candidate = rows[candidateIndex];
      if (
        candidate?.type === "line" &&
        candidate.hunk.id === target.hunk.id &&
        candidate.line.newLine !== null
      ) {
        return Math.max(1, candidate.line.newLine);
      }
    }
  }
  return Math.max(1, target.hunk.newStart);
}

function workingTreeLineForPosition(
  rows: readonly DisplayRow[],
  position: { lineNumber: number; side: SelectableSide } | null,
): number {
  if (!position) return 1;
  const rowIndex = rows.findIndex(
    (row) =>
      row.type === "line" &&
      sideLine(row.line, position.side) === position.lineNumber,
  );
  return rowIndex >= 0 ? workingTreeLineAtRow(rows, rowIndex) : 1;
}

function lineMatchesComment(line: DiffLine, comment: ReviewComment): boolean {
  if (comment.side === "mixed") {
    const oldMatches =
      line.oldLine !== null &&
      comment.oldStartLine !== undefined &&
      comment.oldEndLine !== undefined &&
      line.oldLine >= comment.oldStartLine &&
      line.oldLine <= comment.oldEndLine;
    const newMatches =
      line.newLine !== null &&
      comment.newStartLine !== undefined &&
      comment.newEndLine !== undefined &&
      line.newLine >= comment.newStartLine &&
      line.newLine <= comment.newEndLine;
    return oldMatches || newMatches;
  }
  const lineNumber = sideLine(line, comment.side);
  return (
    lineNumber !== null &&
    lineNumber >= comment.startLine &&
    lineNumber <= comment.endLine
  );
}

function formatSelectionReference(
  path: string,
  selection: {
    side: DiffSide;
    start: number;
    end: number;
    oldStartLine?: number;
    oldEndLine?: number;
    newStartLine?: number;
    newEndLine?: number;
  },
): string {
  const formatRange = (start: number, end: number) =>
    start === end ? `L${start}` : `L${start}-L${end}`;
  if (
    selection.side === "mixed" &&
    selection.oldStartLine !== undefined &&
    selection.oldEndLine !== undefined &&
    selection.newStartLine !== undefined &&
    selection.newEndLine !== undefined
  ) {
    return `${path}:old ${formatRange(selection.oldStartLine, selection.oldEndLine)} / new ${formatRange(selection.newStartLine, selection.newEndLine)}`;
  }
  const side = selection.side === "old" ? " (old)" : "";
  return `${path}:${formatRange(selection.start, selection.end)}${side}`;
}

function changeLabel(file: ChangeFile): string {
  if (file.conflicted) return "conflict";
  return file.kind.replace("type-changed", "type");
}

function stageLabel(
  file: ChangeFile,
): "partial" | "staged" | "unstaged" | "untracked" | null {
  if (file.staged && file.unstaged) return "partial";
  if (file.staged) return "staged";
  if (file.kind === "untracked") return "untracked";
  if (file.unstaged) return "unstaged";
  return null;
}

function applyChangeFileDelta(
  current: readonly ChangeFile[],
  delta: ChangeFileDelta,
): ChangeFile[] {
  const removed = new Set(delta.removedFileIds);
  const upserted = new Map(delta.upserted.map((file) => [file.id, file]));
  const next = current.flatMap((file) => {
    if (removed.has(file.id)) return [];
    return [upserted.get(file.id) ?? file];
  });
  for (const file of delta.upserted) {
    if (!current.some((candidate) => candidate.id === file.id)) next.push(file);
  }
  const nextById = new Map(next.map((file) => [file.id, file]));
  return delta.orderedFileIds.flatMap((fileId) => {
    const file = nextById.get(fileId);
    return file ? [file] : [];
  });
}

function withDiffFileMetadata(
  current: FileDiff,
  file: ChangeFile,
  operationRevision: string,
): FileDiff {
  return {
    ...current,
    path: file.path,
    previousPath: file.previousPath,
    kind: file.kind,
    operationRevision,
  };
}

function packageLabel(packageEntry: PackageScriptsPackage): string {
  return packageEntry.name ?? (
    packageEntry.directory === "." ? "Repository root" : packageEntry.directory
  );
}

function runStatusLabel(status: PackageRunSummary["status"]): string {
  if (status === "succeeded") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "stopped") return "Stopped";
  if (status === "stopping") return "Stopping";
  return "Running";
}

function runElapsed(run: PackageRunSummary, now = Date.now()): string {
  const started = Date.parse(run.startedAt);
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const milliseconds = Math.max(0, finished - started);
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Local HTTP and older browsers may reject Clipboard API access.
    }
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy was blocked. Select and copy the text manually.");
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const start = text.indexOf(query);
  if (start < 0) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="match">{text.slice(start, start + query.length)}</mark>
      {text.slice(start + query.length)}
    </>
  );
}

export function App() {
  const workerPool = useWorkerPool();
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [repositoryLoading, setRepositoryLoading] = useState(false);
  const [files, setFiles] = useState<ChangeFile[]>([]);
  const [operationRevision, setOperationRevision] = useState("");
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loadErrorCode, setLoadErrorCode] = useState("");
  const [appCacheResetBusy, setAppCacheResetBusy] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerView, setDrawerView] = useState<DrawerView>("files");
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const [remoteBridgeOpen, setRemoteBridgeOpen] = useState(false);
  const [forgetRepositoryBusy, setForgetRepositoryBusy] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [settingsProfiles, setSettingsProfiles] = useState<SettingsProfile[]>(() => [
    fallbackSettingsProfile(),
  ]);
  const [activeSettingsProfileId, setActiveSettingsProfileId] =
    useState(storedSettingsProfileId);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [hunkNavigation, setHunkNavigation] = useState<HunkNavigation>(
    navigationBeforeFirstHunk,
  );
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [commentTrayOpen, setCommentTrayOpen] = useState(false);
  const [codexPanelOpen, setCodexPanelOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [editingComment, setEditingComment] = useState<ReviewComment | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [bulkStageBusy, setBulkStageBusy] = useState<BulkStageScope | null>(null);
  const [commitComposerOpen, setCommitComposerOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitMessageBusy, setCommitMessageBusy] = useState(false);
  const [packageScripts, setPackageScripts] =
    useState<PackageScriptsResponse>(emptyPackageScripts);
  const [packageRuns, setPackageRuns] = useState<PackageRunSummary[]>([]);
  const [packageCommandsLoading, setPackageCommandsLoading] = useState(false);
  const [packageRunBusy, setPackageRunBusy] = useState<string | null>(null);
  const [selectedPackageRunId, setSelectedPackageRunId] = useState<string | null>(
    null,
  );
  const [packageRunSnapshot, setPackageRunSnapshot] =
    useState<PackageRunSnapshot | null>(null);
  const [runClock, setRunClock] = useState(() => Date.now());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("current");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewResponse | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [failure, setFailure] = useState<FailureState | null>(null);
  const [failureDetailsOpen, setFailureDetailsOpen] = useState(false);
  const [copyFallbackText, setCopyFallbackText] = useState("");
  const [pendingCommentJump, setPendingCommentJump] = useState<ReviewComment | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [restartPhase, setRestartPhase] = useState<RestartPhase>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() =>
    isSettingsPath() ? "settings" : "review"
  );
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [terminalOpened, setTerminalOpened] = useState(false);

  const openSettingsPage = useCallback(() => {
    const url = new URL(window.location.href);
    if (!isSettingsPath(url.pathname)) {
      url.pathname = SETTINGS_PATH;
      window.history.pushState({ couchviewPage: "settings" }, "", url);
    }
    setWorkspaceMode("settings");
  }, []);

  const closeSettingsPage = useCallback(() => {
    const url = new URL(window.location.href);
    url.pathname = "/";
    window.history.replaceState(null, "", url);
    setWorkspaceMode("review");
  }, []);

  const activeSettingsProfile = useMemo(
    () => settingsProfiles.find((profile) => profile.id === activeSettingsProfileId) ??
      settingsProfiles.find((profile) => profile.id === DEFAULT_SETTINGS_PROFILE_ID) ??
      settingsProfiles[0] ??
      fallbackSettingsProfile(),
    [activeSettingsProfileId, settingsProfiles],
  );
  const typographyPreferences = activeSettingsProfile.data.typography;
  const lineNumbersVisible = activeSettingsProfile.data.display.lineNumbersVisible;
  const lineWrapEnabled = activeSettingsProfile.data.display.lineWrapEnabled;
  const commandBindings = useMemo(
    () => effectiveKeybindings(activeSettingsProfile.data.keyboard),
    [activeSettingsProfile.data.keyboard],
  );
  const fontSize = typographyPreferences.diff.fontSize;
  const terminalConfig = useMemo(
    () => terminalRendererConfig(typographyPreferences.terminal),
    [
      typographyPreferences.terminal.cellHeightAdjustment,
      typographyPreferences.terminal.cellWidthAdjustment,
      typographyPreferences.terminal.fontFamily,
      typographyPreferences.terminal.fontSize,
    ],
  );

  const desktop = useMediaQuery("(min-width: 760px) and (min-height: 600px)");
  const landscape = useMediaQuery("(orientation: landscape) and (max-height: 599px)");
  const compactLandscape = landscape && !desktop;
  const diffViewerRef = useRef<DiffViewerHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toastCounter = useRef(0);
  const currentFileIdRef = useRef<string | null>(null);
  const repositoryIdRef = useRef<string | null>(null);
  const operationRevisionRef = useRef("");
  const repositoryCatalogRef = useRef<RepositoryCatalogEntry[]>([]);
  const settingsProfilesRef = useRef(settingsProfiles);
  settingsProfilesRef.current = settingsProfiles;
  const activeSettingsProfileIdRef = useRef(activeSettingsProfileId);
  activeSettingsProfileIdRef.current = activeSettingsProfileId;
  const settingsMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const repositoryLoadGenerationRef = useRef(0);
  const repositoryRequestRef = useRef<AbortController | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const packageRunEventSourceRef = useRef<EventSource | null>(null);
  const packageOutputRef = useRef<HTMLPreElement>(null);
  const filesRef = useRef<ChangeFile[]>([]);
  const diffRef = useRef<FileDiff | null>(null);
  const diffCacheRef = useRef(new Map<string, FileDiff>());
  const diffPrefetchRef = useRef(new Map<string, Promise<FileDiff | null>>());
  const pendingStageMutationRef = useRef<PendingStageMutation | null>(null);
  const searchRequestRef = useRef<AbortController | null>(null);
  const diffRequestRef = useRef<{ generation: number; controller: AbortController } | null>(
    null,
  );
  const sourceRequestRef = useRef<{ generation: number; controller: AbortController } | null>(
    null,
  );
  const commitMessageRequestRef = useRef<AbortController | null>(null);
  const restartRequestRef = useRef<AbortController | null>(null);
  const visibleLineRef = useRef<{ lineNumber: number; side: SelectableSide } | null>(null);
  const hunkNavigationLockUntilRef = useRef(0);
  const pwaUpdateSafe =
    !(workspaceMode === "settings" && settingsDirty) &&
    !commentComposerOpen &&
    !commitComposerOpen &&
    !commentBusy &&
    !reviewBusy &&
    !stageBusy &&
    bulkStageBusy === null &&
    !commitBusy &&
    !commitMessageBusy &&
    packageRunBusy === null &&
    forgetRepositoryBusy === null &&
    restartPhase === null &&
    !copyFallbackText;
  const pwa = usePwaUpdate({ updateSafe: pwaUpdateSafe });

  filesRef.current = files;

  useEffect(() => {
    diffRef.current = diff;
  }, [diff]);

  const rows = useMemo(() => rowsForDiff(diff), [diff]);

  const activeFile = useMemo(
    () => files.find((file) => file.id === currentFileId) ?? null,
    [currentFileId, files],
  );
  const activeFileIndex = activeFile
    ? files.findIndex((file) => file.id === activeFile.id)
    : -1;

  const filteredFiles = useMemo(() => {
    const normalizedQuery = fileQuery.trim().toLocaleLowerCase();
    return files.filter((file) => {
      if (
        normalizedQuery &&
        !file.path.toLocaleLowerCase().includes(normalizedQuery) &&
        !file.previousPath?.toLocaleLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      if (reviewFilter === "reviewed" && !file.reviewed) return false;
      if (reviewFilter === "unreviewed" && file.reviewed) return false;
      if (stageFilter === "staged" && !file.staged) return false;
      if (stageFilter === "unstaged" && !file.unstaged) return false;
      return true;
    });
  }, [fileQuery, files, reviewFilter, stageFilter]);

  const reviewedCount = files.filter((file) => file.reviewed).length;
  const stagedCount = files.filter((file) => file.staged).length;
  const changeTotals = files.reduce(
    (totals, file) => ({
      additions: totals.additions + (file.additions ?? 0),
      deletions: totals.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
  const commitMessageCapability = bootstrap?.commitMessage ?? {
    available: false,
    reason: "Commit message generation is unavailable from this Couchview server.",
  };
  const codexCapability = bootstrap?.codex ?? {
    available: false,
    reason: "Codex integration is unavailable from this Couchview server.",
  };
  const terminalCapability = bootstrap?.terminal ?? {
    available: false,
    reason: "The browser tmux terminal is unavailable from this Couchview server.",
    persistence: "tmux" as const,
    profiles: [],
  };
  const remoteBridgeCapability = bootstrap?.remoteBridge ?? {
    available: false,
    reason: "Native remote development is unavailable from this Couchview server.",
    p2pEnabled: false,
  };
  const stageableFiles = files.filter((file) => !file.staged || file.unstaged);
  const stageableReviewedFiles = stageableFiles.filter((file) => file.reviewed);
  const commandsAvailable =
    packageScripts.packages.length > 0 ||
    packageScripts.warnings.length > 0 ||
    packageRuns.length > 0;
  const selectedPackageRun =
    packageRunSnapshot?.run ??
    packageRuns.find((run) => run.id === selectedPackageRunId) ??
    null;
  const hunkCount = diff?.hunks.length ?? 0;
  const canNavigatePreviousHunk =
    hunkNavigation.previous !== null && hunkNavigation.previous < hunkCount;
  const canNavigateNextHunk =
    hunkNavigation.next !== null && hunkNavigation.next < hunkCount;
  const selectedRows = useMemo(() => {
    if (!selection) return [];
    const low = Math.min(selection.anchorIndex, selection.focusIndex);
    const high = Math.max(selection.anchorIndex, selection.focusIndex);
    return rows.slice(low, high + 1).flatMap((row) => {
      if (
        row.type !== "line" ||
        row.hunk.id !== selection.hunkId ||
        row.line.kind === "metadata" ||
        (selection.side === "mixed"
          ? row.line.oldLine === null && row.line.newLine === null
          : sideLine(row.line, selection.side) === null)
      ) {
        return [];
      }
      return [row];
    });
  }, [rows, selection]);

  const selectedLineRange = useMemo(() => {
    if (!selection || selectedRows.length === 0) return null;
    const oldLineNumbers =
      selection.side === "new"
        ? []
        : selectedRows.flatMap((row) =>
            row.line.oldLine === null ? [] : [row.line.oldLine],
          );
    const newLineNumbers =
      selection.side === "old"
        ? []
        : selectedRows.flatMap((row) =>
            row.line.newLine === null ? [] : [row.line.newLine],
          );
    const resolvedSide: DiffSide =
      oldLineNumbers.length > 0 && newLineNumbers.length > 0
        ? "mixed"
        : oldLineNumbers.length > 0
          ? "old"
          : "new";
    const primaryLineNumbers =
      newLineNumbers.length > 0 ? newLineNumbers : oldLineNumbers;
    if (primaryLineNumbers.length === 0) return null;
    return {
      side: resolvedSide,
      start: Math.min(...primaryLineNumbers),
      end: Math.max(...primaryLineNumbers),
      ...(oldLineNumbers.length > 0
        ? {
            oldStartLine: Math.min(...oldLineNumbers),
            oldEndLine: Math.max(...oldLineNumbers),
          }
        : {}),
      ...(newLineNumbers.length > 0
        ? {
            newStartLine: Math.min(...newLineNumbers),
            newEndLine: Math.max(...newLineNumbers),
          }
        : {}),
      hunk: selectedRows[0]?.hunk,
      excerpt: selectedRows.slice(0, 200).map((row) =>
        resolvedSide === "mixed"
          ? `${row.line.kind === "addition" ? "+" : row.line.kind === "deletion" ? "-" : " "} ${row.line.text}`
          : row.line.text,
      ),
    };
  }, [selectedRows, selection]);

  const selectedViewerRange = useMemo<SelectedLineRange | null>(() => {
    if (!selection) return null;
    const anchorRow = rows[selection.anchorIndex];
    const focusRow = rows[selection.focusIndex];
    if (anchorRow?.type !== "line" || focusRow?.type !== "line") return null;

    const anchorLine = sideLine(anchorRow.line, selection.anchorSide);
    const focusLine = sideLine(focusRow.line, selection.focusSide);
    if (anchorLine === null || focusLine === null) return null;

    return selectedRangeFromEndpoints(
      {
        lineNumber: anchorLine,
        rowIndex: selection.anchorIndex,
        side: selection.anchorSide,
      },
      {
        lineNumber: focusLine,
        rowIndex: selection.focusIndex,
        side: selection.focusSide,
      },
    );
  }, [rows, selection]);

  const showToast = useCallback((message: string, undo?: UndoReview, details = false) => {
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, message, undo, details });
  }, []);

  const applySettingsProfiles = useCallback((profiles?: SettingsProfile[]) => {
    const next = profiles && profiles.length > 0 ? profiles : [fallbackSettingsProfile()];
    settingsProfilesRef.current = next;
    setSettingsProfiles(next);
    setBootstrap((current) => current ? { ...current, settingsProfiles: next } : current);
    const selectedId = activeSettingsProfileIdRef.current;
    if (!next.some((profile) => profile.id === selectedId)) {
      const fallback = next.find((profile) => profile.id === DEFAULT_SETTINGS_PROFILE_ID) ?? next[0]!;
      activeSettingsProfileIdRef.current = fallback.id;
      setActiveSettingsProfileId(fallback.id);
      try {
        localStorage.setItem(SETTINGS_PROFILE_SELECTION_KEY, fallback.id);
      } catch {
        // The in-memory selection remains usable when local storage is unavailable.
      }
    }
  }, []);

  const replaceSettingsProfile = useCallback((profile: SettingsProfile) => {
    const current = settingsProfilesRef.current;
    const next = current.some((item) => item.id === profile.id)
      ? current.map((item) => item.id === profile.id ? profile : item)
      : [...current, profile];
    applySettingsProfiles(next);
  }, [applySettingsProfiles]);

  const selectSettingsProfile = useCallback((profileId: string) => {
    const selected = settingsProfilesRef.current.find((profile) => profile.id === profileId) ??
      settingsProfilesRef.current.find((profile) => profile.id === DEFAULT_SETTINGS_PROFILE_ID);
    if (!selected) return;
    activeSettingsProfileIdRef.current = selected.id;
    setActiveSettingsProfileId(selected.id);
    try {
      localStorage.setItem(SETTINGS_PROFILE_SELECTION_KEY, selected.id);
    } catch {
      // The selection remains active for this page lifetime.
    }
  }, []);

  const refreshSettingsProfiles = useCallback(async () => {
    const response = await api.settingsProfiles();
    applySettingsProfiles(response.profiles);
    return response.profiles;
  }, [applySettingsProfiles]);

  const saveSettingsProfile = useCallback(async (
    profileId: string,
    name: string,
    data: SettingsProfileData,
    expectedRevision: number,
  ) => {
    if (!bootstrap || settingsBusy) return;
    setSettingsBusy(true);
    try {
      await settingsMutationQueueRef.current.catch(() => undefined);
      const response = await api.updateSettingsProfile(
        profileId,
        { name, data, expectedRevision },
        bootstrap.csrfToken,
      );
      replaceSettingsProfile(response.profile);
      showToast(`Saved ${response.profile.name}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "stale_settings_profile") {
        await refreshSettingsProfiles().catch(() => undefined);
      }
      throw error;
    } finally {
      setSettingsBusy(false);
    }
  }, [
    bootstrap,
    refreshSettingsProfiles,
    replaceSettingsProfile,
    settingsBusy,
    showToast,
  ]);

  const createSettingsProfile = useCallback(async (
    name: string,
    sourceProfileId?: string,
  ) => {
    if (!bootstrap || settingsBusy) return;
    setSettingsBusy(true);
    try {
      const response = await api.createSettingsProfile(
        { name, ...(sourceProfileId ? { sourceProfileId } : {}) },
        bootstrap.csrfToken,
      );
      replaceSettingsProfile(response.profile);
      selectSettingsProfile(response.profile.id);
      showToast(`Created ${response.profile.name}`);
    } catch (error) {
      showToast(messageOf(error));
      throw error;
    } finally {
      setSettingsBusy(false);
    }
  }, [
    bootstrap,
    replaceSettingsProfile,
    selectSettingsProfile,
    settingsBusy,
    showToast,
  ]);

  const deleteSettingsProfile = useCallback(async (profileId: string) => {
    if (!bootstrap || settingsBusy) return;
    setSettingsBusy(true);
    try {
      await api.deleteSettingsProfile(profileId, bootstrap.csrfToken);
      applySettingsProfiles(
        settingsProfilesRef.current.filter((profile) => profile.id !== profileId),
      );
      selectSettingsProfile(DEFAULT_SETTINGS_PROFILE_ID);
      showToast("Deleted settings profile");
    } catch (error) {
      showToast(messageOf(error));
      throw error;
    } finally {
      setSettingsBusy(false);
    }
  }, [
    applySettingsProfiles,
    bootstrap,
    selectSettingsProfile,
    settingsBusy,
    showToast,
  ]);

  const updateActiveProfileData = useCallback((
    update: (current: SettingsProfileData) => SettingsProfileData,
  ) => {
    const profileId = activeSettingsProfileIdRef.current;
    const current = settingsProfilesRef.current.find((profile) => profile.id === profileId);
    if (!current || !bootstrap) return;
    const data = update(structuredClone(current.data));
    const optimistic = { ...current, data };
    replaceSettingsProfile(optimistic);
    settingsMutationQueueRef.current = settingsMutationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const latest = settingsProfilesRef.current.find((profile) => profile.id === profileId);
        if (!latest) return;
        const sentData = structuredClone(latest.data);
        const response = await api.updateSettingsProfile(
          profileId,
          {
            name: latest.name,
            data: sentData,
            expectedRevision: latest.revision,
          },
          bootstrap.csrfToken,
        );
        const after = settingsProfilesRef.current.find((profile) => profile.id === profileId);
        const hasNewerOptimisticData = after &&
          JSON.stringify(after.data) !== JSON.stringify(sentData);
        replaceSettingsProfile(hasNewerOptimisticData
          ? { ...response.profile, data: after.data }
          : response.profile);
      })
      .catch(async (error) => {
        await refreshSettingsProfiles().catch(() => undefined);
        showToast(messageOf(error));
      });
  }, [bootstrap, refreshSettingsProfiles, replaceSettingsProfile, showToast]);

  const setFontSize = useCallback((fontSize: number) => {
    updateActiveProfileData((next) => {
      next.typography.diff.fontSize = fontSize;
      return next;
    });
  }, [updateActiveProfileData]);
  const setLineNumbersVisible = useCallback((visible: boolean) => {
    updateActiveProfileData((next) => {
      next.display.lineNumbersVisible = visible;
      return next;
    });
  }, [updateActiveProfileData]);
  const setLineWrapEnabled = useCallback((enabled: boolean) => {
    updateActiveProfileData((next) => {
      next.display.lineWrapEnabled = enabled;
      return next;
    });
  }, [updateActiveProfileData]);

  useEffect(() => {
    if (workspaceMode !== "settings" || !bootstrap) return;
    let cancelled = false;
    void settingsMutationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!cancelled) await refreshSettingsProfiles();
      })
      .catch((error) => showToast(messageOf(error)));
    return () => {
      cancelled = true;
    };
  }, [bootstrap?.csrfToken, refreshSettingsProfiles, showToast, workspaceMode]);

  const reportFailure = useCallback(
    (error: unknown, context: string, toastMessage = true): FailureState => {
      const next = failureOf(error, context);
      setFailure(next);
      setFailureDetailsOpen(false);
      if (toastMessage) showToast(next.message, undefined, true);
      return next;
    },
    [showToast],
  );

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => setToast(null),
      toast.details ? 12_000 : 5_200,
    );
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const primeDiffRendering = useCallback(
    (nextDiff: FileDiff) => {
      try {
        preloadFileDiffRendering(nextDiff, workerPool);
      } catch {
        // The visible viewer owns rendering errors. Background preloading is
        // best-effort and must never turn a neighboring file into app failure.
      }
    },
    [workerPool],
  );

  const prefetchDiff = useCallback(
    (activeRepositoryId: string, file: ChangeFile): Promise<FileDiff | null> => {
      const cached = readCachedDiff(
        diffCacheRef.current,
        activeRepositoryId,
        file,
      );
      if (cached) {
        primeDiffRendering(cached);
        return Promise.resolve(cached);
      }

      const key = diffCacheKey(
        activeRepositoryId,
        file.id,
        file.contentRevision,
      );
      const existing = diffPrefetchRef.current.get(key);
      if (existing) return existing;

      let pending: Promise<FileDiff | null>;
      pending = api
        .diff(
          activeRepositoryId,
          file.id,
          repositoryRequestRef.current?.signal,
        )
        .then((response) => {
          if (
            repositoryIdRef.current !== activeRepositoryId ||
            response.diff.fileId !== file.id ||
            response.diff.contentRevision !== file.contentRevision
          ) {
            return null;
          }
          rememberDiff(
            diffCacheRef.current,
            activeRepositoryId,
            response.diff,
          );
          primeDiffRendering(response.diff);
          return response.diff;
        })
        .catch(() => null)
        .finally(() => {
          if (diffPrefetchRef.current.get(key) === pending) {
            diffPrefetchRef.current.delete(key);
          }
        });
      diffPrefetchRef.current.set(key, pending);
      return pending;
    },
    [primeDiffRendering],
  );

  const loadDiff = useCallback(
    async (fileId: string, resetPosition = false) => {
      const activeRepositoryId = repositoryIdRef.current;
      if (!activeRepositoryId) return;
      const file = filesRef.current.find((candidate) => candidate.id === fileId);
      if (!file) return;
      diffRequestRef.current?.controller.abort();
      const generation = (diffRequestRef.current?.generation ?? 0) + 1;
      const controller = new AbortController();
      diffRequestRef.current = { generation, controller };
      setDiffError("");
      const cached = readCachedDiff(
        diffCacheRef.current,
        activeRepositoryId,
        file,
      );
      if (cached) {
        if (resetPosition) {
          setSelection(null);
          setHunkNavigation(navigationBeforeFirstHunk());
        }
        primeDiffRendering(cached);
        diffRef.current = cached;
        setDiff(cached);
        setDiffLoading(false);
        return;
      }

      setDiffLoading(true);
      try {
        const key = diffCacheKey(
          activeRepositoryId,
          file.id,
          file.contentRevision,
        );
        const prefetched = await diffPrefetchRef.current.get(key);
        const nextDiff =
          prefetched ??
          (await api.diff(activeRepositoryId, fileId, controller.signal)).diff;
        if (
          diffRequestRef.current?.generation !== generation ||
          repositoryIdRef.current !== activeRepositoryId ||
          currentFileIdRef.current !== fileId ||
          nextDiff.fileId !== fileId
        ) {
          return;
        }
        rememberDiff(diffCacheRef.current, activeRepositoryId, nextDiff);
        primeDiffRendering(nextDiff);
        if (resetPosition) {
          setSelection(null);
          setHunkNavigation(navigationBeforeFirstHunk());
        }
        diffRef.current = nextDiff;
        setDiff(nextDiff);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (diffRequestRef.current?.generation === generation) {
          setDiffError(reportFailure(error, "Load diff", false).message);
        }
      } finally {
        if (diffRequestRef.current?.generation === generation) {
          setDiffLoading(false);
        }
      }
    },
    [primeDiffRendering, reportFailure],
  );

  const refreshChanges = useCallback(async () => {
    const activeRepositoryId = repositoryIdRef.current;
    if (!activeRepositoryId) throw new Error("No repository is selected");
    const response = await api.changes(
      activeRepositoryId,
      repositoryRequestRef.current?.signal,
    );
    if (repositoryIdRef.current !== activeRepositoryId) return response;
    operationRevisionRef.current = response.operationRevision;
    filesRef.current = response.files;
    setFiles(response.files);
    setOperationRevision(response.operationRevision);
    setRepository(response.repository);
    setCurrentFileId((current) => {
      if (current && response.files.some((file) => file.id === current)) return current;
      return (
        response.files.find((file) => !file.reviewed)?.id ?? response.files[0]?.id ?? null
      );
    });
    return response;
  }, []);

  const refreshReviewState = useCallback(async () => {
    const activeRepositoryId = repositoryIdRef.current;
    if (!activeRepositoryId) throw new Error("No repository is selected");
    const response = await api.reviews(
      activeRepositoryId,
      repositoryRequestRef.current?.signal,
    );
    if (repositoryIdRef.current !== activeRepositoryId) return response;
    setComments(response.comments);
    const commentCounts = new Map<string, number>();
    for (const comment of response.comments) {
      commentCounts.set(comment.fileId, (commentCounts.get(comment.fileId) ?? 0) + 1);
    }
    setFiles((current) =>
      current.map((file) => {
        const review = response.reviews.find((item) => item.fileId === file.id);
        return {
          ...file,
          ...(review ? { reviewed: review.reviewed } : {}),
          commentCount: commentCounts.get(file.id) ?? 0,
        };
      }),
    );
    return response;
  }, []);

  const refreshPackageScripts = useCallback(async () => {
    const activeRepositoryId = repositoryIdRef.current;
    if (!activeRepositoryId) throw new Error("No repository is selected");
    const response = await api.packageScripts(
      activeRepositoryId,
      repositoryRequestRef.current?.signal,
    );
    if (repositoryIdRef.current !== activeRepositoryId) return response;
    setPackageScripts(response);
    return response;
  }, []);

  const refreshPackageRuns = useCallback(async () => {
    const activeRepositoryId = repositoryIdRef.current;
    if (!activeRepositoryId) throw new Error("No repository is selected");
    const response = await api.packageRuns(
      activeRepositoryId,
      repositoryRequestRef.current?.signal,
    );
    if (repositoryIdRef.current !== activeRepositoryId) return response;
    setPackageRuns(response.runs);
    return response;
  }, []);

  const refreshRepositories = useCallback(async () => {
    const response = await api.repositories();
    repositoryCatalogRef.current = response.repositories;
    setBootstrap((current) =>
      current
        ? {
            ...current,
            repositories: response.repositories,
            catalogRevision: response.catalogRevision,
          }
        : current,
    );
    return response;
  }, []);

  const loadRepository = useCallback(
    async (nextRepositoryId: string, historyMode: "none" | "push" | "replace") => {
      const generation = repositoryLoadGenerationRef.current + 1;
      const showLoadingState = repositoryIdRef.current === null;
      repositoryLoadGenerationRef.current = generation;
      repositoryRequestRef.current?.abort();
      pendingStageMutationRef.current = null;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      packageRunEventSourceRef.current?.close();
      packageRunEventSourceRef.current = null;
      searchRequestRef.current?.abort();
      commitMessageRequestRef.current?.abort();
      commitMessageRequestRef.current = null;
      const controller = new AbortController();
      repositoryRequestRef.current = controller;
      diffRequestRef.current?.controller.abort();
      sourceRequestRef.current?.controller.abort();
      repositoryIdRef.current = nextRepositoryId;
      currentFileIdRef.current = null;
      setRepositoryId(nextRepositoryId);
      setRepository(null);
      setFiles([]);
      setComments([]);
      operationRevisionRef.current = "";
      setOperationRevision("");
      setCurrentFileId(null);
      diffRef.current = null;
      setDiff(null);
      setDiffError("");
      setDiffLoading(false);
      setSelection(null);
      setHunkNavigation(navigationBeforeFirstHunk());
      setSearchOpen(false);
      setSearchResult(null);
      setSearchQuery("");
      setSourcePreview(null);
      setCommentComposerOpen(false);
      setCommentBody("");
      setEditingComment(null);
      setCommentTrayOpen(false);
      setCodexPanelOpen(false);
      setFocusedCommentId(null);
      setPendingCommentJump(null);
      setCopyFallbackText("");
      setCommitComposerOpen(false);
      setCommitMessage("");
      setCommitMessageBusy(false);
      setPackageScripts(emptyPackageScripts);
      setPackageRuns([]);
      setPackageCommandsLoading(false);
      setPackageRunBusy(null);
      setSelectedPackageRunId(null);
      setPackageRunSnapshot(null);
      setDrawerView("files");
      setReviewBusy(false);
      setStageBusy(false);
      setBulkStageBusy(null);
      setCommitBusy(false);
      setCommentBusy(false);
      setSearchBusy(false);
      setSourceBusy(false);
      setToast(null);
      setFailure(null);
      setFailureDetailsOpen(false);
      setDrawerOpen(false);
      setRepositoryPickerOpen(false);
      setLoadError("");
      setRepositoryLoading(true);
      setPhase(showLoadingState ? "loading" : "ready");
      try {
        const [changes, reviewState] = await Promise.all([
          api.changes(nextRepositoryId, controller.signal),
          api.reviews(nextRepositoryId, controller.signal),
        ]);
        if (
          repositoryLoadGenerationRef.current !== generation ||
          repositoryIdRef.current !== nextRepositoryId
        ) {
          return;
        }
        setRepository(changes.repository);
        filesRef.current = changes.files;
        setFiles(changes.files);
        operationRevisionRef.current = changes.operationRevision;
        setOperationRevision(changes.operationRevision);
        setComments(reviewState.comments);
        const nextFileId =
          changes.files.find((file) => !file.reviewed)?.id ??
          changes.files[0]?.id ??
          null;
        currentFileIdRef.current = nextFileId;
        setCurrentFileId(nextFileId);
        if (historyMode !== "none") {
          const url = new URL(window.location.href);
          if (url.searchParams.get("repo") !== nextRepositoryId) {
            url.searchParams.set("repo", nextRepositoryId);
            window.history[historyMode === "push" ? "pushState" : "replaceState"](
              null,
              "",
              url,
            );
          }
        }
        setConnected(true);
        setPhase("ready");
        setPackageCommandsLoading(true);
        void Promise.all([
          api.packageScripts(nextRepositoryId, controller.signal),
          api.packageRuns(nextRepositoryId, controller.signal),
        ])
          .then(([scripts, runs]) => {
            if (
              repositoryLoadGenerationRef.current !== generation ||
              repositoryIdRef.current !== nextRepositoryId
            ) {
              return;
            }
            setPackageScripts(scripts);
            setPackageRuns(runs.runs);
          })
          .catch((error) => {
            if (
              !(error instanceof DOMException && error.name === "AbortError") &&
              repositoryIdRef.current === nextRepositoryId
            ) {
              showToast(messageOf(error));
            }
          })
          .finally(() => {
            if (repositoryIdRef.current === nextRepositoryId) {
              setPackageCommandsLoading(false);
            }
          });
      } catch (error) {
        if (repositoryLoadGenerationRef.current !== generation) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(messageOf(error));
        setConnected(!(error instanceof ApiError && error.status === 0));
        setPhase("error");
      } finally {
        if (repositoryLoadGenerationRef.current === generation) setRepositoryLoading(false);
      }
    },
    [showToast],
  );

  const clearRepositorySelection = useCallback(() => {
    repositoryLoadGenerationRef.current += 1;
    repositoryRequestRef.current?.abort();
    repositoryRequestRef.current = null;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    packageRunEventSourceRef.current?.close();
    packageRunEventSourceRef.current = null;
    pendingStageMutationRef.current = null;
    searchRequestRef.current?.abort();
    commitMessageRequestRef.current?.abort();
    commitMessageRequestRef.current = null;
    diffRequestRef.current?.controller.abort();
    sourceRequestRef.current?.controller.abort();
    repositoryIdRef.current = null;
    currentFileIdRef.current = null;
    setRepositoryId(null);
    setRepository(null);
    setRepositoryLoading(false);
    setFiles([]);
    setComments([]);
    operationRevisionRef.current = "";
    setOperationRevision("");
    setCurrentFileId(null);
    diffRef.current = null;
    setDiff(null);
    setDiffError("");
    setDiffLoading(false);
    setSelection(null);
    setHunkNavigation(navigationBeforeFirstHunk());
    setSearchOpen(false);
    setSearchResult(null);
    setSearchQuery("");
    setSourcePreview(null);
    setCommentComposerOpen(false);
    setCommentBody("");
    setEditingComment(null);
    setCommentTrayOpen(false);
    setCodexPanelOpen(false);
    setFocusedCommentId(null);
    setPendingCommentJump(null);
    setCommitComposerOpen(false);
    setCommitMessage("");
    setCommitMessageBusy(false);
    setPackageScripts(emptyPackageScripts);
    setPackageRuns([]);
    setPackageCommandsLoading(false);
    setPackageRunBusy(null);
    setSelectedPackageRunId(null);
    setPackageRunSnapshot(null);
    setDrawerView("files");
    setReviewBusy(false);
    setStageBusy(false);
    setBulkStageBusy(null);
    setCommitBusy(false);
    setCommentBusy(false);
    setSearchBusy(false);
    setSourceBusy(false);
    setToast(null);
    setFailure(null);
    setFailureDetailsOpen(false);
    setDrawerOpen(false);
    setCopyFallbackText("");
    setRepositoryPickerOpen(false);
    setLoadError("");
    setLoadErrorCode("");
    const url = new URL(window.location.href);
    url.searchParams.delete("repo");
    window.history.replaceState(null, "", url);
    setPhase("ready");
  }, []);

  const loadApp = useCallback(async () => {
    setPhase("loading");
    setLoadError("");
    setLoadErrorCode("");
    const currentUrl = new URL(window.location.href);
    const accessRefreshAttempted = currentUrl.searchParams.get("access_refresh") === "1";
    const clearAccessRefreshMarker = () => {
      if (!accessRefreshAttempted) return;
      currentUrl.searchParams.delete("access_refresh");
      window.history.replaceState(null, "", currentUrl);
    };
    try {
      const nextBootstrap = await api.bootstrap();
      clearAccessRefreshMarker();
      repositoryCatalogRef.current = nextBootstrap.repositories;
      setBootstrap(nextBootstrap);
      applySettingsProfiles(nextBootstrap.settingsProfiles);
      const requestedId = currentUrl.searchParams.get("repo");
      const selected =
        nextBootstrap.repositories.find(
          (item) => item.id === requestedId && item.available,
        ) ??
        nextBootstrap.repositories.find(
          (item) => item.id === nextBootstrap.defaultRepositoryId && item.available,
        ) ??
        nextBootstrap.repositories.find((item) => item.available);
      if (!selected) {
        clearRepositorySelection();
        setConnected(true);
        return;
      }
      await loadRepository(selected.id, "replace");
    } catch (error) {
      setLoadError(messageOf(error));
      const errorCode = error instanceof ApiError ? error.code : "unknown";
      setLoadErrorCode(
        errorCode === "authentication_required" && accessRefreshAttempted
          ? "authentication_refresh_failed"
          : errorCode,
      );
      clearAccessRefreshMarker();
      setConnected(!(error instanceof ApiError && error.status === 0));
      setPhase("error");
    }
  }, [applySettingsProfiles, clearRepositorySelection, loadRepository]);

  const resetAppCache = useCallback(async () => {
    if (appCacheResetBusy) return;
    setAppCacheResetBusy(true);
    try {
      await clearPwaStorage();
      window.location.reload();
    } catch {
      setLoadError(
        "Couchview could not reset its app cache. Remove its website data in browser settings, then reload.",
      );
      setAppCacheResetBusy(false);
    }
  }, [appCacheResetBusy]);

  useEffect(() => {
    void loadApp();
    return () => {
      repositoryRequestRef.current?.abort();
      diffRequestRef.current?.controller.abort();
      sourceRequestRef.current?.controller.abort();
      eventSourceRef.current?.close();
      packageRunEventSourceRef.current?.close();
      searchRequestRef.current?.abort();
      commitMessageRequestRef.current?.abort();
      restartRequestRef.current?.abort();
    };
  }, [loadApp]);

  useEffect(() => {
    currentFileIdRef.current = currentFileId;
  }, [currentFileId]);

  useEffect(() => {
    repositoryIdRef.current = repositoryId;
    if (!isSettingsPath()) setWorkspaceMode("review");
    setTerminalOpened(false);
  }, [repositoryId]);

  useEffect(() => {
    const onPopState = () => {
      const currentUrl = new URL(window.location.href);
      if (
        workspaceMode === "settings" &&
        settingsDirty &&
        !isSettingsPath(currentUrl.pathname) &&
        !window.confirm("Discard unsaved profile changes?")
      ) {
        currentUrl.pathname = SETTINGS_PATH;
        window.history.pushState({ couchviewPage: "settings" }, "", currentUrl);
        return;
      }
      setWorkspaceMode(isSettingsPath(currentUrl.pathname) ? "settings" : "review");
      const requestedId = currentUrl.searchParams.get("repo");
      const selected = repositoryCatalogRef.current.find(
        (item) => item.id === requestedId && item.available,
      );
      if (selected) {
        if (selected.id !== repositoryIdRef.current) {
          void loadRepository(selected.id, "none");
        }
        return;
      }
      const fallback = repositoryCatalogRef.current.find((item) => item.available);
      if (fallback) void loadRepository(fallback.id, "replace");
      else clearRepositorySelection();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [clearRepositorySelection, loadRepository, settingsDirty, workspaceMode]);

  useEffect(() => {
    if (!settingsDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [settingsDirty]);

  useEffect(() => {
    if (phase !== "ready" || repositoryLoading || !repositoryId) return;
    const stream = new EventSource(API_ROUTES.events(repositoryId));
    eventSourceRef.current = stream;
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (message) => {
      setConnected(true);
      try {
        const event = JSON.parse(message.data) as ServerEvent;
        if (event.repositoryId !== repositoryId) return;
        if (event.type === "changes" || event.type === "ready") {
          void refreshPackageScripts().catch(() => undefined);
          const pendingStage = pendingStageMutationRef.current;
          if (
            event.type === "changes" &&
            pendingStage?.repositoryId === repositoryId
          ) {
            pendingStage.queuedOperationRevision = event.operationRevision;
            return;
          }
          if (event.operationRevision === operationRevisionRef.current) {
            if (event.type === "ready") {
              void refreshReviewState().catch(() => setConnected(false));
            }
            return;
          }
          const fileId = currentFileIdRef.current;
          void refreshChanges()
            .then(async (response) => {
              await refreshReviewState();
              if (!fileId) return;
              const file = response.files.find((candidate) => candidate.id === fileId);
              if (!file) return;
              const currentDiff = diffRef.current;
              if (
                currentDiff?.fileId === fileId &&
                currentDiff.contentRevision === file.contentRevision
              ) {
                const nextDiff = withDiffFileMetadata(
                  currentDiff,
                  file,
                  response.operationRevision,
                );
                diffRef.current = nextDiff;
                setDiff(nextDiff);
                return;
              }
              await loadDiff(fileId, true);
            })
            .catch(() => setConnected(false));
        }
        if (event.type === "state") {
          void refreshReviewState().catch(() => setConnected(false));
        }
        if (event.type === "repositories") {
          void refreshRepositories()
            .then((catalog) => {
              const current = catalog.repositories.find(
                (item) => item.id === repositoryIdRef.current,
              );
              if (current?.available) return;
              const next = catalog.repositories.find((item) => item.available);
              if (next) void loadRepository(next.id, "replace");
              else clearRepositorySelection();
            })
            .catch(() => setConnected(false));
        }
      } catch {
        // Ignore malformed keep-alives while leaving the stream connected.
      }
    };
    return () => {
      stream.close();
      if (eventSourceRef.current === stream) eventSourceRef.current = null;
    };
  }, [
    clearRepositorySelection,
    loadDiff,
    loadRepository,
    phase,
    refreshChanges,
    refreshPackageScripts,
    refreshRepositories,
    refreshReviewState,
    repositoryId,
    repositoryLoading,
  ]);

  useEffect(() => {
    if (
      phase !== "ready" ||
      repositoryLoading ||
      !repositoryId ||
      drawerView !== "commands"
    ) {
      return;
    }
    setPackageCommandsLoading(true);
    void Promise.all([refreshPackageScripts(), refreshPackageRuns()])
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          showToast(messageOf(error));
        }
      })
      .finally(() => setPackageCommandsLoading(false));
    const interval = window.setInterval(() => {
      void refreshPackageRuns().catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [
    drawerView,
    phase,
    refreshPackageRuns,
    refreshPackageScripts,
    repositoryId,
    repositoryLoading,
    showToast,
  ]);

  useEffect(() => {
    packageRunEventSourceRef.current?.close();
    packageRunEventSourceRef.current = null;
    if (!repositoryId || !selectedPackageRunId) {
      setPackageRunSnapshot(null);
      return;
    }
    const stream = new EventSource(
      API_ROUTES.packageRunEvents(repositoryId, selectedPackageRunId),
    );
    packageRunEventSourceRef.current = stream;
    stream.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as PackageRunEvent;
        if (event.type === "snapshot") {
          setPackageRunSnapshot(event.snapshot);
          setPackageRuns((current) => [
            event.snapshot.run,
            ...current.filter((run) => run.id !== event.snapshot.run.id),
          ]);
          return;
        }
        if (event.type === "output") {
          setPackageRunSnapshot((current) => {
            if (!current || current.run.id !== selectedPackageRunId) return current;
            if (
              current.output.some(
                (chunk) => chunk.sequence === event.chunk.sequence,
              )
            ) {
              return current;
            }
            return { ...current, output: [...current.output, event.chunk] };
          });
          return;
        }
        setPackageRunSnapshot((current) =>
          current?.run.id === event.run.id
            ? { ...current, run: event.run }
            : current
        );
        setPackageRuns((current) => [
          event.run,
          ...current.filter((run) => run.id !== event.run.id),
        ]);
      } catch {
        // Ignore malformed run events; EventSource will continue reconnecting.
      }
    };
    return () => {
      stream.close();
      if (packageRunEventSourceRef.current === stream) {
        packageRunEventSourceRef.current = null;
      }
    };
  }, [repositoryId, selectedPackageRunId]);

  useEffect(() => {
    const active =
      selectedPackageRun &&
      ["running", "stopping"].includes(selectedPackageRun.status);
    if (!active) return;
    const interval = window.setInterval(() => setRunClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [selectedPackageRun]);

  useEffect(() => {
    const output = packageOutputRef.current;
    if (!output) return;
    output.scrollTop = output.scrollHeight;
  }, [packageRunSnapshot?.output]);

  useLayoutEffect(() => {
    setSelection(null);
    visibleLineRef.current = null;
    hunkNavigationLockUntilRef.current = 0;
    setHunkNavigation(navigationBeforeFirstHunk());
    setDiffError("");
    if (!currentFileId) {
      diffRequestRef.current?.controller.abort();
      diffRef.current = null;
      setDiff(null);
      setDiffLoading(false);
      return;
    }
    const activeRepositoryId = repositoryIdRef.current;
    const file = filesRef.current.find(
      (candidate) => candidate.id === currentFileId,
    );
    const cached =
      activeRepositoryId && file
        ? readCachedDiff(diffCacheRef.current, activeRepositoryId, file)
        : null;
    if (cached) {
      diffRequestRef.current?.controller.abort();
      primeDiffRendering(cached);
      diffRef.current = cached;
      setDiff(cached);
      setDiffLoading(false);
      return;
    }
    diffRef.current = null;
    setDiff(null);
    void loadDiff(currentFileId);
    return () => {
      if (currentFileIdRef.current !== currentFileId) {
        diffRequestRef.current?.controller.abort();
      }
    };
  }, [currentFileId, loadDiff, primeDiffRendering]);

  useEffect(() => {
    if (!repositoryId || !currentFileId) return;
    const index = files.findIndex((file) => file.id === currentFileId);
    if (index < 0) return;
    const neighbors = [files[index + 1], files[index - 1]].filter(
      (file): file is ChangeFile => Boolean(file),
    );
    if (neighbors.length === 0) return;

    const preload = () => {
      if (repositoryIdRef.current !== repositoryId) return;
      for (const file of neighbors) {
        void prefetchDiff(repositoryId, file);
      }
    };
    const timeout = window.setTimeout(preload, 0);
    return () => window.clearTimeout(timeout);
  }, [currentFileId, files, prefetchDiff, repositoryId]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--code-size", `${fontSize}px`);
    document.documentElement.style.setProperty(
      "--code-font-family",
      codeFontStack(typographyPreferences.diff.fontFamily),
    );
  }, [fontSize, typographyPreferences.diff.fontFamily]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 1 || !activeFile || !repositoryId) {
      setSearchResult(null);
      setSearchBusy(false);
      return;
    }
    setSearchResult(null);
    const query = searchQuery.trim();
    const currentPath = activeFile.path;
    const controller = new AbortController();
    searchRequestRef.current = controller;
    const timeout = window.setTimeout(() => {
      setSearchBusy(true);
      void api
        .search(repositoryId, query, currentPath, controller.signal)
        .then((response) => {
          if (
            !controller.signal.aborted &&
            repositoryIdRef.current === repositoryId &&
            response.query === query &&
            response.currentPath === currentPath
          ) {
            setSearchResult(response);
          }
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            showToast(messageOf(error));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchBusy(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      if (searchRequestRef.current === controller) searchRequestRef.current = null;
    };
  }, [activeFile, repositoryId, searchOpen, searchQuery, showToast]);

  const selectFile = useCallback((fileId: string) => {
    setCurrentFileId(fileId);
    setDrawerOpen(false);
    setCommentTrayOpen(false);
    diffViewerRef.current?.scrollToTop();
  }, []);

  const openRepositoryPicker = useCallback(() => {
    setRepositoryPickerOpen(true);
    void refreshRepositories().catch((error) => showToast(messageOf(error)));
  }, [refreshRepositories, showToast]);

  const rebuildAndRestart = useCallback(async () => {
    if (!bootstrap?.restart.available || restartPhase) return;
    const controller = new AbortController();
    restartRequestRef.current?.abort();
    restartRequestRef.current = controller;
    setRepositoryPickerOpen(false);
    setRestartPhase("building");
    try {
      const response = await api.restart(bootstrap.csrfToken, controller.signal);
      if (controller.signal.aborted) return;
      setRestartPhase("restarting");
      const deadline = Date.now() + 60_000;
      let nextInstance = null;
      while (!controller.signal.aborted && Date.now() < deadline) {
        await waitForDelay(250, controller.signal);
        try {
          const candidate = await api.instance(controller.signal);
          if (candidate.instanceId !== response.previousInstanceId) {
            nextInstance = candidate;
            break;
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          // The listener is expected to disappear briefly during the handoff.
        }
      }
      if (!nextInstance) {
        throw new Error(
          "Couchview did not come back within 60 seconds. Start it from the terminal.",
        );
      }
      setRestartPhase("loading");
      try {
        await clearPwaStorage();
      } catch {
        // A network reload still refreshes non-PWA and restricted browser sessions.
      }
      window.location.reload();
    } catch (error) {
      if (controller.signal.aborted) return;
      setRestartPhase(null);
      showToast(messageOf(error));
    } finally {
      if (restartRequestRef.current === controller) {
        restartRequestRef.current = null;
      }
    }
  }, [bootstrap, restartPhase, showToast]);

  const selectRepository = useCallback(
    (entry: RepositoryCatalogEntry) => {
      if (!entry.available) return;
      if (entry.id === repositoryIdRef.current) {
        setRepositoryPickerOpen(false);
        return;
      }
      void loadRepository(entry.id, "push");
    },
    [loadRepository],
  );

  const forgetSavedRepository = useCallback(
    async (entry: RepositoryCatalogEntry) => {
      if (
        !bootstrap ||
        forgetRepositoryBusy ||
        !window.confirm(
          `Forget ${entry.name}? Its saved reviews and comments will be deleted, and any running tmux session—including running programs and unsaved work—will be terminated.`,
        )
      ) {
        return;
      }
      setForgetRepositoryBusy(entry.id);
      const signal = repositoryRequestRef.current?.signal;
      try {
        await api.forgetRepository(entry.id, bootstrap.csrfToken, signal);
        if (signal?.aborted) return;
        const catalog = await refreshRepositories();
        if (entry.id === repositoryIdRef.current) {
          const next = catalog.repositories.find((item) => item.available);
          if (next) {
            await loadRepository(next.id, "replace");
          } else {
            clearRepositorySelection();
          }
        }
        showToast(`Forgot ${entry.name}`);
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        showToast(messageOf(error));
      } finally {
        setForgetRepositoryBusy((current) => (current === entry.id ? null : current));
      }
    },
    [
      bootstrap,
      clearRepositorySelection,
      forgetRepositoryBusy,
      loadRepository,
      refreshRepositories,
      showToast,
    ],
  );

  const navigateFile = useCallback(
    (direction: -1 | 1) => {
      if (activeFileIndex < 0) return;
      const next = files[activeFileIndex + direction];
      if (next) selectFile(next.id);
    },
    [activeFileIndex, files, selectFile],
  );

  const navigateHunk = useCallback(
    (direction: -1 | 1) => {
      const hunkCount = diff?.hunks.length ?? 0;
      const targetHunk =
        direction === -1 ? hunkNavigation.previous : hunkNavigation.next;
      if (targetHunk === null || targetHunk < 0 || targetHunk >= hunkCount) return;
      // Pierre can report an intermediate visible line while a large, wrapped
      // diff is settling. Keep repeated hunk taps routed from the requested hunk.
      if (hunkCount > 1) hunkNavigationLockUntilRef.current = Date.now() + 250;
      setHunkNavigation(navigationAtHunk(targetHunk, hunkCount));
      diffViewerRef.current?.scrollToHunk(targetHunk);
    },
    [diff, hunkNavigation],
  );

  const openWordSearch = useCallback((word: string) => {
    setSearchQuery(word);
    setSearchScope("current");
    setSourcePreview(null);
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 30);
  }, []);

  const handleGutterClick = useCallback(
    (rowIndex: number, row: LineRow, side: SelectableSide) => {
      if (sideLine(row.line, side) === null || row.line.kind === "metadata") return;
      setSelection((current) => {
        if (!current || current.hunkId !== row.hunk.id) {
          return {
            side,
            hunkId: row.hunk.id,
            anchorIndex: rowIndex,
            focusIndex: rowIndex,
            anchorSide: side,
            focusSide: side,
          };
        }
        const nextSide: DiffSide =
          current.side === "mixed" || current.side !== side ? "mixed" : side;
        return {
          ...current,
          side: nextSide,
          focusIndex: rowIndex,
          focusSide: side,
        };
      });
    },
    [],
  );

  const handleVisibleLineChange = useCallback(
    (lineNumber: number, side: SelectableSide) => {
      visibleLineRef.current = { lineNumber, side };
      if (Date.now() < hunkNavigationLockUntilRef.current) return;
      setHunkNavigation(
        navigationAtVisibleLine(diff?.hunks ?? [], lineNumber, side),
      );
    },
    [diff],
  );

  const openTerminalWorkspace = useCallback(
    () => {
      if (!bootstrap || !repositoryId || !repository) return;
      if (!terminalCapability.available) {
        showToast(terminalCapability.reason ?? "The browser tmux terminal is unavailable.");
        return;
      }
      setTerminalOpened(true);
      setWorkspaceMode("terminal");
    },
    [bootstrap, repository, repositoryId, showToast, terminalCapability],
  );

  const handleViewerLineNumberClick = useCallback(
    (lineNumber: number, side: SelectableSide) => {
      const rowIndex = rows.findIndex(
        (candidate) =>
          candidate.type === "line" &&
          candidate.line.kind !== "metadata" &&
          sideLine(candidate.line, side) === lineNumber,
      );
      const row = rows[rowIndex];
      if (rowIndex >= 0 && row?.type === "line") {
        handleGutterClick(rowIndex, row, side);
      }
    },
    [handleGutterClick, rows],
  );

  const setReviewed = useCallback(
    async (file: ChangeFile, reviewed: boolean, advance: boolean) => {
      if (!bootstrap || !repositoryId || reviewBusy) return;
      const activeRepositoryId = repositoryId;
      const signal = repositoryRequestRef.current?.signal;
      setReviewBusy(true);
      const previous = file.reviewed;
      setFiles((current) =>
        current.map((item) => (item.id === file.id ? { ...item, reviewed } : item)),
      );
      try {
        await api.setReviewed(
          activeRepositoryId,
          { fileId: file.id, contentRevision: file.contentRevision, reviewed },
          bootstrap.csrfToken,
          signal,
        );
        if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
        if (advance && reviewed) {
          const after = files.slice(activeFileIndex + 1);
          const before = files.slice(0, Math.max(0, activeFileIndex));
          const next =
            after.find((item) => item.id !== file.id && !item.reviewed) ??
            before.find((item) => item.id !== file.id && !item.reviewed) ??
            files[activeFileIndex + 1];
          if (next) selectFile(next.id);
        }
        showToast(reviewed ? "Marked reviewed" : "Review mark removed", {
          fileId: file.id,
          contentRevision: file.contentRevision,
          reviewed: previous,
        });
      } catch (error) {
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setFiles((current) =>
          current.map((item) =>
            item.id === file.id ? { ...item, reviewed: previous } : item,
          ),
        );
        showToast(messageOf(error));
      } finally {
        if (repositoryIdRef.current === activeRepositoryId) setReviewBusy(false);
      }
    },
    [activeFileIndex, bootstrap, files, repositoryId, reviewBusy, selectFile, showToast],
  );

  const undoReview = useCallback(
    async (undo: UndoReview) => {
      if (!bootstrap || !repositoryId) return;
      const activeRepositoryId = repositoryId;
      const signal = repositoryRequestRef.current?.signal;
      const file = files.find((item) => item.id === undo.fileId);
      if (!file) return;
      setToast(null);
      setFiles((current) =>
        current.map((item) =>
          item.id === undo.fileId ? { ...item, reviewed: undo.reviewed } : item,
        ),
      );
      try {
        await api.setReviewed(
          activeRepositoryId,
          {
            fileId: undo.fileId,
            contentRevision: undo.contentRevision,
            reviewed: undo.reviewed,
          },
          bootstrap.csrfToken,
          signal,
        );
      } catch (error) {
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        void refreshReviewState();
        showToast(messageOf(error));
      }
    },
    [bootstrap, files, refreshReviewState, repositoryId, showToast],
  );

  const reconcileChangedFile = useCallback(
    async (fileId: string, resetPosition = false) => {
      const response = await refreshChanges();
      const file = response.files.find((candidate) => candidate.id === fileId);
      if (!file || currentFileIdRef.current !== fileId) return;
      const currentDiff = diffRef.current;
      if (
        currentDiff?.fileId === fileId &&
        currentDiff.contentRevision === file.contentRevision
      ) {
        const nextDiff = withDiffFileMetadata(
          currentDiff,
          file,
          response.operationRevision,
        );
        diffRef.current = nextDiff;
        setDiff(nextDiff);
        return;
      }
      await loadDiff(fileId, resetPosition);
    },
    [loadDiff, refreshChanges],
  );

  const toggleStageActiveFile = useCallback(async () => {
    if (
      !activeFile ||
      !bootstrap ||
      !repositoryId ||
      stageBusy ||
      bulkStageBusy
    ) {
      return;
    }
    const activeRepositoryId = repositoryId;
    const signal = repositoryRequestRef.current?.signal;
    const shouldStage = !activeFile.staged || activeFile.unstaged;
    const mutation: PendingStageMutation = {
      repositoryId: activeRepositoryId,
      queuedOperationRevision: null,
    };
    pendingStageMutationRef.current = mutation;
    setStageBusy(true);
    setFiles((current) =>
      current.map((file) =>
        file.id === activeFile.id
          ? { ...file, staged: shouldStage, unstaged: !shouldStage }
          : file,
      ),
    );
    try {
      const response = await api.stage(
        activeRepositoryId,
        {
          fileId: activeFile.id,
          operationRevision,
          contentRevision: activeFile.contentRevision,
          staged: shouldStage,
        },
        bootstrap.csrfToken,
        signal,
      );
      if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
      const queuedOperationRevision = mutation.queuedOperationRevision;
      if (pendingStageMutationRef.current === mutation) {
        pendingStageMutationRef.current = null;
      }
      operationRevisionRef.current = response.operationRevision;
      setOperationRevision(response.operationRevision);
      setFiles((current) => applyChangeFileDelta(current, response.changes));
      if (
        !response.file &&
        response.changes.removedFileIds.includes(activeFile.id)
      ) {
        const remainingFiles = applyChangeFileDelta(files, response.changes);
        const nextFileId =
          remainingFiles[Math.min(activeFileIndex, remainingFiles.length - 1)]?.id ??
          null;
        currentFileIdRef.current = nextFileId;
        setCurrentFileId(nextFileId);
      }
      const currentDiff = diffRef.current;
      if (
        response.file &&
        currentDiff?.fileId === activeFile.id &&
        currentDiff.contentRevision === response.file.contentRevision
      ) {
        const nextDiff = withDiffFileMetadata(
          currentDiff,
          response.file,
          response.operationRevision,
        );
        diffRef.current = nextDiff;
        setDiff(nextDiff);
      } else if (
        response.file &&
        currentFileIdRef.current === activeFile.id
      ) {
        await loadDiff(activeFile.id);
      }
      if (
        queuedOperationRevision &&
        queuedOperationRevision !== response.operationRevision
      ) {
        await reconcileChangedFile(activeFile.id, true);
      }
      showToast(shouldStage ? "File staged" : "File unstaged");
    } catch (error) {
      const queuedOperationRevision = mutation.queuedOperationRevision;
      if (pendingStageMutationRef.current === mutation) {
        pendingStageMutationRef.current = null;
      }
      setFiles((current) =>
        current.map((file) =>
          file.id === activeFile.id
            ? {
                ...file,
                staged: activeFile.staged,
                unstaged: activeFile.unstaged,
              }
            : file,
        ),
      );
      if (
        signal?.aborted ||
        repositoryIdRef.current !== activeRepositoryId ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      reportFailure(error, shouldStage ? "Stage file" : "Unstage file");
      if (
        queuedOperationRevision ||
        (error instanceof ApiError && error.status === 409)
      ) {
        void reconcileChangedFile(activeFile.id, true);
      }
    } finally {
      if (pendingStageMutationRef.current === mutation) {
        pendingStageMutationRef.current = null;
      }
      if (repositoryIdRef.current === activeRepositoryId) setStageBusy(false);
    }
  }, [
    activeFile,
    activeFileIndex,
    bootstrap,
    bulkStageBusy,
    files,
    loadDiff,
    operationRevision,
    reconcileChangedFile,
    reportFailure,
    repositoryId,
    showToast,
    stageBusy,
  ]);

  const stageMultipleFiles = useCallback(
    async (scope: BulkStageScope) => {
      if (
        !bootstrap ||
        !repositoryId ||
        stageBusy ||
        bulkStageBusy
      ) {
        return;
      }
      const targets = files.filter(
        (file) =>
          (!file.staged || file.unstaged) &&
          (scope === "all" || file.reviewed),
      );
      if (targets.length === 0) return;

      const activeRepositoryId = repositoryId;
      const signal = repositoryRequestRef.current?.signal;
      const targetIds = new Set(targets.map((file) => file.id));
      const previousById = new Map(
        targets.map((file) => [
          file.id,
          { staged: file.staged, unstaged: file.unstaged },
        ]),
      );
      const mutation: PendingStageMutation = {
        repositoryId: activeRepositoryId,
        queuedOperationRevision: null,
      };
      pendingStageMutationRef.current = mutation;
      setBulkStageBusy(scope);
      setFiles((current) =>
        current.map((file) =>
          targetIds.has(file.id)
            ? { ...file, staged: true, unstaged: false }
            : file,
        ),
      );

      try {
        const response = await api.stageFiles(
          activeRepositoryId,
          {
            files: targets.map((file) => ({
              fileId: file.id,
              contentRevision: file.contentRevision,
            })),
            operationRevision,
          },
          bootstrap.csrfToken,
          signal,
        );
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId
        ) {
          return;
        }

        const queuedOperationRevision = mutation.queuedOperationRevision;
        if (pendingStageMutationRef.current === mutation) {
          pendingStageMutationRef.current = null;
        }
        operationRevisionRef.current = response.operationRevision;
        setOperationRevision(response.operationRevision);
        setFiles((current) =>
          applyChangeFileDelta(current, response.changes),
        );

        const previousActiveFileId = currentFileIdRef.current;
        if (
          previousActiveFileId &&
          response.changes.removedFileIds.includes(previousActiveFileId)
        ) {
          const remainingFiles = applyChangeFileDelta(files, response.changes);
          const previousIndex = files.findIndex(
            (file) => file.id === previousActiveFileId,
          );
          const nextFileId =
            remainingFiles[
              Math.min(
                Math.max(previousIndex, 0),
                remainingFiles.length - 1,
              )
            ]?.id ?? null;
          currentFileIdRef.current = nextFileId;
          setCurrentFileId(nextFileId);
        } else if (previousActiveFileId) {
          const currentDiff = diffRef.current;
          const updatedActiveFile = response.files.find(
            (file) => file.id === previousActiveFileId,
          );
          if (
            updatedActiveFile &&
            currentDiff?.fileId === previousActiveFileId &&
            currentDiff.contentRevision === updatedActiveFile.contentRevision
          ) {
            const nextDiff = withDiffFileMetadata(
              currentDiff,
              updatedActiveFile,
              response.operationRevision,
            );
            diffRef.current = nextDiff;
            setDiff(nextDiff);
          } else if (
            updatedActiveFile &&
            currentFileIdRef.current === previousActiveFileId
          ) {
            await loadDiff(previousActiveFileId);
          } else if (currentDiff?.fileId === previousActiveFileId) {
            const nextDiff = {
              ...currentDiff,
              operationRevision: response.operationRevision,
            };
            diffRef.current = nextDiff;
            setDiff(nextDiff);
          }
        }

        if (
          queuedOperationRevision &&
          queuedOperationRevision !== response.operationRevision
        ) {
          const fileId = currentFileIdRef.current;
          if (fileId) await reconcileChangedFile(fileId, true);
        }
        const noun = targets.length === 1 ? "file" : "files";
        showToast(
          scope === "reviewed"
            ? `${targets.length} reviewed ${noun} staged`
            : `${targets.length} ${noun} staged`,
        );
      } catch (error) {
        const queuedOperationRevision = mutation.queuedOperationRevision;
        if (pendingStageMutationRef.current === mutation) {
          pendingStageMutationRef.current = null;
        }
        setFiles((current) =>
          current.map((file) => {
            const previous = previousById.get(file.id);
            return previous ? { ...file, ...previous } : file;
          }),
        );
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        reportFailure(
          error,
          scope === "reviewed" ? "Stage reviewed files" : "Stage all files",
        );
        if (
          queuedOperationRevision ||
          (error instanceof ApiError && error.status === 409)
        ) {
          const fileId = currentFileIdRef.current;
          if (fileId) void reconcileChangedFile(fileId, true);
        }
      } finally {
        if (pendingStageMutationRef.current === mutation) {
          pendingStageMutationRef.current = null;
        }
        if (repositoryIdRef.current === activeRepositoryId) {
          setBulkStageBusy(null);
        }
      }
    },
    [
      bootstrap,
      bulkStageBusy,
      files,
      loadDiff,
      operationRevision,
      reconcileChangedFile,
      reportFailure,
      repositoryId,
      showToast,
      stageBusy,
    ],
  );

  const openCommitComposer = useCallback(() => {
    commitMessageRequestRef.current?.abort();
    commitMessageRequestRef.current = null;
    setCommitMessageBusy(false);
    setDrawerOpen(false);
    setCommitMessage("");
    setCommitComposerOpen(true);
  }, []);

  const closeCommitComposer = useCallback(() => {
    commitMessageRequestRef.current?.abort();
    commitMessageRequestRef.current = null;
    setCommitMessageBusy(false);
    setCommitComposerOpen(false);
  }, []);

  const generateCommitMessage = useCallback(async () => {
    if (
      !bootstrap ||
      !repositoryId ||
      !commitMessageCapability.available ||
      commitMessageBusy ||
      stagedCount === 0
    ) {
      return;
    }
    const activeRepositoryId = repositoryId;
    const requestedRevision = operationRevision;
    const controller = new AbortController();
    commitMessageRequestRef.current?.abort();
    commitMessageRequestRef.current = controller;
    setCommitMessageBusy(true);
    try {
      const response = await api.generateCommitMessage(
        activeRepositoryId,
        { operationRevision: requestedRevision },
        bootstrap.csrfToken,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        commitMessageRequestRef.current !== controller ||
        repositoryIdRef.current !== activeRepositoryId ||
        operationRevisionRef.current !== response.operationRevision
      ) {
        return;
      }
      setCommitMessage(response.message);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      reportFailure(error, "Generate commit message");
      if (error instanceof ApiError && error.status === 409) {
        void refreshChanges();
      }
    } finally {
      if (commitMessageRequestRef.current === controller) {
        commitMessageRequestRef.current = null;
        setCommitMessageBusy(false);
      }
    }
  }, [
    bootstrap,
    commitMessageBusy,
    commitMessageCapability.available,
    operationRevision,
    refreshChanges,
    reportFailure,
    repositoryId,
    stagedCount,
  ]);

  const commitStagedChanges = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const message = commitMessage.trim();
      if (!message || !bootstrap || !repositoryId || commitBusy || stagedCount === 0) return;
      const activeRepositoryId = repositoryId;
      const signal = repositoryRequestRef.current?.signal;
      setCommitBusy(true);
      try {
        const response = await api.commit(
          activeRepositoryId,
          { message, operationRevision },
          bootstrap.csrfToken,
          signal,
        );
        if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
        operationRevisionRef.current = response.operationRevision;
        setOperationRevision(response.operationRevision);
        setCommitComposerOpen(false);
        setCommitMessage("");
        await Promise.all([refreshChanges(), refreshReviewState()]);
        if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
        showToast(`Committed ${response.commit.slice(0, 7)}`);
      } catch (error) {
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        reportFailure(error, "Commit staged changes");
        if (error instanceof ApiError && error.status === 409) {
          void refreshChanges();
        }
      } finally {
        if (repositoryIdRef.current === activeRepositoryId) setCommitBusy(false);
      }
    },
    [
      bootstrap,
      commitBusy,
      commitMessage,
      operationRevision,
      reportFailure,
      refreshChanges,
      refreshReviewState,
      repositoryId,
      showToast,
      stagedCount,
    ],
  );

  const startPackageScript = useCallback(
    async (
      packageEntry: PackageScriptsPackage,
      script: PackageScriptDefinition,
    ) => {
      if (!bootstrap || !repositoryId) return;
      const activeRepositoryId = repositoryId;
      const busyKey = `${packageEntry.packagePath}\0${script.name}`;
      const signal = repositoryRequestRef.current?.signal;
      setPackageRunBusy(busyKey);
      try {
        const response = await api.startPackageRun(
          activeRepositoryId,
          {
            packagePath: packageEntry.packagePath,
            scriptName: script.name,
            manifestRevision: packageEntry.manifestRevision,
          },
          bootstrap.csrfToken,
          signal,
        );
        if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
        setPackageRuns((current) => [
          response.run,
          ...current.filter((run) => run.id !== response.run.id),
        ]);
        setPackageRunSnapshot({ run: response.run, output: [] });
        setSelectedPackageRunId(response.run.id);
        setDrawerOpen(false);
      } catch (error) {
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        showToast(messageOf(error));
        if (
          error instanceof ApiError &&
          error.code === "package_scripts_changed"
        ) {
          void refreshPackageScripts();
        }
      } finally {
        if (repositoryIdRef.current === activeRepositoryId) {
          setPackageRunBusy(null);
        }
      }
    },
    [bootstrap, refreshPackageScripts, repositoryId, showToast],
  );

  const stopPackageRun = useCallback(async () => {
    if (!bootstrap || !repositoryId || !selectedPackageRunId) return;
    const activeRepositoryId = repositoryId;
    const runId = selectedPackageRunId;
    const signal = repositoryRequestRef.current?.signal;
    setPackageRunBusy(runId);
    try {
      const response = await api.stopPackageRun(
        activeRepositoryId,
        runId,
        bootstrap.csrfToken,
        signal,
      );
      if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
      setPackageRunSnapshot((current) =>
        current?.run.id === runId ? { ...current, run: response.run } : current
      );
      setPackageRuns((current) => [
        response.run,
        ...current.filter((run) => run.id !== response.run.id),
      ]);
    } catch (error) {
      if (
        signal?.aborted ||
        repositoryIdRef.current !== activeRepositoryId ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      showToast(messageOf(error));
    } finally {
      if (repositoryIdRef.current === activeRepositoryId) setPackageRunBusy(null);
    }
  }, [bootstrap, repositoryId, selectedPackageRunId, showToast]);

  const openPackageRun = useCallback((run: PackageRunSummary) => {
    setPackageRunSnapshot({ run, output: [] });
    setSelectedPackageRunId(run.id);
    setDrawerOpen(false);
  }, []);

  const openCommentComposer = useCallback(() => {
    if (!selectedLineRange) return;
    setEditingComment(null);
    setCommentBody("");
    setCommentComposerOpen(true);
  }, [selectedLineRange]);

  const saveComment = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const body = commentBody.trim();
      if (!body || !bootstrap || !repositoryId || commentBusy) return;
      const activeRepositoryId = repositoryId;
      const signal = repositoryRequestRef.current?.signal;
      setCommentBusy(true);
      try {
        if (editingComment) {
          const response = await api.updateComment(
            activeRepositoryId,
            { id: editingComment.id, body },
            bootstrap.csrfToken,
            signal,
          );
          if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
          setComments((current) =>
            current.map((comment) =>
              comment.id === response.comment.id ? response.comment : comment,
            ),
          );
          showToast("Comment updated");
        } else if (activeFile && selectedLineRange?.hunk) {
          const response = await api.createComment(
            activeRepositoryId,
            {
              fileId: activeFile.id,
              contentRevision: activeFile.contentRevision,
              side: selectedLineRange.side,
              startLine: selectedLineRange.start,
              endLine: selectedLineRange.end,
              oldStartLine: selectedLineRange.oldStartLine,
              oldEndLine: selectedLineRange.oldEndLine,
              newStartLine: selectedLineRange.newStartLine,
              newEndLine: selectedLineRange.newEndLine,
              hunkHeader: selectedLineRange.hunk.header,
              excerpt: selectedLineRange.excerpt,
              body,
            },
            bootstrap.csrfToken,
            signal,
          );
          if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
          setComments((current) =>
            current.some((comment) => comment.id === response.comment.id)
              ? current.map((comment) =>
                  comment.id === response.comment.id ? response.comment : comment,
                )
              : [...current, response.comment],
          );
          void refreshReviewState();
          setSelection(null);
          showToast("Comment added");
        }
        setCommentComposerOpen(false);
        setCommentBody("");
        setEditingComment(null);
      } catch (error) {
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        showToast(messageOf(error));
      } finally {
        if (repositoryIdRef.current === activeRepositoryId) setCommentBusy(false);
      }
    },
    [
      activeFile,
      bootstrap,
      commentBody,
      commentBusy,
      editingComment,
      refreshReviewState,
      repositoryId,
      selectedLineRange,
      showToast,
    ],
  );

  const editComment = useCallback((comment: ReviewComment) => {
    setEditingComment(comment);
    setCommentBody(comment.body);
    setCommentTrayOpen(false);
    setCommentComposerOpen(true);
  }, []);

  const deleteComment = useCallback(
    async (comment: ReviewComment) => {
      if (
        !bootstrap ||
        !repositoryId ||
        !window.confirm(`Delete comment at ${formatCommentReference(comment)}?`)
      ) {
        return;
      }
      const activeRepositoryId = repositoryId;
      const signal = repositoryRequestRef.current?.signal;
      try {
        await api.deleteComment(
          activeRepositoryId,
          { id: comment.id },
          bootstrap.csrfToken,
          signal,
        );
        if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
        setComments((current) => current.filter((item) => item.id !== comment.id));
        setFiles((current) =>
          current.map((file) =>
            file.id === comment.fileId
              ? { ...file, commentCount: Math.max(0, file.commentCount - 1) }
              : file,
          ),
        );
        showToast("Comment deleted");
      } catch (error) {
        if (
          signal?.aborted ||
          repositoryIdRef.current !== activeRepositoryId ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        showToast(messageOf(error));
      }
    },
    [bootstrap, repositoryId, showToast],
  );

  const copyComments = useCallback(async () => {
    const activeRepositoryId = repositoryIdRef.current;
    if (!activeRepositoryId) return;
    let currentComments: ReviewComment[];
    try {
      const reviewState = await refreshReviewState();
      if (repositoryIdRef.current !== activeRepositoryId) return;
      currentComments = reviewState.comments.filter((comment) => !comment.stale);
    } catch (error) {
      if (
        repositoryIdRef.current !== activeRepositoryId ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      showToast(`Could not refresh comment anchors: ${messageOf(error)}`);
      return;
    }
    if (currentComments.length === 0) {
      showToast("No current comments to copy");
      return;
    }
    const payload = exportCommentsForCodex(currentComments);
    try {
      await copyToClipboard(payload);
      showToast(
        `Copied ${currentComments.length} comment${currentComments.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      setCopyFallbackText(payload);
      setCommentTrayOpen(false);
      showToast(`${messageOf(error)} The export is ready for manual copy.`);
    }
  }, [refreshReviewState, showToast]);

  const copyFailureDiagnostics = useCallback(async () => {
    if (!failure) return;
    try {
      await copyToClipboard(formatFailureDiagnostics(failure));
      showToast("Diagnostics copied");
    } catch (error) {
      showToast(messageOf(error));
    }
  }, [failure, showToast]);

  const showSource = useCallback(
    async (match: SearchMatch) => {
      if (!repositoryId) return;
      const activeRepositoryId = repositoryId;
      sourceRequestRef.current?.controller.abort();
      const generation = (sourceRequestRef.current?.generation ?? 0) + 1;
      const controller = new AbortController();
      sourceRequestRef.current = { generation, controller };
      setSourceBusy(true);
      try {
        const response = await api.source(
          activeRepositoryId,
          match.path,
          match.line,
          controller.signal,
        );
        if (
          sourceRequestRef.current?.generation === generation &&
          !controller.signal.aborted &&
          repositoryIdRef.current === activeRepositoryId &&
          response.path === match.path
        ) {
          setSourcePreview(response);
        }
      } catch (error) {
        if (
          repositoryIdRef.current === activeRepositoryId &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          showToast(messageOf(error));
        }
      } finally {
        if (
          sourceRequestRef.current?.generation === generation &&
          repositoryIdRef.current === activeRepositoryId
        ) {
          setSourceBusy(false);
        }
      }
    },
    [repositoryId, showToast],
  );

  useEffect(() => {
    if (searchOpen) return;
    sourceRequestRef.current?.controller.abort();
    setSourceBusy(false);
    setSourcePreview(null);
  }, [searchOpen]);

  const jumpToComment = useCallback(
    (comment: ReviewComment) => {
      if (comment.stale) {
        showToast("This comment is stale; its saved excerpt is no longer anchored to the diff");
        return;
      }
      if (!files.some((file) => file.id === comment.fileId)) {
        showToast("That file is no longer in the review queue");
        return;
      }
      setPendingCommentJump(comment);
      setCommentTrayOpen(false);
      if (comment.fileId !== currentFileId) selectFile(comment.fileId);
    },
    [currentFileId, files, selectFile, showToast],
  );

  const openInlineComment = useCallback((comment: ReviewComment) => {
    setFocusedCommentId(comment.id);
    setCommentTrayOpen(true);
  }, []);

  useEffect(() => {
    if (!commentTrayOpen || !focusedCommentId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>("[data-comment-id]")]
        .find((element) => element.dataset.commentId === focusedCommentId);
      card?.scrollIntoView?.({ block: "nearest" });
      card?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [commentTrayOpen, focusedCommentId]);

  useEffect(() => {
    if (!pendingCommentJump || !diff || pendingCommentJump.fileId !== diff.fileId) return;
    const matchingRowIndexes = rows.flatMap((row, index) =>
      row.type === "line" && lineMatchesComment(row.line, pendingCommentJump)
        ? [index]
        : [],
    );
    const firstRowIndex = matchingRowIndexes[0];
    const lastRowIndex = matchingRowIndexes.at(-1);
    if (firstRowIndex !== undefined && lastRowIndex !== undefined) {
      diffViewerRef.current?.scrollToComment(pendingCommentJump);
      const firstRow = rows[firstRowIndex];
      const lastRow = rows[lastRowIndex];
      if (firstRow?.type === "line" && lastRow?.type === "line") {
        const sideFor = (
          row: LineRow,
          boundary: "first" | "last",
        ): SelectableSide => {
          if (pendingCommentJump.side === "old") return "old";
          if (pendingCommentJump.side === "new") return "new";
          if (boundary === "last" && row.line.newLine !== null) return "new";
          if (row.line.oldLine !== null) return "old";
          return "new";
        };
        const anchorSide = sideFor(firstRow, "first");
        const focusSide = sideFor(lastRow, "last");
        setSelection({
          side: pendingCommentJump.side,
          hunkId: firstRow.hunk.id,
          anchorIndex: firstRowIndex,
          focusIndex: lastRowIndex,
          anchorSide,
          focusSide,
        });
      }
    }
    setPendingCommentJump(null);
  }, [diff, pendingCommentJump, rows]);

  const overlayVisible =
    repositoryPickerOpen ||
    remoteBridgeOpen ||
    searchOpen ||
    failureDetailsOpen ||
    commitComposerOpen ||
    Boolean(selectedPackageRunId) ||
    commentComposerOpen ||
    commentTrayOpen ||
    Boolean(copyFallbackText) ||
    (!desktop && drawerOpen);

  const dismissCommandOverlays = useCallback(() => {
    setRepositoryPickerOpen(false);
    setRemoteBridgeOpen(false);
    setSearchOpen(false);
    setFailureDetailsOpen(false);
    closeCommitComposer();
    setSelectedPackageRunId(null);
    setCommentComposerOpen(false);
    setCommentTrayOpen(false);
    setCopyFallbackText("");
    setDrawerOpen(false);
  }, [closeCommitComposer]);

  const showReviewWorkspace = useCallback((): boolean => {
    if (
      workspaceMode === "settings" &&
      settingsDirty &&
      !window.confirm("Discard unsaved profile changes?")
    ) {
      return false;
    }
    const url = new URL(window.location.href);
    if (isSettingsPath(url.pathname)) {
      url.pathname = "/";
      window.history.replaceState(null, "", url);
    }
    setWorkspaceMode("review");
    return true;
  }, [settingsDirty, workspaceMode]);

  const runtimeCommands = useMemo(() => {
    const command = (
      id: CommandId,
      enabled: boolean,
      disabledReason: string | null,
      perform: () => void,
    ): RuntimeCommand => ({
      ...COMMAND_DEFINITIONS[id],
      binding: commandBindings[id],
      enabled,
      disabledReason: enabled ? null : disabledReason,
      perform,
    });
    const hasRepository = Boolean(repositoryId && repository);
    return {
      "palette.open": command("palette.open", true, null, () => {
        setCommandPaletteOpen((current) => !current);
      }),
      "navigate.review": command("navigate.review", true, null, () => {
        if (!showReviewWorkspace()) return;
        dismissCommandOverlays();
      }),
      "navigate.terminal": command(
        "navigate.terminal",
        hasRepository && terminalCapability.available,
        terminalCapability.reason ?? "Select a repository first",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          openTerminalWorkspace();
        },
      ),
      "navigate.remote": command(
        "navigate.remote",
        hasRepository,
        "Select a repository first",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          setRemoteBridgeOpen(true);
        },
      ),
      "navigate.settings": command("navigate.settings", true, null, () => {
        dismissCommandOverlays();
        openSettingsPage();
      }),
      "repository.switch": command(
        "repository.switch",
        bootstrap !== null,
        "Couchview is still loading",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          openRepositoryPicker();
        },
      ),
      "panel.files": command(
        "panel.files",
        hasRepository,
        "Select a repository first",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          setDrawerView("files");
          setDrawerOpen(true);
        },
      ),
      "panel.packageCommands": command(
        "panel.packageCommands",
        hasRepository,
        "Select a repository first",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          setDrawerView("commands");
          setDrawerOpen(true);
        },
      ),
      "search.open": command(
        "search.open",
        Boolean(activeFile && repositoryId),
        "Open a changed file first",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          setSearchQuery("");
          setSearchScope("current");
          setSourcePreview(null);
          setSearchOpen(true);
          window.setTimeout(() => searchInputRef.current?.focus(), 30);
        },
      ),
      "commit.open": command(
        "commit.open",
        stagedCount > 0 && !commitBusy,
        stagedCount === 0 ? "Stage changes before committing" : "A commit is already running",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          openCommitComposer();
        },
      ),
      "comments.open": command(
        "comments.open",
        hasRepository,
        "Select a repository first",
        () => {
          if (!showReviewWorkspace()) return;
          dismissCommandOverlays();
          setFocusedCommentId(null);
          setCommentTrayOpen(true);
        },
      ),
      "file.toggleStage": command(
        "file.toggleStage",
        Boolean(activeFile) && !stageBusy && bulkStageBusy === null,
        activeFile ? "A staging operation is already running" : "Open a changed file first",
        () => void toggleStageActiveFile(),
      ),
      "file.toggleReviewed": command(
        "file.toggleReviewed",
        Boolean(activeFile) && !reviewBusy,
        activeFile ? "A review update is already running" : "Open a changed file first",
        () => {
          if (activeFile) void setReviewed(activeFile, !activeFile.reviewed, false);
        },
      ),
      "file.previous": command(
        "file.previous",
        activeFileIndex > 0,
        "This is the first file",
        () => navigateFile(-1),
      ),
      "file.next": command(
        "file.next",
        activeFileIndex >= 0 && activeFileIndex < files.length - 1,
        "This is the last file",
        () => navigateFile(1),
      ),
      "hunk.previous": command(
        "hunk.previous",
        workspaceMode === "review" && canNavigatePreviousHunk,
        workspaceMode === "review" ? "There is no previous hunk" : "Open diff review first",
        () => navigateHunk(-1),
      ),
      "hunk.next": command(
        "hunk.next",
        workspaceMode === "review" && canNavigateNextHunk,
        workspaceMode === "review" ? "There is no next hunk" : "Open diff review first",
        () => navigateHunk(1),
      ),
    } satisfies Record<CommandId, RuntimeCommand>;
  }, [
    activeFile,
    activeFileIndex,
    bootstrap,
    bulkStageBusy,
    canNavigateNextHunk,
    canNavigatePreviousHunk,
    commandBindings,
    commitBusy,
    dismissCommandOverlays,
    files.length,
    navigateFile,
    navigateHunk,
    openCommitComposer,
    openRepositoryPicker,
    openSettingsPage,
    openTerminalWorkspace,
    repository,
    repositoryId,
    reviewBusy,
    setReviewed,
    showReviewWorkspace,
    stageBusy,
    stagedCount,
    terminalCapability.available,
    terminalCapability.reason,
    toggleStageActiveFile,
    workspaceMode,
  ]);

  const { pending: pendingShortcut } = useShortcutEngine({
    bindings: commandBindings,
    commands: runtimeCommands,
    paletteOpen: commandPaletteOpen,
    recording: shortcutRecording,
    restricted: workspaceMode === "terminal" || overlayVisible,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (commandPaletteOpen || event.key !== "Escape" || !overlayVisible) return;
      event.preventDefault();
      if (copyFallbackText) setCopyFallbackText("");
      else if (failureDetailsOpen) setFailureDetailsOpen(false);
      else if (repositoryPickerOpen) setRepositoryPickerOpen(false);
      else if (remoteBridgeOpen) setRemoteBridgeOpen(false);
      else if (commitComposerOpen) closeCommitComposer();
      else if (selectedPackageRunId) setSelectedPackageRunId(null);
      else if (commentComposerOpen) setCommentComposerOpen(false);
      else if (commentTrayOpen) setCommentTrayOpen(false);
      else if (searchOpen) setSearchOpen(false);
      else setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeCommitComposer,
    commandPaletteOpen,
    commitComposerOpen,
    commentComposerOpen,
    commentTrayOpen,
    copyFallbackText,
    failureDetailsOpen,
    overlayVisible,
    remoteBridgeOpen,
    repositoryPickerOpen,
    searchOpen,
    selectedPackageRunId,
  ]);

  useEffect(() => {
    if (!overlayVisible) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlays = document.querySelectorAll<HTMLElement>('[role="dialog"], .drawer');
    const overlay = overlays.item(overlays.length - 1);
    if (!overlay) return;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = window.requestAnimationFrame(() => {
      if (!overlay.contains(document.activeElement)) {
        overlay.querySelector<HTMLElement>(focusableSelector)?.focus();
      }
    });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...overlay.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("keydown", trapFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [
    commitComposerOpen,
    commentComposerOpen,
    commentTrayOpen,
    copyFallbackText,
    desktop,
    drawerOpen,
    failureDetailsOpen,
    overlayVisible,
    repositoryPickerOpen,
    remoteBridgeOpen,
    searchOpen,
    selectedPackageRunId,
  ]);

  const terminalWorkspace = terminalOpened && bootstrap && repositoryId && repository ? (
    <TerminalWorkspace
      active={workspaceMode === "terminal"}
      capability={terminalCapability}
      commandPaletteShortcut={formatShortcut(commandBindings["palette.open"])}
      csrfToken={bootstrap.csrfToken}
      onBack={() => setWorkspaceMode("review")}
      onEnded={() => showToast("tmux session ended")}
      onNotice={showToast}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      rendererConfig={terminalConfig}
      repositoryId={repositoryId}
      repositoryName={repository.name}
    />
  ) : null;
  const pwaRefreshToast = pwa.needRefresh ? (
    <div className="toast update-toast">
      <span>An app update is ready.</span>
      <span>
        <button className="text-button" onClick={pwa.dismissRefresh} type="button">
          Later
        </button>
        <button className="text-button" onClick={pwa.update} type="button">
          Reload
        </button>
      </span>
    </div>
  ) : null;
  const globalCommandUi = (
    <>
      <CommandPalette
        commands={runtimeCommands}
        onOpenChange={setCommandPaletteOpen}
        open={commandPaletteOpen}
      />
      {pendingShortcut.length > 0 && (
        <div aria-live="polite" className="shortcut-pending-hud" role="status">
          {formatShortcut(pendingShortcut)}
        </div>
      )}
    </>
  );

  if (workspaceMode === "settings" && phase === "ready" && bootstrap) {
    return (
      <>
        {terminalWorkspace}
        <ProfileSettingsPage
          busy={settingsBusy}
          commandPaletteShortcut={formatShortcut(commandBindings["palette.open"])}
          onBack={closeSettingsPage}
          onCreate={(name) => createSettingsProfile(name)}
          onDelete={deleteSettingsProfile}
          onDirtyChange={setSettingsDirty}
          onDuplicate={(profileId, name) => createSettingsProfile(name, profileId)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onRecordingChange={setShortcutRecording}
          onSave={saveSettingsProfile}
          onSelect={selectSettingsProfile}
          profile={activeSettingsProfile}
          profiles={settingsProfiles}
        />
        {globalCommandUi}
        {pwaRefreshToast && (
          <div className="toast-stack" aria-live="polite">
            {pwaRefreshToast}
          </div>
        )}
      </>
    );
  }

  if (phase === "loading") {
    return (
      <>
        <main className={`app-shell ${compactLandscape ? "compact-landscape" : ""}`}>
          <div className="loading-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
            <LoaderCircle className="state-icon spinner" size={30} />
            <h1 className="state-title">Opening repository…</h1>
            <p className="state-copy">Reading changed files and restoring settings.</p>
          </div>
        </main>
        {globalCommandUi}
      </>
    );
  }

  if (phase === "error") {
    const authenticationRequired = loadErrorCode === "authentication_required";
    const authenticationRefreshFailed = loadErrorCode === "authentication_refresh_failed";
    const disconnected = loadErrorCode === "disconnected";
    const repositoryId = new URL(window.location.href).searchParams.get("repo");
    const accessRefresh = new URL(API_ROUTES.accessRefresh, window.location.origin);
    if (repositoryId) accessRefresh.searchParams.set("repo", repositoryId);
    return (
      <main className={`app-shell ${compactLandscape ? "compact-landscape" : ""}`}>
        <div className="error-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
          <AlertTriangle className="state-icon" size={32} />
          <h1 className="state-title">
            {authenticationRefreshFailed
              ? "Sign-in didn’t complete"
              : authenticationRequired
              ? "Sign-in expired"
              : disconnected
                ? "Couchview is unavailable"
                : "Couldn’t open Couchview"}
          </h1>
          <p className="state-copy">
            {authenticationRefreshFailed
              ? "Cloudflare returned to Couchview, but this browser still does not have a usable Access session."
              : authenticationRequired
              ? "Sign in again to continue using Couchview."
              : loadError}
          </p>
          <div className="state-actions">
            {authenticationRefreshFailed ? (
              <>
                <a className="action-button" href={API_ROUTES.accessLogout}>
                  <RotateCcw size={16} /> Reset Cloudflare sign-in
                </a>
                <a
                  className="action-button secondary"
                  href={`${accessRefresh.pathname}${accessRefresh.search}`}
                >
                  <LogIn size={16} /> Try sign-in again
                </a>
              </>
            ) : authenticationRequired ? (
              <>
                <a className="action-button" href={`${accessRefresh.pathname}${accessRefresh.search}`}>
                  <LogIn size={16} /> Sign in again
                </a>
                <button className="action-button secondary" onClick={() => void loadApp()} type="button">
                  <RefreshCw size={16} /> Retry
                </button>
              </>
            ) : (
              <>
                <button className="action-button" onClick={() => void loadApp()} type="button">
                  <RefreshCw size={16} /> Retry
                </button>
                {disconnected && (
                  <a
                    className="action-button secondary"
                    href={`${accessRefresh.pathname}${accessRefresh.search}`}
                  >
                    <LogIn size={16} /> Sign in again
                  </a>
                )}
                {disconnected && (
                  <button
                    className="action-button secondary"
                    disabled={appCacheResetBusy}
                    onClick={() => void resetAppCache()}
                    type="button"
                  >
                    {appCacheResetBusy ? (
                      <LoaderCircle className="spinner" size={16} />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                    Reset app cache
                  </button>
                )}
              </>
            )}
          </div>
          {authenticationRefreshFailed && (
            <p className="state-help">
              Reset signs this browser out of every Cloudflare Access app. Return to Couchview and
              sign in again.
            </p>
          )}
        </div>
      </main>
    );
  }

  const drawerVisible = drawerOpen || desktop;
  const activeSearchMatches =
    searchScope === "current" ? searchResult?.currentFile : searchResult?.otherFiles;
  const activeComments = activeFile
    ? comments.filter((comment) => comment.fileId === activeFile.id)
    : [];
  const currentCommentCount = comments.filter((comment) => !comment.stale).length;
  const activeFileFullyStaged = Boolean(activeFile?.staged && !activeFile.unstaged);

  return (
    <>
      {terminalWorkspace}
      {globalCommandUi}
      <main
        className={`app-shell ${compactLandscape ? "compact-landscape" : ""} ${workspaceMode === "terminal" ? "terminal-active" : ""}`}
      >
      {drawerVisible && (
        <>
          {!desktop && (
            <button
              aria-label="Close changed files"
              className="drawer-scrim"
              onClick={() => setDrawerOpen(false)}
              type="button"
            />
          )}
          <aside aria-label="Changed files" className="drawer">
            <header className="drawer-header">
              <div>
                <h2 className="drawer-title">
                  {drawerView === "files" ? "Changed files" : "Package commands"}
                </h2>
                {drawerView === "files" ? (
                  <div
                    aria-label={`${files.length} changed ${files.length === 1 ? "file" : "files"}, ${changeTotals.additions} ${changeTotals.additions === 1 ? "addition" : "additions"}, ${changeTotals.deletions} ${changeTotals.deletions === 1 ? "deletion" : "deletions"}`}
                    className="repo-meta"
                  >
                    <span>
                      {files.length} {files.length === 1 ? "file" : "files"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="additions">+{changeTotals.additions}</span>
                    <span className="deletions">−{changeTotals.deletions}</span>
                  </div>
                ) : (
                  <div className="repo-meta">
                    {packageScripts.packages.length}{" "}
                    {packageScripts.packages.length === 1 ? "package" : "packages"}
                  </div>
                )}
              </div>
              <button
                aria-label="Close changed files"
                className="icon-button"
                onClick={() => setDrawerOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>

            <div className="filter-area">
              {commandsAvailable && (
                <div className="drawer-tabs" aria-label="Project drawer views">
                  <button
                    aria-pressed={drawerView === "files"}
                    className={drawerView === "files" ? "active" : ""}
                    onClick={() => setDrawerView("files")}
                    type="button"
                  >
                    Files
                  </button>
                  <button
                    aria-pressed={drawerView === "commands"}
                    className={drawerView === "commands" ? "active" : ""}
                    onClick={() => setDrawerView("commands")}
                    type="button"
                  >
                    <SquareTerminal size={13} /> Commands
                  </button>
                </div>
              )}
              {drawerView === "files" ? (
                <>
                  <label className="sr-only" htmlFor="file-filter">
                    Filter changed files
                  </label>
                  <input
                    className="filter-input"
                    id="file-filter"
                    onChange={(event) => setFileQuery(event.target.value)}
                    placeholder="Filter paths…"
                    type="search"
                    value={fileQuery}
                  />
                  <div className="chips" aria-label="Review filters">
                    {(["all", "unreviewed", "reviewed"] as const).map((filter) => (
                      <button
                        className={`chip ${reviewFilter === filter ? "active" : ""}`}
                        key={filter}
                        onClick={() => setReviewFilter(filter)}
                        type="button"
                      >
                        {filter === "all" ? "All reviews" : filter}
                      </button>
                    ))}
                  </div>
                  <div className="chips" aria-label="Stage filters">
                    {(["all", "unstaged", "staged"] as const).map((filter) => (
                      <button
                        className={`chip ${stageFilter === filter ? "active" : ""}`}
                        key={filter}
                        onClick={() => setStageFilter(filter)}
                        type="button"
                      >
                        {filter === "all" ? "Any stage" : filter}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="command-warning">
                  Package scripts run on this computer as your user. Only run commands
                  from repositories and networks you trust.
                </div>
              )}
            </div>

            {drawerView === "files" ? (
              <div className="file-list">
                {filteredFiles.map((file) => (
                  <button
                    className={`file-row ${file.id === currentFileId ? "current" : ""}`}
                    key={file.id}
                    onClick={() => selectFile(file.id)}
                    type="button"
                  >
                    {file.reviewed ? (
                      <CheckCircle2 color="var(--green)" size={16} />
                    ) : (
                      <Circle size={16} />
                    )}
                    <span style={{ minWidth: 0 }}>
                      <span className="file-row-path">{file.path}</span>
                      <span className="file-row-meta">
                        <span>{changeLabel(file)}</span>
                        {stageLabel(file) && stageLabel(file) !== changeLabel(file) && (
                          <span>{stageLabel(file)}</span>
                        )}
                        {file.additions !== null && (
                          <span className="additions">+{file.additions}</span>
                        )}
                        {file.deletions !== null && (
                          <span className="deletions">−{file.deletions}</span>
                        )}
                      </span>
                    </span>
                    <span className="file-state-icons">
                      {file.staged && <GitPullRequestArrow aria-label="Staged" size={13} />}
                      {file.commentCount > 0 && <span className="badge">{file.commentCount}</span>}
                    </span>
                  </button>
                ))}
                {filteredFiles.length === 0 && (
                  <div className="empty-state" style={{ minHeight: 160 }}>
                    <ListFilter className="state-icon" size={24} />
                    <p className="state-copy">No files match these filters.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="commands-list">
                {packageCommandsLoading && packageScripts.packages.length === 0 ? (
                  <div className="loading-state" style={{ minHeight: 140 }}>
                    <LoaderCircle className="state-icon spinner" size={23} />
                    <p className="state-copy">Finding package scripts…</p>
                  </div>
                ) : (
                  <>
                    {packageRuns.length > 0 && (
                      <section className="command-group" aria-label="Recent package runs">
                        <h3 className="command-group-title">Active and recent runs</h3>
                        {packageRuns.map((run) => (
                          <button
                            className="package-run-row"
                            key={run.id}
                            onClick={() => openPackageRun(run)}
                            type="button"
                          >
                            <span>
                              <span className="package-script-name">{run.scriptName}</span>
                              <span className="package-script-command">
                                {run.directory} · {run.invocation}
                              </span>
                            </span>
                            <span className={`run-status ${run.status}`}>
                              {runStatusLabel(run.status)}
                            </span>
                          </button>
                        ))}
                      </section>
                    )}
                    {packageScripts.packages.map((packageEntry) => (
                      <section className="command-group" key={packageEntry.packagePath}>
                        <h3 className="command-group-title">
                          <span>{packageLabel(packageEntry)}</span>
                          <code>{packageEntry.directory}</code>
                        </h3>
                        {packageEntry.scripts.length > 0 ? (
                          packageEntry.scripts.map((script) => {
                            const busyKey = `${packageEntry.packagePath}\0${script.name}`;
                            const active = packageRuns.some(
                              (run) =>
                                run.packagePath === packageEntry.packagePath &&
                                run.scriptName === script.name &&
                                ["running", "stopping"].includes(run.status),
                            );
                            return (
                              <div className="package-script-row" key={script.name}>
                                <span>
                                  <span className="package-script-name">{script.name}</span>
                                  <span className="package-script-command">{script.command}</span>
                                </span>
                                <button
                                  aria-label={`Run ${script.name} in ${packageEntry.directory}`}
                                  className="icon-button command-run-button"
                                  disabled={active || packageRunBusy === busyKey}
                                  onClick={() => void startPackageScript(packageEntry, script)}
                                  title={active ? "This script is already running" : "Run script"}
                                  type="button"
                                >
                                  {packageRunBusy === busyKey ? (
                                    <LoaderCircle className="spinner" size={16} />
                                  ) : (
                                    <Play size={15} />
                                  )}
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <p className="command-empty">No scripts in this package.</p>
                        )}
                      </section>
                    ))}
                    {packageScripts.warnings.map((warning) => (
                      <div className="package-warning" key={`${warning.packagePath}:${warning.message}`}>
                        <strong>{warning.packagePath}</strong>
                        <span>{warning.message}</span>
                      </div>
                    ))}
                    {packageScripts.packages.length === 0 &&
                      packageRuns.length === 0 &&
                      packageScripts.warnings.length === 0 && (
                        <div className="empty-state" style={{ minHeight: 160 }}>
                          <SquareTerminal className="state-icon" size={26} />
                          <p className="state-copy">No package.json files were detected.</p>
                        </div>
                      )}
                  </>
                )}
              </div>
            )}

            <footer className="drawer-footer">
              {drawerView === "files" ? (
                <>
                  <div className="progress-track" aria-hidden="true">
                    <div
                      className="progress-value"
                      style={{ width: `${files.length ? (reviewedCount / files.length) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="progress-label">
                    {reviewedCount} of {files.length} reviewed
                  </div>
                  <div className="bulk-stage-actions">
                    <button
                      aria-label={`Stage all files (${stageableFiles.length})`}
                      className="action-button secondary"
                      disabled={
                        stageableFiles.length === 0 ||
                        stageBusy ||
                        bulkStageBusy !== null
                      }
                      onClick={() => void stageMultipleFiles("all")}
                      type="button"
                    >
                      {bulkStageBusy === "all" ? (
                        <LoaderCircle className="spinner" size={15} />
                      ) : (
                        <GitPullRequestArrow size={15} />
                      )}
                      <span>Stage all ({stageableFiles.length})</span>
                    </button>
                    <button
                      aria-label={`Stage reviewed files (${stageableReviewedFiles.length})`}
                      className="action-button secondary"
                      disabled={
                        stageableReviewedFiles.length === 0 ||
                        stageBusy ||
                        bulkStageBusy !== null
                      }
                      onClick={() => void stageMultipleFiles("reviewed")}
                      type="button"
                    >
                      {bulkStageBusy === "reviewed" ? (
                        <LoaderCircle className="spinner" size={15} />
                      ) : (
                        <CheckCircle2 size={15} />
                      )}
                      <span>
                        Stage reviewed ({stageableReviewedFiles.length})
                      </span>
                    </button>
                  </div>
                  <button
                    className="action-button commit-action"
                    disabled={stagedCount === 0 || commitBusy}
                    onClick={openCommitComposer}
                    type="button"
                  >
                    <GitCommitHorizontal size={16} />
                    {stagedCount === 0
                      ? "No staged changes"
                      : `Commit ${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`}
                  </button>
                </>
              ) : (
                <div className="progress-label command-footer-copy">
                  Commands keep running when this panel closes. Open a recent run to
                  reconnect to its output.
                </div>
              )}
            </footer>
          </aside>
        </>
      )}

      <header className="top-bar">
        <button
          aria-label="Open changed files"
          className="icon-button menu-button"
          onClick={() => setDrawerOpen(true)}
          type="button"
        >
          <Menu size={20} />
        </button>
        {compactLandscape ? (
          <div
            aria-label="Current file"
            className="compact-file-context"
            role="region"
          >
            <span className={`connection-dot ${connected ? "" : "offline"}`} />
            <button
              aria-label="Select repository"
              aria-haspopup="dialog"
              className="compact-repo-name repository-trigger"
              onClick={openRepositoryPicker}
              title={`${repository?.name ?? "Couchview"} · ${repository?.branch ?? "detached"}`}
              type="button"
            >
              <span>{repository?.name ?? "Couchview"}</span>
              <ChevronDown size={12} />
            </button>
            <span className="compact-context-divider">/</span>
            <span className="file-path" title={activeFile?.path}>
              {activeFile?.path ?? "No changed file"}
            </span>
            {activeFile && (
              <div className="compact-file-meta">
                <span className="status-pill compact-change-kind">{changeLabel(activeFile)}</span>
                <span className="additions">+{activeFile.additions ?? diff?.additions ?? 0}</span>
                <span className="deletions">−{activeFile.deletions ?? diff?.deletions ?? 0}</span>
                {activeFile.reviewed && <span className="status-pill reviewed">reviewed</span>}
                {stageLabel(activeFile) && (
                  <span className={`status-pill ${stageLabel(activeFile)}`}>
                    {stageLabel(activeFile)}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="repo-heading">
            <button
              aria-label="Select repository"
              aria-haspopup="dialog"
              className="repo-name repository-trigger"
              onClick={openRepositoryPicker}
              type="button"
            >
              <span className={`connection-dot ${connected ? "" : "offline"}`} />
              <span>{repository?.name ?? "Couchview"}</span>
              <ChevronDown size={13} />
            </button>
            <div className="repo-meta">
              <GitBranch size={10} />
              <span>{repository?.branch ?? "detached"}</span>
              <span>·</span>
              <span>{reviewedCount}/{files.length} reviewed</span>
            </div>
          </div>
        )}
        {compactLandscape && (
          <div className="landscape-tools">
            <div className="compact-hunk-nav" aria-label="Hunk navigation">
              <button
                aria-label="Previous hunk"
                className="icon-button"
                disabled={!canNavigatePreviousHunk}
                onClick={() => navigateHunk(-1)}
                title="Previous hunk (K)"
                type="button"
              >
                <ChevronUp size={16} />
              </button>
              <button
                aria-label="Next hunk"
                className="icon-button"
                disabled={!canNavigateNextHunk}
                onClick={() => navigateHunk(1)}
                title="Next hunk (J)"
                type="button"
              >
                <ChevronDown size={16} />
              </button>
            </div>
            <button
              aria-label={`Open comments (${comments.length})`}
              className="icon-button compact-comments-button"
              onClick={() => {
                setFocusedCommentId(null);
                setCommentTrayOpen(true);
              }}
              title="Review comments"
              type="button"
            >
              <MessageSquareText size={17} />
              {comments.length > 0 && <span className="badge">{comments.length}</span>}
            </button>
          </div>
        )}
        <button
          aria-label="Open command palette"
          className="icon-button command-palette-trigger"
          onClick={() => setCommandPaletteOpen(true)}
          title={`Open command palette (${formatShortcut(commandBindings["palette.open"])})`}
          type="button"
        >
          <Search size={18} />
          {desktop && <kbd>{formatShortcut(commandBindings["palette.open"])}</kbd>}
        </button>
        <button
          aria-label="Set up native IDE"
          className="icon-button remote-bridge-launch-button"
          disabled={!repositoryId || !repository}
          onClick={() => setRemoteBridgeOpen(true)}
          title={remoteBridgeCapability.available
            ? "Pair a Mac and open this repository in Zed"
            : remoteBridgeCapability.reason ?? "Native remote development is unavailable"}
          type="button"
        >
          <MonitorUp size={18} />
        </button>
        <button
          aria-label="Open tmux terminal"
          aria-pressed={workspaceMode === "terminal"}
          className="icon-button terminal-launch-button"
          disabled={!terminalCapability.available || !repositoryId}
          onClick={() => openTerminalWorkspace()}
          title={terminalCapability.available
            ? "Open persistent tmux terminal"
            : terminalCapability.reason ?? "The browser tmux terminal is unavailable"}
          type="button"
        >
          <SquareTerminal size={18} />
        </button>
        {compactLandscape && (
          <button
            aria-label="Open settings"
            className="icon-button settings-launch-button"
            onClick={openSettingsPage}
            title="Typography settings"
            type="button"
          >
            <Settings2 size={18} />
          </button>
        )}
        <div className="font-controls" aria-label="Diff display controls">
          <button
            aria-label={lineNumbersVisible ? "Hide line numbers" : "Show line numbers"}
            aria-pressed={lineNumbersVisible}
            className={`number-toggle ${lineNumbersVisible ? "active" : ""}`}
            onClick={() => setLineNumbersVisible(!lineNumbersVisible)}
            title={lineNumbersVisible ? "Hide line numbers" : "Show line numbers"}
            type="button"
          >
            123
          </button>
          <button
            aria-label={lineWrapEnabled ? "Keep long lines on one line" : "Wrap long lines"}
            aria-pressed={lineWrapEnabled}
            className={`wrap-toggle ${lineWrapEnabled ? "active" : ""}`}
            onClick={() => setLineWrapEnabled(!lineWrapEnabled)}
            title={lineWrapEnabled ? "Keep long lines on one line" : "Wrap long lines"}
            type="button"
          >
            <WrapText aria-hidden="true" size={16} />
          </button>
          <button
            aria-label="Decrease diff font size"
            className="icon-button compact-button"
            disabled={fontSize <= TYPOGRAPHY_LIMITS.diff.fontSize.min}
            onClick={() => setFontSize(Math.max(
              TYPOGRAPHY_LIMITS.diff.fontSize.min,
              fontSize - TYPOGRAPHY_LIMITS.diff.fontSize.step,
            ))}
            type="button"
          >
            <Minus size={15} />
          </button>
          <span className="font-value">{fontSize}px</span>
          <button
            aria-label="Increase diff font size"
            className="icon-button compact-button"
            disabled={fontSize >= TYPOGRAPHY_LIMITS.diff.fontSize.max}
            onClick={() => setFontSize(Math.min(
              TYPOGRAPHY_LIMITS.diff.fontSize.max,
              fontSize + TYPOGRAPHY_LIMITS.diff.fontSize.step,
            ))}
            type="button"
          >
            <Plus size={15} />
          </button>
        </div>
      </header>

      {!connected && !compactLandscape && (
        <div className="disconnected-banner" style={{ gridColumn: desktop ? 2 : undefined }}>
          <WifiOff size={12} /> Disconnected — reconnecting to the local server
        </div>
      )}

      {!compactLandscape && <section className="file-bar" aria-label="Current file">
        <button
          aria-label="Previous file"
          className="icon-button"
          disabled={activeFileIndex <= 0}
          onClick={() => navigateFile(-1)}
          title="Previous file ([)"
          type="button"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="file-summary">
          <div className="file-path" title={activeFile?.path}>
            {activeFile?.path ?? "No changed file"}
          </div>
          {activeFile && (
            <div className="file-meta">
              <span className="status-pill">{changeLabel(activeFile)}</span>
              <span className="additions">+{activeFile.additions ?? diff?.additions ?? 0}</span>
              <span className="deletions">−{activeFile.deletions ?? diff?.deletions ?? 0}</span>
              {activeFile.reviewed && <span className="status-pill reviewed">reviewed</span>}
              {stageLabel(activeFile) && (
                <span className={`status-pill ${stageLabel(activeFile)}`}>
                  {stageLabel(activeFile)}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          aria-label="Next file"
          className="icon-button"
          disabled={activeFileIndex < 0 || activeFileIndex >= files.length - 1}
          onClick={() => navigateFile(1)}
          title="Next file (])"
          type="button"
        >
          <ChevronRight size={20} />
        </button>
        <button
          aria-label="Open settings"
          className="icon-button settings-launch-button"
          onClick={openSettingsPage}
          title="Typography settings"
          type="button"
        >
          <Settings2 size={18} />
        </button>
      </section>}

      <section className="workspace" aria-label="Unified diff">
        {files.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 className="state-icon" color="var(--green)" size={34} />
            <h2 className="state-title">Working tree is clean</h2>
            <p className="state-copy">New changes will appear here automatically.</p>
          </div>
        ) : diffLoading && !diff ? (
          <div className="loading-state">
            <LoaderCircle className="state-icon spinner" size={27} />
            <p className="state-copy">Loading diff…</p>
          </div>
        ) : diffError && !diff ? (
          <div className="error-state">
            <AlertTriangle className="state-icon" size={28} />
            <h2 className="state-title">Couldn’t load this diff</h2>
            <p className="state-copy">{diffError}</p>
            {failure && (
              <button
                className="action-button secondary"
                onClick={() => setFailureDetailsOpen(true)}
                type="button"
              >
                Error details
              </button>
            )}
            {currentFileId && (
              <button
                className="action-button secondary"
                onClick={() => {
                  const retryId = currentFileId;
                  setCurrentFileId(null);
                  window.setTimeout(() => setCurrentFileId(retryId), 0);
                }}
                type="button"
              >
                <RefreshCw size={15} /> Retry
              </button>
            )}
          </div>
        ) : diff?.binary ? (
          <div className="empty-state">
            <FileCode2 className="state-icon" size={31} />
            <h2 className="state-title">Binary file</h2>
            <p className="state-copy">A line-by-line preview isn’t available for this change.</p>
            {diff.header.length > 0 && (
              <pre className="metadata-preview">{diff.header.join("\n")}</pre>
            )}
          </div>
        ) : diff?.tooLarge && rows.length === 0 ? (
          <div className="empty-state">
            <AlertTriangle className="state-icon" size={31} />
            <h2 className="state-title">Diff is too large to display</h2>
            <p className="state-copy">Review this file using your local Git tools.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <FileCode2 className="state-icon" size={31} />
            <h2 className="state-title">No textual hunks</h2>
            <p className="state-copy">Review the file metadata below.</p>
            {diff?.header.length ? (
              <pre className="metadata-preview">{diff.header.join("\n")}</pre>
            ) : null}
          </div>
        ) : diff ? (
          <DiffViewer
            comments={comments}
            diff={diff}
            fontFamily={codeFontStack(typographyPreferences.diff.fontFamily)}
            fontSize={fontSize}
            lineHeightAdjustment={typographyPreferences.diff.lineHeightAdjustment}
            widthAdjustment={typographyPreferences.diff.widthAdjustment}
            lineNumbersVisible={lineNumbersVisible}
            lineWrapEnabled={lineWrapEnabled}
            onCommentClick={openInlineComment}
            onIdentifierClick={openWordSearch}
            onLineNumberClick={handleViewerLineNumberClick}
            onVisibleLineChange={handleVisibleLineChange}
            ref={diffViewerRef}
            selectedRange={selectedViewerRange}
          />
        ) : null}

        {diffLoading && diff && (
          <div className="diff-refresh-indicator" role="status">
            <LoaderCircle className="spinner" size={14} />
            <span>Refreshing diff…</span>
          </div>
        )}

        {selectedLineRange && !commentComposerOpen && (
          <div className="selection-banner" role="status">
            <div className="selection-copy">
              {selectedLineRange.side === "mixed" &&
              selectedLineRange.oldStartLine !== undefined &&
              selectedLineRange.oldEndLine !== undefined &&
              selectedLineRange.newStartLine !== undefined &&
              selectedLineRange.newEndLine !== undefined
                ? `Old lines ${selectedLineRange.oldStartLine}${selectedLineRange.oldEndLine === selectedLineRange.oldStartLine ? "" : `–${selectedLineRange.oldEndLine}`} / new lines ${selectedLineRange.newStartLine}${selectedLineRange.newEndLine === selectedLineRange.newStartLine ? "" : `–${selectedLineRange.newEndLine}`}`
                : `${selectedLineRange.side === "old" ? "Old" : "New"} lines ${selectedLineRange.start}${selectedLineRange.end === selectedLineRange.start ? "" : `–${selectedLineRange.end}`}`}
            </div>
            <div className="selection-actions">
              <button
                className="text-button"
                onClick={() => setSelection(null)}
                type="button"
              >
                Clear
              </button>
              <button className="text-button" onClick={openCommentComposer} type="button">
                <MessageSquareText size={14} /> Comment
              </button>
            </div>
          </div>
        )}
      </section>

      <nav className="bottom-bar" aria-label="Review actions">
        <div className="nav-pair file-nav" aria-label="File navigation">
          <button
            aria-label="Previous file"
            className="icon-button"
            disabled={activeFileIndex <= 0}
            onClick={() => navigateFile(-1)}
            type="button"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            aria-label="Next file"
            className="icon-button"
            disabled={activeFileIndex < 0 || activeFileIndex >= files.length - 1}
            onClick={() => navigateFile(1)}
            type="button"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="nav-pair hunk-nav" aria-label="Hunk navigation">
          <button
            aria-label="Previous hunk"
            className="icon-button"
            disabled={!canNavigatePreviousHunk}
            onClick={() => navigateHunk(-1)}
            title="Previous hunk (K)"
            type="button"
          >
            <ChevronUp size={18} />
          </button>
          <button
            aria-label="Next hunk"
            className="icon-button"
            disabled={!canNavigateNextHunk}
            onClick={() => navigateHunk(1)}
            title="Next hunk (J)"
            type="button"
          >
            <ChevronDown size={18} />
          </button>
        </div>
        <button
          aria-label={activeFile?.reviewed ? "Unreview current file" : compactLandscape ? "Review current file" : "Review + next"}
          className={`action-button review-action ${activeFile?.reviewed ? "success" : ""}`}
          disabled={!activeFile || reviewBusy}
          onClick={() => activeFile && void setReviewed(activeFile, !activeFile.reviewed, !compactLandscape)}
          title={compactLandscape ? "Toggle reviewed" : "Mark reviewed and advance"}
          type="button"
        >
          {reviewBusy ? (
            <LoaderCircle className="spinner" size={16} />
          ) : activeFile?.reviewed ? (
            <Undo2 size={16} />
          ) : (
            <Check size={16} />
          )}
          <span className="action-copy">
            {activeFile?.reviewed ? "Unreview" : compactLandscape ? "Review" : "Review + next"}
          </span>
        </button>
        <button
          aria-label={activeFileFullyStaged ? "Unstage current file" : "Stage current file"}
          className="icon-button stage-action"
          disabled={!activeFile || stageBusy || bulkStageBusy !== null}
          onClick={() => void toggleStageActiveFile()}
          title={activeFileFullyStaged ? "Unstage file" : "Stage file"}
          type="button"
        >
          {stageBusy || bulkStageBusy ? (
            <LoaderCircle className="spinner" size={19} />
          ) : (
            <GitPullRequestArrow color={activeFile?.staged ? "var(--accent)" : undefined} size={19} />
          )}
          <span className="stage-copy">{activeFileFullyStaged ? "Unstage" : "Stage"}</span>
        </button>
        <button
          aria-label={`Open comments (${comments.length})`}
          className="icon-button comments-action"
          onClick={() => {
            setFocusedCommentId(null);
            setCommentTrayOpen(true);
          }}
          title="Review comments"
          type="button"
        >
          <MessageSquareText size={19} />
          {comments.length > 0 && <span className="badge">{comments.length}</span>}
        </button>
      </nav>

      {repositoryPickerOpen && (
        <>
          <button
            aria-label="Close repository picker"
            className="sheet-scrim"
            onClick={() => setRepositoryPickerOpen(false)}
            type="button"
          />
          <section
            aria-label="Repositories"
            aria-modal="true"
            className="bottom-sheet repository-picker"
            role="dialog"
          >
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">Repositories</h2>
                <div className="repo-meta">Switch projects without restarting the server</div>
              </div>
              <button
                aria-label="Close repository picker"
                className="icon-button"
                onClick={() => setRepositoryPickerOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div className="repository-list">
              {bootstrap?.repositories.length ? (
                bootstrap.repositories.map((entry) => (
                  <div
                    className={`repository-row ${entry.id === repositoryId ? "current" : ""} ${entry.available ? "" : "unavailable"}`}
                    key={entry.id}
                  >
                    <button
                      aria-current={entry.id === repositoryId ? "true" : undefined}
                      className="repository-select"
                      disabled={!entry.available}
                      onClick={() => selectRepository(entry)}
                      type="button"
                    >
                      <span className="repository-row-name">
                        {entry.name}
                        {entry.id === repositoryId && <Check size={14} />}
                      </span>
                      <span className="repository-row-path">{entry.root}</span>
                      {!entry.available && (
                        <span className="repository-row-status">Unavailable</span>
                      )}
                    </button>
                    <button
                      aria-label={`Forget ${entry.name}`}
                      className="icon-button repository-forget"
                      disabled={forgetRepositoryBusy !== null}
                      onClick={() => void forgetSavedRepository(entry)}
                      title="Forget repository and delete its saved review state"
                      type="button"
                    >
                      {forgetRepositoryBusy === entry.id ? (
                        <LoaderCircle className="spinner" size={16} />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state" style={{ minHeight: 150 }}>
                  <FileCode2 className="state-icon" size={26} />
                  <p className="state-copy">No saved repositories.</p>
                </div>
              )}
            </div>
            <footer className="sheet-footer">
              {bootstrap?.restart && (
                <>
                  <button
                    className="action-button secondary repository-restart-action"
                    disabled={!bootstrap.restart.available || restartPhase !== null}
                    onClick={() => void rebuildAndRestart()}
                    type="button"
                  >
                    {restartPhase === "building" ? (
                      <LoaderCircle className="spinner" size={16} />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Rebuild &amp; restart Couchview
                  </button>
                  <div className="progress-label">
                    {bootstrap.restart.available
                      ? "Builds this Couchview checkout, then reloads the current review."
                      : bootstrap.restart.reason}
                  </div>
                </>
              )}
              {repositoryId && repository && (
                <button
                  className="action-button secondary repository-remote-action"
                  onClick={() => {
                    setRepositoryPickerOpen(false);
                    setRemoteBridgeOpen(true);
                  }}
                  type="button"
                >
                  <MonitorUp size={16} /> Native IDE setup
                </button>
              )}
              <div className="progress-label">
                Run <code>couchview</code> inside another Git project to add it.
              </div>
            </footer>
          </section>
        </>
      )}

      {bootstrap && repositoryId && repository && (
        <RemoteBridgeSheet
          capability={remoteBridgeCapability}
          csrfToken={bootstrap.csrfToken}
          onClose={() => setRemoteBridgeOpen(false)}
          onNotice={showToast}
          open={remoteBridgeOpen}
          repositoryId={repositoryId}
          repositoryName={repository.name}
          repositoryRoot={repository.root}
        />
      )}

      {searchOpen && (
        <>
          <button
            aria-label="Close search"
            className="sheet-scrim"
            onClick={() => setSearchOpen(false)}
            type="button"
          />
          <section aria-label="Project search" aria-modal="true" className="bottom-sheet" role="dialog">
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">Find in project</h2>
                <div className="repo-meta">Click any code word to search</div>
              </div>
              <button
                aria-label="Close search"
                className="icon-button"
                onClick={() => setSearchOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div className="search-form">
              <label className="sr-only" htmlFor="project-search">
                Search project
              </label>
              <input
                className="search-input"
                id="project-search"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSourcePreview(null);
                }}
                ref={searchInputRef}
                spellCheck={false}
                type="search"
                value={searchQuery}
              />
              <div className="segmented">
                <button
                  className={searchScope === "current" ? "active" : ""}
                  onClick={() => {
                    setSearchScope("current");
                    setSourcePreview(null);
                  }}
                  type="button"
                >
                  Current file ({searchResult?.currentFile.length ?? 0})
                </button>
                <button
                  className={searchScope === "other" ? "active" : ""}
                  onClick={() => {
                    setSearchScope("other");
                    setSourcePreview(null);
                  }}
                  type="button"
                >
                  Other files ({searchResult?.otherFiles.length ?? 0})
                </button>
              </div>
            </div>
            {sourcePreview ? (
              <div className="source-preview">
                <div className="source-path">{sourcePreview.path}</div>
                {sourcePreview.lines.map((line) => (
                  <div
                    className={`source-line ${line.line === sourcePreview.focusLine ? "active" : ""}`}
                    key={line.line}
                  >
                    <span className="source-number">{line.line}</span>
                    <code className="source-code">
                      {highlightMatch(line.text, searchQuery)}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <div className="search-results">
                {searchBusy || sourceBusy ? (
                  <div className="loading-state" style={{ minHeight: 140 }}>
                    <LoaderCircle className="state-icon spinner" size={23} />
                  </div>
                ) : searchQuery.trim().length < 1 ? (
                  <div className="empty-state" style={{ minHeight: 140 }}>
                    <Search className="state-icon" size={24} />
                    <p className="state-copy">Enter a search term.</p>
                  </div>
                ) : activeSearchMatches?.length ? (
                  activeSearchMatches.map((match) => (
                    <button
                      className="search-result"
                      key={`${match.path}:${match.line}:${match.column}`}
                      onClick={() => void showSource(match)}
                      type="button"
                    >
                      <div className="result-path">
                        {match.path}:{match.line}:{match.column}
                      </div>
                      <div className="result-preview">
                        {highlightMatch(match.preview, searchQuery)}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="empty-state" style={{ minHeight: 140 }}>
                    <Search className="state-icon" size={24} />
                    <p className="state-copy">No matches in this scope.</p>
                  </div>
                )}
              </div>
            )}
            <footer className="sheet-footer">
              {sourcePreview ? (
                <button
                  className="action-button secondary"
                  onClick={() => setSourcePreview(null)}
                  style={{ width: "100%" }}
                  type="button"
                >
                  <ChevronLeft size={16} /> Back to results
                </button>
              ) : (
                <div className="progress-label">
                  {searchResult?.truncated ? "Showing the first matches" : "Searches tracked project files"}
                </div>
              )}
            </footer>
          </section>
        </>
      )}

      {commentComposerOpen && (
        <>
          <button
            aria-label="Close comment editor"
            className="sheet-scrim"
            onClick={() => setCommentComposerOpen(false)}
            type="button"
          />
          <form
            aria-label={editingComment ? "Edit review comment" : "Add review comment"}
            aria-modal="true"
            className="bottom-sheet"
            onSubmit={(event) => void saveComment(event)}
            role="dialog"
          >
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">
                  {editingComment ? "Edit comment" : "Add review comment"}
                </h2>
                <div className="repo-meta">
                  {editingComment
                    ? formatCommentReference(editingComment)
                    : selectedLineRange && activeFile
                      ? formatSelectionReference(activeFile.path, selectedLineRange)
                      : "Selected lines"}
                </div>
              </div>
              <button
                aria-label="Close comment editor"
                className="icon-button"
                onClick={() => setCommentComposerOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div style={{ minHeight: 0, overflow: "auto", padding: 9 }}>
              <textarea
                autoFocus
                className="comment-input"
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="Describe the issue and the expected correction…"
                value={commentBody}
              />
            </div>
            <div />
            <footer className="sheet-footer">
              <button
                className="action-button"
                disabled={!commentBody.trim() || commentBusy}
                style={{ width: "100%" }}
                type="submit"
              >
                {commentBusy ? <LoaderCircle className="spinner" size={16} /> : <Check size={16} />}
                {editingComment ? "Save comment" : "Add comment"}
              </button>
            </footer>
          </form>
        </>
      )}

      {commitComposerOpen && (
        <>
          <button
            aria-label="Close commit editor"
            className="sheet-scrim"
            onClick={closeCommitComposer}
            type="button"
          />
          <form
            aria-label="Commit staged changes"
            aria-modal="true"
            className="bottom-sheet"
            onSubmit={(event) => void commitStagedChanges(event)}
            role="dialog"
          >
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">Commit staged changes</h2>
                <div className="repo-meta">
                  {stagedCount} staged {stagedCount === 1 ? "file" : "files"} · unstaged edits stay local
                </div>
              </div>
              <button
                aria-label="Close commit editor"
                className="icon-button"
                onClick={closeCommitComposer}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div style={{ minHeight: 0, overflow: "auto", padding: 9 }}>
              <textarea
                autoFocus
                className="comment-input commit-input"
                maxLength={20_000}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message…"
                readOnly={commitMessageBusy}
                value={commitMessage}
              />
            </div>
            <div />
            <footer className="sheet-footer commit-footer">
              <div className="commit-actions">
                <button
                  className="action-button secondary"
                  disabled={
                    !commitMessageCapability.available ||
                    commitMessageBusy ||
                    commitBusy ||
                    stagedCount === 0
                  }
                  onClick={() => void generateCommitMessage()}
                  title={commitMessageCapability.reason ?? undefined}
                  type="button"
                >
                  {commitMessageBusy ? (
                    <LoaderCircle className="spinner" size={16} />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {commitMessageBusy
                    ? "Generating…"
                    : commitMessage.trim()
                      ? "Regenerate with Codex"
                      : "Generate with Codex"}
                </button>
                <button
                  className="action-button"
                  disabled={
                    !commitMessage.trim() ||
                    commitBusy ||
                    commitMessageBusy
                  }
                  type="submit"
                >
                  {commitBusy ? (
                    <LoaderCircle className="spinner" size={16} />
                  ) : (
                    <GitCommitHorizontal size={16} />
                  )}
                  Commit staged changes
                </button>
              </div>
              <div className="progress-label commit-generation-copy">
                {commitMessageCapability.available
                  ? commitMessageBusy
                    ? "Generating a one-line Conventional Commit from staged changes…"
                    : "Only staged changes are sent to Codex. Committing remains a separate action."
                  : commitMessageCapability.reason}
              </div>
            </footer>
          </form>
        </>
      )}

      {selectedPackageRunId && selectedPackageRun && (
        <>
          <button
            aria-label="Close package command output"
            className="sheet-scrim"
            onClick={() => setSelectedPackageRunId(null)}
            type="button"
          />
          <section
            aria-label="Package command output"
            aria-modal="true"
            className="bottom-sheet package-run-sheet"
            role="dialog"
          >
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">
                  {selectedPackageRun.packageName ?? selectedPackageRun.directory}
                  <span className="command-title-separator"> / </span>
                  {selectedPackageRun.scriptName}
                </h2>
                <div className="repo-meta package-run-meta">
                  <span className={`run-status ${selectedPackageRun.status}`}>
                    {runStatusLabel(selectedPackageRun.status)}
                  </span>
                  <span>{runElapsed(selectedPackageRun, runClock)}</span>
                  {selectedPackageRun.exitCode !== null && (
                    <span>exit {selectedPackageRun.exitCode}</span>
                  )}
                </div>
              </div>
              <button
                aria-label="Close package command output"
                className="icon-button"
                onClick={() => setSelectedPackageRunId(null)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div className="package-run-context">
              <div>
                <span>Working directory</span>
                <code>
                  {selectedPackageRun.directory === "."
                    ? repository?.root
                    : `${repository?.root}/${selectedPackageRun.directory}`}
                </code>
              </div>
              <div>
                <span>Invocation</span>
                <code>{selectedPackageRun.invocation}</code>
              </div>
              <div>
                <span>package.json script</span>
                <code>{selectedPackageRun.command}</code>
              </div>
            </div>
            <pre className="package-output" ref={packageOutputRef}>
              {selectedPackageRun.outputTruncated && (
                <span className="package-output-notice">
                  [Earlier output was truncated.]
                  {"\n"}
                </span>
              )}
              {packageRunSnapshot?.output.length ? (
                packageRunSnapshot.output.map((chunk) => (
                  <span className={`package-output-${chunk.stream}`} key={chunk.sequence}>
                    {chunk.text}
                  </span>
                ))
              ) : (
                <span className="package-output-empty">
                  {["running", "stopping"].includes(selectedPackageRun.status)
                    ? "Waiting for output…"
                    : "The command produced no output."}
                </span>
              )}
            </pre>
            <footer className="sheet-footer package-run-actions">
              <button
                className="action-button secondary"
                onClick={() => setSelectedPackageRunId(null)}
                type="button"
              >
                Close
              </button>
              {["running", "stopping"].includes(selectedPackageRun.status) && (
                <button
                  className="action-button danger-action"
                  disabled={
                    selectedPackageRun.status === "stopping" ||
                    packageRunBusy === selectedPackageRun.id
                  }
                  onClick={() => void stopPackageRun()}
                  type="button"
                >
                  {packageRunBusy === selectedPackageRun.id ? (
                    <LoaderCircle className="spinner" size={16} />
                  ) : (
                    <Square size={14} />
                  )}
                  {selectedPackageRun.status === "stopping" ? "Stopping…" : "Stop"}
                </button>
              )}
            </footer>
          </section>
        </>
      )}

      {commentTrayOpen && (
        <>
          <button
            aria-label="Close comment tray"
            className="sheet-scrim"
            onClick={() => setCommentTrayOpen(false)}
            type="button"
          />
          <section aria-label="Review comments" aria-modal="true" className="bottom-sheet" role="dialog">
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">Review comments</h2>
                <div className="repo-meta">
                  {activeComments.length} on this file · {comments.length} total
                </div>
              </div>
              <button
                aria-label="Close comment tray"
                className="icon-button"
                onClick={() => setCommentTrayOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div className="filter-area">
              <div className="progress-label" style={{ marginTop: 0, textAlign: "left" }}>
                Current comments from every file are copied together; stale comments stay visible but
                are excluded.
              </div>
            </div>
            <div className="comment-list">
              {comments.length === 0 ? (
                <div className="empty-state" style={{ minHeight: 170 }}>
                  <MessageSquareText className="state-icon" size={26} />
                  <p className="state-copy">
                    Tap a line number, then another, to select a range and add a comment.
                  </p>
                </div>
              ) : (
                comments.map((comment) => (
                  <article
                    className={`comment-card ${focusedCommentId === comment.id ? "focused" : ""}`}
                    data-comment-id={comment.id}
                    key={comment.id}
                    tabIndex={-1}
                  >
                    <button
                      className="text-button"
                      disabled={comment.stale}
                      onClick={() => jumpToComment(comment)}
                      style={{ minHeight: 0, padding: 0 }}
                      type="button"
                    >
                      <span className="comment-reference">
                        {formatCommentReference(comment)} {comment.stale ? "· stale" : ""}
                      </span>
                    </button>
                    <p className="comment-body">{comment.body}</p>
                    <div className="comment-actions">
                      <button
                        aria-label={`Edit comment at ${formatCommentReference(comment)}`}
                        className="text-button"
                        onClick={() => editComment(comment)}
                        type="button"
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        aria-label={`Delete comment at ${formatCommentReference(comment)}`}
                        className="text-button danger"
                        onClick={() => void deleteComment(comment)}
                        type="button"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
            <footer className="sheet-footer">
              <button
                className="action-button"
                disabled={currentCommentCount === 0}
                onClick={() => void copyComments()}
                style={{ width: "100%" }}
                type="button"
              >
                <Copy size={16} /> Copy {currentCommentCount || "current"} for Codex
              </button>
              <button
                className="action-button secondary"
                onClick={() => {
                  setCommentTrayOpen(false);
                  setCodexPanelOpen(true);
                }}
                title={codexCapability.reason ?? undefined}
                style={{ width: "100%" }}
                type="button"
              >
                <Send size={16} /> Send to Codex
              </button>
            </footer>
          </section>
        </>
      )}

      {codexPanelOpen && repositoryId && bootstrap && (
        <CodexCommentsPanel
          capability={codexCapability}
          csrfToken={bootstrap.csrfToken}
          currentCommentCount={currentCommentCount}
          onClose={() => setCodexPanelOpen(false)}
          repositoryId={repositoryId}
          showToast={showToast}
        />
      )}

      {failureDetailsOpen && failure && (
        <>
          <button
            aria-label="Close error details"
            className="modal-scrim"
            onClick={() => setFailureDetailsOpen(false)}
            type="button"
          />
          <section
            aria-label="Git error details"
            aria-modal="true"
            className="bottom-sheet diagnostic-sheet"
            role="dialog"
          >
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">Error details</h2>
                <div className="repo-meta">
                  {failure.context} · {failure.code}
                </div>
              </div>
              <button
                aria-label="Close error details"
                className="icon-button"
                onClick={() => setFailureDetailsOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div className="diagnostic-content">
              <p className="diagnostic-message">{failure.message}</p>
              <dl className="diagnostic-grid">
                <div>
                  <dt>HTTP status</dt>
                  <dd>{failure.status ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Error code</dt>
                  <dd>{failure.code}</dd>
                </div>
                {failure.diagnostic && (
                  <>
                    <div>
                      <dt>Diagnostic ID</dt>
                      <dd>{failure.diagnostic.id}</dd>
                    </div>
                    <div>
                      <dt>Git operation</dt>
                      <dd>{failure.diagnostic.operation}</dd>
                    </div>
                    <div>
                      <dt>Failure kind</dt>
                      <dd>{failure.diagnostic.kind}</dd>
                    </div>
                    <div>
                      <dt>Exit code</dt>
                      <dd>{failure.diagnostic.exitCode ?? "Not available"}</dd>
                    </div>
                  </>
                )}
              </dl>
              {failure.diagnostic && (
                <>
                  <h3 className="diagnostic-subtitle">Git output</h3>
                  <pre className="diagnostic-output">
                    {failure.diagnostic.stderr || "Git returned no stderr output."}
                  </pre>
                </>
              )}
            </div>
            <footer className="sheet-footer diagnostic-actions">
              <button
                className="action-button secondary"
                onClick={() => setFailureDetailsOpen(false)}
                type="button"
              >
                Close
              </button>
              <button
                className="action-button"
                onClick={() => void copyFailureDiagnostics()}
                type="button"
              >
                <Copy size={15} /> Copy diagnostics
              </button>
            </footer>
          </section>
        </>
      )}

      {copyFallbackText && (
        <>
          <button
            aria-label="Close manual copy dialog"
            className="modal-scrim"
            onClick={() => setCopyFallbackText("")}
            type="button"
          />
          <section
            aria-label="Copy comments manually"
            aria-modal="true"
            className="bottom-sheet copy-sheet"
            role="dialog"
          >
            <span className="sheet-grabber" />
            <header className="sheet-header">
              <div>
                <h2 className="sheet-title">Copy comments manually</h2>
                <div className="repo-meta">Select the text and copy it into Codex.</div>
              </div>
              <button
                aria-label="Close manual copy dialog"
                className="icon-button"
                onClick={() => setCopyFallbackText("")}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div className="copy-field-wrap">
              <textarea
                autoFocus
                className="copy-field"
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                rows={14}
                value={copyFallbackText}
              />
            </div>
          </section>
        </>
      )}

      <div className="toast-stack" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.undo && (
              <button className="text-button" onClick={() => void undoReview(toast.undo!)} type="button">
                Undo
              </button>
            )}
            {toast.details && failure && (
              <button
                className="text-button"
                onClick={() => {
                  setToast(null);
                  setFailureDetailsOpen(true);
                }}
                type="button"
              >
                Details
              </button>
            )}
          </div>
        )}
        {pwaRefreshToast}
        {pwa.canInstall && (
          <div className="toast">
            <span>Install Couchview for full-screen access.</span>
            <span>
              <button className="text-button" onClick={pwa.dismissInstall} type="button">
                Not now
              </button>
              <button className="text-button" onClick={() => void pwa.install()} type="button">
                Install
              </button>
            </span>
          </div>
        )}
        {pwa.iosInstallHint && !pwa.canInstall && (
          <div className="toast">
            <span>Install via Share → Add to Home Screen.</span>
            <button className="text-button" onClick={pwa.dismissInstall} type="button">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {restartPhase && (
        <div aria-live="assertive" className="restart-overlay" role="status">
          <LoaderCircle className="spinner" size={30} />
          <h2 className="state-title">
            {restartPhase === "building"
              ? "Building Couchview…"
              : restartPhase === "restarting"
                ? "Restarting Couchview…"
                : "Loading the new build…"}
          </h2>
          <p className="state-copy">
            Keep this page open. Your repository selection and review state will be restored.
          </p>
        </div>
      )}
      </main>
    </>
  );
}
