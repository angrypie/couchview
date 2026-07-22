import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SelectedLineRange } from "@pierre/diffs";
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
  GitPullRequestArrow,
  ListFilter,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  WifiOff,
  WrapText,
  X,
} from "lucide-react";
import {
  API_ROUTES,
  type BootstrapResponse,
  type ChangeFile,
  type DiffHunk,
  type DiffLine,
  type DiffSide,
  type FileDiff,
  type ReviewComment,
  type SearchMatch,
  type SearchResponse,
  type ServerEvent,
  type SourcePreviewResponse,
} from "../shared/contracts.ts";
import { ApiError, api } from "./api.ts";
import {
  exportCommentsForCodex,
  formatCommentReference,
} from "./commentExport.ts";
import { usePwaUpdate } from "./usePwaUpdate.ts";
import {
  DiffViewer,
  type DiffViewerHandle,
} from "./DiffViewer.tsx";
import { selectedRangeFromEndpoints } from "./diffAdapter.ts";

type AppPhase = "loading" | "ready" | "error";
type ReviewFilter = "all" | "unreviewed" | "reviewed";
type StageFilter = "all" | "unstaged" | "staged";
type SearchScope = "current" | "other";

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

interface UndoReview {
  fileId: string;
  contentRevision: string;
  reviewed: boolean;
}

interface ToastState {
  id: number;
  message: string;
  undo?: UndoReview;
}

const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 16;
const DEFAULT_FONT_SIZE = 11;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
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

function useStoredNumber(key: string, fallback: number): [number, (value: number) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      const parsed = stored ? Number(stored) : Number.NaN;
      return Number.isFinite(parsed)
        ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, parsed))
        : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: number) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Font resizing still works when persistent storage is unavailable.
      }
    },
    [key],
  );

  return [value, update];
}

function useStoredBoolean(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
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
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [files, setFiles] = useState<ChangeFile[]>([]);
  const [operationRevision, setOperationRevision] = useState("");
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loadError, setLoadError] = useState("");
  const [diffError, setDiffError] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [fontSize, setFontSize] = useStoredNumber(
    "couch-review:font-size",
    DEFAULT_FONT_SIZE,
  );
  const [lineNumbersVisible, setLineNumbersVisible] = useStoredBoolean(
    "couch-review:line-numbers",
    false,
  );
  const [lineWrapEnabled, setLineWrapEnabled] = useStoredBoolean(
    "couch-review:line-wrap",
    false,
  );
  const [currentHunk, setCurrentHunk] = useState(0);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [commentTrayOpen, setCommentTrayOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [editingComment, setEditingComment] = useState<ReviewComment | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("current");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewResponse | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [copyFallbackText, setCopyFallbackText] = useState("");
  const [pendingCommentJump, setPendingCommentJump] = useState<ReviewComment | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);

  const desktop = useMediaQuery("(min-width: 760px) and (min-height: 600px)");
  const landscape = useMediaQuery("(orientation: landscape) and (max-height: 599px)");
  const compactLandscape = landscape && !desktop;
  const diffViewerRef = useRef<DiffViewerHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toastCounter = useRef(0);
  const currentFileIdRef = useRef<string | null>(null);
  const diffRequestRef = useRef<{ generation: number; controller: AbortController } | null>(
    null,
  );
  const sourceRequestRef = useRef<{ generation: number; controller: AbortController } | null>(
    null,
  );
  const pwa = usePwaUpdate();

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

  const showToast = useCallback((message: string, undo?: UndoReview) => {
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, message, undo });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const loadDiff = useCallback(
    async (fileId: string, resetPosition = false) => {
      diffRequestRef.current?.controller.abort();
      const generation = (diffRequestRef.current?.generation ?? 0) + 1;
      const controller = new AbortController();
      diffRequestRef.current = { generation, controller };
      setDiffLoading(true);
      setDiffError("");
      try {
        const response = await api.diff(fileId, controller.signal);
        if (
          diffRequestRef.current?.generation !== generation ||
          currentFileIdRef.current !== fileId ||
          response.diff.fileId !== fileId
        ) {
          return;
        }
        if (resetPosition) {
          setSelection(null);
          setCurrentHunk(0);
        }
        setDiff(response.diff);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (diffRequestRef.current?.generation === generation) {
          setDiffError(messageOf(error));
        }
      } finally {
        if (diffRequestRef.current?.generation === generation) {
          setDiffLoading(false);
        }
      }
    },
    [],
  );

  const refreshChanges = useCallback(async () => {
    const response = await api.changes();
    setFiles(response.files);
    setOperationRevision(response.operationRevision);
    setBootstrap((current) =>
      current
        ? {
            ...current,
            repository: response.repository,
            operationRevision: response.operationRevision,
          }
        : current,
    );
    setCurrentFileId((current) => {
      if (current && response.files.some((file) => file.id === current)) return current;
      return (
        response.files.find((file) => !file.reviewed)?.id ?? response.files[0]?.id ?? null
      );
    });
    return response;
  }, []);

  const refreshReviewState = useCallback(async () => {
    const response = await api.reviews();
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

  const loadApp = useCallback(async () => {
    setPhase("loading");
    setLoadError("");
    try {
      const [nextBootstrap, changes, reviewState] = await Promise.all([
        api.bootstrap(),
        api.changes(),
        api.reviews(),
      ]);
      setBootstrap({
        ...nextBootstrap,
        repository: changes.repository,
        operationRevision: changes.operationRevision,
      });
      setFiles(changes.files);
      setOperationRevision(changes.operationRevision);
      setComments(reviewState.comments);
      setCurrentFileId((current) =>
        current && changes.files.some((file) => file.id === current)
          ? current
          : (changes.files.find((file) => !file.reviewed)?.id ??
            changes.files[0]?.id ??
            null),
      );
      setConnected(true);
      setPhase("ready");
    } catch (error) {
      setLoadError(messageOf(error));
      setConnected(!(error instanceof ApiError && error.status === 0));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void loadApp();
  }, [loadApp]);

  useEffect(() => {
    currentFileIdRef.current = currentFileId;
  }, [currentFileId]);

  useEffect(() => {
    if (phase !== "ready") return;
    const stream = new EventSource(API_ROUTES.events);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (message) => {
      setConnected(true);
      try {
        const event = JSON.parse(message.data) as ServerEvent;
        if (event.type === "changes" || event.type === "ready") {
          const fileId = currentFileIdRef.current;
          void (event.type === "ready" ? api.bootstrap() : Promise.resolve(null))
            .then((nextBootstrap) => {
              if (nextBootstrap) setBootstrap(nextBootstrap);
              return refreshChanges();
            })
            .then(async (response) => {
              await refreshReviewState();
              if (!fileId || !response.files.some((file) => file.id === fileId)) return;
              await loadDiff(fileId, true);
            })
            .catch(() => setConnected(false));
        }
        if (event.type === "comments" || event.type === "reviews") {
          void refreshReviewState().catch(() => setConnected(false));
        }
      } catch {
        // Ignore malformed keep-alives while leaving the stream connected.
      }
    };
    return () => stream.close();
  }, [loadDiff, phase, refreshChanges, refreshReviewState]);

  useEffect(() => {
    setSelection(null);
    setCurrentHunk(0);
    setDiff(null);
    setDiffError("");
    if (!currentFileId) {
      diffRequestRef.current?.controller.abort();
      setDiffLoading(false);
      return;
    }
    void loadDiff(currentFileId);
    return () => {
      if (currentFileIdRef.current !== currentFileId) {
        diffRequestRef.current?.controller.abort();
      }
    };
  }, [currentFileId, loadDiff]);

  useEffect(() => {
    document.documentElement.style.setProperty("--code-size", `${fontSize}px`);
  }, [fontSize]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 1 || !activeFile) {
      setSearchResult(null);
      setSearchBusy(false);
      return;
    }
    setSearchResult(null);
    const query = searchQuery.trim();
    const currentPath = activeFile.path;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchBusy(true);
      void api
        .search(query, currentPath, controller.signal)
        .then((response) => {
          if (
            !controller.signal.aborted &&
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
    };
  }, [activeFile, searchOpen, searchQuery, showToast]);

  const selectFile = useCallback((fileId: string) => {
    setCurrentFileId(fileId);
    setDrawerOpen(false);
    setCommentTrayOpen(false);
    diffViewerRef.current?.scrollToTop();
  }, []);

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
      if (hunkCount === 0) return;
      const nextHunk = Math.min(
        hunkCount - 1,
        Math.max(0, currentHunk + direction),
      );
      setCurrentHunk(nextHunk);
      diffViewerRef.current?.scrollToHunk(nextHunk);
    },
    [currentHunk, diff],
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
      const row = rows.find(
        (candidate): candidate is LineRow =>
          candidate.type === "line" &&
          candidate.line.kind !== "metadata" &&
          sideLine(candidate.line, side) === lineNumber,
      );
      if (row) setCurrentHunk(row.hunkIndex);
    },
    [rows],
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
      if (!bootstrap || reviewBusy) return;
      setReviewBusy(true);
      const previous = file.reviewed;
      setFiles((current) =>
        current.map((item) => (item.id === file.id ? { ...item, reviewed } : item)),
      );
      try {
        await api.setReviewed(
          { fileId: file.id, contentRevision: file.contentRevision, reviewed },
          bootstrap.csrfToken,
        );
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
        setFiles((current) =>
          current.map((item) =>
            item.id === file.id ? { ...item, reviewed: previous } : item,
          ),
        );
        showToast(messageOf(error));
      } finally {
        setReviewBusy(false);
      }
    },
    [activeFileIndex, bootstrap, files, reviewBusy, selectFile, showToast],
  );

  const undoReview = useCallback(
    async (undo: UndoReview) => {
      if (!bootstrap) return;
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
          {
            fileId: undo.fileId,
            contentRevision: undo.contentRevision,
            reviewed: undo.reviewed,
          },
          bootstrap.csrfToken,
        );
      } catch (error) {
        void refreshReviewState();
        showToast(messageOf(error));
      }
    },
    [bootstrap, files, refreshReviewState, showToast],
  );

  const toggleStageActiveFile = useCallback(async () => {
    if (!activeFile || !bootstrap || stageBusy) return;
    const shouldStage = !activeFile.staged || activeFile.unstaged;
    setStageBusy(true);
    try {
      const response = await api.stage(
        {
          fileId: activeFile.id,
          operationRevision,
          contentRevision: activeFile.contentRevision,
          staged: shouldStage,
        },
        bootstrap.csrfToken,
      );
      setOperationRevision(response.operationRevision);
      await refreshChanges();
      if (currentFileIdRef.current === activeFile.id) {
        await loadDiff(activeFile.id);
      }
      showToast(shouldStage ? "File staged" : "File unstaged");
    } catch (error) {
      showToast(messageOf(error));
      if (error instanceof ApiError && error.status === 409) void refreshChanges();
    } finally {
      setStageBusy(false);
    }
  }, [
    activeFile,
    bootstrap,
    loadDiff,
    operationRevision,
    refreshChanges,
    showToast,
    stageBusy,
  ]);

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
      if (!body || !bootstrap || commentBusy) return;
      setCommentBusy(true);
      try {
        if (editingComment) {
          const response = await api.updateComment(
            { id: editingComment.id, body },
            bootstrap.csrfToken,
          );
          setComments((current) =>
            current.map((comment) =>
              comment.id === response.comment.id ? response.comment : comment,
            ),
          );
          showToast("Comment updated");
        } else if (activeFile && selectedLineRange?.hunk) {
          const response = await api.createComment(
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
          );
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
        showToast(messageOf(error));
      } finally {
        setCommentBusy(false);
      }
    },
    [
      activeFile,
      bootstrap,
      commentBody,
      commentBusy,
      editingComment,
      refreshReviewState,
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
        !window.confirm(`Delete comment at ${formatCommentReference(comment)}?`)
      ) {
        return;
      }
      try {
        await api.deleteComment({ id: comment.id }, bootstrap.csrfToken);
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
        showToast(messageOf(error));
      }
    },
    [bootstrap, showToast],
  );

  const copyComments = useCallback(async () => {
    let currentComments: ReviewComment[];
    try {
      const reviewState = await refreshReviewState();
      currentComments = reviewState.comments.filter((comment) => !comment.stale);
    } catch (error) {
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

  const showSource = useCallback(
    async (match: SearchMatch) => {
      sourceRequestRef.current?.controller.abort();
      const generation = (sourceRequestRef.current?.generation ?? 0) + 1;
      const controller = new AbortController();
      sourceRequestRef.current = { generation, controller };
      setSourceBusy(true);
      try {
        const response = await api.source(match.path, match.line, controller.signal);
        if (
          sourceRequestRef.current?.generation === generation &&
          !controller.signal.aborted &&
          response.path === match.path
        ) {
          setSourcePreview(response);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          showToast(messageOf(error));
        }
      } finally {
        if (sourceRequestRef.current?.generation === generation) setSourceBusy(false);
      }
    },
    [showToast],
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const overlayOpen =
        searchOpen ||
        commentComposerOpen ||
        commentTrayOpen ||
        Boolean(copyFallbackText) ||
        (!desktop && drawerOpen);
      if (event.key === "Escape" && overlayOpen) {
        event.preventDefault();
        if (copyFallbackText) setCopyFallbackText("");
        else if (commentComposerOpen) setCommentComposerOpen(false);
        else if (commentTrayOpen) setCommentTrayOpen(false);
        else if (searchOpen) setSearchOpen(false);
        else setDrawerOpen(false);
        return;
      }
      if (overlayOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "]") navigateFile(1);
      if (event.key === "[") navigateFile(-1);
      if (event.key.toLocaleLowerCase() === "j") navigateHunk(1);
      if (event.key.toLocaleLowerCase() === "k") navigateHunk(-1);
      if (event.key.toLocaleLowerCase() === "r" && activeFile) {
        void setReviewed(activeFile, !activeFile.reviewed, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeFile,
    commentComposerOpen,
    commentTrayOpen,
    copyFallbackText,
    desktop,
    drawerOpen,
    navigateFile,
    navigateHunk,
    searchOpen,
    setReviewed,
  ]);

  const overlayVisible =
    searchOpen ||
    commentComposerOpen ||
    commentTrayOpen ||
    Boolean(copyFallbackText) ||
    (!desktop && drawerOpen);

  useEffect(() => {
    if (!overlayVisible) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlays = document.querySelectorAll<HTMLElement>('[role="dialog"], .drawer');
    const overlay = overlays.item(overlays.length - 1);
    if (!overlay) return;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
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
    commentComposerOpen,
    commentTrayOpen,
    copyFallbackText,
    desktop,
    drawerOpen,
    overlayVisible,
    searchOpen,
  ]);

  if (phase === "loading") {
    return (
      <main className={`app-shell ${compactLandscape ? "compact-landscape" : ""}`}>
        <div className="loading-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
          <LoaderCircle className="state-icon spinner" size={30} />
          <h1 className="state-title">Opening repository…</h1>
          <p className="state-copy">Reading changed files and restoring review notes.</p>
        </div>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className={`app-shell ${compactLandscape ? "compact-landscape" : ""}`}>
        <div className="error-state" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
          <AlertTriangle className="state-icon" size={32} />
          <h1 className="state-title">Couldn’t open Couch Review</h1>
          <p className="state-copy">{loadError}</p>
          <button className="action-button" onClick={() => void loadApp()} type="button">
            <RefreshCw size={16} /> Retry
          </button>
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
    <main className={`app-shell ${compactLandscape ? "compact-landscape" : ""}`}>
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
                <h2 className="drawer-title">Changed files</h2>
                <div className="repo-meta">{files.length} total</div>
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
            </div>

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

            <footer className="drawer-footer">
              <div className="progress-track" aria-hidden="true">
                <div
                  className="progress-value"
                  style={{ width: `${files.length ? (reviewedCount / files.length) * 100 : 0}%` }}
                />
              </div>
              <div className="progress-label">
                {reviewedCount} of {files.length} reviewed
              </div>
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
            <span
              className="compact-repo-name"
              title={`${bootstrap?.repository.name ?? "Couch Review"} · ${bootstrap?.repository.branch ?? "detached"}`}
            >
              {bootstrap?.repository.name ?? "Couch Review"}
            </span>
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
            <div className="repo-name">
              <span className={`connection-dot ${connected ? "" : "offline"}`} />
              <span>{bootstrap?.repository.name ?? "Couch Review"}</span>
            </div>
            <div className="repo-meta">
              <GitBranch size={10} />
              <span>{bootstrap?.repository.branch ?? "detached"}</span>
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
                disabled={currentHunk <= 0}
                onClick={() => navigateHunk(-1)}
                title="Previous hunk (K)"
                type="button"
              >
                <ChevronUp size={16} />
              </button>
              <button
                aria-label="Next hunk"
                className="icon-button"
                disabled={currentHunk >= (diff?.hunks.length ?? 0) - 1}
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
            disabled={fontSize <= MIN_FONT_SIZE}
            onClick={() => setFontSize(Math.max(MIN_FONT_SIZE, fontSize - 1))}
            type="button"
          >
            <Minus size={15} />
          </button>
          <span className="font-value">{fontSize}px</span>
          <button
            aria-label="Increase diff font size"
            className="icon-button compact-button"
            disabled={fontSize >= MAX_FONT_SIZE}
            onClick={() => setFontSize(Math.min(MAX_FONT_SIZE, fontSize + 1))}
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
      </section>}

      <section className="workspace" aria-label="Unified diff">
        {files.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 className="state-icon" color="var(--green)" size={34} />
            <h2 className="state-title">Working tree is clean</h2>
            <p className="state-copy">New changes will appear here automatically.</p>
          </div>
        ) : diffLoading ? (
          <div className="loading-state">
            <LoaderCircle className="state-icon spinner" size={27} />
            <p className="state-copy">Loading diff…</p>
          </div>
        ) : diffError ? (
          <div className="error-state">
            <AlertTriangle className="state-icon" size={28} />
            <h2 className="state-title">Couldn’t load this diff</h2>
            <p className="state-copy">{diffError}</p>
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
            fontSize={fontSize}
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
            disabled={currentHunk <= 0}
            onClick={() => navigateHunk(-1)}
            title="Previous hunk (K)"
            type="button"
          >
            <ChevronUp size={18} />
          </button>
          <button
            aria-label="Next hunk"
            className="icon-button"
            disabled={currentHunk >= (diff?.hunks.length ?? 0) - 1}
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
          disabled={!activeFile || stageBusy}
          onClick={() => void toggleStageActiveFile()}
          title={activeFileFullyStaged ? "Unstage file" : "Stage file"}
          type="button"
        >
          {stageBusy ? (
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
          </div>
        )}
        {pwa.needRefresh && (
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
        )}
        {pwa.offlineReady && (
          <div className="toast">
            <span>App shell is ready offline.</span>
            <button className="text-button" onClick={pwa.dismissOfflineReady} type="button">
              Dismiss
            </button>
          </div>
        )}
        {pwa.canInstall && (
          <div className="toast">
            <span>Install Couch Review for full-screen access.</span>
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
    </main>
  );
}
