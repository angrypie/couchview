import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useEffect,
	useRef,
} from "react";

import {
	TERMINAL_ENDED_CLOSE_CODE,
	TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
	TERMINAL_P2P_FAILED_CLOSE_CODE,
	type TerminalWebRtcConfiguration,
} from "../../../shared/contracts.ts";
import type { BrowserTerminalRenderer } from "../../ghosttyTerminal.ts";
import {
	type TerminalKeyLatencySummary,
	type TerminalLatencySummary,
	TerminalLatencyTracker,
	TerminalRoundTripTracker,
} from "../../terminalLatency.ts";
import { type TerminalTransportStatus, TerminalWebRtcUpgrade } from "../../terminalWebRtc.ts";
import {
	type TerminalDomHostActions,
	TerminalDomRequestError,
	unwrapTerminalDomResult,
} from "./terminalDomContract.ts";

const LEASE_RETRY_INTERVAL_MS = 5_000;

export type ConnectionState =
	| "loading"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "in-use"
	| "taken-over"
	| "ended"
	| "error";

interface TerminalAttachmentOptions
	extends Pick<
		TerminalDomHostActions,
		"confirm" | "createAttachment" | "renewLease" | "terminalWebSocketUrl"
	> {
	activeRef: MutableRefObject<boolean>;
	available: boolean;
	clientIdRef: MutableRefObject<string | null>;
	expectedCloseRef: MutableRefObject<boolean>;
	latencyEnabledRef: MutableRefObject<boolean>;
	latencyTrackerRef: MutableRefObject<TerminalLatencyTracker | null>;
	reconnectAttemptRef: MutableRefObject<number>;
	reconnectNonce: number;
	reconnectTimerRef: MutableRefObject<number | null>;
	rendererGeneration: number;
	rendererReady: boolean;
	rendererRef: MutableRefObject<BrowserTerminalRenderer | null>;
	repositoryId: string;
	requestReconnect(immediate?: boolean): void;
	retryP2pRef: MutableRefObject<(() => void) | null>;
	roundTripTrackerRef: MutableRefObject<TerminalRoundTripTracker | null>;
	setConnectionError: Dispatch<SetStateAction<string | null>>;
	setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
	setLatencySummary: Dispatch<SetStateAction<TerminalKeyLatencySummary | null>>;
	setRoundTripSummary: Dispatch<SetStateAction<TerminalLatencySummary | null>>;
	setTransportStatus: Dispatch<SetStateAction<TerminalTransportStatus>>;
	socketRef: MutableRefObject<WebSocket | null>;
	suppressAutomaticP2pRef: MutableRefObject<boolean>;
	webRtcConfigurationRef: MutableRefObject<TerminalWebRtcConfiguration | null>;
	webRtcRef: MutableRefObject<TerminalWebRtcUpgrade | null>;
}

function useLatestRef<Value>(value: Value): MutableRefObject<Value> {
	const ref = useRef(value);
	ref.current = value;
	return ref;
}

export function useTerminalAttachment({
	activeRef,
	available,
	clientIdRef,
	confirm,
	createAttachment,
	expectedCloseRef,
	latencyEnabledRef,
	latencyTrackerRef,
	reconnectAttemptRef,
	reconnectNonce,
	reconnectTimerRef,
	rendererGeneration,
	rendererReady,
	rendererRef,
	renewLease,
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
	terminalWebSocketUrl,
	webRtcConfigurationRef,
	webRtcRef,
}: TerminalAttachmentOptions) {
	// Expo DOM callback proxies may receive a new identity on every parent render.
	// Keep the live bridge targets current without treating identity churn as a
	// reason to dispose a healthy terminal attachment.
	const confirmRef = useLatestRef(confirm);
	const createAttachmentRef = useLatestRef(createAttachment);
	const renewLeaseRef = useLatestRef(renewLease);
	useEffect(() => {
		if (!rendererReady || !available) return;
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
				void renewLeaseRef
					.current({ clientId: clientIdRef.current! })
					.then(unwrapTerminalDomResult)
					.then(() => {
						leaseAbort = null;
						if (!disposed && directActive && webRtcConfiguration) {
							scheduleLeaseRenewal(webRtcConfiguration.leaseRenewIntervalMs);
						}
					})
					.catch((error) => {
						leaseAbort = null;
						const retryable =
							!(error instanceof TerminalDomRequestError) ||
							error.status === 408 ||
							error.status === 425 ||
							error.status === 429 ||
							error.status >= 500;
						if (!disposed && directActive && (error as Error).name !== "AbortError" && retryable) {
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
			const sampleId =
				tracker && receivedAt !== null ? tracker.hostOutputReceived(receivedAt) : null;
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
				const attachment = unwrapTerminalDomResult(
					await createAttachmentRef.current({
						clientId: clientIdRef.current!,
						profileId: "tmux",
						cols: Math.max(2, renderer.cols || 80),
						rows: Math.max(1, renderer.rows || 24),
						takeover,
					}),
				);
				if (disposed) return;
				webRtcConfiguration = attachment.webRtc ?? null;
				webRtcConfigurationRef.current = webRtcConfiguration;
				setTransportStatus(
					webRtcConfiguration && suppressAutomaticP2pRef.current ? "fallback" : "websocket",
				);
				socket = new WebSocket(terminalWebSocketUrl, [
					attachment.protocol,
					`couchview-ticket.${attachment.ticket}`,
				]);
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
							if (webRtcConfiguration && !suppressAutomaticP2pRef.current && !p2pStarted) {
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
				if (error instanceof TerminalDomRequestError && error.code === "terminal_in_use") {
					setConnectionState("in-use");
					const confirmed = await confirmRef.current(
						"The tmux terminal is active in another browser tab. Take control here?",
					);
					if (confirmed) await connect(true);
					return;
				}
				const message = error instanceof Error ? error.message : "The terminal connection failed.";
				setConnectionError(message);
				if (
					error instanceof TerminalDomRequestError &&
					["terminal_disabled", "terminal_unavailable", "terminal_size_invalid"].includes(
						error.code,
					)
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
		available,
		reconnectNonce,
		rendererGeneration,
		rendererReady,
		repositoryId,
		requestReconnect,
		terminalWebSocketUrl,
	]);
}
