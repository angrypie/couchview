import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  LoaderCircle,
  RotateCw,
  SquareTerminal,
  Trash2,
} from "lucide-react";

import {
  API_ROUTES,
  TERMINAL_ENDED_CLOSE_CODE,
  type TerminalCapability,
  type TerminalFileTarget,
} from "../shared/contracts.ts";
import { ApiError, api } from "./api.ts";
import {
  createBrowserTerminal,
  type BrowserTerminalRenderer,
} from "./ghosttyTerminal.ts";

type ConnectionState =
  | "loading"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "in-use"
  | "taken-over"
  | "ended"
  | "error";

export interface TerminalTargetRequest {
  id: number;
  target: TerminalFileTarget;
}

interface TerminalWorkspaceProps {
  active: boolean;
  capability: TerminalCapability;
  csrfToken: string;
  repositoryId: string;
  repositoryName: string;
  targetRequest: TerminalTargetRequest | null;
  onBack(): void;
  onEnded(): void;
  onNotice(message: string): void;
  onTargetHandled(requestId: number): void;
}

const clientStorageKey = "couchview:terminal-client-id";

function terminalClientId(): string {
  const existing = window.sessionStorage.getItem(clientStorageKey);
  if (existing && /^[A-Za-z0-9_-]{8,128}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const created = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  window.sessionStorage.setItem(clientStorageKey, created);
  return created;
}

function canForceEnd(error: unknown): error is ApiError {
  return error instanceof ApiError && [
    "terminal_unsaved_buffers",
    "terminal_quit_failed",
    "terminal_unavailable",
  ].includes(error.code);
}

function terminalWebSocketUrl(repositoryId: string): string {
  const url = new URL(API_ROUTES.terminalSocket(repositoryId), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function stateLabel(state: ConnectionState): string {
  switch (state) {
    case "loading":
      return "Loading terminal";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "connected":
      return "Connected";
    case "in-use":
      return "In use in another tab";
    case "taken-over":
      return "Control moved to another tab";
    case "ended":
      return "Session ended";
    default:
      return "Disconnected";
  }
}

export function TerminalWorkspace({
  active,
  capability,
  csrfToken,
  repositoryId,
  repositoryName,
  targetRequest,
  onBack,
  onEnded,
  onNotice,
  onTargetHandled,
}: TerminalWorkspaceProps) {
  const [rendererReady, setRendererReady] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [rendererRetryNonce, setRendererRetryNonce] = useState(0);
  const [ending, setEnding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BrowserTerminalRenderer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const expectedCloseRef = useRef(false);
  const targetRequestRef = useRef(targetRequest);
  const activeRef = useRef(active);
  const handledTargetRef = useRef<number | null>(null);

  targetRequestRef.current = targetRequest;
  activeRef.current = active;

  const requestReconnect = useCallback((immediate = false) => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
    }
    const delay = immediate
      ? 0
      : Math.min(5_000, 250 * 2 ** Math.min(reconnectAttemptRef.current, 5));
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setReconnectNonce((value) => value + 1);
    }, delay);
  }, []);

  useEffect(() => {
    if (!capability.available || !containerRef.current) {
      setConnectionState("error");
      setConnectionError(capability.reason);
      return;
    }
    let disposed = false;
    setConnectionState("loading");
    setConnectionError(null);
    void createBrowserTerminal({
      container: containerRef.current,
      onData(data) {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) socket.send(data);
      },
      onResize(cols, rows) {
        if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null;
          const socket = socketRef.current;
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        }, 50);
      },
    }).then((renderer) => {
      if (disposed) {
        renderer.dispose();
        return;
      }
      rendererRef.current = renderer;
      setRendererReady(true);
    }).catch((error) => {
      if (disposed) return;
      setConnectionState("error");
      setConnectionError(`The browser terminal could not load: ${(error as Error).message}`);
    });
    return () => {
      disposed = true;
      expectedCloseRef.current = true;
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close(1000, "workspace_unmounted");
      socketRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [capability.available, capability.reason, rendererRetryNonce, repositoryId]);

  useEffect(() => {
    if (!rendererReady || !capability.available) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    expectedCloseRef.current = false;
    setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
    setConnectionError(null);

    const connect = async (takeover: boolean): Promise<void> => {
      const renderer = rendererRef.current;
      if (!renderer || disposed) return;
      const pendingTarget = targetRequestRef.current;
      try {
        const attachment = await api.createTerminalAttachment(
          repositoryId,
          {
            clientId: terminalClientId(),
            profileId: "nvim",
            cols: Math.max(2, renderer.cols || 80),
            rows: Math.max(1, renderer.rows || 24),
            takeover,
            ...(pendingTarget && pendingTarget.id !== handledTargetRef.current
              ? { target: pendingTarget.target }
              : {}),
          },
          csrfToken,
        );
        if (disposed) return;
        if (pendingTarget && pendingTarget.id !== handledTargetRef.current) {
          handledTargetRef.current = pendingTarget.id;
          onTargetHandled(pendingTarget.id);
        }
        socket = new WebSocket(
          terminalWebSocketUrl(repositoryId),
          [attachment.protocol, `couchview-ticket.${attachment.ticket}`],
        );
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;
        socket.addEventListener("message", (event) => {
          if (disposed || socketRef.current !== socket) return;
          if (typeof event.data !== "string") {
            renderer.write(new Uint8Array(event.data as ArrayBuffer));
            return;
          }
          try {
            const control = JSON.parse(event.data) as {
              type?: string;
              code?: string;
              message?: string;
            };
            if (control.type === "ready") {
              reconnectAttemptRef.current = 0;
              setConnectionState("connected");
              setConnectionError(null);
              renderer.fit();
              if (activeRef.current) renderer.focus();
            } else if (control.type === "error") {
              setConnectionError(control.message ?? "The terminal connection failed.");
            }
          } catch {
            // Unknown control frames are ignored; terminal bytes are always binary.
          }
        });
        socket.addEventListener("close", (event) => {
          if (socketRef.current === socket) socketRef.current = null;
          if (disposed) return;
          if (event.code === TERMINAL_ENDED_CLOSE_CODE) {
            expectedCloseRef.current = true;
            if (reconnectTimerRef.current !== null) {
              window.clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            setConnectionState("ended");
            setConnectionError(null);
            return;
          }
          if (expectedCloseRef.current) return;
          if (event.code === 4001) {
            setConnectionState("taken-over");
            setConnectionError("Another browser tab took control of this Neovim session.");
            return;
          }
          reconnectAttemptRef.current += 1;
          setConnectionState("reconnecting");
          requestReconnect();
        });
        socket.addEventListener("error", () => {
          if (!disposed) setConnectionError("The terminal WebSocket could not connect.");
        });
      } catch (error) {
        if (disposed) return;
        if (error instanceof ApiError && error.code === "terminal_in_use") {
          setConnectionState("in-use");
          const confirmed = window.confirm(
            "Neovim is active in another browser tab. Take control here?",
          );
          if (confirmed) await connect(true);
          return;
        }
        const message = error instanceof Error ? error.message : "The terminal connection failed.";
        setConnectionError(message);
        if (error instanceof ApiError && ["terminal_disabled", "terminal_unavailable"].includes(error.code)) {
          setConnectionState("error");
          return;
        }
        reconnectAttemptRef.current += 1;
        setConnectionState("reconnecting");
        requestReconnect();
      }
    };

    void connect(false);
    return () => {
      disposed = true;
      expectedCloseRef.current = true;
      socket?.close(1000, "connection_replaced");
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [
    capability.available,
    csrfToken,
    onTargetHandled,
    reconnectNonce,
    rendererReady,
    repositoryId,
    requestReconnect,
  ]);

  useEffect(() => {
    if (!targetRequest || targetRequest.id === handledTargetRef.current) return;
    if (connectionState !== "connected") return;
    let cancelled = false;
    void api.openTerminalFile(
      repositoryId,
      { target: targetRequest.target },
      csrfToken,
    ).then(() => {
      if (cancelled) return;
      handledTargetRef.current = targetRequest.id;
      onTargetHandled(targetRequest.id);
    }).catch((error) => {
      if (cancelled) return;
      handledTargetRef.current = targetRequest.id;
      onTargetHandled(targetRequest.id);
      onNotice(error instanceof Error ? error.message : "Neovim could not open the selected file.");
    });
    return () => {
      cancelled = true;
    };
  }, [connectionState, csrfToken, onNotice, onTargetHandled, repositoryId, targetRequest]);

  useEffect(() => {
    if (!active || !rendererReady) return;
    const frame = window.requestAnimationFrame(() => {
      rendererRef.current?.fit();
      rendererRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, rendererReady]);

  const endSession = useCallback(async () => {
    if (!window.confirm("End this persistent Neovim session?")) return;
    setEnding(true);
    try {
      await api.endTerminal(repositoryId, { force: false }, csrfToken);
    } catch (error) {
      if (!canForceEnd(error)) {
        onNotice(error instanceof Error ? error.message : "The Neovim session could not be ended.");
        setEnding(false);
        return;
      }
      const force = window.confirm(
        `${error.message}\n\nForce end the session? This may discard unsaved buffers.`,
      );
      if (!force) {
        setEnding(false);
        return;
      }
      try {
        await api.endTerminal(repositoryId, { force: true }, csrfToken);
      } catch (forceError) {
        onNotice(forceError instanceof Error ? forceError.message : "The Neovim session could not be ended.");
        setEnding(false);
        return;
      }
    }
    expectedCloseRef.current = true;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    socketRef.current?.close(1000, "terminal_ended");
    socketRef.current = null;
    setConnectionState("ended");
    setConnectionError(null);
    setEnding(false);
    onEnded();
  }, [csrfToken, onEnded, onNotice, repositoryId]);

  const retry = useCallback(() => {
    reconnectAttemptRef.current = 0;
    expectedCloseRef.current = false;
    if (!rendererReady) {
      setConnectionState("loading");
      setConnectionError(null);
      setRendererRetryNonce((value) => value + 1);
      return;
    }
    requestReconnect(true);
  }, [rendererReady, requestReconnect]);

  return (
    <section
      aria-hidden={!active}
      aria-label="Neovim workspace"
      className={`terminal-workspace ${active ? "active" : "hidden"}`}
      inert={!active}
    >
      <header className="terminal-toolbar">
        <button className="terminal-toolbar-button" onClick={onBack} type="button">
          <ArrowLeft size={16} /> Review
        </button>
        <div className="terminal-heading">
          <SquareTerminal size={16} />
          <span>{repositoryName}</span>
          <span className={`terminal-connection ${connectionState}`}>{stateLabel(connectionState)}</span>
        </div>
        <button
          className="terminal-toolbar-button danger"
          disabled={ending || connectionState === "ended"}
          onClick={() => void endSession()}
          type="button"
        >
          {ending ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}
          End session
        </button>
      </header>
      <div className="terminal-stage">
        <div className="terminal-surface" ref={containerRef} />
        {(!capability.available || connectionState !== "connected") && (
          <div className="terminal-overlay" role="status">
            {connectionState === "loading" || connectionState === "connecting" || connectionState === "reconnecting" ? (
              <LoaderCircle className="spinner" size={24} />
            ) : (
              <AlertTriangle size={24} />
            )}
            <strong>{stateLabel(connectionState)}</strong>
            {(connectionError || capability.reason) && (
              <span>{connectionError ?? capability.reason}</span>
            )}
            {["in-use", "taken-over", "ended", "error"].includes(connectionState) && capability.available && (
              <button className="action-button secondary" onClick={retry} type="button">
                <RotateCw size={15} />
                {connectionState === "ended" ? "Start Neovim" : "Reconnect"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
