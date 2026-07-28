import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  LoaderCircle,
  RotateCw,
  ShieldCheck,
  SquareTerminal,
  Trash2,
} from "lucide-react";

import {
  API_ROUTES,
  TERMINAL_ENDED_CLOSE_CODE,
  type TerminalCapability,
} from "../shared/contracts.ts";
import { ApiError, api } from "./api.ts";
import {
  createBrowserTerminal,
  type BrowserTerminalRenderer,
} from "./ghosttyTerminal.ts";
import {
  TerminalLatencyTracker,
  terminalLatencyEnabled,
  type TerminalLatencySummary,
} from "./terminalLatency.ts";
import {
  SAFE_TERMINAL_RENDERER_CONFIG,
  type TerminalRendererConfig,
} from "./typographyPreferences.ts";

type ConnectionState =
  | "loading"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "in-use"
  | "taken-over"
  | "ended"
  | "error";

interface TerminalWorkspaceProps {
  active: boolean;
  capability: TerminalCapability;
  csrfToken: string;
  rendererConfig: TerminalRendererConfig;
  repositoryId: string;
  repositoryName: string;
  onBack(): void;
  onEnded(): void;
  onNotice(message: string): void;
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
  rendererConfig,
  repositoryId,
  repositoryName,
  onBack,
  onEnded,
  onNotice,
}: TerminalWorkspaceProps) {
  const [safeMode, setSafeMode] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [rendererRetryNonce, setRendererRetryNonce] = useState(0);
  const [ending, setEnding] = useState(false);
  const debugAvailableRef = useRef(terminalLatencyEnabled(window.location.search));
  const [latencyEnabled, setLatencyEnabled] = useState(debugAvailableRef.current);
  const [latencySummary, setLatencySummary] = useState<TerminalLatencySummary | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BrowserTerminalRenderer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const expectedCloseRef = useRef(false);
  const latencyEnabledRef = useRef(latencyEnabled);
  latencyEnabledRef.current = latencyEnabled;
  const latencyTrackerRef = useRef<TerminalLatencyTracker | null>(null);
  if (latencyEnabled && !latencyTrackerRef.current) {
    latencyTrackerRef.current = new TerminalLatencyTracker();
  }
  const activeRef = useRef(active);
  activeRef.current = active;
  const activeRendererConfig = safeMode
    ? SAFE_TERMINAL_RENDERER_CONFIG
    : rendererConfig;

  useEffect(() => {
    setSafeMode(false);
  }, [rendererConfig]);

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
    // A renderer configuration change disposes the current renderer and its
    // socket below. Move readiness back through false so the replacement
    // renderer can trigger a fresh terminal attachment when it becomes ready.
    setRendererReady(false);
    setConnectionState("loading");
    setConnectionError(null);
    latencyTrackerRef.current?.reset();
    setLatencySummary(null);
    void createBrowserTerminal({
      container: containerRef.current,
      config: activeRendererConfig,
      onData(data) {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          if (latencyEnabledRef.current) {
            latencyTrackerRef.current?.dataSent(window.performance.now());
          }
          socket.send(data);
        } else {
          latencyTrackerRef.current?.cancelPending();
        }
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
      // Ghostty can reinitialize from its warm WASM cache before React commits
      // rendererReady=false. A generation change always identifies a new
      // renderer and therefore always replaces the tmux attachment.
      setRendererGeneration((value) => value + 1);
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
      latencyTrackerRef.current?.cancelPending();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [activeRendererConfig, capability.available, capability.reason, rendererRetryNonce, repositoryId]);

  useEffect(() => {
    const tracker = latencyTrackerRef.current;
    tracker?.reset();
    setLatencySummary(null);
    rendererRef.current?.setLatencyKeyHandler(
      latencyEnabled && tracker
        ? (event) => tracker.keyEvent(event, window.performance.now())
        : null,
    );
  }, [latencyEnabled, rendererGeneration]);

  useEffect(() => {
    if (!rendererReady || !capability.available) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    expectedCloseRef.current = false;
    setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
    setConnectionError(null);
    latencyTrackerRef.current?.reset();
    setLatencySummary(null);

    const connect = async (takeover: boolean): Promise<void> => {
      const renderer = rendererRef.current;
      if (!renderer || disposed) return;
      try {
        const attachment = await api.createTerminalAttachment(
          repositoryId,
          {
            clientId: terminalClientId(),
            profileId: "tmux",
            cols: Math.max(2, renderer.cols || 80),
            rows: Math.max(1, renderer.rows || 24),
            takeover,
          },
          csrfToken,
        );
        if (disposed) return;
        socket = new WebSocket(
          terminalWebSocketUrl(repositoryId),
          [attachment.protocol, `couchview-ticket.${attachment.ticket}`],
        );
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;
        socket.addEventListener("message", (event) => {
          if (disposed || socketRef.current !== socket) return;
          if (typeof event.data !== "string") {
            const bytes = new Uint8Array(event.data as ArrayBuffer);
            const tracker = latencyEnabledRef.current
              ? latencyTrackerRef.current
              : null;
            const sampleId = tracker?.hostOutputReceived(window.performance.now()) ?? null;
            if (sampleId === null || !tracker) {
              renderer.write(bytes);
            } else {
              renderer.write(bytes, () => {
                if (disposed || socketRef.current !== socket) return;
                const summary = tracker.canvasRendered(sampleId, window.performance.now());
                if (summary) setLatencySummary(summary);
              });
            }
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
          latencyTrackerRef.current?.cancelPending();
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
            setConnectionError("Another browser tab took control of this tmux terminal.");
            return;
          }
          if (event.code === 1008 && event.reason === "terminal_size_invalid") {
            setConnectionState("error");
            setConnectionError("Terminal dimensions are outside the supported range.");
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
            "The tmux terminal is active in another browser tab. Take control here?",
          );
          if (confirmed) await connect(true);
          return;
        }
        const message = error instanceof Error ? error.message : "The terminal connection failed.";
        setConnectionError(message);
        if (
          error instanceof ApiError &&
          ["terminal_disabled", "terminal_unavailable", "terminal_size_invalid"].includes(error.code)
        ) {
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
      latencyTrackerRef.current?.cancelPending();
      socket?.close(1000, "connection_replaced");
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [
    capability.available,
    csrfToken,
    reconnectNonce,
    rendererGeneration,
    rendererReady,
    repositoryId,
    requestReconnect,
  ]);

  useEffect(() => {
    if (!active || !rendererReady) return;
    const frame = window.requestAnimationFrame(() => {
      rendererRef.current?.fit();
      rendererRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, rendererGeneration, rendererReady]);

  const endSession = useCallback(async () => {
    if (!window.confirm(
      "End this persistent tmux session? Running programs and unsaved work will be terminated.",
    )) return;
    setEnding(true);
    try {
      await api.endTerminal(repositoryId, csrfToken);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The tmux session could not be ended.");
      setEnding(false);
      return;
    }
    expectedCloseRef.current = true;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    socketRef.current?.close(1000, "terminal_ended");
    socketRef.current = null;
    latencyTrackerRef.current?.cancelPending();
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

  const enableSafeMode = useCallback(() => {
    reconnectAttemptRef.current = 0;
    expectedCloseRef.current = true;
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    socketRef.current?.close(1000, "safe_mode");
    socketRef.current = null;
    latencyTrackerRef.current?.cancelPending();
    setRendererReady(false);
    setConnectionState("loading");
    setConnectionError(null);
    setSafeMode(true);
  }, []);

  const toggleLatencyProfiler = useCallback(() => {
    if (!debugAvailableRef.current) return;
    setLatencyEnabled((enabled) => !enabled);
  }, []);

  const connectionLabel = `${stateLabel(connectionState)}${safeMode ? " · Safe Mode" : ""}`;

  return (
    <section
      aria-hidden={!active}
      aria-label="tmux terminal"
      className={`terminal-workspace ${active ? "active" : "hidden"}`}
      inert={!active}
      style={{
        "--terminal-background": activeRendererConfig.theme.background,
      } as CSSProperties}
    >
      <header className="terminal-toolbar">
        <button className="terminal-toolbar-button" onClick={onBack} type="button">
          <ArrowLeft size={16} /> Review
        </button>
        <div className="terminal-heading">
          <SquareTerminal size={16} />
          <span>{repositoryName}</span>
          <span className={`terminal-connection ${connectionState}`}>{connectionLabel}</span>
        </div>
        <div className="terminal-toolbar-actions">
          {debugAvailableRef.current && (
            <button
              aria-pressed={latencyEnabled}
              className={`terminal-toolbar-button${latencyEnabled ? " active" : ""}`}
              onClick={toggleLatencyProfiler}
              type="button"
            >
              <Bug size={15} /> Debug
            </button>
          )}
          <button
            className="terminal-toolbar-button danger"
            disabled={ending || connectionState === "ended"}
            onClick={() => void endSession()}
            type="button"
          >
            {ending ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}
            End session
          </button>
        </div>
      </header>
      <div className="terminal-stage">
        <div className="terminal-surface" ref={containerRef} />
        {latencyEnabled && (
          <div
            aria-label="Terminal key-to-canvas latency"
            className="terminal-latency-overlay"
            data-testid="terminal-latency-overlay"
          >
            {latencySummary
              ? `Key→canvas ${latencySummary.lastMs.toFixed(1)} ms · p50 ${latencySummary.p50Ms.toFixed(1)} · p95 ${latencySummary.p95Ms.toFixed(1)} · n=${latencySummary.sampleCount}`
              : "Waiting for a clean echoed key…"}
          </div>
        )}
        {(!capability.available || connectionState !== "connected") && (
          <div className="terminal-overlay" role="status">
            {connectionState === "loading" || connectionState === "connecting" || connectionState === "reconnecting" ? (
              <LoaderCircle className="spinner" size={24} />
            ) : (
              <AlertTriangle size={24} />
            )}
            <strong>{connectionLabel}</strong>
            {(connectionError || capability.reason) && (
              <span>{connectionError ?? capability.reason}</span>
            )}
            {["in-use", "taken-over", "ended", "error"].includes(connectionState) && capability.available && (
              <div className="terminal-overlay-actions">
                <button className="action-button secondary" onClick={retry} type="button">
                  <RotateCw size={15} />
                  {connectionState === "ended" ? "Start tmux" : "Reconnect"}
                </button>
                {connectionState === "error" && !safeMode && (
                  <button
                    className="action-button secondary"
                    onClick={enableSafeMode}
                    type="button"
                  >
                    <ShieldCheck size={15} />
                    Safe Mode
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
