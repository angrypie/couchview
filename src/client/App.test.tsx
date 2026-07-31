import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type {
  ChangeFile,
  FileDiff,
  PackageRunSummary,
  ReviewComment,
} from "../shared/contracts.ts";
import {
  FakeTerminalWebSocket,
  previewRendererState,
  rendererState,
  resetFakeTerminalWebSockets,
  resetRendererState,
  terminalPreviewRendererFactory,
  terminalRendererFactory,
} from "./terminalTestFakes.ts";
import {
  DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER,
  TYPOGRAPHY_STORAGE_KEY,
  type TypographyPreferences,
} from "./typographyPreferences.ts";

let pwaNeedRefresh = false;
let pwaUpdateCalls = 0;

mock.module("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [pwaNeedRefresh, () => undefined],
    updateServiceWorker: async () => {
      pwaUpdateCalls += 1;
    },
  }),
}));

mock.module("./ghosttyTerminal.ts", () => ({
  createBrowserTerminal: terminalRendererFactory,
  createBrowserTerminalPreview: terminalPreviewRendererFactory,
}));

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const React = await import("react");
const viewerCommentJumps: string[] = [];
const viewerHunkJumps: number[] = [];
let viewerVisibleLineChange:
  | ((lineNumber: number, side: "old" | "new") => void)
  | null = null;
interface MockDiffViewerProps {
  comments: readonly ReviewComment[];
  diff: FileDiff;
  fontFamily: string;
  fontSize: number;
  lineHeightAdjustment: number;
  widthAdjustment: number;
  lineNumbersVisible: boolean;
  lineWrapEnabled: boolean;
  onCommentClick(comment: ReviewComment): void;
  onIdentifierClick(identifier: string): void;
  onLineNumberClick(lineNumber: number, side: "old" | "new"): void;
  onVisibleLineChange(lineNumber: number, side: "old" | "new"): void;
}
mock.module("./DiffViewer.tsx", () => ({
  DiffViewer: React.forwardRef(function MockDiffViewer(
    {
      comments,
      diff,
      fontFamily,
      fontSize,
      lineHeightAdjustment,
      widthAdjustment,
      lineNumbersVisible,
      lineWrapEnabled,
      onCommentClick,
      onIdentifierClick,
      onLineNumberClick,
      onVisibleLineChange,
    }: MockDiffViewerProps,
    ref: React.ForwardedRef<unknown>,
  ) {
    viewerVisibleLineChange = onVisibleLineChange;
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
        style={{
          fontFamily,
          fontSize: `${fontSize}px`,
          letterSpacing: `${widthAdjustment}px`,
          lineHeight: `${fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + lineHeightAdjustment}px`,
        }}
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
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { App } = await import("./App.tsx");
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

const repository = {
  id: "repo",
  name: "fixture",
  root: "/fixture",
  branch: "main",
  head: "abc",
  unborn: false,
};

const alternateRepository = {
  ...repository,
  id: "repo-two",
  name: "second-fixture",
  root: "/second-fixture",
  branch: "feature/other-project",
};

const repositoryCatalog = [repository, alternateRepository].map((item) => ({
  id: item.id,
  name: item.name,
  root: item.root,
  available: true,
  addedAt: "2026-07-20T10:00:00.000Z",
}));

const packageScriptsFixture = {
  packages: [
    {
      packagePath: "package.json",
      directory: ".",
      name: "fixture-root",
      manifestRevision: "root-package-revision",
      runner: "bun" as const,
      scripts: [
        { name: "test", command: "bun test" },
        { name: "dev", command: "vite" },
      ],
    },
    {
      packagePath: "apps/web/package.json",
      directory: "apps/web",
      name: "@fixture/web",
      manifestRevision: "web-package-revision",
      runner: "pnpm" as const,
      scripts: [{ name: "build", command: "vite build" }],
    },
  ],
  warnings: [],
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
  static instances: EventSourceStub[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() {
    EventSourceStub.instances.push(this);
  }
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

describe("Couchview app", () => {
  let files: ChangeFile[] = structuredClone(initialFiles);
  let comments: Array<Record<string, unknown>> = [];
  let reviews: Array<Record<string, unknown>> = [];
  let packageRuns: PackageRunSummary[] = [];
  let requests: Array<{ path: string; method: string; body: unknown }> = [];
  let catalog = structuredClone(repositoryCatalog);
  let servedFirstDiff: FileDiff = structuredClone(firstDiff);
  let currentOperationRevision = "operation-1";
  let diffFailure = false;
  let stageFailure = false;
  let delayNextDiffResponse = false;
  let releaseDiffResponse: (() => void) | null = null;
  let delayStageResponse = false;
  let releaseStageResponse: (() => void) | null = null;
  let emitSseDuringStage = false;
  let removeActiveFileOnStage = false;
  let commitMessageFailure = false;
  let delayCommitMessageResponse = false;
  let commitMessageRequestAborted = false;
  let releaseCommitMessageResponse: (() => void) | null = null;
  let commitMessageAvailable = true;
  let terminalAvailable = false;
  let remoteBridgeAvailable = false;
  let remoteBridgeDevices: Array<Record<string, unknown>> = [];
  let bootstrapFailureStatus: number | null = null;

  beforeEach(() => {
    files = structuredClone(initialFiles);
    comments = [];
    reviews = [];
    packageRuns = [];
    requests = [];
    catalog = structuredClone(repositoryCatalog);
    servedFirstDiff = structuredClone(firstDiff);
    currentOperationRevision = "operation-1";
    diffFailure = false;
    stageFailure = false;
    delayNextDiffResponse = false;
    releaseDiffResponse = null;
    delayStageResponse = false;
    releaseStageResponse = null;
    emitSseDuringStage = false;
    removeActiveFileOnStage = false;
    commitMessageFailure = false;
    delayCommitMessageResponse = false;
    commitMessageRequestAborted = false;
    releaseCommitMessageResponse = null;
    commitMessageAvailable = true;
    terminalAvailable = false;
    remoteBridgeAvailable = false;
    remoteBridgeDevices = [];
    bootstrapFailureStatus = null;
    pwaNeedRefresh = false;
    pwaUpdateCalls = 0;
    resetRendererState();
    resetFakeTerminalWebSockets();
    EventSourceStub.instances.length = 0;
    viewerCommentJumps.length = 0;
    viewerHunkJumps.length = 0;
    viewerVisibleLineChange = null;
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
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
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FakeTerminalWebSocket,
    });
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: FakeTerminalWebSocket,
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

      const repositoryRoute = /^\/api\/repositories\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
      const requestedRepositoryId = repositoryRoute?.[1]
        ? decodeURIComponent(repositoryRoute[1])
        : null;
      const nestedPath = repositoryRoute?.[2] ?? "";
      const requestedRepository = requestedRepositoryId === alternateRepository.id
        ? alternateRepository
        : repository;

      if (url.pathname === "/api/bootstrap") {
        if (bootstrapFailureStatus !== null) {
          return new Response("Cloudflare Access sign-in required", {
            status: bootstrapFailureStatus,
          });
        }
        return Response.json({
          csrfToken: "csrf",
          repositories: catalog,
          defaultRepositoryId: repository.id,
          catalogRevision: 1,
          restart: {
            available: true,
            reason: null,
          },
          commitMessage: {
            available: commitMessageAvailable,
            reason: commitMessageAvailable
              ? null
              : "Codex CLI is unavailable in this test.",
          },
          terminal: {
            available: terminalAvailable,
            reason: terminalAvailable ? null : "tmux is unavailable in this test.",
            persistence: "tmux",
            profiles: [{
              id: "tmux",
              label: "tmux",
              available: terminalAvailable,
              reason: terminalAvailable ? null : "tmux is unavailable in this test.",
            }],
          },
          remoteBridge: {
            available: remoteBridgeAvailable,
            reason: remoteBridgeAvailable ? null : "Native IDE bridge is disabled in this test.",
            p2pEnabled: remoteBridgeAvailable,
          },
        });
      }
      if (url.pathname === "/api/restart" && method === "POST") {
        return Response.json(
          {
            status: "restarting",
            previousInstanceId: "fixture-instance",
          },
          { status: 202 },
        );
      }
      if (url.pathname === "/api/instance" && method === "GET") {
        return Response.json({
          service: "couchview",
          protocolVersion: 5,
          version: "0.1.0",
          instanceId: "fixture-instance",
          bindHost: "127.0.0.1",
          port: 4173,
          accessOrigins: ["http://127.0.0.1:4173"],
          terminalEnabled: terminalAvailable,
          terminalP2pEnabled: false,
          terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
          remoteBridgeEnabled: remoteBridgeAvailable,
          remoteBridgeP2pEnabled: remoteBridgeAvailable,
          remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
          remoteBridgeTargetPort: 22,
          remoteBridgeOriginAccess: "auto",
        });
      }
      if (url.pathname === "/api/repositories") {
        return Response.json({ repositories: catalog, catalogRevision: 1 });
      }
      if (repositoryRoute && !nestedPath && method === "DELETE") {
        catalog = catalog.filter((entry) => entry.id !== requestedRepositoryId);
        return Response.json({ deletedId: requestedRepositoryId });
      }
      if (nestedPath === "terminal/end" && method === "POST") {
        return Response.json({ status: "ended" });
      }
      if (nestedPath === "terminal/attachments" && method === "POST") {
        return Response.json({
          ticket: "app-test-ticket",
          expiresAt: "2026-07-26T12:00:30.000Z",
          protocol: "couchview-terminal-v1",
          session: {
            profileId: "tmux",
            running: true,
            controllerConnected: false,
          },
        }, { status: 201 });
      }
      if (nestedPath === "remote-bridge/pairings" && method === "GET") {
        return Response.json({ devices: remoteBridgeDevices });
      }
      if (nestedPath === "remote-bridge/pairings" && method === "POST") {
        return Response.json({
          command:
            "couchview bridge pair --url 'https://review.example.com' --code 'pairing-code' --origin-access 'cloudflare-access'",
          expiresAt: "2099-07-29T12:05:00.000Z",
          sshAlias: "couchview-fixture-new-device",
        }, { status: 201 });
      }
      const remoteBridgeDeviceRoute = /^remote-bridge\/pairings\/([^/]+)$/.exec(nestedPath);
      if (remoteBridgeDeviceRoute && method === "DELETE") {
        const deviceId = decodeURIComponent(remoteBridgeDeviceRoute[1]!);
        remoteBridgeDevices = remoteBridgeDevices.filter((device) => device.id !== deviceId);
        return new Response(null, { status: 204 });
      }
      if (nestedPath === "package-scripts" && method === "GET") {
        return Response.json(packageScriptsFixture);
      }
      if (nestedPath === "package-runs" && method === "GET") {
        return Response.json({ runs: packageRuns });
      }
      if (nestedPath === "package-runs" && method === "POST") {
        const input = body as {
          packagePath: string;
          scriptName: string;
        };
        const packageEntry = packageScriptsFixture.packages.find(
          (item) => item.packagePath === input.packagePath,
        )!;
        const script = packageEntry.scripts.find(
          (item) => item.name === input.scriptName,
        )!;
        const run: PackageRunSummary = {
          id: `package-run-${packageRuns.length + 1}`,
          repositoryId: requestedRepositoryId!,
          packagePath: packageEntry.packagePath,
          packageName: packageEntry.name,
          directory: packageEntry.directory,
          scriptName: script.name,
          command: script.command,
          runner: packageEntry.runner,
          invocation: `${packageEntry.runner} run ${script.name}`,
          status: "running",
          exitCode: null,
          startedAt: "2026-07-23T10:00:00.000Z",
          finishedAt: null,
          outputTruncated: false,
        };
        packageRuns = [run, ...packageRuns];
        return Response.json({ run }, { status: 201 });
      }
      const packageRunStopRoute = /^package-runs\/([^/]+)\/stop$/.exec(nestedPath);
      if (packageRunStopRoute && method === "POST") {
        const run = packageRuns.find(
          (item) => item.id === decodeURIComponent(packageRunStopRoute[1]!),
        )!;
        run.status = "stopping";
        return Response.json({ run });
      }
      if (nestedPath === "files") {
        return Response.json({
          repository: requestedRepository,
          files,
          operationRevision: currentOperationRevision,
        });
      }
      if (nestedPath === "comments" && method === "GET") {
        return Response.json({ reviews, comments });
      }
      if (nestedPath === "files/first/diff") {
        if (diffFailure) {
          return Response.json(
            {
              error: {
                code: "git_empty_output",
                message: "Git diff returned no data for a changed file after two attempts",
                diagnostic: {
                  id: "diff1234",
                  source: "git",
                  operation: "diff",
                  kind: "empty_output",
                  exitCode: 0,
                  stderr: "Git reported this path as changed but returned no diff output.",
                  retryable: true,
                  timeoutMs: null,
                },
              },
            },
            { status: 503 },
          );
        }
        if (delayNextDiffResponse) {
          delayNextDiffResponse = false;
          await new Promise<void>((resolve) => {
            releaseDiffResponse = resolve;
          });
        }
        return Response.json({ diff: servedFirstDiff });
      }
      if (nestedPath === "files/second/diff") return Response.json({ diff: secondDiff });
      if (nestedPath === "search") {
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
      if (nestedPath === "source") {
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
      if (nestedPath === "files/first/review" && method === "PUT") {
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
      if (nestedPath === "files/stage" && method === "POST") {
        const targets = (
          body as { files: Array<{ fileId: string; contentRevision: string }> }
        ).files;
        const targetIds = new Set(targets.map((target) => target.fileId));
        const stagedFiles = files.filter((file) => targetIds.has(file.id));
        for (const file of stagedFiles) {
          file.staged = true;
          file.unstaged = false;
          file.indexStatus = file.kind === "added" ? "A" : "M";
          file.worktreeStatus = ".";
        }
        currentOperationRevision = "operation-bulk-stage";
        return Response.json({
          files: stagedFiles,
          changes: {
            upserted: stagedFiles,
            removedFileIds: [],
            orderedFileIds: files.map((file) => file.id),
          },
          operationRevision: currentOperationRevision,
        });
      }
      if (nestedPath === "files/first/stage" && method === "POST") {
        if (stageFailure) {
          return Response.json(
            {
              error: {
                code: "git_timeout",
                message: "Git update-index stopped responding after 15 seconds",
                diagnostic: {
                  id: "stage123",
                  source: "git",
                  operation: "update-index",
                  kind: "timeout",
                  exitCode: null,
                  stderr: "No output was received before the timeout.",
                  retryable: true,
                  timeoutMs: 15_000,
                },
              },
            },
            { status: 504 },
          );
        }
        const staged = (body as { staged?: boolean }).staged ?? true;
        files[0]!.staged = staged;
        files[0]!.unstaged = !staged;
        files[0]!.indexStatus = staged ? "M" : ".";
        files[0]!.worktreeStatus = staged ? "." : "M";
        currentOperationRevision = `operation-${staged ? 2 : 3}`;
        const removedFileId = removeActiveFileOnStage ? files[0]!.id : null;
        const responseFile = removedFileId ? null : files[0]!;
        if (removedFileId) files = files.slice(1);
        if (emitSseDuringStage) {
          EventSourceStub.instances.at(-1)?.onmessage?.(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "changes",
                repositoryId: "repo",
                operationRevision: currentOperationRevision,
                stateRevision: 0,
                catalogRevision: 1,
                at: "2026-07-22T10:00:00.000Z",
              }),
            }),
          );
        }
        if (delayStageResponse) {
          await new Promise<void>((resolve) => {
            releaseStageResponse = resolve;
          });
        }
        return Response.json({
          file: responseFile,
          changes: {
            upserted: responseFile ? [responseFile] : [],
            removedFileIds: removedFileId ? [removedFileId] : [],
            orderedFileIds: files.map((file) => file.id),
          },
          operationRevision: currentOperationRevision,
        });
      }
      if (nestedPath === "commit" && method === "POST") {
        files = files.filter((file) => !file.staged || file.unstaged);
        for (const file of files) {
          if (!file.staged) continue;
          file.staged = false;
          file.indexStatus = ".";
        }
        currentOperationRevision = "operation-after-commit";
        return Response.json(
          {
            commit: "abc1234abc1234abc1234abc1234abc1234abc12",
            operationRevision: currentOperationRevision,
          },
          { status: 201 },
        );
      }
      if (nestedPath === "commit-message" && method === "POST") {
        if (commitMessageFailure) {
          return Response.json(
            {
              error: {
                code: "codex_failed",
                message: "Codex could not generate a commit message",
              },
            },
            { status: 502 },
          );
        }
        if (delayCommitMessageResponse) {
          await new Promise<void>((resolve, reject) => {
            releaseCommitMessageResponse = resolve;
            init?.signal?.addEventListener(
              "abort",
              () => {
                commitMessageRequestAborted = true;
                reject(new DOMException("The request was aborted.", "AbortError"));
              },
              { once: true },
            );
          });
        }
        return Response.json({
          message: "feat(review): generate commit messages with Codex",
          operationRevision: currentOperationRevision,
        });
      }
      if (nestedPath === "files/first/comments" && method === "POST") {
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
      if (nestedPath === "comments/comment-1" && method === "PUT") {
        comments[0] = { ...comments[0], body: (body as { body: string }).body };
        return Response.json({ comment: comments[0] });
      }
      if (nestedPath === "comments/comment-1" && method === "DELETE") {
        comments = [];
        return Response.json({ deletedId: "comment-1" });
      }
      return Response.json({ error: { code: "not_found", message: url.pathname } }, { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  test("applies a safe launch update silently", async () => {
    pwaNeedRefresh = true;
    render(<App />);

    await waitFor(() => expect(pwaUpdateCalls).toBe(1));
    expect(screen.queryByText("An app update is ready.")).toBeNull();
  });

  test("keeps the update prompt when Settings may contain unapplied changes", async () => {
    window.history.replaceState(null, "", "/settings");
    const view = render(<App />);

    await screen.findByRole("region", { name: "Settings" });
    fireEvent.change(screen.getAllByLabelText("Font size")[0]!, {
      target: { value: "14" },
    });
    pwaNeedRefresh = true;
    view.rerender(<App />);
    expect(screen.getByText("An app update is ready.")).toBeTruthy();
    expect(pwaUpdateCalls).toBe(0);
  });

  test("resizes, reviews and advances, then navigates back", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    expect(screen.getByText("11px")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase diff font size" }));
    expect(screen.getByText("12px")).toBeTruthy();
    expect(
      (JSON.parse(localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)!) as TypographyPreferences)
        .diff.fontSize,
    ).toBe(12);

    fireEvent.click(screen.getByRole("button", { name: /Review \+ next/ }));
    await waitFor(() => expect(screen.getByText("src/second.ts")).toBeTruthy());
    expect(
      requests.some((request) => request.path === "/api/repositories/repo/files/first/review"),
    ).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Previous file" })[0]!);
    await waitFor(() => expect(screen.getByText("src/first.ts")).toBeTruthy());
  });

  test("offers a network-only sign-in path when the secure session expires", async () => {
    bootstrapFailureStatus = 401;
    window.history.replaceState(null, "", "/?repo=repo-two");
    render(<App />);

    await screen.findByRole("heading", { name: "Sign-in expired" });
    expect(screen.getByText("Sign in again to continue using Couchview.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign in again" }).getAttribute("href"),
    ).toBe("/api/access/refresh?repo=repo-two");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset app cache" })).toBeNull();
  });

  test("stops a completed Access sign-in from silently looping", async () => {
    bootstrapFailureStatus = 401;
    window.history.replaceState(
      null,
      "",
      "/?repo=repo-two&access_refresh=1",
    );
    render(<App />);

    await screen.findByRole("heading", { name: "Sign-in didn’t complete" });
    expect(
      screen.getByText(
        "Cloudflare returned to Couchview, but this browser still does not have a usable Access session.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Reset Cloudflare sign-in" }).getAttribute("href"),
    ).toBe("/api/access/logout");
    expect(
      screen.getByRole("link", { name: "Try sign-in again" }).getAttribute("href"),
    ).toBe("/api/access/refresh?repo=repo-two");
    expect(window.location.search).toBe("?repo=repo-two");
  });

  test("offers sign-in, retry, and app-cache recovery for a connection failure", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
    render(<App />);

    await screen.findByRole("heading", { name: "Couchview is unavailable" });
    expect(screen.getByText("Could not reach Couchview.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset app cache" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign in again" }).getAttribute("href"),
    ).toBe("/api/access/refresh");
  });

  test("does not suggest authentication or cache recovery for a server response", async () => {
    bootstrapFailureStatus = 503;
    render(<App />);

    await screen.findByRole("heading", { name: "Couldn’t open Couchview" });
    expect(screen.getByText("Request failed (503)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset app cache" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
  });

  test("preserves tmux across Review and applies terminal settings only once", async () => {
    terminalAvailable = true;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Increase diff font size" }));
    fireEvent.click(screen.getByRole("button", { name: "Open tmux terminal" }));

    await waitFor(() => expect(rendererState.calls).toBe(1));
    await waitFor(() => expect(requests.some(
      (request) =>
        request.path === "/api/repositories/repo/terminal/attachments" &&
        request.method === "POST",
    )).toBe(true));
    expect(requests.find(
      (request) => request.path === "/api/repositories/repo/terminal/attachments",
    )).toMatchObject({
      body: {
        profileId: "tmux",
      },
    });
    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
    expect(document.querySelector("main.app-shell")?.classList.contains("terminal-active")).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(document.querySelector("main.app-shell")?.classList.contains("terminal-active")).toBe(
      false,
    );
    expect(
      document.querySelector(".terminal-workspace")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(screen.getByText("12px")).toBeTruthy();
    expect(rendererState.calls).toBe(1);
    expect(FakeTerminalWebSocket.instances).toHaveLength(1);
    expect(FakeTerminalWebSocket.instances[0]?.closes).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const settings = screen.getByRole("region", { name: "Settings" });
    const diffCard = within(settings)
      .getByRole("heading", { name: "Diff view" })
      .closest("section")!;
    const terminalCard = within(settings)
      .getByRole("heading", { name: "Terminal" })
      .closest("section")!;
    await waitFor(() => expect(previewRendererState.calls).toBe(1));
    expect(within(terminalCard).getByTestId("terminal-typography-preview")
      .getAttribute("data-renderer")).toBe("ghostty-web");
    expect(within(terminalCard).getByTestId("terminal-typography-preview")
      .querySelector("canvas")).toBeTruthy();
    fireEvent.change(within(diffCard).getByLabelText("Line height adjustment"), {
      target: { value: "3.5" },
    });
    fireEvent.change(within(terminalCard).getByLabelText("Font size"), {
      target: { value: "16" },
    });
    fireEvent.change(within(terminalCard).getByLabelText("Font size"), {
      target: { value: "17" },
    });
    fireEvent.change(within(terminalCard).getByLabelText("Font size"), {
      target: { value: "18" },
    });
    await waitFor(() => expect(rendererState.calls).toBe(1));
    expect(FakeTerminalWebSocket.instances[0]?.closes).toHaveLength(0);
    const applyTerminal = within(terminalCard).getByRole("button", {
      name: "Apply terminal changes",
    }) as HTMLButtonElement;
    expect(applyTerminal.disabled).toBe(false);

    fireEvent.click(applyTerminal);
    await waitFor(() => expect(rendererState.calls).toBe(2));
    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(2));
    expect(applyTerminal.disabled).toBe(true);

    fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Open tmux terminal" }));
    expect(rendererState.calls).toBe(2);
    expect(
      screen.getByRole("region", { name: "tmux terminal" }).getAttribute("aria-hidden"),
    ).toBe("false");
  });

  test("opens Settings directly from its own route", async () => {
    window.history.replaceState(null, "", "/settings?repo=repo");
    render(<App />);

    const settings = screen.getByRole("region", { name: "Settings" });
    expect(window.location.pathname).toBe("/settings");
    expect(within(settings).getByRole("heading", { name: "Typography" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Unified diff" })).toBeNull();

    fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
    await screen.findByText("src/first.ts");
    expect(window.location.pathname).toBe("/");
  });

  test("persists independent diff and terminal typography from Settings", async () => {
    terminalAvailable = true;
    render(<App />);
    await screen.findByText("src/first.ts");

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const settings = screen.getByRole("region", { name: "Settings" });
    expect(window.location.pathname).toBe("/settings");
    const diffCard = within(settings)
      .getByRole("heading", { name: "Diff view" })
      .closest("section")!;
    const terminalCard = within(settings)
      .getByRole("heading", { name: "Terminal" })
      .closest("section")!;
    expect(within(diffCard).getByTestId("diff-column-ruler").textContent).toContain("80");
    expect(within(terminalCard).getByTestId("terminal-column-ruler").textContent)
      .toContain("80");
    expect(within(terminalCard).getByLabelText("lualine preview").textContent)
      .toContain("NORMAL");
    expect(within(terminalCard).getByLabelText("lualine preview").textContent)
      .toContain("");
    expect(within(terminalCard).getByLabelText("tmux status preview").textContent)
      .toContain("nvim *");
    expect(within(terminalCard).getByLabelText("Cell width adjustment").getAttribute("min"))
      .toBe("-5");
    expect(within(terminalCard).getByLabelText("Cell width adjustment").getAttribute("max"))
      .toBe("5");

    fireEvent.click(within(diffCard).getByRole("button", { name: /^System monospace/ }));
    fireEvent.change(within(diffCard).getByLabelText("Font size"), {
      target: { value: "14" },
    });
    fireEvent.change(within(diffCard).getByLabelText("Line height adjustment"), {
      target: { value: "3.5" },
    });
    fireEvent.change(within(diffCard).getByLabelText("Width adjustment"), {
      target: { value: "0.4" },
    });

    fireEvent.click(within(terminalCard).getByRole("button", { name: /^System monospace/ }));
    fireEvent.change(within(terminalCard).getByLabelText("Font size"), {
      target: { value: "18" },
    });
    fireEvent.change(within(terminalCard).getByLabelText("Cell height adjustment"), {
      target: { value: "4" },
    });
    fireEvent.change(within(terminalCard).getByLabelText("Cell width adjustment"), {
      target: { value: "-5" },
    });

    expect(within(diffCard).getByTestId("diff-typography-preview").style.fontFamily)
      .toStartWith("ui-monospace");
    await waitFor(() => expect(previewRendererState.configs.at(-1)).toMatchObject({
      fontFamily: "system",
      fontSize: 18,
      cellHeightAdjustment: 4,
      cellWidthAdjustment: -5,
    }));
    expect(localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)).toBeNull();
    const defaultTerminal = {
      fontFamily: "iosevka",
      fontSize: 15,
      cellHeightAdjustment: 0,
      cellWidthAdjustment: 0,
    } as const;
    const applyDiff = within(diffCard).getByRole("button", {
      name: "Apply diff changes",
    }) as HTMLButtonElement;
    expect(applyDiff.disabled).toBe(false);
    expect(applyDiff.closest("header")?.classList.contains("settings-card-header"))
      .toBe(true);
    expect(within(diffCard).getByText(/review is unchanged/)).toBeTruthy();

    fireEvent.click(applyDiff);
    expect(applyDiff.disabled).toBe(true);
    const diffApplied = JSON.parse(
      localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)!,
    ) as TypographyPreferences;
    expect(diffApplied.diff).toEqual({
      fontFamily: "system",
      fontSize: 14,
      lineHeightAdjustment: 3.5,
      widthAdjustment: 0.4,
    });
    expect(diffApplied.terminal).toEqual(defaultTerminal);

    const applyTerminal = within(terminalCard).getByRole("button", {
      name: "Apply terminal changes",
    }) as HTMLButtonElement;
    expect(applyTerminal.disabled).toBe(false);
    expect(applyTerminal.closest("header")?.classList.contains("settings-card-header"))
      .toBe(true);
    expect(within(terminalCard).getByText(/running terminal is unchanged/)).toBeTruthy();

    fireEvent.click(applyTerminal);
    expect(applyTerminal.disabled).toBe(true);
    const stored = JSON.parse(
      localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)!,
    ) as TypographyPreferences;
    expect(stored.terminal).toEqual({
      fontFamily: "system",
      fontSize: 18,
      cellHeightAdjustment: 4,
      cellWidthAdjustment: -5,
    });

    fireEvent.click(within(settings).getByRole("button", { name: "Review" }));
    expect(window.location.pathname).toBe("/");
    const viewer = screen.getByTestId("pierre-code-view");
    expect(viewer.style.fontFamily).toStartWith("ui-monospace");
    expect(viewer.style.fontSize).toBe("14px");
    expect(viewer.style.lineHeight).toBe("25.2px");
    expect(viewer.style.letterSpacing).toBe("0.4px");

    fireEvent.click(screen.getByRole("button", { name: "Open tmux terminal" }));
    await waitFor(() => expect(rendererState.calls).toBe(1));
    expect(rendererState.options?.config).toMatchObject(stored.terminal);
  });

  test("migrates pre-rename display preferences", async () => {
    localStorage.setItem("couch-review:font-size", "13");
    localStorage.setItem("couch-review:line-numbers", "true");
    localStorage.setItem("couch-review:line-wrap", "true");

    render(<App />);

    await screen.findByText("src/first.ts");
    expect(screen.getByText("13px")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide line numbers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep long lines on one line" })).toBeTruthy();
    expect(
      (JSON.parse(localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)!) as TypographyPreferences)
        .diff.fontSize,
    ).toBe(13);
    expect(localStorage.getItem("couchview:line-numbers")).toBe("true");
    expect(localStorage.getItem("couchview:line-wrap")).toBe("true");
  });

  test("preloads adjacent diffs and reuses them for instant back-and-forth navigation", async () => {
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    const diffRequestCount = (fileId: string) =>
      requests.filter(
        (request) =>
          request.path === `/api/repositories/repo/files/${fileId}/diff`,
      ).length;
    await waitFor(() => expect(diffRequestCount("second")).toBe(1));

    fireEvent.click(
      screen.getAllByRole("button", { name: "Next file" })[0]!,
    );
    expect(screen.queryByText("Loading diff…")).toBeNull();
    expect(screen.getByTestId("pierre-code-view").textContent).toContain(
      "export const second = true;",
    );
    expect(diffRequestCount("second")).toBe(1);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Previous file" })[0]!,
    );
    expect(screen.queryByText("Loading diff…")).toBeNull();
    expect(screen.getByTestId("pierre-code-view").textContent).toContain(
      "const value = load(newPath);",
    );
    expect(diffRequestCount("first")).toBe(1);
  });

  test("does not reload the diff for duplicate SSE operation revisions", async () => {
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
    const stream = EventSourceStub.instances[0];
    if (!stream?.onmessage) throw new Error("event stream was not connected");
    const diffRequestCount = () =>
      requests.filter(
        (request) => request.path === "/api/repositories/repo/files/first/diff",
      ).length;
    const reviewRequestCount = () =>
      requests.filter(
        (request) =>
          request.path === "/api/repositories/repo/comments" &&
          request.method === "GET",
      ).length;
    const initialDiffRequests = diffRequestCount();
    const initialReviewRequests = reviewRequestCount();
    const event = {
      repositoryId: "repo",
      operationRevision: "operation-1",
      stateRevision: 0,
      catalogRevision: 1,
      at: "2026-07-22T10:00:00.000Z",
    };

    await act(async () => {
      stream.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ ...event, type: "ready" }),
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(reviewRequestCount()).toBe(initialReviewRequests + 1));
    expect(diffRequestCount()).toBe(initialDiffRequests);

    await act(async () => {
      stream.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ ...event, type: "changes" }),
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(diffRequestCount()).toBe(initialDiffRequests);
  });

  test("stages optimistically without refreshing files or reloading an unchanged diff", async () => {
    delayStageResponse = true;
    emitSseDuringStage = true;
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
    const fileRequestCount = () =>
      requests.filter(
        (request) =>
          request.path === "/api/repositories/repo/files" &&
          request.method === "GET",
      ).length;
    const diffRequestCount = () =>
      requests.filter(
        (request) => request.path === "/api/repositories/repo/files/first/diff",
      ).length;
    const initialFileRequests = fileRequestCount();
    const initialDiffRequests = diffRequestCount();

    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await waitFor(() => expect(releaseStageResponse).not.toBeNull());

    expect(screen.getByRole("button", { name: "Unstage current file" })).toBeTruthy();
    expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
    expect(screen.queryByText("Loading diff…")).toBeNull();
    expect(fileRequestCount()).toBe(initialFileRequests);
    expect(diffRequestCount()).toBe(initialDiffRequests);

    await act(async () => {
      releaseStageResponse?.();
      await Promise.resolve();
    });

    await screen.findByText("File staged");
    expect(fileRequestCount()).toBe(initialFileRequests);
    expect(diffRequestCount()).toBe(initialDiffRequests);
    expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
  });

  test("stages only reviewed files from the changed-files drawer", async () => {
    files[0] = { ...files[0]!, reviewed: true };
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    const diffRequestCount = () =>
      requests.filter(
        (request) => request.path === "/api/repositories/repo/files/first/diff",
      ).length;
    const initialDiffRequests = diffRequestCount();
    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    const drawer = await screen.findByRole("complementary", {
      name: "Changed files",
    });
    expect(
      within(drawer).getByRole("button", { name: "Stage all files (2)" }),
    ).toBeTruthy();
    fireEvent.click(
      within(drawer).getByRole("button", {
        name: "Stage reviewed files (1)",
      }),
    );

    await screen.findByText("1 reviewed file staged");
    expect(
      requests.find(
        (request) => request.path === "/api/repositories/repo/files/stage",
      )?.body,
    ).toMatchObject({
      files: [{ fileId: "first", contentRevision: "first-v1" }],
      operationRevision: "operation-1",
    });
    expect(
      within(drawer).getByRole("button", { name: "Stage all files (1)" }),
    ).toBeTruthy();
    expect(
      (
        within(drawer).getByRole("button", {
          name: "Stage reviewed files (0)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(diffRequestCount()).toBe(initialDiffRequests);
    expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
  });

  test("stages every changed file from the drawer in one request", async () => {
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    const drawer = await screen.findByRole("complementary", {
      name: "Changed files",
    });
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Stage all files (2)" }),
    );

    await screen.findByText("2 files staged");
    expect(
      requests.find(
        (request) => request.path === "/api/repositories/repo/files/stage",
      )?.body,
    ).toMatchObject({
      files: [
        { fileId: "first", contentRevision: "first-v1" },
        { fileId: "second", contentRevision: "second-v1" },
      ],
      operationRevision: "operation-1",
    });
    expect(
      within(drawer).getByRole("button", {
        name: "Commit 2 staged files",
      }),
    ).toBeTruthy();
    expect(
      (
        within(drawer).getByRole("button", {
          name: "Stage all files (0)",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test("selects the next file when an authoritative stage delta removes the active file", async () => {
    files[0] = {
      ...files[0]!,
      indexStatus: "A",
      worktreeStatus: "D",
      staged: true,
      unstaged: true,
    };
    removeActiveFileOnStage = true;
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));

    await screen.findByText("src/second.ts");
    await waitFor(() =>
      expect(screen.getByTestId("pierre-code-view").textContent).toContain(
        "export const second = true;",
      ),
    );
  });

  test("applies external staging metadata without reloading unchanged diff content", async () => {
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
    const stream = EventSourceStub.instances[0];
    if (!stream?.onmessage) throw new Error("event stream was not connected");
    const diffRequestCount = () =>
      requests.filter(
        (request) => request.path === "/api/repositories/repo/files/first/diff",
      ).length;
    const initialDiffRequests = diffRequestCount();
    files[0] = {
      ...files[0]!,
      indexStatus: "M",
      worktreeStatus: ".",
      staged: true,
      unstaged: false,
    };
    currentOperationRevision = "operation-external-stage";

    await act(async () => {
      stream.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "changes",
            repositoryId: "repo",
            operationRevision: currentOperationRevision,
            stateRevision: 0,
            catalogRevision: 1,
            at: "2026-07-22T10:00:00.000Z",
          }),
        }),
      );
    });

    await screen.findByRole("button", { name: "Unstage current file" });
    expect(diffRequestCount()).toBe(initialDiffRequests);
    expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
  });

  test("keeps the current diff mounted during a real background diff refresh", async () => {
    render(<App />);

    await screen.findByTestId("pierre-code-view");
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
    const stream = EventSourceStub.instances[0];
    if (!stream?.onmessage) throw new Error("event stream was not connected");
    files[0] = {
      ...files[0]!,
      contentRevision: "first-v2",
    };
    servedFirstDiff = {
      ...servedFirstDiff,
      contentRevision: "first-v2",
      operationRevision: "operation-content-change",
    };
    currentOperationRevision = "operation-content-change";
    delayNextDiffResponse = true;

    await act(async () => {
      stream.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "changes",
            repositoryId: "repo",
            operationRevision: currentOperationRevision,
            stateRevision: 0,
            catalogRevision: 1,
            at: "2026-07-22T10:00:00.000Z",
          }),
        }),
      );
    });
    await screen.findByText("Refreshing diff…");

    expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
    expect(screen.queryByText("Loading diff…")).toBeNull();

    await act(async () => {
      releaseDiffResponse?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText("Refreshing diff…")).toBeNull());
    expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
  });

  test("pairs native IDEs, opens Zed through the managed alias, and revokes devices", async () => {
    remoteBridgeAvailable = true;
    remoteBridgeDevices = [{
      id: "device-one",
      repositoryId: repository.id,
      label: "MacBook Air",
      sshAlias: "couchview-fixture-device-one",
      createdAt: "2026-07-29T10:00:00.000Z",
      lastUsedAt: "2026-07-29T10:01:00.000Z",
    }];
    render(<App />);
    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Set up native IDE" }));

    const dialog = await screen.findByRole("dialog", { name: "Native IDE setup" });
    expect(within(dialog).getByText("Direct WebRTC preferred")).toBeTruthy();
    const zedLink = within(dialog).getByRole("link", { name: "Open" });
    expect(zedLink.getAttribute("href")).toBe(
      "zed://ssh/couchview-fixture-device-one/fixture",
    );
    expect(within(dialog).getByText(
      "zed 'ssh://couchview-fixture-device-one/fixture'",
    )).toBeTruthy();
    expect(within(dialog).getByText(
      "couchview bridge codex --profile couchview-fixture-device-one --repo '/fixture'",
    )).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Device name"), {
      target: { value: "Travel Air" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
    await within(dialog).findByText(/couchview bridge pair --url/);
    expect(requests).toContainEqual({
      path: `/api/repositories/${repository.id}/remote-bridge/pairings`,
      method: "POST",
      body: { label: "Travel Air" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke MacBook Air" }));
    await waitFor(() => expect(requests).toContainEqual({
      path: `/api/repositories/${repository.id}/remote-bridge/pairings/device-one`,
      method: "DELETE",
      body: null,
    }));
    await waitFor(() => expect(within(dialog).queryByText("MacBook Air")).toBeNull());
  });

  test("reuses one native IDE pairing for another registered repository", async () => {
    remoteBridgeAvailable = true;
    remoteBridgeDevices = [{
      id: "device-one",
      repositoryId: repository.id,
      label: "MacBook Air",
      sshAlias: "couchview-fixture-device-one",
      createdAt: "2026-07-29T10:00:00.000Z",
      lastUsedAt: null,
    }];
    render(<App />);
    await screen.findByText("src/first.ts");

    fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
    const picker = await screen.findByRole("dialog", { name: "Repositories" });
    fireEvent.click(
      within(picker).getByRole("button", {
        name: /second-fixture \/second-fixture/,
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
        "second-fixture",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up native IDE" }));
    const dialog = await screen.findByRole("dialog", { name: "Native IDE setup" });
    expect(within(dialog).getByText("MacBook Air")).toBeTruthy();
    expect(within(dialog).getByText(
      "zed 'ssh://couchview-fixture-device-one/second-fixture'",
    )).toBeTruthy();
    expect(within(dialog).getByText(
      "couchview bridge codex --profile couchview-fixture-device-one --repo '/second-fixture'",
    )).toBeTruthy();
    expect(requests).toContainEqual({
      path: "/api/repositories/repo-two/remote-bridge/pairings",
      method: "GET",
      body: null,
    });
  });

  test("switches repositories through the picker and follows URL history", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
    const picker = await screen.findByRole("dialog", { name: "Repositories" });
    expect(within(picker).getByText("/second-fixture")).toBeTruthy();
    fireEvent.click(
      within(picker).getByRole("button", {
        name: /second-fixture \/second-fixture/,
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
        "second-fixture",
      );
    });
    expect(new URL(window.location.href).searchParams.get("repo")).toBe("repo-two");
    expect(requests.some((request) => request.path === "/api/repositories/repo-two/files")).toBe(
      true,
    );

    window.history.replaceState(null, "", "/?repo=repo");
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.popState(window);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
        "fixture",
      );
    });
  });

  test("starts a rebuild and waits for the replacement server", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
    const picker = await screen.findByRole("dialog", { name: "Repositories" });
    fireEvent.click(
      within(picker).getByRole("button", {
        name: "Rebuild & restart Couchview",
      }),
    );

    expect(await screen.findByText("Restarting Couchview…")).toBeTruthy();
    expect(
      requests.some(
        (request) =>
          request.path === "/api/restart" &&
          request.method === "POST",
      ),
    ).toBe(true);
  });

  test("shows unavailable repositories and confirms Forget", async () => {
    catalog[1] = { ...catalog[1]!, available: false };
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
    const picker = await screen.findByRole("dialog", { name: "Repositories" });
    expect(within(picker).getByText("Unavailable")).toBeTruthy();
    const unavailableProject = within(picker).getByRole("button", {
      name: /second-fixture \/second-fixture Unavailable/,
    }) as HTMLButtonElement;
    expect(unavailableProject.disabled).toBe(true);

    fireEvent.click(within(picker).getByRole("button", { name: "Forget second-fixture" }));
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/repositories/repo-two" && request.method === "DELETE",
        ),
      ).toBe(true);
    });
  });

  test("warns once before forgetting a repository and terminating its tmux work", async () => {
    catalog[1] = { ...catalog[1]!, available: false };
    const confirmations: string[] = [];
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: (message: string) => {
        confirmations.push(message);
        return true;
      },
    });
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
    const picker = await screen.findByRole("dialog", { name: "Repositories" });
    fireEvent.click(within(picker).getByRole("button", { name: "Forget second-fixture" }));

    await waitFor(() => expect(
      requests.filter(
        (entry) => entry.path === "/api/repositories/repo-two" && entry.method === "DELETE",
      ),
    ).toHaveLength(1));
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toContain("running programs and unsaved work");
  });

  test("aborts an in-flight repository load when another project is selected", async () => {
    render(<App />);
    await screen.findByText("src/first.ts");

    const normalFetch = globalThis.fetch;
    let secondLoadAborted = false;
    globalThis.fetch = ((input, init) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, "http://localhost");
      if (url.pathname !== "/api/repositories/repo-two/files") {
        return normalFetch(input, init);
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            secondLoadAborted = true;
            reject(new TypeError("aborted"));
          },
          { once: true },
        );
      });
    }) as typeof fetch;

    fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
    const picker = await screen.findByRole("dialog", { name: "Repositories" });
    fireEvent.click(
      within(picker).getByRole("button", { name: /second-fixture \/second-fixture/ }),
    );
    await waitFor(() =>
      expect(
        requests.some((request) => request.path === "/api/repositories/repo-two/comments"),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
    const returnPicker = await screen.findByRole("dialog", { name: "Repositories" });
    fireEvent.click(
      within(returnPicker).getByRole("button", { name: /fixture \/fixture/ }),
    );
    await waitFor(() => expect(secondLoadAborted).toBe(true));
    await screen.findByText("src/first.ts");
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
        requests.find(
          (request) => request.path === "/api/repositories/repo/files/first/review",
        )?.body,
      ).toMatchObject({ reviewed: true }),
    );
    expect(screen.getByText("src/first.ts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await screen.findByRole("button", { name: "Unstage current file" });
    expect(
      requests.find(
        (request) => request.path === "/api/repositories/repo/files/first/stage",
      )?.body,
    ).toMatchObject({ staged: true });

    fireEvent.click(screen.getByRole("button", { name: "Unstage current file" }));
    await screen.findByRole("button", { name: "Stage current file" });
    expect(
      requests
        .filter((request) => request.path === "/api/repositories/repo/files/first/stage")
        .at(-1)?.body,
    ).toMatchObject({ staged: false });
  });

  test("shows structured diagnostics when a diff unexpectedly returns no output", async () => {
    diffFailure = true;
    render(<App />);

    await screen.findByText("Couldn’t load this diff");
    expect(
      screen.getByText("Git diff returned no data for a changed file after two attempts"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Error details" }));
    const details = await screen.findByRole("dialog", { name: "Git error details" });
    expect(within(details).getByText("diff1234")).toBeTruthy();
    expect(within(details).getByText("empty_output")).toBeTruthy();
    expect(
      within(details).getByText(
        "Git reported this path as changed but returned no diff output.",
      ),
    ).toBeTruthy();
  });

  test("opens Git timeout diagnostics from a failed staging toast", async () => {
    stageFailure = true;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await screen.findByText("Git update-index stopped responding after 15 seconds");
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const details = await screen.findByRole("dialog", { name: "Git error details" });
    expect(within(details).getByText("stage123")).toBeTruthy();
    expect(within(details).getByText("update-index")).toBeTruthy();
    expect(within(details).getByText("timeout")).toBeTruthy();
  });

  test("commits staged files from the changed-files drawer", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await screen.findByRole("button", { name: "Unstage current file" });

    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Commit 1 staged file" }),
    );
    const composer = await screen.findByRole("dialog", {
      name: "Commit staged changes",
    });
    expect(
      requests.some(
        (request) =>
          request.path === "/api/repositories/repo/commit-message",
      ),
    ).toBe(false);
    fireEvent.click(
      within(composer).getByRole("button", { name: "Generate with Codex" }),
    );
    const generated = await within(composer).findByDisplayValue(
      "feat(review): generate commit messages with Codex",
    );
    expect(
      requests.find(
        (request) =>
          request.path === "/api/repositories/repo/commit-message",
      ),
    ).toMatchObject({
      method: "POST",
      body: { operationRevision: "operation-2" },
    });
    fireEvent.change(generated, {
      target: { value: "fix(review): edit the generated commit message" },
    });
    fireEvent.click(
      within(composer).getByRole("button", { name: "Commit staged changes" }),
    );

    await screen.findByText("Committed abc1234");
    expect(
      requests.find((request) => request.path === "/api/repositories/repo/commit"),
    ).toMatchObject({
      method: "POST",
      body: {
        message: "fix(review): edit the generated commit message",
        operationRevision: "operation-2",
      },
    });
    await waitFor(() => expect(screen.getByText("src/second.ts")).toBeTruthy());
  });

  test("preserves a commit draft when Codex generation fails", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await screen.findByRole("button", { name: "Unstage current file" });
    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Commit 1 staged file" }),
    );
    const composer = await screen.findByRole("dialog", {
      name: "Commit staged changes",
    });
    const input = within(composer).getByPlaceholderText("Commit message…");
    fireEvent.change(input, {
      target: { value: "fix(review): preserve this draft" },
    });
    commitMessageFailure = true;
    fireEvent.click(
      within(composer).getByRole("button", {
        name: "Regenerate with Codex",
      }),
    );

    await screen.findByText("Codex could not generate a commit message");
    expect((input as HTMLTextAreaElement).value).toBe(
      "fix(review): preserve this draft",
    );
  });

  test("aborts Codex generation when the commit editor closes", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await screen.findByRole("button", { name: "Unstage current file" });
    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Commit 1 staged file" }),
    );
    const composer = await screen.findByRole("dialog", {
      name: "Commit staged changes",
    });
    delayCommitMessageResponse = true;
    fireEvent.click(
      within(composer).getByRole("button", { name: "Generate with Codex" }),
    );
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/repositories/repo/commit-message",
        ),
      ).toBe(true),
    );
    fireEvent.click(
      within(composer).getByRole("button", { name: "Close commit editor" }),
    );

    await waitFor(() => expect(commitMessageRequestAborted).toBe(true));
    expect(screen.queryByRole("dialog", { name: "Commit staged changes" })).toBeNull();
    releaseCommitMessageResponse?.();
  });

  test("explains when Codex commit generation is unavailable", async () => {
    commitMessageAvailable = false;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
    await screen.findByRole("button", { name: "Unstage current file" });
    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Commit 1 staged file" }),
    );
    const composer = await screen.findByRole("dialog", {
      name: "Commit staged changes",
    });
    expect(
      (
        within(composer).getByRole("button", {
          name: "Generate with Codex",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      within(composer).getByText("Codex CLI is unavailable in this test."),
    ).toBeTruthy();
  });

  test("groups package scripts by subproject and streams a completed run", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Commands/ }),
    );
    expect(await screen.findByText("fixture-root")).toBeTruthy();
    expect(screen.getByText("@fixture/web")).toBeTruthy();
    expect(screen.getByText("vite build")).toBeTruthy();
    expect(screen.getByText(/Package scripts run on this computer/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Run build in apps/web" }),
    );
    const output = await screen.findByRole("dialog", {
      name: "Package command output",
    });
    expect(
      requests.find(
        (request) =>
          request.path === "/api/repositories/repo/package-runs" &&
          request.method === "POST",
      ),
    ).toMatchObject({
      body: {
        packagePath: "apps/web/package.json",
        scriptName: "build",
        manifestRevision: "web-package-revision",
      },
    });
    await waitFor(() => expect(EventSourceStub.instances.length).toBeGreaterThan(1));
    const stream = EventSourceStub.instances.at(-1)!;
    const running = packageRuns[0]!;
    await act(async () => {
      stream.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "snapshot",
            snapshot: {
              run: running,
              output: [
                { sequence: 1, stream: "stdout", text: "building web\n" },
              ],
            },
          }),
        }),
      );
      stream.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "status",
            run: {
              ...running,
              status: "succeeded",
              exitCode: 0,
              finishedAt: "2026-07-23T10:00:02.000Z",
            },
          }),
        }),
      );
    });

    expect(within(output).getByText("building web")).toBeTruthy();
    expect(within(output).getByText("Passed")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Package command output" }),
      ).toBeNull()
    );
    expect(
      requests.some((request) => request.path.endsWith("/stop")),
    ).toBe(false);
  });

  test("stops a running package script from its output sheet", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
    fireEvent.click(await screen.findByRole("button", { name: /Commands/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run dev in ." }));
    const output = await screen.findByRole("dialog", {
      name: "Package command output",
    });
    fireEvent.click(within(output).getByRole("button", { name: "Stop" }));

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/repositories/repo/package-runs/package-run-1/stop" &&
            request.method === "POST",
        ),
      ).toBe(true)
    );
    expect(await within(output).findByText("Stopping")).toBeTruthy();
  });

  test("hides line numbers by default and remembers the 123 toggle", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    expect(screen.queryByRole("button", { name: "Select old line 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show line numbers" }));
    expect(await screen.findByRole("button", { name: "Select old line 1" })).toBeTruthy();
    expect(localStorage.getItem("couchview:line-numbers")).toBe("true");

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
    expect(localStorage.getItem("couchview:line-wrap")).toBe("true");

    cleanup();
    render(<App />);
    await screen.findByText("src/first.ts");
    expect(screen.getByRole("button", { name: "Keep long lines on one line" })).toBeTruthy();
    expect((await screen.findByTestId("pierre-code-view")).dataset.lineWrap).toBe("true");
  });

  test("jumps to the only hunk from above or below it", async () => {
    render(<App />);

    await screen.findByText("src/first.ts");
    const previousHunk = screen.getByRole("button", {
      name: "Previous hunk",
    }) as HTMLButtonElement;
    const nextHunk = screen.getByRole("button", {
      name: "Next hunk",
    }) as HTMLButtonElement;
    await waitFor(() => expect(nextHunk.disabled).toBe(false));
    expect(previousHunk.disabled).toBe(true);

    fireEvent.click(nextHunk);

    expect(viewerHunkJumps).toEqual([0]);
    expect(nextHunk.disabled).toBe(true);
    expect(previousHunk.disabled).toBe(true);

    act(() => viewerVisibleLineChange?.(100, "new"));
    expect(previousHunk.disabled).toBe(false);
    expect(nextHunk.disabled).toBe(true);

    fireEvent.click(previousHunk);
    expect(viewerHunkJumps).toEqual([0, 0]);
    expect(previousHunk.disabled).toBe(true);
  });

  test("routes hunk navigation without skipping the first hunk", async () => {
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
    expect(viewerHunkJumps).toEqual([0]);
    expect(nextHunk.disabled).toBe(false);

    fireEvent.click(nextHunk);
    expect(viewerHunkJumps).toEqual([0, 1]);
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

  test("replaces the review comments tray when opening Send to Codex", async () => {
    comments = [fixtureComment("comment-1", "Send this to Codex")];
    files[0]!.commentCount = 1;
    render(<App />);

    await screen.findByText("src/first.ts");
    fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
    expect(await screen.findByRole("dialog", { name: "Review comments" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send to Codex" }));

    expect(await screen.findByRole("dialog", { name: "Send comments to Codex" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Review comments" })).toBeNull();
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
