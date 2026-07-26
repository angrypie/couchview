import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TERMINAL_ENDED_CLOSE_CODE } from "../shared/contracts.ts";
import {
  FakeTerminalWebSocket,
  rendererState,
  resetFakeTerminalWebSockets,
  resetRendererState,
  terminalRendererFactory,
} from "./terminalTestFakes.ts";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

mock.module("./ghosttyTerminal.ts", () => ({
  createBrowserTerminal: terminalRendererFactory,
}));

const React = await import("react");
const { act, cleanup, fireEvent, render, screen, waitFor } = await import(
  "@testing-library/react"
);
const { TerminalWorkspace } = await import("./TerminalWorkspace.tsx");

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalConfirm = window.confirm;

const capability = {
  available: true,
  reason: null,
  persistence: "tmux" as const,
  profiles: [
    { id: "nvim" as const, label: "Neovim", available: true, reason: null },
  ],
};

interface FetchRecord {
  body: unknown;
  method: string;
  path: string;
}

let fetchRecords: FetchRecord[] = [];
let attachmentResponses: Response[] = [];
let endResponses: Response[] = [];

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function terminalFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl, "http://127.0.0.1:4173");
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const rawBody = init?.body ?? (input instanceof Request ? input.body : null);
  const body = typeof rawBody === "string" ? JSON.parse(rawBody) : null;
  fetchRecords.push({ body, method, path: url.pathname });
  if (url.pathname.endsWith("/terminal/attachments")) {
    return Promise.resolve(attachmentResponses.shift() ?? jsonResponse({
      ticket: "ticket-1",
      expiresAt: "2026-07-26T12:00:30.000Z",
      protocol: "couchview-terminal-v1",
      session: { profileId: "nvim", running: true, controllerConnected: false },
    }, 201));
  }
  if (url.pathname.endsWith("/terminal/open")) {
    return Promise.resolve(jsonResponse({ status: "opened" }));
  }
  if (url.pathname.endsWith("/terminal/end")) {
    return Promise.resolve(endResponses.shift() ?? jsonResponse({ status: "ended" }));
  }
  return Promise.resolve(jsonResponse({ error: { code: "not_found", message: url.pathname } }, 404));
}

function defaultProps() {
  return {
    active: true,
    capability,
    csrfToken: "csrf-token",
    repositoryId: "repo",
    repositoryName: "fixture",
    targetRequest: null,
    onBack: mock(() => undefined),
    onEnded: mock(() => undefined),
    onNotice: mock((_message: string) => undefined),
    onTargetHandled: mock((_requestId: number) => undefined),
  };
}

beforeEach(() => {
  resetRendererState();
  fetchRecords = [];
  attachmentResponses = [];
  endResponses = [];
  resetFakeTerminalWebSockets();
  sessionStorage.clear();
  globalThis.fetch = terminalFetch as typeof fetch;
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeTerminalWebSocket,
  });
  Object.defineProperty(window, "WebSocket", {
    configurable: true,
    value: FakeTerminalWebSocket,
  });
  window.confirm = () => true;
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
  window.confirm = originalConfirm;
});

describe("TerminalWorkspace", () => {
  test("loads lazily, streams binary data, and stays mounted while Review is active", async () => {
    const props = defaultProps();
    const view = render(<TerminalWorkspace {...props} />);

    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
    const socket = FakeTerminalWebSocket.instances[0]!;
    expect(rendererState.calls).toBe(1);
    expect(fetchRecords[0]).toMatchObject({
      method: "POST",
      path: "/api/repositories/repo/terminal/attachments",
      body: { cols: 100, rows: 32, takeover: false },
    });
    expect(socket.protocols).toEqual([
      "couchview-terminal-v1",
      "couchview-ticket.ticket-1",
    ]);

    await act(async () => {
      socket.emitMessage(JSON.stringify({ type: "ready", profileId: "nvim" }));
    });
    expect(screen.getByText("Connected")).toBeTruthy();
    const bytes = new Uint8Array([0x1b, 0x5b, 0x32, 0x4a]);
    await act(async () => socket.emitMessage(bytes.buffer));
    expect(rendererState.writes).toHaveLength(1);
    expect([...rendererState.writes[0]!]).toEqual([...bytes]);

    if (!rendererState.options) throw new Error("renderer callbacks missing");
    rendererState.options.onData(new TextEncoder().encode("ihello"));
    rendererState.options.onResize(120, 40);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(socket.sent.some((value) => value instanceof Uint8Array)).toBe(true);
    expect(socket.sent).toContain(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));

    view.rerender(<TerminalWorkspace {...props} active={false} />);
    expect(
      view.container.querySelector(".terminal-workspace")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(rendererState.disposed).toBe(0);
    expect(socket.closes).toHaveLength(0);

    view.rerender(<TerminalWorkspace {...props} active />);
    await waitFor(() => expect(rendererState.focuses).toBeGreaterThan(0));
    expect(FakeTerminalWebSocket.instances).toHaveLength(1);
    view.unmount();
    expect(rendererState.disposed).toBe(1);
    expect(socket.closes).toContainEqual({ code: 1000, reason: "workspace_unmounted" });
  });

  test("opens later Review targets without reconnecting", async () => {
    const props = defaultProps();
    const view = render(<TerminalWorkspace {...props} />);
    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
    const socket = FakeTerminalWebSocket.instances[0]!;
    await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));

    const targetRequest = {
      id: 9,
      target: { fileId: "file-1", contentRevision: "revision-1", line: 37 },
    };
    view.rerender(<TerminalWorkspace {...props} targetRequest={targetRequest} />);
    await waitFor(() => expect(fetchRecords.some(
      (record) => record.path.endsWith("/terminal/open"),
    )).toBe(true));
    expect(fetchRecords.find((record) => record.path.endsWith("/terminal/open"))?.body).toEqual({
      target: targetRequest.target,
    });
    expect(props.onTargetHandled).toHaveBeenCalledWith(9);
    expect(FakeTerminalWebSocket.instances).toHaveLength(1);
  });

  test("asks before taking control from another tab", async () => {
    attachmentResponses.push(
      jsonResponse({
        error: {
          code: "terminal_in_use",
          message: "Neovim is controlled by another browser tab",
        },
      }, 409),
      jsonResponse({
        ticket: "takeover-ticket",
        expiresAt: "2026-07-26T12:00:30.000Z",
        protocol: "couchview-terminal-v1",
        session: { profileId: "nvim", running: true, controllerConnected: true },
      }, 201),
    );
    const confirmations: string[] = [];
    window.confirm = (message) => {
      confirmations.push(String(message));
      return true;
    };

    render(<TerminalWorkspace {...defaultProps()} />);
    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
    const attachmentBodies = fetchRecords
      .filter((record) => record.path.endsWith("/terminal/attachments"))
      .map((record) => record.body as { takeover: boolean });
    expect(attachmentBodies.map((body) => body.takeover)).toEqual([false, true]);
    expect(confirmations.join("\n")).toContain("Take control here");
    expect(FakeTerminalWebSocket.instances[0]?.protocols).toContain(
      "couchview-ticket.takeover-ticket",
    );
  });

  test("requires a second confirmation before discarding modified buffers", async () => {
    endResponses.push(
      jsonResponse({
        error: {
          code: "terminal_unsaved_buffers",
          message: "Neovim has 2 modified buffers",
        },
      }, 409),
      jsonResponse({ status: "ended" }),
    );
    const confirmations: string[] = [];
    window.confirm = (message) => {
      confirmations.push(String(message));
      return true;
    };
    const props = defaultProps();
    render(<TerminalWorkspace {...props} />);
    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
    const socket = FakeTerminalWebSocket.instances[0]!;
    await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));

    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await waitFor(() => expect(props.onEnded).toHaveBeenCalledTimes(1));
    const endBodies = fetchRecords
      .filter((record) => record.path.endsWith("/terminal/end"))
      .map((record) => record.body);
    expect(endBodies).toEqual([{ force: false }, { force: true }]);
    expect(confirmations).toHaveLength(2);
    expect(confirmations[1]).toContain("discard unsaved buffers");
    expect(screen.getAllByText("Session ended")).toHaveLength(2);
  });

  test("does not load the renderer when the server capability is unavailable", async () => {
    render(
      <TerminalWorkspace
        {...defaultProps()}
        capability={{
          ...capability,
          available: false,
          reason: "Install Neovim",
          profiles: [
            { id: "nvim", label: "Neovim", available: false, reason: "Install Neovim" },
          ],
        }}
      />,
    );
    expect(await screen.findByText("Install Neovim")).toBeTruthy();
    expect(rendererState.calls).toBe(0);
    expect(fetchRecords).toHaveLength(0);
  });

  test("does not reconnect after the server ends the session", async () => {
    render(<TerminalWorkspace {...defaultProps()} />);
    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
    const socket = FakeTerminalWebSocket.instances[0]!;
    await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));

    await act(async () => socket.emitClose(TERMINAL_ENDED_CLOSE_CODE));
    expect(screen.getAllByText("Session ended")).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(FakeTerminalWebSocket.instances).toHaveLength(1);
  });

  test("retries renderer initialization after a transient load failure", async () => {
    rendererState.failure = new Error("temporary WASM failure");
    render(<TerminalWorkspace {...defaultProps()} />);

    expect(await screen.findByText(/temporary WASM failure/)).toBeTruthy();
    expect(FakeTerminalWebSocket.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
    expect(rendererState.calls).toBe(2);
  });
});
