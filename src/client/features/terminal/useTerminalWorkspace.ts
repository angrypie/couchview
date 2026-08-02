import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import {
	type TerminalCapability,
	type TerminalWebRtcConfiguration,
} from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { type BrowserTerminalRenderer, createBrowserTerminal } from "../../ghosttyTerminal.ts";
import type { TerminalKeyInput } from "../../terminalKeyboard.ts";
import {
	type TerminalKeyLatencySummary,
	type TerminalLatencySummary,
	TerminalLatencyTracker,
	TerminalRoundTripTracker,
	terminalLatencyEnabled,
} from "../../terminalLatency.ts";
import { type TerminalTransportStatus, TerminalWebRtcUpgrade } from "../../terminalWebRtc.ts";
import {
	SAFE_TERMINAL_RENDERER_CONFIG,
	type TerminalRendererConfig,
} from "../../typographyPreferences.ts";
import { type ConnectionState, useTerminalAttachment } from "./useTerminalAttachment.ts";

export interface TerminalWorkspaceControllerOptions {
	active: boolean;
	capability: TerminalCapability;
	csrfToken: string;
	rendererConfig: TerminalRendererConfig;
	repositoryId: string;
	onEnded(): void;
	onNotice(message: string): void;
}

const clientStorageKey = "couchview:terminal-client-id";
const LATENCY_PING_INTERVAL_MS = 2_000;

function terminalClientId(): string {
	const existing = window.sessionStorage.getItem(clientStorageKey);
	if (existing && /^[A-Za-z0-9_-]{8,128}$/.test(existing)) return existing;
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const created = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
	window.sessionStorage.setItem(clientStorageKey, created);
	return created;
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

export function useTerminalWorkspace({
	active,
	capability,
	csrfToken,
	rendererConfig,
	repositoryId,
	onEnded,
	onNotice,
}: TerminalWorkspaceControllerOptions) {
	const [safeMode, setSafeMode] = useState(false);
	const [rendererReady, setRendererReady] = useState(false);
	const [rendererGeneration, setRendererGeneration] = useState(0);
	const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [transportStatus, setTransportStatus] = useState<TerminalTransportStatus>("websocket");
	const [reconnectNonce, setReconnectNonce] = useState(0);
	const [rendererRetryNonce, setRendererRetryNonce] = useState(0);
	const [ending, setEnding] = useState(false);
	const [virtualControlActive, setVirtualControlActive] = useState(false);
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
	const activeRendererConfig = safeMode ? SAFE_TERMINAL_RENDERER_CONFIG : rendererConfig;

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
		setVirtualControlActive(false);
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
			onVirtualControlChange: setVirtualControlActive,
		})
			.then((renderer) => {
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
			})
			.catch((error) => {
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

	useTerminalAttachment({
		activeRef,
		available: capability.available,
		clientIdRef,
		csrfToken,
		expectedCloseRef,
		latencyEnabledRef,
		latencyTrackerRef,
		reconnectAttemptRef,
		reconnectNonce,
		reconnectTimerRef,
		rendererGeneration,
		rendererReady,
		rendererRef,
		repositoryId,
		requestReconnect,
		retryP2pRef,
		roundTripTrackerRef,
		setConnectionError,
		setConnectionState,
		setLatencySummary,
		setRoundTripSummary,
		setTransportStatus,
		socketRef,
		suppressAutomaticP2pRef,
		webRtcConfigurationRef,
		webRtcRef,
	});

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

	useEffect(() => {
		if (active && connectionState === "connected") return;
		rendererRef.current?.setVirtualControl(false);
		setVirtualControlActive(false);
	}, [active, connectionState]);

	const endSession = useCallback(async () => {
		if (
			!window.confirm(
				"End this persistent tmux session? Running programs and unsaved work will be terminated.",
			)
		)
			return;
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

	const preserveTerminalFocus = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
	}, []);

	const sendHelperKey = useCallback((input: TerminalKeyInput) => {
		rendererRef.current?.sendKey(input);
		rendererRef.current?.focus();
	}, []);

	const toggleVirtualControl = useCallback(() => {
		const nextActive = !virtualControlActive;
		rendererRef.current?.setVirtualControl(nextActive);
		rendererRef.current?.focus();
	}, [virtualControlActive]);

	const connectionLabel = `${stateLabel(connectionState)}${safeMode ? " · Safe Mode" : ""}`;
	const keyboardHelpersDisabled = !rendererReady || connectionState !== "connected";

	return {
		activeRendererConfig,
		connectionError,
		connectionLabel,
		connectionState,
		containerRef,
		enableSafeMode,
		endSession,
		ending,
		keyboardHelpersDisabled,
		latencyEnabled,
		latencySummary,
		preserveTerminalFocus,
		retry,
		retryP2p,
		retryP2pAvailable: webRtcConfigurationRef.current !== null,
		roundTripSummary,
		safeMode,
		sendHelperKey,
		toggleLatencyProfiler,
		toggleVirtualControl,
		transportStatus,
		virtualControlActive,
	};
}

export type TerminalWorkspaceController = ReturnType<typeof useTerminalWorkspace>;
