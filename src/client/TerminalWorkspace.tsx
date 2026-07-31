import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  LoaderCircle,
  RotateCw,
  Search,
  ShieldCheck,
  SquareTerminal,
  Trash2,
} from "lucide-react";

import {
  API_ROUTES,
  TERMINAL_ENDED_CLOSE_CODE,
  TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
  TERMINAL_P2P_FAILED_CLOSE_CODE,
  type TerminalCapability,
  type TerminalWebRtcConfiguration,
} from "../shared/contracts.ts";
import { ApiError, api } from "./api.ts";
import {
  createBrowserTerminal,
  type BrowserTerminalRenderer,
} from "./ghosttyTerminal.ts";
import {
  TerminalLatencyTracker,
  TerminalRoundTripTracker,
  terminalLatencyEnabled,
  type TerminalKeyLatencySummary,
  type TerminalLatencySummary,
} from "./terminalLatency.ts";
import {
  SAFE_TERMINAL_RENDERER_CONFIG,
  type TerminalRendererConfig,
} from "./typographyPreferences.ts";
import {
  TerminalWebRtcUpgrade,
  type TerminalTransportStatus,
} from "./terminalWebRtc.ts";

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
  commandPaletteShortcut?: string;
  csrfToken: string;
  rendererConfig: TerminalRendererConfig;
  repositoryId: string;
  repositoryName: string;
  onBack(): void;
  onOpenCommandPalette?(): void;
  onEnded(): void;
  onNotice(message: string): void;
}

const clientStorageKey = "couchview:terminal-client-id";
const LATENCY_PING_INTERVAL_MS = 2_000;
const LEASE_RETRY_INTERVAL_MS = 5_000;

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

function transportLabel(status: TerminalTransportStatus): string {
  switch (status) {
    case "finding":
      return "Finding direct path";
    case "direct":
      return "Direct P2P";
    case "fallback":
      return "WebSocket fallback";
    default:
      return "WebSocket";
  }
}

export function TerminalWorkspace({
  active,
  capability,
  commandPaletteShortcut = "",
  csrfToken,
  rendererConfig,
  repositoryId,
  repositoryName,
  onBack,
  onOpenCommandPalette = () => undefined,
  onEnded,
  onNotice,
}: TerminalWorkspaceProps) {
  const [safeMode, setSafeMode] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [transportStatus, setTransportStatus] = useState<TerminalTransportStatus>("websocket");
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [rendererRetryNonce, setRendererRetryNonce] = useState(0);
  const [ending, setEnding] = useState(false);
  const [latencyEnabled, setLatencyEnabled] = useState(
    terminalLatencyEnabled(window.location.search),
  );
  const [latencySummary, setLatencySummary] = useState<TerminalKeyLatencySummary | null>(null);
  const [roundTripSummary, setRoundTripSummary] = useState<TerminalLatencySummary | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BrowserTerminalRenderer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const webRtcRef = useRef<TerminalWebRtcUpgrade | null>(null);
  const webRtcConfigurationRef = useRef<TerminalWebRtcConfiguration | null>(null);
  const retryP2pRef = useRef<(() => void) | null>(null);
  const suppressAutomaticP2pRef = useRef(false);
  const clientIdRef = useRef<string | null>(null);
  if (!clientIdRef.current) clientIdRef.current = terminalClientId();
  const resizeTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const expectedCloseRef = useRef(false);
  const latencyEnabledRef = useRef(latencyEnabled);
  latencyEnabledRef.current = latencyEnabled;
  const latencyTrackerRef = useRef<TerminalLatencyTracker | null>(null);
  const roundTripTrackerRef = useRef<TerminalRoundTripTracker | null>(null);
  const pingSequenceRef = useRef(0);
  if (latencyEnabled && !latencyTrackerRef.current) {
    latencyTrackerRef.current = new TerminalLatencyTracker();
  }
  if (latencyEnabled && !roundTripTrackerRef.current) {
    roundTripTrackerRef.current = new TerminalRoundTripTracker();
  }
  const activeRef = useRef(active);
  activeRef.current = active;
  const activeRendererConfig = safeMode
    ? SAFE_TERMINAL_RENDERER_CONFIG
    : rendererConfig;

  useEffect(() => {
    setSafeMode(false);
  }, [rendererConfig]);

  useEffect(() => {
    suppressAutomaticP2pRef.current = false;
  }, [repositoryId]);

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

  const sendTerminalData = useCallback((data: Uint8Array<ArrayBufferLike>): boolean => {
    if (webRtcRef.current?.sendData(data)) {
      if (latencyEnabledRef.current) {
        latencyTrackerRef.current?.dataSent(window.performance.now());
      }
      return true;
    }
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      latencyTrackerRef.current?.cancelPending();
      return false;
    }
    if (latencyEnabledRef.current) {
      latencyTrackerRef.current?.dataSent(window.performance.now());
    }
    socket.send(Uint8Array.from(data));
    return true;
  }, []);

  const sendTerminalControl = useCallback((control: Record<string, unknown>): boolean => {
    if (webRtcRef.current?.sendControl(control)) return true;
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(control));
    return true;
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
        return sendTerminalData(data);
      },
      onResize(cols, rows) {
        if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null;
          sendTerminalControl({ type: "resize", cols, rows });
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
      webRtcRef.current?.close();
      webRtcRef.current = null;
      webRtcConfigurationRef.current = null;
      retryP2pRef.current = null;
      socketRef.current?.close(1000, "workspace_unmounted");
      socketRef.current = null;
      latencyTrackerRef.current?.cancelPending();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [
    activeRendererConfig,
    capability.available,
    capability.reason,
    rendererRetryNonce,
    repositoryId,
    sendTerminalControl,
    sendTerminalData,
  ]);

  useEffect(() => {
    const tracker = latencyTrackerRef.current;
    tracker?.reset();
    roundTripTrackerRef.current?.reset();
    setLatencySummary(null);
    setRoundTripSummary(null);
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
    let webRtc: TerminalWebRtcUpgrade | null = null;
    let webRtcConfiguration: TerminalWebRtcConfiguration | null = null;
    let leaseTimer: number | null = null;
    let leaseAbort: AbortController | null = null;
    let directActive = false;
    let p2pStarted = false;
    expectedCloseRef.current = false;
    setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
    setConnectionError(null);
    latencyTrackerRef.current?.reset();
    setLatencySummary(null);

    const clearLeaseRenewal = () => {
      if (leaseTimer !== null) window.clearTimeout(leaseTimer);
      leaseTimer = null;
      leaseAbort?.abort();
      leaseAbort = null;
    };

    const scheduleLeaseRenewal = (delayMs: number) => {
      if (leaseTimer !== null) window.clearTimeout(leaseTimer);
      leaseTimer = window.setTimeout(() => {
        leaseTimer = null;
        if (disposed || !directActive || !webRtcConfiguration) return;
        leaseAbort = new AbortController();
        void api.renewTerminalLease(
          repositoryId,
          { clientId: clientIdRef.current! },
          csrfToken,
          leaseAbort.signal,
        ).then(() => {
          leaseAbort = null;
          if (!disposed && directActive && webRtcConfiguration) {
            scheduleLeaseRenewal(webRtcConfiguration.leaseRenewIntervalMs);
          }
        }).catch((error) => {
          leaseAbort = null;
          const retryable = !(error instanceof ApiError) ||
            error.status === 408 ||
            error.status === 425 ||
            error.status === 429 ||
            error.status >= 500;
          if (
            !disposed &&
            directActive &&
            (error as Error).name !== "AbortError" &&
            retryable
          ) {
            scheduleLeaseRenewal(LEASE_RETRY_INTERVAL_MS);
          }
        });
      }, delayMs);
    };

    const writeHostOutput = (bytes: Uint8Array<ArrayBufferLike>) => {
      if (disposed) return;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const renderBytes = Uint8Array.from(bytes);
      const tracker = latencyEnabledRef.current ? latencyTrackerRef.current : null;
      const receivedAt = tracker ? window.performance.now() : null;
      const sampleId = tracker && receivedAt !== null
        ? tracker.hostOutputReceived(receivedAt)
        : null;
      if (sampleId === null || !tracker) {
        renderer.write(renderBytes);
        return;
      }
      renderer.write(renderBytes, {
        onWriteComplete() {
          tracker.terminalWriteCompleted(sampleId, window.performance.now());
        },
        onRenderStart() {
          tracker.canvasRenderStarted(sampleId, window.performance.now());
        },
        onRenderComplete() {
          if (disposed || rendererRef.current !== renderer) return;
          const summary = tracker.canvasRendered(sampleId, window.performance.now());
          if (summary) setLatencySummary(summary);
        },
      });
    };

    const handleTerminalControl = (control: Record<string, unknown>) => {
      if (
        control.type === "pong" &&
        Number.isSafeInteger(control.id) &&
        latencyEnabledRef.current
      ) {
        const summary = roundTripTrackerRef.current?.pong(
          control.id as number,
          window.performance.now(),
        );
        if (summary) setRoundTripSummary(summary);
      }
    };

    const connect = async (takeover: boolean): Promise<void> => {
      const renderer = rendererRef.current;
      if (!renderer || disposed) return;
      try {
        const attachment = await api.createTerminalAttachment(
          repositoryId,
          {
            clientId: clientIdRef.current!,
            profileId: "tmux",
            cols: Math.max(2, renderer.cols || 80),
            rows: Math.max(1, renderer.rows || 24),
            takeover,
          },
          csrfToken,
        );
        if (disposed) return;
        webRtcConfiguration = attachment.webRtc ?? null;
        webRtcConfigurationRef.current = webRtcConfiguration;
        setTransportStatus(
          webRtcConfiguration && suppressAutomaticP2pRef.current ? "fallback" : "websocket",
        );
        socket = new WebSocket(
          terminalWebSocketUrl(repositoryId),
          [attachment.protocol, `couchview-ticket.${attachment.ticket}`],
        );
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;
        webRtc = new TerminalWebRtcUpgrade({
          sendSignal(value) {
            if (disposed || socket?.readyState !== WebSocket.OPEN) return false;
            socket.send(JSON.stringify(value));
            return true;
          },
          onControl: handleTerminalControl,
          onData: writeHostOutput,
          onDirectActive() {
            directActive = true;
            if (webRtcConfiguration) {
              scheduleLeaseRenewal(webRtcConfiguration.leaseRenewIntervalMs);
            }
          },
          onActiveFailure() {
            if (disposed) return;
            directActive = false;
            clearLeaseRenewal();
            suppressAutomaticP2pRef.current = true;
            setTransportStatus("fallback");
            if (socket?.readyState === WebSocket.OPEN) {
              socket.close(TERMINAL_P2P_FAILED_CLOSE_CODE, "terminal_p2p_client_failed");
            }
          },
          onStatus: setTransportStatus,
        });
        webRtcRef.current = webRtc;
        retryP2pRef.current = () => {
          if (
            !disposed &&
            socket?.readyState === WebSocket.OPEN &&
            webRtc?.canRetry &&
            webRtcConfiguration
          ) {
            suppressAutomaticP2pRef.current = false;
            p2pStarted = true;
            void webRtc.start(webRtcConfiguration);
          }
        };
        socket.addEventListener("message", (event) => {
          if (disposed || socketRef.current !== socket) return;
          if (typeof event.data !== "string") {
            if (!directActive) writeHostOutput(new Uint8Array(event.data as ArrayBuffer));
            return;
          }
          try {
            const control = JSON.parse(event.data) as Record<string, unknown>;
            if (webRtc?.handleSignal(control)) return;
            handleTerminalControl(control);
            if (control.type === "ready") {
              reconnectAttemptRef.current = 0;
              setConnectionState("connected");
              setConnectionError(null);
              renderer.fit();
              if (activeRef.current) renderer.focus();
              if (
                webRtcConfiguration &&
                !suppressAutomaticP2pRef.current &&
                !p2pStarted
              ) {
                p2pStarted = true;
                void webRtc?.start(webRtcConfiguration);
              }
            } else if (control.type === "error") {
              setConnectionError(
                typeof control.message === "string"
                  ? control.message
                  : "The terminal connection failed.",
              );
            }
          } catch {
            // Unknown control frames are ignored; terminal bytes are always binary.
          }
        });
        socket.addEventListener("close", (event) => {
          if (socketRef.current === socket) socketRef.current = null;
          if (webRtcRef.current === webRtc) webRtcRef.current = null;
          if (retryP2pRef.current) retryP2pRef.current = null;
          directActive = false;
          clearLeaseRenewal();
          webRtc?.close();
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
          if (
            event.code === TERMINAL_P2P_FAILED_CLOSE_CODE ||
            event.code === TERMINAL_LEASE_EXPIRED_CLOSE_CODE
          ) {
            suppressAutomaticP2pRef.current = true;
            setTransportStatus("fallback");
            reconnectAttemptRef.current += 1;
            setConnectionState("reconnecting");
            requestReconnect(true);
            return;
          }
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
      clearLeaseRenewal();
      webRtc?.close();
      if (webRtcRef.current === webRtc) webRtcRef.current = null;
      if (retryP2pRef.current) retryP2pRef.current = null;
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
    const tracker = roundTripTrackerRef.current;
    tracker?.reset();
    setRoundTripSummary(null);
    if (!latencyEnabled || connectionState !== "connected" || !tracker) return;

    const ping = () => {
      const id = ++pingSequenceRef.current;
      if (!tracker.start(id, window.performance.now())) return;
      if (!sendTerminalControl({ type: "ping", id })) tracker.cancelPending();
    };
    ping();
    const interval = window.setInterval(ping, LATENCY_PING_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      tracker.cancelPending();
    };
  }, [connectionState, latencyEnabled, rendererGeneration, sendTerminalControl]);

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
    webRtcRef.current?.close();
    webRtcRef.current = null;
    retryP2pRef.current = null;
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
    webRtcRef.current?.close();
    webRtcRef.current = null;
    retryP2pRef.current = null;
    latencyTrackerRef.current?.cancelPending();
    setRendererReady(false);
    setConnectionState("loading");
    setConnectionError(null);
    setSafeMode(true);
  }, []);

  const retryP2p = useCallback(() => {
    retryP2pRef.current?.();
  }, []);

  const toggleLatencyProfiler = useCallback(() => {
    const nextEnabled = !latencyEnabled;
    const url = new URL(window.location.href);
    if (nextEnabled) {
      url.searchParams.set("terminalLatency", "1");
    } else {
      url.searchParams.delete("terminalLatency");
    }
    window.history.replaceState(window.history.state, "", url);
    setLatencyEnabled(nextEnabled);
  }, [latencyEnabled]);

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
          <span
            className={`terminal-transport ${transportStatus}`}
            data-testid="terminal-transport"
          >
            {transportLabel(transportStatus)}
          </span>
        </div>
        <div className="terminal-toolbar-actions">
          <button
            aria-label="Open command palette"
            className="terminal-toolbar-button command-palette-trigger"
            onClick={onOpenCommandPalette}
            type="button"
          >
            <Search size={15} />
            <span className="workspace-command-label">Commands</span>
            {commandPaletteShortcut && (
              <kbd className="workspace-command-shortcut">{commandPaletteShortcut}</kbd>
            )}
          </button>
          {transportStatus === "fallback" && webRtcConfigurationRef.current && (
            <button
              className="terminal-toolbar-button"
              onClick={retryP2p}
              type="button"
            >
              <RotateCw size={15} /> Retry P2P
            </button>
          )}
          <button
            aria-pressed={latencyEnabled}
            className={`terminal-toolbar-button${latencyEnabled ? " active" : ""}`}
            onClick={toggleLatencyProfiler}
            type="button"
          >
            <Bug size={15} /> Debug
          </button>
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
            aria-label="Terminal latency diagnostics"
            className="terminal-latency-overlay"
            data-testid="terminal-latency-overlay"
          >
            <div className="terminal-latency-heading">
              <strong>Terminal latency</strong>
              <span>live</span>
            </div>
            <div className="terminal-latency-grid">
              <div>
                <span>Key → canvas</span>
                <strong>
                  {latencySummary ? `${latencySummary.total.lastMs.toFixed(1)} ms` : "Waiting…"}
                </strong>
                <small>
                  {latencySummary
                    ? `p50 ${latencySummary.total.p50Ms.toFixed(1)} · p95 ${latencySummary.total.p95Ms.toFixed(1)} · n=${latencySummary.total.sampleCount}`
                    : "Type one clean printable key"}
                </small>
              </div>
              <div>
                <span>Baseline RTT</span>
                <strong>{roundTripSummary ? `${roundTripSummary.lastMs.toFixed(1)} ms` : "Measuring…"}</strong>
                <small>
                  {roundTripSummary
                    ? `p50 ${roundTripSummary.p50Ms.toFixed(1)} · p95 ${roundTripSummary.p95Ms.toFixed(1)} · n=${roundTripSummary.sampleCount}`
                    : "WebSocket ping every 2 seconds"}
                </small>
              </div>
            </div>
            <div className="terminal-latency-phase-heading">
              <strong>Per-key phases</strong>
              <span>latest · p50 · p95</span>
            </div>
            <div className="terminal-latency-phases">
              <div>
                <span>Press → send</span>
                <strong>
                  {latencySummary
                    ? `${latencySummary.pressToSend.lastMs.toFixed(1)} ms`
                    : "—"}
                </strong>
                <small>
                  {latencySummary
                    ? `p50 ${latencySummary.pressToSend.p50Ms.toFixed(1)} · p95 ${latencySummary.pressToSend.p95Ms.toFixed(1)}`
                    : "Browser input path"}
                </small>
              </div>
              <div>
                <span>Send → receive</span>
                <strong>
                  {latencySummary
                    ? `${latencySummary.sendToReceive.lastMs.toFixed(1)} ms`
                    : "—"}
                </strong>
                <small>
                  {latencySummary
                    ? `p50 ${latencySummary.sendToReceive.p50Ms.toFixed(1)} · p95 ${latencySummary.sendToReceive.p95Ms.toFixed(1)}`
                    : "Wire + server/tmux echo"}
                </small>
              </div>
              <div>
                <span>Receive → paint</span>
                <strong>
                  {latencySummary
                    ? `${latencySummary.receiveToPaint.lastMs.toFixed(1)} ms`
                    : "—"}
                </strong>
                <small>
                  {latencySummary
                    ? `p50 ${latencySummary.receiveToPaint.p50Ms.toFixed(1)} · p95 ${latencySummary.receiveToPaint.p95Ms.toFixed(1)}`
                    : "Ghostty parse + canvas frame"}
                </small>
              </div>
            </div>
            <div className="terminal-latency-phase-heading">
              <strong>Receive → paint detail</strong>
              <span>latest · p50 · p95</span>
            </div>
            <div className="terminal-latency-phases terminal-latency-receive-detail">
              <div>
                <span>Receive → write done</span>
                <strong>
                  {latencySummary
                    ? `${latencySummary.receiveToWrite.lastMs.toFixed(1)} ms`
                    : "—"}
                </strong>
                <small>
                  {latencySummary
                    ? `p50 ${latencySummary.receiveToWrite.p50Ms.toFixed(1)} · p95 ${latencySummary.receiveToWrite.p95Ms.toFixed(1)}`
                    : "Bytes + Ghostty/WASM write"}
                </small>
              </div>
              <div>
                <span>Frame wait</span>
                <strong>
                  {latencySummary
                    ? `${latencySummary.writeToRender.lastMs.toFixed(1)} ms`
                    : "—"}
                </strong>
                <small>
                  {latencySummary
                    ? `p50 ${latencySummary.writeToRender.p50Ms.toFixed(1)} · p95 ${latencySummary.writeToRender.p95Ms.toFixed(1)}`
                    : "Write done → render starts"}
                </small>
              </div>
              <div>
                <span>Canvas render</span>
                <strong>
                  {latencySummary
                    ? `${latencySummary.renderDuration.lastMs.toFixed(1)} ms`
                    : "—"}
                </strong>
                <small>
                  {latencySummary
                    ? `p50 ${latencySummary.renderDuration.p50Ms.toFixed(1)} · p95 ${latencySummary.renderDuration.p95Ms.toFixed(1)}`
                    : "CanvasRenderer execution"}
                </small>
              </div>
            </div>
            <div className="terminal-latency-breakdown">
              {latencySummary
                ? `Latest key: ${latencySummary.pressToSend.lastMs.toFixed(1)} + ${latencySummary.sendToReceive.lastMs.toFixed(1)} + ${latencySummary.receiveToPaint.lastMs.toFixed(1)} = ${latencySummary.total.lastMs.toFixed(1)} ms.`
                : "The three phases form one accepted key timeline and add to key→canvas."}
            </div>
            <small className="terminal-latency-note">
              Send→receive combines both network legs with server/tmux echo. Baseline RTT is a
              separate immediate WebSocket ping. Receive→paint ends when CanvasRenderer returns,
              before browser compositing or physical display scanout. Frame wait is Ghostty render
              loop scheduling; canvas render is synchronous renderer execution.
            </small>
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
