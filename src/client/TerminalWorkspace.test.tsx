import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TERMINAL_ENDED_CLOSE_CODE, TERMINAL_P2P_FAILED_CLOSE_CODE } from "../shared/contracts.ts";
import {
	FakeTerminalWebSocket,
	rendererState,
	resetFakeTerminalWebSockets,
	resetRendererState,
	terminalRendererFactory,
} from "./terminalTestFakes.ts";
import {
	DEFAULT_TYPOGRAPHY_PREFERENCES,
	SAFE_TERMINAL_RENDERER_CONFIG,
	terminalRendererConfig,
} from "./typographyPreferences.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

mock.module("./ghosttyTerminal.ts", () => ({
	createBrowserTerminal: terminalRendererFactory,
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { TerminalWorkspace } = await import("./TerminalWorkspace.tsx");

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalRtcPeerConnection = globalThis.RTCPeerConnection;
const originalConfirm = window.confirm;

const capability = {
	available: true,
	reason: null,
	persistence: "tmux" as const,
	profiles: [{ id: "tmux" as const, label: "tmux", available: true, reason: null }],
};

interface FetchRecord {
	body: unknown;
	method: string;
	path: string;
}

let fetchRecords: FetchRecord[] = [];
let attachmentResponses: Response[] = [];
let endResponses: Response[] = [];
let leaseResponses: Response[] = [];

const applicationSdp = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

type RtcListener = (event: MessageEvent | Event) => void;

class FakeRtcDataChannel {
	readonly label = "couchview-terminal";
	readonly protocol = "couchview-terminal-data-v1";
	readonly ordered = true;
	readonly maxRetransmits = null;
	readonly maxPacketLifeTime = null;
	binaryType: BinaryType = "blob";
	readyState: RTCDataChannelState = "connecting";
	bufferedAmount = 0;
	readonly sent: Array<string | ArrayBuffer> = [];
	private readonly listeners = new Map<string, RtcListener[]>();

	addEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener as RtcListener);
		this.listeners.set(type, listeners);
	}

	send(value: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void {
		if (typeof value === "string" || value instanceof ArrayBuffer) {
			this.sent.push(value);
		} else {
			this.sent.push(
				Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer,
			);
		}
	}

	open(): void {
		this.readyState = "open";
		this.emit("open", new Event("open"));
	}

	emitMessage(value: string | ArrayBuffer): void {
		this.emit("message", new MessageEvent("message", { data: value }));
	}

	emitClose(): void {
		this.readyState = "closed";
		this.emit("close", new Event("close"));
	}

	close(): void {
		if (this.readyState !== "closed") this.emitClose();
	}

	private emit(type: string, event: MessageEvent | Event): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

class FakeRtcPeerConnection {
	static instances: FakeRtcPeerConnection[] = [];

	readonly channel = new FakeRtcDataChannel();
	readonly configuration: RTCConfiguration;
	iceGatheringState: RTCIceGatheringState = "complete";
	connectionState: RTCPeerConnectionState = "new";
	localDescription: (RTCSessionDescription & { toJSON(): RTCSessionDescriptionInit }) | null = null;
	remoteDescription: RTCSessionDescriptionInit | null = null;
	closed = false;
	private readonly listeners = new Map<string, EventListener[]>();

	constructor(configuration: RTCConfiguration = {}) {
		this.configuration = configuration;
		FakeRtcPeerConnection.instances.push(this);
	}

	createDataChannel(): RTCDataChannel {
		return this.channel as unknown as RTCDataChannel;
	}

	async createOffer(): Promise<RTCSessionDescriptionInit> {
		return { type: "offer", sdp: applicationSdp };
	}

	async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
		this.localDescription = {
			type: description.type!,
			sdp: description.sdp!,
			toJSON: () => ({ type: description.type, sdp: description.sdp }),
		} as RTCSessionDescription & { toJSON(): RTCSessionDescriptionInit };
	}

	async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
		this.remoteDescription = description;
	}

	addEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? [];
		this.listeners.set(
			type,
			listeners.filter((candidate) => candidate !== listener),
		);
	}

	close(): void {
		this.closed = true;
		this.connectionState = "closed";
	}
}

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
		return Promise.resolve(
			attachmentResponses.shift() ??
				jsonResponse(
					{
						ticket: "ticket-1",
						expiresAt: "2026-07-26T12:00:30.000Z",
						protocol: "couchview-terminal-v1",
						session: { profileId: "tmux", running: true, controllerConnected: false },
					},
					201,
				),
		);
	}
	if (url.pathname.endsWith("/terminal/end")) {
		return Promise.resolve(endResponses.shift() ?? jsonResponse({ status: "ended" }));
	}
	if (url.pathname.endsWith("/terminal/lease")) {
		return Promise.resolve(
			leaseResponses.shift() ??
				jsonResponse({
					expiresAt: "2026-07-26T12:02:00.000Z",
				}),
		);
	}
	return Promise.resolve(
		jsonResponse({ error: { code: "not_found", message: url.pathname } }, 404),
	);
}

function defaultProps() {
	return {
		active: true,
		capability,
		csrfToken: "csrf-token",
		rendererConfig: SAFE_TERMINAL_RENDERER_CONFIG,
		repositoryId: "repo",
		repositoryName: "fixture",
		onBack: mock(() => undefined),
		onEnded: mock(() => undefined),
		onNotice: mock((_message: string) => undefined),
	};
}

function installFakeRtc(): void {
	const constructor = FakeRtcPeerConnection as unknown as typeof RTCPeerConnection;
	Object.defineProperty(globalThis, "RTCPeerConnection", {
		configurable: true,
		value: constructor,
	});
	Object.defineProperty(window, "RTCPeerConnection", {
		configurable: true,
		value: constructor,
	});
}

function p2pAttachment(ticket: string, leaseRenewIntervalMs = 30_000) {
	return jsonResponse(
		{
			ticket,
			expiresAt: "2026-07-26T12:00:30.000Z",
			protocol: "couchview-terminal-v1",
			session: { profileId: "tmux", running: true, controllerConnected: false },
			webRtc: {
				iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
				negotiationTimeoutMs: 10_000,
				leaseRenewIntervalMs,
			},
		},
		201,
	);
}

beforeEach(() => {
	resetRendererState();
	fetchRecords = [];
	attachmentResponses = [];
	endResponses = [];
	leaseResponses = [];
	FakeRtcPeerConnection.instances = [];
	resetFakeTerminalWebSockets();
	window.history.replaceState({}, "", "/");
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
	Object.defineProperty(globalThis, "RTCPeerConnection", {
		configurable: true,
		value: undefined,
	});
	Object.defineProperty(window, "RTCPeerConnection", {
		configurable: true,
		value: undefined,
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
	Object.defineProperty(globalThis, "RTCPeerConnection", {
		configurable: true,
		value: originalRtcPeerConnection,
	});
	Object.defineProperty(window, "RTCPeerConnection", {
		configurable: true,
		value: originalRtcPeerConnection,
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
			body: { profileId: "tmux", cols: 100, rows: 32, takeover: false },
		});
		expect(rendererState.options?.config).toEqual(SAFE_TERMINAL_RENDERER_CONFIG);
		expect(screen.queryByTestId("terminal-latency-overlay")).toBeNull();
		expect(screen.getByRole("button", { name: "Debug" }).getAttribute("aria-pressed")).toBe(
			"false",
		);
		expect(rendererState.latencyKeyHandler).toBeNull();
		expect(socket.protocols).toEqual(["couchview-terminal-v1", "couchview-ticket.ticket-1"]);

		await act(async () => {
			socket.emitMessage(JSON.stringify({ type: "ready", profileId: "tmux" }));
		});
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(
			socket.sent.some((value) => typeof value === "string" && value.includes('"type":"ping"')),
		).toBe(false);
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
		expect(view.container.querySelector(".terminal-workspace")?.getAttribute("aria-hidden")).toBe(
			"true",
		);
		expect(rendererState.disposed).toBe(0);
		expect(socket.closes).toHaveLength(0);

		view.rerender(<TerminalWorkspace {...props} active />);
		await waitFor(() => expect(rendererState.focuses).toBeGreaterThan(0));
		expect(FakeTerminalWebSocket.instances).toHaveLength(1);
		view.unmount();
		expect(rendererState.disposed).toBe(1);
		expect(socket.closes).toContainEqual({ code: 1000, reason: "workspace_unmounted" });
	});

	test("sends helper keys and applies the one-shot Ctrl modifier to any helper key", async () => {
		render(<TerminalWorkspace {...defaultProps()} />);
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));

		const helperBar = screen.getByRole("toolbar", {
			name: "Terminal keyboard shortcuts",
		});
		const control = screen.getByRole("button", {
			name: "Control modifier for next key",
		});
		expect(control.getAttribute("aria-pressed")).toBe("false");

		fireEvent.click(control);
		expect(rendererState.virtualControl).toBe(true);
		expect(control.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "Send Arrow Left" }));
		expect(rendererState.keyInputs.at(-1)).toEqual({
			code: "ArrowLeft",
			ctrlKey: true,
			key: "ArrowLeft",
		});
		expect(control.getAttribute("aria-pressed")).toBe("false");

		fireEvent.click(screen.getByRole("button", { name: "Send Escape" }));
		fireEvent.click(screen.getByRole("button", { name: "Send Tab" }));
		fireEvent.click(screen.getByRole("button", { name: "Send Ctrl+C" }));
		fireEvent.click(screen.getByRole("button", { name: "Send Ctrl+L" }));
		expect(rendererState.keyInputs.slice(-4)).toEqual([
			{ code: "Escape", ctrlKey: false, key: "Escape" },
			{ code: "Tab", ctrlKey: false, key: "Tab" },
			{ code: "KeyC", ctrlKey: true, key: "c" },
			{ code: "KeyL", ctrlKey: true, key: "l" },
		]);
		expect(helperBar.contains(document.activeElement)).toBe(false);
		expect(rendererState.focuses).toBeGreaterThan(0);
	});

	test("keeps WebSocket transport when native WebRTC is unavailable", async () => {
		attachmentResponses.push(p2pAttachment("p2p-unavailable"));
		render(<TerminalWorkspace {...defaultProps()} />);
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));
		expect(screen.getByTestId("terminal-transport").textContent).toBe("WebSocket");
		expect(
			socket.sent.some((value) => typeof value === "string" && value.includes("webrtc-offer")),
		).toBe(false);
	});

	test("upgrades input, output, resize, pings, and lease renewal to direct P2P", async () => {
		installFakeRtc();
		attachmentResponses.push(p2pAttachment("p2p-success", 20));
		const view = render(<TerminalWorkspace {...defaultProps()} />);
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));
		await waitFor(() => expect(FakeRtcPeerConnection.instances).toHaveLength(1));
		const peer = FakeRtcPeerConnection.instances[0]!;
		expect(peer.configuration.iceServers).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);
		await waitFor(() =>
			expect(
				socket.sent.some((value) => typeof value === "string" && value.includes("webrtc-offer")),
			).toBe(true),
		);
		expect(screen.getByTestId("terminal-transport").textContent).toBe("Finding direct path");

		await act(async () =>
			socket.emitMessage(
				JSON.stringify({
					type: "webrtc-answer",
					answer: { type: "answer", sdp: applicationSdp },
				}),
			),
		);
		expect(peer.remoteDescription).toEqual({ type: "answer", sdp: applicationSdp });
		peer.channel.open();
		await act(async () => socket.emitMessage(JSON.stringify({ type: "webrtc-switch" })));
		expect(socket.sent).toContain(JSON.stringify({ type: "webrtc-activate" }));

		const websocketBinaryBeforeSwitch = socket.sent.filter(
			(value) => value instanceof Uint8Array,
		).length;
		rendererState.options!.onData(new TextEncoder().encode("queued"));
		expect(socket.sent.filter((value) => value instanceof Uint8Array)).toHaveLength(
			websocketBinaryBeforeSwitch,
		);
		expect(peer.channel.sent).toHaveLength(0);

		await act(async () =>
			peer.channel.emitMessage(
				JSON.stringify({
					type: "ready",
					transport: "webrtc",
					leaseExpiresAt: "2026-07-26T12:02:00.000Z",
				}),
			),
		);
		expect(screen.getByTestId("terminal-transport").textContent).toBe("Direct P2P");
		expect(new TextDecoder().decode(peer.channel.sent[0] as ArrayBuffer)).toBe("queued");

		await act(async () =>
			peer.channel.emitMessage(new TextEncoder().encode("direct-output").buffer),
		);
		expect(new TextDecoder().decode(rendererState.writes.at(-1))).toBe("direct-output");
		rendererState.options!.onResize(121, 41);
		await new Promise((resolve) => setTimeout(resolve, 70));
		expect(
			peer.channel.sent.some(
				(value) =>
					typeof value === "string" &&
					value === JSON.stringify({ type: "resize", cols: 121, rows: 41 }),
			),
		).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Debug" }));
		await waitFor(() =>
			expect(
				peer.channel.sent.some(
					(value) => typeof value === "string" && value.includes('"type":"ping"'),
				),
			).toBe(true),
		);
		await waitFor(() =>
			expect(
				fetchRecords.some(
					(record) =>
						record.path.endsWith("/terminal/lease") &&
						(record.body as { clientId?: string }).clientId,
				),
			).toBe(true),
		);
		expect(socket.closes).toHaveLength(0);

		view.unmount();
		expect(peer.closed).toBe(true);
	});

	test("falls back after direct-path loss, suppresses automatic retry, and offers Retry P2P", async () => {
		installFakeRtc();
		attachmentResponses.push(p2pAttachment("p2p-first"), p2pAttachment("p2p-fallback"));
		render(<TerminalWorkspace {...defaultProps()} />);
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const firstSocket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => firstSocket.emitMessage(JSON.stringify({ type: "ready" })));
		await waitFor(() => expect(FakeRtcPeerConnection.instances).toHaveLength(1));
		const firstPeer = FakeRtcPeerConnection.instances[0]!;
		await act(async () =>
			firstSocket.emitMessage(
				JSON.stringify({
					type: "webrtc-answer",
					answer: { type: "answer", sdp: applicationSdp },
				}),
			),
		);
		firstPeer.channel.open();
		await act(async () => firstSocket.emitMessage(JSON.stringify({ type: "webrtc-switch" })));
		await act(async () =>
			firstPeer.channel.emitMessage(
				JSON.stringify({
					type: "ready",
					transport: "webrtc",
				}),
			),
		);
		expect(screen.getByTestId("terminal-transport").textContent).toBe("Direct P2P");

		await act(async () => firstPeer.channel.emitClose());
		expect(firstSocket.closes).toContainEqual({
			code: TERMINAL_P2P_FAILED_CLOSE_CODE,
			reason: "terminal_p2p_client_failed",
		});
		expect(screen.getByTestId("terminal-transport").textContent).toBe("WebSocket fallback");
		await act(async () =>
			firstSocket.emitClose(TERMINAL_P2P_FAILED_CLOSE_CODE, "terminal_p2p_channel_closed"),
		);
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(2));
		const fallbackSocket = FakeTerminalWebSocket.instances[1]!;
		await act(async () => fallbackSocket.emitMessage(JSON.stringify({ type: "ready" })));
		expect(FakeRtcPeerConnection.instances).toHaveLength(1);
		expect(screen.getByTestId("terminal-transport").textContent).toBe("WebSocket fallback");
		expect(screen.getByRole("button", { name: "Retry P2P" })).toBeTruthy();
		rendererState.options!.onData(new TextEncoder().encode("fallback-input"));
		expect(fallbackSocket.sent.some((value) => value instanceof Uint8Array)).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Retry P2P" }));
		await waitFor(() => expect(FakeRtcPeerConnection.instances).toHaveLength(2));
		expect(screen.getByTestId("terminal-transport").textContent).toBe("Finding direct path");
	});

	test("returns to the live WebSocket when direct negotiation is unavailable", async () => {
		installFakeRtc();
		attachmentResponses.push(p2pAttachment("p2p-negotiation-fallback"));
		render(<TerminalWorkspace {...defaultProps()} />);
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));
		await waitFor(() => expect(FakeRtcPeerConnection.instances).toHaveLength(1));
		await act(async () =>
			socket.emitMessage(
				JSON.stringify({
					type: "webrtc-unavailable",
					message: "No direct path",
				}),
			),
		);
		expect(screen.getByTestId("terminal-transport").textContent).toBe("WebSocket");
		rendererState.options!.onData(new TextEncoder().encode("still-live"));
		expect(socket.sent.some((value) => value instanceof Uint8Array)).toBe(true);
	});

	test("keeps the Debug control visible while gating diagnostics behind its flag", async () => {
		render(<TerminalWorkspace {...defaultProps()} />);

		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));
		const debug = screen.getByRole("button", { name: "Debug" });

		expect(debug.getAttribute("aria-pressed")).toBe("false");
		expect(screen.queryByTestId("terminal-latency-overlay")).toBeNull();
		expect(rendererState.latencyKeyHandler).toBeNull();
		expect(
			socket.sent.some((value) => typeof value === "string" && value.includes('"type":"ping"')),
		).toBe(false);

		fireEvent.click(debug);
		expect(debug.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByTestId("terminal-latency-overlay").textContent).toContain("Key → canvas");
		expect(new URL(window.location.href).searchParams.get("terminalLatency")).toBe("1");
		expect(rendererState.latencyKeyHandler).not.toBeNull();
		await waitFor(() =>
			expect(
				socket.sent.some((value) => typeof value === "string" && value.includes('"type":"ping"')),
			).toBe(true),
		);
		expect(rendererState.calls).toBe(1);
		expect(FakeTerminalWebSocket.instances).toHaveLength(1);

		fireEvent.click(debug);
		expect(debug.getAttribute("aria-pressed")).toBe("false");
		expect(screen.queryByTestId("terminal-latency-overlay")).toBeNull();
		expect(new URL(window.location.href).searchParams.get("terminalLatency")).toBeNull();
		expect(rendererState.latencyKeyHandler).toBeNull();
		expect(rendererState.calls).toBe(1);
		expect(FakeTerminalWebSocket.instances).toHaveLength(1);
	});

	test("reports an opt-in key-to-canvas sample only after Ghostty renders host output", async () => {
		window.history.replaceState({}, "", "/?terminalLatency=1");
		render(<TerminalWorkspace {...defaultProps()} />);

		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));
		const overlay = screen.getByTestId("terminal-latency-overlay");
		expect(overlay.textContent).toContain("Waiting…");
		expect(overlay.textContent).toContain("Baseline RTT");
		await waitFor(() => expect(rendererState.latencyKeyHandler).not.toBeNull());

		const ping = socket.sent
			.filter((value): value is string => typeof value === "string")
			.map((value) => JSON.parse(value) as { type?: string; id?: number })
			.find((control) => control.type === "ping");
		expect(ping?.id).toBeNumber();
		await act(async () => socket.emitMessage(JSON.stringify({ type: "pong", id: ping!.id })));
		expect(overlay.textContent).toMatch(/Baseline RTT\d+\.\d ms/);

		await act(async () => {
			rendererState.latencyKeyHandler!(new KeyboardEvent("keydown", { key: "x" }));
			rendererState.options!.onData(new TextEncoder().encode("x"));
		});
		expect(rendererState.pendingCanvasRenders).toHaveLength(0);

		await act(async () => socket.emitMessage(new TextEncoder().encode("x").buffer));
		expect(rendererState.pendingCanvasRenders).toHaveLength(1);
		expect(overlay.textContent).toContain("Waiting…");

		await act(async () => {
			const render = rendererState.pendingCanvasRenders.shift();
			render?.onRenderStart();
			render?.onRenderComplete();
		});
		expect(overlay.textContent).toMatch(/Key → canvas\d+\.\d ms/);
		expect(overlay.textContent).toMatch(/p50 \d+\.\d · p95 \d+\.\d · n=1/);
		expect(overlay.textContent).toMatch(/Press → send\d+\.\d ms/);
		expect(overlay.textContent).toMatch(/Send → receive\d+\.\d ms/);
		expect(overlay.textContent).toMatch(/Receive → paint\d+\.\d ms/);
		expect(overlay.textContent).toMatch(/Receive → write done\d+\.\d ms/);
		expect(overlay.textContent).toMatch(/Frame wait\d+\.\d ms/);
		expect(overlay.textContent).toMatch(/Canvas render\d+\.\d ms/);
		expect(overlay.textContent).toMatch(/Latest key: \d+\.\d \+ \d+\.\d \+ \d+\.\d = \d+\.\d ms/);
	});

	test("reattaches each new renderer after rapid typography changes while hidden", async () => {
		const props = defaultProps();
		const view = render(<TerminalWorkspace {...props} />);

		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const initialSocket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => initialSocket.emitMessage(JSON.stringify({ type: "ready" })));
		expect(screen.getByText("Connected")).toBeTruthy();

		const adjustedRendererConfig = {
			...props.rendererConfig,
			fontSize: props.rendererConfig.fontSize + 1,
		};
		view.rerender(
			<TerminalWorkspace {...props} active={false} rendererConfig={adjustedRendererConfig} />,
		);

		await waitFor(() => expect(rendererState.calls).toBe(2));
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(2));
		expect(initialSocket.closes).toContainEqual({
			code: 1000,
			reason: "workspace_unmounted",
		});
		const replacementSocket = FakeTerminalWebSocket.instances[1]!;
		await act(async () => replacementSocket.emitMessage(JSON.stringify({ type: "ready" })));

		const finalRendererConfig = {
			...adjustedRendererConfig,
			fontSize: adjustedRendererConfig.fontSize + 1,
		};
		view.rerender(
			<TerminalWorkspace {...props} active={false} rendererConfig={finalRendererConfig} />,
		);
		await waitFor(() => expect(rendererState.calls).toBe(3));
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(3));
		const finalSocket = FakeTerminalWebSocket.instances[2]!;
		await act(async () => finalSocket.emitMessage(JSON.stringify({ type: "ready" })));

		view.rerender(<TerminalWorkspace {...props} active rendererConfig={finalRendererConfig} />);
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(rendererState.configs).toEqual([
			props.rendererConfig,
			adjustedRendererConfig,
			finalRendererConfig,
		]);
	});

	test("updates the terminal palette without reconnecting the tmux attachment", async () => {
		const props = defaultProps();
		const view = render(<TerminalWorkspace {...props} />);

		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const initialSocket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => initialSocket.emitMessage(JSON.stringify({ type: "ready" })));
		await waitFor(() => expect(rendererState.themes).toContain(props.rendererConfig.theme));

		const lightConfig = terminalRendererConfig(DEFAULT_TYPOGRAPHY_PREFERENCES.terminal, "light");
		view.rerender(<TerminalWorkspace {...props} rendererConfig={lightConfig} />);

		await waitFor(() => expect(rendererState.themes).toContain(lightConfig.theme));
		expect(rendererState.calls).toBe(1);
		expect(FakeTerminalWebSocket.instances).toHaveLength(1);
		expect(rendererState.disposed).toBe(0);
		expect(initialSocket.closes).toHaveLength(0);
	});

	test("asks before taking control from another tab", async () => {
		attachmentResponses.push(
			jsonResponse(
				{
					error: {
						code: "terminal_in_use",
						message: "The tmux terminal is controlled by another browser tab",
					},
				},
				409,
			),
			jsonResponse(
				{
					ticket: "takeover-ticket",
					expiresAt: "2026-07-26T12:00:30.000Z",
					protocol: "couchview-terminal-v1",
					session: { profileId: "tmux", running: true, controllerConnected: true },
				},
				201,
			),
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

	test("warns once before terminating running programs and unsaved work", async () => {
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
		expect(endBodies).toEqual([null]);
		expect(confirmations).toHaveLength(1);
		expect(confirmations[0]).toContain("Running programs and unsaved work");
		expect(screen.getAllByText("Session ended")).toHaveLength(2);
	});

	test("does not load the renderer when the server capability is unavailable", async () => {
		render(
			<TerminalWorkspace
				{...defaultProps()}
				capability={{
					...capability,
					available: false,
					reason: "Install tmux",
					profiles: [{ id: "tmux", label: "tmux", available: false, reason: "Install tmux" }],
				}}
			/>,
		);
		expect(await screen.findByText("Install tmux")).toBeTruthy();
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

	test("does not retry an attachment with unsupported terminal dimensions", async () => {
		attachmentResponses.push(
			jsonResponse(
				{
					error: {
						code: "terminal_size_invalid",
						message: "Terminal dimensions are outside the supported range",
					},
				},
				400,
			),
		);

		render(<TerminalWorkspace {...defaultProps()} />);

		expect(
			await screen.findByText("Terminal dimensions are outside the supported range"),
		).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 650));
		expect(
			fetchRecords.filter((record) => record.path.endsWith("/terminal/attachments")),
		).toHaveLength(1);
		expect(FakeTerminalWebSocket.instances).toHaveLength(0);
	});

	test("reinitializes with bundled defaults when Safe Mode is requested", async () => {
		const hostRenderer = {
			...SAFE_TERMINAL_RENDERER_CONFIG,
			cellHeightAdjustment: 10,
			cellWidthAdjustment: 4,
		};
		attachmentResponses.push(
			jsonResponse(
				{
					error: {
						code: "terminal_size_invalid",
						message: "Terminal dimensions are outside the supported range",
					},
				},
				400,
			),
		);

		render(<TerminalWorkspace {...defaultProps()} rendererConfig={hostRenderer} />);

		expect(await screen.findByRole("button", { name: "Safe Mode" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Safe Mode" }));
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));

		expect(rendererState.configs).toEqual([hostRenderer, SAFE_TERMINAL_RENDERER_CONFIG]);
		expect(rendererState.disposed).toBe(1);
		expect(screen.getByText("Connected · Safe Mode")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Safe Mode" })).toBeNull();
	});

	test("reinitializes in Safe Mode when the requested layout already matches defaults", async () => {
		attachmentResponses.push(
			jsonResponse(
				{
					error: {
						code: "terminal_size_invalid",
						message: "Terminal dimensions are outside the supported range",
					},
				},
				400,
			),
		);

		render(<TerminalWorkspace {...defaultProps()} />);

		expect(await screen.findByRole("button", { name: "Safe Mode" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Safe Mode" }));
		await waitFor(() => expect(rendererState.calls).toBe(2));
		expect(rendererState.disposed).toBe(1);
		expect(FakeTerminalWebSocket.instances).toHaveLength(1);
	});

	test("does not reconnect after an unsupported terminal resize", async () => {
		render(<TerminalWorkspace {...defaultProps()} />);
		await waitFor(() => expect(FakeTerminalWebSocket.instances).toHaveLength(1));
		const socket = FakeTerminalWebSocket.instances[0]!;
		await act(async () => socket.emitMessage(JSON.stringify({ type: "ready" })));

		await act(async () => socket.emitClose(1008, "terminal_size_invalid"));
		expect(screen.getByText("Terminal dimensions are outside the supported range.")).toBeTruthy();
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
