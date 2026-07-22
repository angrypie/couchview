import {
  forwardRef,
  type CSSProperties,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewScrollTarget,
  type DiffLineAnnotation,
  type SelectedLineRange,
} from "@pierre/diffs/react";
import type {
  CodeViewLineSelection,
  CodeViewOptions,
} from "@pierre/diffs";
import { MessageSquareText } from "lucide-react";
import type {
  FileDiff,
  ReviewComment,
} from "../shared/contracts.ts";
import { formatCommentReference } from "./commentExport.ts";
import {
  adaptFileDiff,
  annotationsForFile,
  commentAnnotation,
  commentAnnotationsVersion,
  fromPierreSide,
  reconstructUnifiedPatch,
  toPierreSide,
  type CommentAnnotationMetadata,
} from "./diffAdapter.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$-]*$/;

const PIERRE_UNSAFE_CSS = `
:host {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  --diffs-bg: var(--viewer-bg, #0d1014);
  --diffs-dark-bg: var(--viewer-bg, #0d1014);
  --diffs-dark: var(--viewer-text, #e7edf5);
  --diffs-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  --diffs-min-number-column-width: 1ch;
  --diffs-bg-context-override: var(--viewer-context, #131820);
  --diffs-bg-separator-override: var(--viewer-separator, #17243a);
  --diffs-bg-addition-override: var(--viewer-addition, #112b22);
  --diffs-bg-deletion-override: var(--viewer-deletion, #321a1e);
  --diffs-bg-selection-override: var(--viewer-selection, #3a4e77);
  --diffs-fg-number-override: var(--viewer-number, #718096);
  --diffs-addition-color-override: var(--viewer-green, #52d091);
  --diffs-deletion-color-override: var(--viewer-red, #ff7f85);
  --diffs-modified-color-override: var(--viewer-accent, #7da6ff);
}
[data-diff]:not([data-disable-line-numbers]) [data-column-number] {
  padding-inline: .45ch !important;
}
[data-line-number-content] {
  min-width: 1ch !important;
}
[data-column-number][role="button"], [data-char][role="button"] {
  cursor: pointer;
}
[data-column-number][role="button"]:focus-visible,
[data-char][role="button"]:focus-visible {
  z-index: 5;
  border-radius: 2px;
  outline: 2px solid var(--viewer-accent, #7da6ff);
  outline-offset: -1px;
}
[data-char][role="button"]:hover {
  border-radius: 2px;
  background: color-mix(in srgb, var(--viewer-accent, #7da6ff) 25%, transparent);
}
`;

export interface ViewerLineTarget {
  lineNumber: number;
  side: "old" | "new";
  align?: "start" | "center" | "end" | "nearest";
  behavior?: "instant" | "smooth" | "smooth-auto";
}

export interface DiffViewerHandle {
  scrollToLine(target: ViewerLineTarget): void;
  scrollToHunk(hunkIndex: number): void;
  scrollToComment(comment: ReviewComment): void;
  scrollToTop(): void;
}

interface DiffViewerProps {
  comments: readonly ReviewComment[];
  diff: FileDiff;
  fontSize: number;
  lineNumbersVisible: boolean;
  lineWrapEnabled: boolean;
  selectedRange: SelectedLineRange | null;
  onCommentClick(comment: ReviewComment): void;
  onIdentifierClick(identifier: string): void;
  onLineNumberClick(lineNumber: number, side: "old" | "new"): void;
  onVisibleLineChange(lineNumber: number, side: "old" | "new"): void;
}

function hunkTarget(diff: FileDiff, hunkIndex: number): ViewerLineTarget | null {
  const hunk = diff.hunks[hunkIndex];
  if (!hunk) return null;
  const firstLine = hunk.lines.find(
    (line) => line.kind !== "metadata" && (line.newLine !== null || line.oldLine !== null),
  );
  if (firstLine?.newLine !== null && firstLine?.newLine !== undefined) {
    return { lineNumber: firstLine.newLine, side: "new", align: "start" };
  }
  if (firstLine?.oldLine !== null && firstLine?.oldLine !== undefined) {
    return { lineNumber: firstLine.oldLine, side: "old", align: "start" };
  }
  if (hunk.newLines > 0) {
    return { lineNumber: hunk.newStart, side: "new", align: "start" };
  }
  if (hunk.oldLines > 0) {
    return { lineNumber: hunk.oldStart, side: "old", align: "start" };
  }
  return null;
}

function commentTarget(comment: ReviewComment): ViewerLineTarget | null {
  const annotation = commentAnnotation(comment);
  if (!annotation) return null;
  return {
    lineNumber: annotation.lineNumber,
    side: fromPierreSide(annotation.side),
    align: "center",
  };
}

function keyActivates(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " ";
}

function enhanceRenderedDiff(
  host: HTMLElement,
  phase: "mount" | "update" | "unmount",
  lineNumbersVisible: boolean,
  fontSize: number,
  lineHeight: number,
): void {
  const root = host.shadowRoot;
  if (!root) return;

  const interactive = root.querySelectorAll<HTMLElement>(
    "[data-column-number], [data-char]",
  );
  for (const element of interactive) {
    element.onkeydown = null;
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    element.removeAttribute("aria-label");
    element.removeAttribute("title");
  }
  if (phase === "unmount") return;

  // Mobile Safari can independently inflate wide code blocks, which makes an
  // 11px preference render closer to 16px for some files. Keep the sizing on
  // Pierre's actual shadow host (not only its React wrapper), and pin its row
  // metric to the same value whenever a virtualized item is mounted or reused.
  host.style.setProperty("-webkit-text-size-adjust", "100%");
  host.style.setProperty("text-size-adjust", "100%");
  host.style.setProperty("--diffs-font-size", `${fontSize}px`);
  host.style.setProperty("--diffs-line-height", `${lineHeight}px`);

  if (lineNumbersVisible) {
    for (const number of root.querySelectorAll<HTMLElement>("[data-column-number]")) {
      const lineNumber = number.getAttribute("data-column-number");
      if (!lineNumber) continue;
      const type = number.getAttribute("data-line-type");
      const side = type === "change-deletion" ? "old" : "new";
      const label = `Select ${side} line ${lineNumber}`;
      number.setAttribute("role", "button");
      number.tabIndex = 0;
      number.setAttribute("aria-label", label);
      number.title = label;
      number.onkeydown = (event) => {
        if (!keyActivates(event)) return;
        event.preventDefault();
        number.click();
      };
    }
  }

  for (const token of root.querySelectorAll<HTMLElement>("[data-char]")) {
    if (token.querySelector("[data-char]")) continue;
    const identifier = token.textContent ?? "";
    if (!IDENTIFIER_PATTERN.test(identifier)) continue;
    const label = `Find “${identifier}” in project`;
    token.setAttribute("role", "button");
    token.tabIndex = 0;
    token.setAttribute("aria-label", label);
    token.title = label;
    token.onkeydown = (event) => {
      if (!keyActivates(event)) return;
      event.preventDefault();
      token.click();
    };
  }
}

function toScrollTarget(diffId: string, target: ViewerLineTarget): CodeViewScrollTarget {
  return {
    type: "line",
    id: diffId,
    lineNumber: target.lineNumber,
    side: toPierreSide(target.side),
    align: target.align ?? "nearest",
    behavior: target.behavior ?? "smooth",
  };
}

export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(
  function DiffViewer(
    {
      comments,
      diff,
      fontSize,
      lineNumbersVisible,
      lineWrapEnabled,
      onCommentClick,
      onIdentifierClick,
      onLineNumberClick,
      onVisibleLineChange,
      selectedRange,
    },
    ref,
  ) {
    const codeViewRef = useRef<CodeViewHandle<CommentAnnotationMetadata>>(null);
    const scrollFrameRef = useRef<number | null>(null);
    const pendingAnchorRef = useRef<{
      lineNumber: number;
      side: "old" | "new";
    } | null>(null);

    const adapted = useMemo(() => {
      try {
        return { value: adaptFileDiff(diff), error: null };
      } catch (error) {
        return {
          value: null,
          error: error instanceof Error ? error : new Error("The patch could not be parsed."),
        };
      }
    }, [diff]);

    const annotations = useMemo(
      () => annotationsForFile(comments, diff.fileId),
      [comments, diff.fileId],
    );
    const annotationVersion = useMemo(
      () => commentAnnotationsVersion(comments, diff.fileId, diff.contentRevision),
      [comments, diff.contentRevision, diff.fileId],
    );
    const lineHeight = fontSize * 1.55;

    const items = useMemo<CodeViewItem<CommentAnnotationMetadata>[]>(() => {
      if (!adapted.value) return [];
      return [
        {
          id: diff.fileId,
          type: "diff",
          fileDiff: adapted.value.fileDiff,
          annotations,
          version: annotationVersion,
        },
      ];
    }, [adapted.value, annotationVersion, annotations, diff.fileId]);

    const selectedLines = useMemo<CodeViewLineSelection | null>(
      () => selectedRange ? { id: diff.fileId, range: selectedRange } : null,
      [diff.fileId, selectedRange],
    );

    const handleScroll = useCallback(
      (
        scrollTop: number,
        viewer: NonNullable<
          ReturnType<CodeViewHandle<CommentAnnotationMetadata>["getInstance"]>
        >,
      ) => {
        const rendered = viewer
          .getRenderedItems()
          .find((item) => item.type === "diff" && item.id === diff.fileId);
        if (!rendered || rendered.type !== "diff") return;
        const localTop = Math.max(0, scrollTop - viewer.getLocalTopForInstance(rendered.instance));
        const anchor = rendered.instance.getNumericScrollAnchor(localTop);
        if (!anchor) return;
        pendingAnchorRef.current = {
          lineNumber: anchor.lineNumber,
          side: fromPierreSide(anchor.side ?? "additions"),
        };
        if (scrollFrameRef.current !== null) return;
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          scrollFrameRef.current = null;
          const pending = pendingAnchorRef.current;
          if (pending) onVisibleLineChange(pending.lineNumber, pending.side);
        });
      },
      [diff.fileId, onVisibleLineChange],
    );

    useEffect(
      () => () => {
        if (scrollFrameRef.current !== null) {
          window.cancelAnimationFrame(scrollFrameRef.current);
        }
      },
      [],
    );

    const scrollToLine = useCallback(
      (target: ViewerLineTarget) => {
        codeViewRef.current?.scrollTo(toScrollTarget(diff.fileId, target));
      },
      [diff.fileId],
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToLine,
        scrollToHunk(hunkIndex) {
          const target = hunkTarget(diff, hunkIndex);
          if (target) scrollToLine(target);
        },
        scrollToComment(comment) {
          const target = commentTarget(comment);
          if (target) scrollToLine(target);
        },
        scrollToTop() {
          codeViewRef.current?.scrollTo({ type: "position", position: 0 });
        },
      }),
      [diff, scrollToLine],
    );

    const options = useMemo<CodeViewOptions<CommentAnnotationMetadata>>(
      () => ({
        theme: "pierre-dark",
        themeType: "dark",
        diffStyle: "unified",
        diffIndicators: "bars",
        hunkSeparators: "metadata",
        lineDiffType: "word-alt",
        overflow: lineWrapEnabled ? "wrap" : "scroll",
        disableFileHeader: true,
        disableLineNumbers: !lineNumbersVisible,
        enableLineSelection: false,
        lineHoverHighlight: lineNumbersVisible ? "both" : "line",
        useTokenTransformer: true,
        tokenizeMaxLineLength: 2_000,
        tokenizeMaxLength: 100_000,
        itemMetrics: {
          lineHeight,
          paddingTop: 0,
          paddingBottom: 0,
        },
        layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
        unsafeCSS: PIERRE_UNSAFE_CSS,
        onLineNumberClick(props) {
          if (!lineNumbersVisible || props.type !== "diff-line") return;
          onLineNumberClick(props.lineNumber, fromPierreSide(props.annotationSide));
        },
        onTokenClick(props) {
          if (props.type !== "token" || !IDENTIFIER_PATTERN.test(props.tokenText)) return;
          onIdentifierClick(props.tokenText);
        },
        onPostRender(node, _instance, phase) {
          enhanceRenderedDiff(
            node,
            phase,
            lineNumbersVisible,
            fontSize,
            lineHeight,
          );
        },
      }),
      [
        fontSize,
        lineHeight,
        lineNumbersVisible,
        lineWrapEnabled,
        onIdentifierClick,
        onLineNumberClick,
      ],
    );

    const renderAnnotation = useCallback(
      (annotation: DiffLineAnnotation<CommentAnnotationMetadata>) => {
        const comment = annotation.metadata?.comment;
        if (!comment) return null;
        return (
          <button
            aria-label={`Open comment at ${formatCommentReference(comment)}`}
            className="diff-comment-chip"
            data-comment-chip={comment.id}
            onClick={(event) => {
              event.stopPropagation();
              onCommentClick(comment);
            }}
            type="button"
          >
            <MessageSquareText aria-hidden="true" size={12} />
            <span className="diff-comment-reference">
              {formatCommentReference(comment)}
            </span>
            <span className="diff-comment-preview">{comment.body}</span>
          </button>
        );
      },
      [onCommentClick],
    );

    if (!adapted.value) {
      let patch = "";
      try {
        patch = reconstructUnifiedPatch(diff);
      } catch {
        patch = diff.header.join("\n");
      }
      return (
        <div className={`patch-fallback ${lineWrapEnabled ? "wrap-lines" : ""}`} role="alert">
          <div className="patch-fallback-message">
            Syntax rendering failed: {adapted.error?.message ?? "invalid patch"}. Showing plain text.
          </div>
          <pre>{patch}</pre>
        </div>
      );
    }

    return (
      <div className="diff-viewer-shell">
        {diff.tooLarge && (
          <div className="truncated-banner" role="status">
            Showing the first 2 MiB or 20,000 rows.
          </div>
        )}
        <CodeView<CommentAnnotationMetadata>
          className="pierre-code-view"
          items={items}
          onScroll={handleScroll}
          options={options}
          ref={codeViewRef}
          renderAnnotation={renderAnnotation}
          selectedLines={selectedLines}
          style={{
            "--diffs-font-size": `${fontSize}px`,
            "--diffs-line-height": `${lineHeight}px`,
            WebkitTextSizeAdjust: "100%",
            textSizeAdjust: "100%",
          } as CSSProperties}
        />
      </div>
    );
  },
);
