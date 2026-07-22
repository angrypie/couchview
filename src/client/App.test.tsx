import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { FileDiff, ReviewComment } from "../shared/contracts.ts";

mock.module("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, () => undefined],
    needRefresh: [false, () => undefined],
    updateServiceWorker: async () => undefined,
  }),
}));

GlobalRegistrator.register();

const React = await import("react");
const viewerCommentJumps: string[] = [];
const viewerHunkJumps: number[] = [];
interface MockDiffViewerProps {
  comments: readonly ReviewComment[];
  diff: FileDiff;
  lineNumbersVisible: boolean;
  lineWrapEnabled: boolean;
  onCommentClick(comment: ReviewComment): void;
  onIdentifierClick(identifier: string): void;
  onLineNumberClick(lineNumber: number, side: "old" | "new"): void;
}
mock.module("./DiffViewer.tsx", () => ({
  DiffViewer: React.forwardRef(function MockDiffViewer(
    {
      comments,
      diff,
      lineNumbersVisible,
      lineWrapEnabled,
      onCommentClick,
      onIdentifierClick,
      onLineNumberClick,
    }: MockDiffViewerProps,
    ref: React.ForwardedRef<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({
      scrollToLine() {},
      scrollToHunk(hunkIndex: number) {
        viewerHunkJumps.push(hunkIndex);
      },
      scrollToComment(comment: ReviewComment) {
        viewerCommentJumps.push(comment.id);
      },
      scrollToTop() {},
    }));
    return (
      <div
        className="pierre-code-view"
        data-line-wrap={String(lineWrapEnabled)}
        data-testid="pierre-code-view"
      >
        {diff.hunks.flatMap((hunk) =>
          hunk.lines.map((line) => (
            <div data-kind={line.kind} key={`${hunk.id}:${line.id}`}>
              {lineNumbersVisible && line.oldLine !== null && (
                <button
                  aria-label={`Select old line ${line.oldLine}`}
                  onClick={() => onLineNumberClick(line.oldLine!, "old")}
                  type="button"
                >
                  {line.oldLine}
                </button>
              )}
              {lineNumbersVisible && line.newLine !== null && (
                <button
                  aria-label={`Select new line ${line.newLine}`}
                  onClick={() => onLineNumberClick(line.newLine!, "new")}
                  type="button"
                >
                  {line.newLine}
                </button>
              )}
              {line.text.split(/([A-Za-z_$][\w$-]*)/g).map((token, index) =>
                /^[A-Za-z_$][\w$-]*$/.test(token) ? (
                  <button
                    key={`${index}:${token}`}
                    onClick={() => onIdentifierClick(token)}
                    title={`Find “${token}” in project`}
                    type="button"
                  >
                    {token}
                  </button>
                ) : (
                  <span key={`${index}:${token}`}>{token}</span>
                ),
              )}
            </div>
          )),
        )}
        {comments
          .filter((comment) => comment.fileId === diff.fileId && !comment.stale)
          .map((comment) => (
            <button
              aria-label={`Open comment at ${comment.path}`}
              key={comment.id}
              onClick={() => onCommentClick(comment)}
              type="button"
            >
              {comment.body}
            </button>
          ))}
      </div>
    );
  }),
}));

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return this.classList.contains("pierre-code-view") ? 640 : 44;
  },
});
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return this.classList.contains("pierre-code-view") ? 375 : 120;
  },
});
HTMLElement.prototype.getBoundingClientRect = function () {
  const width = this.classList.contains("pierre-code-view") ? 375 : 120;
  const height = this.classList.contains("pierre-code-view") ? 640 : 44;
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
};
class ResizeObserverStub {
  constructor(
    private readonly callback: ResizeObserverCallback,
  ) {}
  observe(target: Element) {
    const contentRect = target.getBoundingClientRect();
    this.callback(
      [
        {
          target,
          contentRect,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverStub,
});
Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverStub,
});
const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { App } = await import("./App.tsx");
const originalFetch = globalThis.fetch;

const repository = {
  id: "repo",
  name: "fixture",
  root: "/fixture",
  branch: "main",
  head: "abc",
  unborn: false,
};

const initialFiles = [
  {
    id: "first",
    path: "src/first.ts",
    previousPath: null,
    kind: "modified" as const,
    indexStatus: ".",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    conflicted: false,
    binary: false,
    additions: 1,
    deletions: 1,
    contentRevision: "first-v1",
    reviewed: false,
    commentCount: 0,
  },
  {
    id: "second",
    path: "src/second.ts",
    previousPath: null,
    kind: "added" as const,
    indexStatus: ".",
    worktreeStatus: "?",
    staged: false,
    unstaged: true,
    conflicted: false,
    binary: false,
    additions: 1,
    deletions: 0,
    contentRevision: "second-v1",
    reviewed: false,
    commentCount: 0,
  },
];

const firstDiff = {
  fileId: "first",
  path: "src/first.ts",
  previousPath: null,
  kind: "modified" as const,
  contentRevision: "first-v1",
  operationRevision: "operation-1",
  binary: false,
  tooLarge: false,
  header: [],
  additions: 1,
  deletions: 1,
  hunks: [
    {
      id: "hunk-1",
      header: "@@ -1,2 +1,2 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        {
          id: "old",
          kind: "deletion" as const,
          text: "const value = load(oldPath);",
          oldLine: 1,
          newLine: null,
          noNewline: false,
        },
        {
          id: "new",
          kind: "addition" as const,
          text: "const value = load(newPath);",
          oldLine: null,
          newLine: 1,
          noNewline: false,
        },
        {
          id: "context",
          kind: "context" as const,
          text: "return value;",
          oldLine: 2,
          newLine: 2,
          noNewline: false,
        },
      ],
    },
  ],
};

const secondDiff = {
  ...firstDiff,
  fileId: "second",
  path: "src/second.ts",
  kind: "added" as const,
  contentRevision: "second-v1",
  additions: 1,
  deletions: 0,
  hunks: [
    {
      id: "second-hunk",
      header: "@@ -0,0 +1 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      lines: [
        {
          id: "second-line",
          kind: "addition" as const,
          text: "export const second = true;",
          oldLine: null,
          newLine: 1,
          noNewline: false,
        },
      ],
    },
  ],
};

class EventSourceStub {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close() {}
}

function fixtureComment(
  id: string,
  body: string,
  stale = false,
): Record<string, unknown> {
  return {
    id,
    fileId: "first",
    path: "src/first.ts",
    side: "mixed",
    startLine: 1,
    endLine: 1,
    oldStartLine: 1,
    oldEndLine: 1,
    newStartLine: 1,
    newEndLine: 1,
    hunkHeader: "@@ -1,2 +1,2 @@",
    excerpt: ["- const value = load(oldPath);", "+ const value = load(newPath);"],
    body,
    contentRevision: "first-v1",
    stale,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
  };
}

describe("Couch Review app", () => {
  let files = structuredClone(initialFiles);
  let comments: Array<Record<string, unknown>> = [];
  let reviews: Array<Record<string, unknown>> = [];
  let requests: Array<{ path: string; method: string; body: unknown }> = [];
  let servedFirstDiff: FileDiff = structuredClone(firstDiff);

  beforeEach(() => {
    files = structuredClone(initialFiles);
    comments = [];
    reviews = [];
    requests = [];
    servedFirstDiff = structuredClone(firstDiff);
    viewerCommentJumps.length = 0;
    viewerHunkJumps.length = 0;
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }),
    });
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: EventSourceStub,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error("denied")) },
    });

    globalThis.fetch = (async (input, init) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, "http://localhost");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ path: url.pathname, method, body });

      if (url.pathname === "/api/bootstrap") {
        return Response.json({ repository, csrfToken: "csrf", operationRevision: "operation-1" });
      }
      if (url.pathname === "/api/files") {
        return Response.json({ repository, files, operationRevision: "operation-1" });
      }
      if (url.pathname === "/api/comments" && method === "GET") {
        return Response.json({ reviews, comments });
      }
      if (url.pathname === "/api/files/first/diff") return Response.json({ diff: servedFirstDiff });
      if (url.pathname === "/api/files/second/diff") return Response.json({ diff: secondDiff });
      if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q") ?? "";
        return Response.json({
          query,
          currentPath: "src/first.ts",
          currentFile: [
            { path: "src/first.ts", line: 1, column: 15, preview: "const value = load(newPath);" },
          ],
          otherFiles: [
            { path: "src/second.ts", line: 1, column: 14, preview: "export const load = true;" },
          ],
          truncated: false,
        });
      }
      if (url.pathname === "/api/source") {
        return Response.json({
          path: url.searchParams.get("path"),
          focusLine: 1,
          startLine: 1,
          endLine: 2,
          lines: [
            { line: 1, text: "const value = load(newPath);" },
            { line: 2, text: "return value;" },
          ],
          truncated: false,
        });
      }
      if (url.pathname === "/api/files/first/review" && method === "PUT") {
        files[0]!.reviewed = Boolean((body as { reviewed: boolean }).reviewed);
        const review = {
          fileId: "first",
          path: "src/first.ts",
          contentRevision: "first-v1",
          reviewed: files[0]!.reviewed,
          updatedAt: new Date().toISOString(),
        };
        reviews = [review];
        return Response.json({ review });
      }
      if (url.pathname === "/api/files/first/stage" && method === "POST") {
        const staged = (body as { staged?: boolean }).staged ?? true;
        files[0]!.staged = staged;
        files[0]!.unstaged = !staged;
        files[0]!.indexStatus = staged ? "M" : ".";
        files[0]!.worktreeStatus = staged ? "." : "M";
        return Response.json({ file: files[0], operationRevision: `operation-${staged ? 2 : 3}` });
      }
      if (url.pathname === "/api/files/first/comments" && method === "POST") {
        const now = new Date().toISOString();
        const comment = {
          ...(body as Record<string, unknown>),
          id: "comment-1",
          path: "src/first.ts",
          excerpt: ["- const value = load(oldPath);", "+ const value = load(newPath);"],
          stale: false,
          createdAt: now,
          updatedAt: now,
        };
        comments = [comment];
        return Response.json({ comment }, { status: 201 });
      }
      if (url.pathname === "/api/comments/comment-1" && method === "PUT") {
        comments[0] = { ...comments[0], body: (body as { body: string }).body };
        return Response.json({ comment: comments[0] });
      }
      if (url.pathname === "/api/comments/comment-1" && method === "DELETE") {
        comments = [];
        return Response.json({ deletedId: "comment-1" });
      }
      return Response.json({ error: { code: "not_found", message: url.pathname } }, { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  test("resizes, reviews and advances, then navigates back", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    expect(screen.getByText("11px")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase diff font size" }));
    expect(screen.getByText("12px")).toBeTruthy();
    expect(localStorage.getItem("couch-review:font-size")).toBe("12");

    fireEvent.click(screen.getByRole("button", { name: /Review \+ next/ }));
    await waitFor(() => expect(screen.getByText("src/second.ts")).toBeTruthy());
    expect(requests.some((request) => request.path === "/api/files/first/review")).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Previous file" })[0]!);
    await waitFor(() => expect(screen.getByText("src/first.ts")).toBeTruthy());
  });

  test("uses compact landscape actions without advancing and toggles staging", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("orientation: landscape"),
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }),
    });
    const { container } = render(<App />);

    await screen.findByText("src/first.ts");
    expect(container.querySelector(".app-shell.compact-landscape")).toBeTruthy();
    expect(container.querySelector(".file-bar")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Previous file" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Next file" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Review current file" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.path === "/api/files/first/review")?.body,
      ).toMatchObject({ reviewed: true }),
    );
    expect(screen.getByText("src/first.ts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await screen.findByRole("button", { name: "Unstage current file" });
    expect(
      requests.find((request) => request.path === "/api/files/first/stage")?.body,
    ).toMatchObject({ staged: true });

    fireEvent.click(screen.getByRole("button", { name: "Unstage current file" }));
    await screen.findByRole("button", { name: "Stage current file" });
    expect(
      requests.filter((request) => request.path === "/api/files/first/stage").at(-1)?.body,
    ).toMatchObject({ staged: false });
  });

  test("hides line numbers by default and remembers the 123 toggle", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    expect(screen.queryByRole("button", { name: "Select old line 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show line numbers" }));
    expect(await screen.findByRole("button", { name: "Select old line 1" })).toBeTruthy();
    expect(localStorage.getItem("couch-review:line-numbers")).toBe("true");

    cleanup();
    render(<App />);
    await screen.findByText("src/first.ts");
    expect(screen.getByRole("button", { name: "Hide line numbers" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Select new line 1" })).toBeTruthy();
  });

  test("wraps long lines on request and remembers the display preference", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    expect((await screen.findByTestId("pierre-code-view")).dataset.lineWrap).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Wrap long lines" }));
    expect(screen.getByRole("button", { name: "Keep long lines on one line" })).toBeTruthy();
    expect(screen.getByTestId("pierre-code-view").dataset.lineWrap).toBe("true");
    expect(localStorage.getItem("couch-review:line-wrap")).toBe("true");

    cleanup();
    render(<App />);
    await screen.findByText("src/first.ts");
    expect(screen.getByRole("button", { name: "Keep long lines on one line" })).toBeTruthy();
    expect((await screen.findByTestId("pierre-code-view")).dataset.lineWrap).toBe("true");
  });

  test("routes hunk navigation through the viewer handle", async () => {
    const secondHunk = structuredClone(servedFirstDiff.hunks[0]!);
    secondHunk.id = "hunk-2";
    secondHunk.header = "@@ -11,2 +11,2 @@";
    secondHunk.oldStart = 11;
    secondHunk.newStart = 11;
    secondHunk.lines = secondHunk.lines.map((line) => ({
      ...line,
      oldLine: line.oldLine === null ? null : line.oldLine + 10,
      newLine: line.newLine === null ? null : line.newLine + 10,
    }));
    servedFirstDiff.hunks.push(secondHunk);
    render(<App />);

    await screen.findByText("src/first.ts");
    const nextHunk = screen.getByRole("button", { name: "Next hunk" }) as HTMLButtonElement;
    await waitFor(() => expect(nextHunk.disabled).toBe(false));
    fireEvent.click(nextHunk);
    expect(viewerHunkJumps).toEqual([1]);
    expect(nextHunk.disabled).toBe(true);
  });

  test("searches a clicked identifier and opens a source preview", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    const loadButtons = await screen.findAllByTitle("Find “load” in project");
    fireEvent.click(loadButtons[0]!);
    await screen.findByRole("dialog", { name: "Project search" });
    const currentResult = await screen.findByRole("button", {
      name: /src\/first\.ts:1:15/,
    });
    fireEvent.click(screen.getByRole("button", { name: "Other files (1)" }));
    expect(
      await screen.findByRole("button", { name: /src\/second\.ts:1:14/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Current file (1)" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /src\/first\.ts:1:15/ }),
    );
    expect(await screen.findByText("return value;")).toBeTruthy();
  });

  test("creates a mixed replacement comment and exposes the manual copy fallback", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Show line numbers" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select old line 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select new line 1" }));
    await screen.findByText(/Old lines 1 \/ new lines 1/);
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe the issue/), {
      target: { value: "Use the safe loader." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(comments).toHaveLength(1));
    expect(comments[0]).toMatchObject({
      side: "mixed",
      oldStartLine: 1,
      newStartLine: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
    expect(await screen.findAllByText("Use the safe loader.")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Copy 1 for Codex/ }));
    await screen.findByRole("dialog", { name: "Copy comments manually" });
    const copyField = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(copyField.value).toContain("src/first.ts:old L1 / new L1");
    expect(copyField.value).toContain("Use the safe loader.");
  });

  test("opens an inline comment chip and focuses its tray card", async () => {
    comments = [fixtureComment("comment-1", "Inline correction")];
    files[0]!.commentCount = 1;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(await screen.findByRole("button", { name: /Open comment at/ }));
    await screen.findByRole("dialog", { name: "Review comments" });
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.dataset.commentId).toBe(
        "comment-1",
      );
    });
  });

  test("jumps from the comment tray through the viewer handle", async () => {
    comments = [fixtureComment("comment-1", "Jump target")];
    files[0]!.commentCount = 1;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
    const tray = await screen.findByRole("dialog", { name: "Review comments" });
    fireEvent.click(
      within(tray).getByRole("button", {
        name: "src/first.ts:old L1 / new L1",
      }),
    );
    await waitFor(() => expect(viewerCommentJumps).toEqual(["comment-1"]));
    expect(await screen.findByText(/Old lines 1 \/ new lines 1/)).toBeTruthy();
  });

  test("edits and deletes an existing comment", async () => {
    comments = [fixtureComment("comment-1", "Original correction")];
    files[0]!.commentCount = 1;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
    expect(await screen.findAllByText("Original correction")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Edit comment at/ }));
    const editor = screen.getByPlaceholderText(/Describe the issue/) as HTMLTextAreaElement;
    expect(editor.value).toBe("Original correction");
    fireEvent.change(editor, { target: { value: "Updated correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(comments[0]?.body).toBe("Updated correction"));

    fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
    expect(await screen.findAllByText("Updated correction")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Delete comment at/ }));
    await waitFor(() => expect(comments).toHaveLength(0));
    expect(await screen.findByText(/Tap a line number/)).toBeTruthy();
  });

  test("keeps stale comments visible while excluding them from export", async () => {
    comments = [
      fixtureComment("comment-1", "Current correction"),
      fixtureComment("stale-comment", "Outdated correction", true),
    ];
    files[0]!.commentCount = 2;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
    expect(await screen.findByText("Outdated correction")).toBeTruthy();
    expect(screen.getByText(/· stale/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy 1 for Codex/ }));
    await screen.findByRole("dialog", { name: "Copy comments manually" });
    const copyField = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(copyField.value).toContain("Current correction");
    expect(copyField.value).not.toContain("Outdated correction");
  });
});
