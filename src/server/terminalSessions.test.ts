import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	TERMINAL_ENDED_CLOSE_CODE,
	TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
	TERMINAL_P2P_FAILED_CLOSE_CODE,
} from "../shared/contracts.ts";
import {
	isLoopbackHostname,
	TERMINAL_PROTOCOL,
	TERMINAL_TICKET_PREFIX,
	type TerminalCommandRunner,
	type TerminalDataChannel,
	type TerminalEvent,
	type TerminalPeerConnection,
	TerminalSessionService,
	type TerminalSocketData,
	terminalAccessIsLoopback,
} from "./terminalSessions.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

interface CommandHarness {
	commands: string[][];
	runner: TerminalCommandRunner;
	serverRunning: boolean;
	sessionRunning: boolean;
}

function commandHarness(initialSession = false, initialServer = initialSession): CommandHarness {
	const harness: CommandHarness = {
		commands: [],
		serverRunning: initialServer,
		sessionRunning: initialSession,
		async runner(argv) {
			const command = [...argv];
			harness.commands.push(command);
			if (command.includes("has-session")) {
				return { exitCode: harness.sessionRunning ? 0 : 1, stdout: "", stderr: "" };
			}
			if (command.includes("list-sessions")) {
				return { exitCode: harness.serverRunning ? 0 : 1, stdout: "", stderr: "" };
			}
			if (command.includes("new-session")) {
				harness.serverRunning = true;
				harness.sessionRunning = true;
				return { exitCode: 0, stdout: "", stderr: "" };
			}
			if (command.includes("kill-session")) {
				harness.serverRunning = false;
				harness.sessionRunning = false;
				return { exitCode: 0, stdout: "", stderr: "" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		},
	};
	return harness;
}

async function serviceFixture(
	harness: CommandHarness,
	options: {
		enabled?: boolean;
		now?: () => number;
		tokenFactory?: () => string;
		userTmuxConfig?: string;
		withPty?: boolean;
		p2pEnabled?: boolean;
		peerConnectionFactory?: (iceServers: readonly string[]) => TerminalPeerConnection;
		setTimer?: typeof setTimeout;
		clearTimer?: typeof clearTimeout;
	} = {},
) {
	const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "couchview-terminal-"));
	temporaryDirectories.push(runtimeDirectory);
	const userTmuxConfigPath = options.userTmuxConfig
		? path.join(runtimeDirectory, "user-tmux.conf")
		: null;
	if (userTmuxConfigPath) await writeFile(userTmuxConfigPath, options.userTmuxConfig!, "utf8");
	let terminalClosed = 0;
	let processKilled = 0;
	const terminalWrites: Uint8Array[] = [];
	const terminalResizes: Array<{ cols: number; rows: number }> = [];
	let terminalOptions: Bun.TerminalOptions | null = null;
	const terminal = {
		close() {
			terminalClosed += 1;
		},
		resize(cols: number, rows: number) {
			terminalResizes.push({ cols, rows });
		},
		setRawMode() {},
		write(bytes: Uint8Array) {
			terminalWrites.push(Uint8Array.from(bytes));
		},
	} as unknown as Bun.Terminal;
	const process = {
		exited: new Promise<number>(() => undefined),
		kill() {
			processKilled += 1;
		},
	} as unknown as ReturnType<typeof Bun.spawn>;
	const service = new TerminalSessionService({
		enabled: options.enabled ?? true,
		namespaceSeed: "terminal-session-tests",
		runtimeDirectory,
		dependencies: {
			terminalAvailable: true,
			tmuxPath: "/fake/tmux",
			tmux256Color: true,
		},
		commandRunner: harness.runner,
		now: options.now,
		tokenFactory: options.tokenFactory,
		userTmuxConfigPath,
		p2pEnabled: options.p2pEnabled,
		peerConnectionFactory: options.peerConnectionFactory,
		setTimer: options.setTimer,
		clearTimer: options.clearTimer,
		...(options.withPty
			? {
					terminalFactory: (createdOptions: Bun.TerminalOptions) => {
						terminalOptions = createdOptions;
						return terminal;
					},
					terminalSpawner: () => process,
				}
			: {}),
	});
	return {
		processKilled: () => processKilled,
		runtimeDirectory,
		service,
		terminalClosed: () => terminalClosed,
		terminalOptions: () => terminalOptions,
		terminalResizes,
		terminalWrites,
	};
}

function attachmentRequest(clientId = "client_12345678") {
	return {
		clientId,
		profileId: "tmux" as const,
		cols: 100,
		rows: 32,
		takeover: false,
	};
}

function upgradeRequest(ticket: string): Request {
	return new Request("http://127.0.0.1:4173/api/repositories/repo/terminal/socket", {
		headers: {
			host: "127.0.0.1:4173",
			origin: "http://127.0.0.1:4173",
			"sec-websocket-protocol": `${TERMINAL_PROTOCOL}, ${TERMINAL_TICKET_PREFIX}${ticket}`,
			upgrade: "websocket",
		},
	});
}

function fakeSocket(data: TerminalSocketData) {
	const sent: string[] = [];
	const binary: Uint8Array[] = [];
	const closes: Array<{ code?: number; reason?: string }> = [];
	return {
		binaryType: "arraybuffer",
		closes,
		data,
		binary,
		sendBinary(value: Uint8Array) {
			binary.push(Uint8Array.from(value));
			return 1;
		},
		sendText(value: string) {
			sent.push(value);
			return 1;
		},
		close(code?: number, reason?: string) {
			closes.push({ code, reason });
		},
		sent,
	} as unknown as Bun.ServerWebSocket<TerminalSocketData> & {
		closes: Array<{ code?: number; reason?: string }>;
		sent: string[];
		binary: Uint8Array[];
	};
}

class FakeTerminalEvent<T extends unknown[]> implements TerminalEvent<T> {
	private readonly handlers = new Set<(...args: T) => void>();

	subscribe(handler: (...args: T) => void) {
		this.handlers.add(handler);
		return { unSubscribe: () => this.handlers.delete(handler) };
	}

	emit(...args: T): void {
		for (const handler of this.handlers) handler(...args);
	}
}

class FakeDataChannel implements TerminalDataChannel {
	readonly label: string;
	readonly protocol: string;
	readonly ordered: boolean;
	readonly maxRetransmits = undefined;
	readonly maxPacketLifeTime = undefined;
	readyState: "open" | "closed" | "connecting" | "closing" = "connecting";
	bufferedAmount = 0;
	readonly stateChanged = new FakeTerminalEvent<["open" | "closed" | "connecting" | "closing"]>();
	readonly onMessage = new FakeTerminalEvent<[string | Buffer<ArrayBufferLike>]>();
	readonly error = new FakeTerminalEvent<[Error]>();
	readonly sent: Array<string | Buffer<ArrayBufferLike>> = [];

	constructor(options: { label?: string; protocol?: string; ordered?: boolean } = {}) {
		this.label = options.label ?? "couchview-terminal";
		this.protocol = options.protocol ?? "couchview-terminal-data-v1";
		this.ordered = options.ordered ?? true;
	}

	send(value: string | Buffer<ArrayBufferLike>): void {
		this.sent.push(typeof value === "string" ? value : Buffer.from(value));
	}

	open(): void {
		this.readyState = "open";
		this.stateChanged.emit("open");
	}

	close(): void {
		if (this.readyState === "closed") return;
		this.readyState = "closed";
		this.stateChanged.emit("closed");
	}
}

class FakePeerConnection implements TerminalPeerConnection {
	readonly onDataChannel = new FakeTerminalEvent<[TerminalDataChannel]>();
	readonly connectionStateChange = new FakeTerminalEvent<
		["disconnected" | "closed" | "new" | "connected" | "connecting" | "failed"]
	>();
	localDescription: { type: "answer"; sdp: string } | undefined;
	remoteDescription: { type: "offer"; sdp: string } | undefined;
	closed = false;

	async setRemoteDescription(description: { type: "offer"; sdp: string }): Promise<void> {
		this.remoteDescription = description;
	}

	async createAnswer(): Promise<{ type: "answer"; sdp: string }> {
		return {
			type: "answer",
			sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
		};
	}

	async setLocalDescription(description: { type: "answer"; sdp: string }): Promise<void> {
		this.localDescription = description;
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

describe("terminal network policy", () => {
	test("recognizes only loopback bind hosts and origins", () => {
		expect(isLoopbackHostname("localhost")).toBe(true);
		expect(isLoopbackHostname("127.42.0.9")).toBe(true);
		expect(isLoopbackHostname("[::1]")).toBe(true);
		expect(isLoopbackHostname("0.0.0.0")).toBe(false);
		expect(isLoopbackHostname("192.168.1.10")).toBe(false);
		expect(
			terminalAccessIsLoopback("127.0.0.1", ["http://localhost:4173", "http://127.0.0.1:4173"]),
		).toBe(true);
		expect(terminalAccessIsLoopback("127.0.0.1", ["http://192.168.1.10:4173"])).toBe(false);
		expect(terminalAccessIsLoopback("0.0.0.0", [])).toBe(false);
	});

	test("reports dependency and explicit-policy failures", async () => {
		const harness = commandHarness();
		const disabled = await serviceFixture(harness, { enabled: false });
		expect(disabled.service.capability).toMatchObject({
			available: false,
			persistence: "tmux",
		});
		expect(disabled.service.capability.reason).toContain("disabled");

		const missing = new TerminalSessionService({
			enabled: true,
			namespaceSeed: "missing-dependencies",
			dependencies: {
				terminalAvailable: true,
				tmuxPath: null,
				tmux256Color: false,
			},
		});
		expect(missing.capability.reason).toContain("Install tmux");
		missing.close();
	});
});

describe("persistent tmux sessions", () => {
	test("rejects malformed takeover requests before starting tmux", async () => {
		const harness = commandHarness();
		const { service } = await serviceFixture(harness);
		await expect(
			service.issueAttachment(
				"repo",
				"/project",
				{
					...attachmentRequest(),
					takeover: "yes" as unknown as boolean,
				},
				{ host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
			),
		).rejects.toMatchObject({
			status: 400,
			code: "terminal_takeover_invalid",
		});
		expect(harness.commands.some((command) => command.includes("new-session"))).toBe(false);
		service.close();
	});

	test("starts one raw tmux session and sources the local config before required overrides", async () => {
		const harness = commandHarness();
		let token = 0;
		const { runtimeDirectory, service } = await serviceFixture(harness, {
			tokenFactory: () => `ticket-${++token}`,
			userTmuxConfig: "set -g default-shell /opt/homebrew/bin/fish\nset -g mouse off\n",
		});

		await service.issueAttachment("repo", "/project", attachmentRequest(), {
			host: "127.0.0.1:4173",
			origin: "http://127.0.0.1:4173",
		});
		await service.issueAttachment("repo", "/project", attachmentRequest(), {
			host: "127.0.0.1:4173",
			origin: "http://127.0.0.1:4173",
		});

		expect(harness.commands.filter((command) => command.includes("new-session"))).toHaveLength(1);
		const newSession = harness.commands.find((command) => command.includes("new-session"));
		expect(newSession).toEqual(
			expect.arrayContaining(["/fake/tmux", "-f", path.join(runtimeDirectory, "tmux.conf"), "-L"]),
		);
		expect(newSession?.slice(-6)).toEqual([
			"new-session",
			"-d",
			"-s",
			expect.stringMatching(/^nvim-/),
			"-c",
			"/project",
		]);
		const tmuxConfiguration = await readFile(path.join(runtimeDirectory, "tmux.conf"), "utf8");
		expect(tmuxConfiguration.indexOf("source-file")).toBeLessThan(
			tmuxConfiguration.indexOf("mouse on"),
		);
		expect(tmuxConfiguration).toContain("user-tmux.conf");
		expect(tmuxConfiguration).toContain("escape-time 0");
		expect(tmuxConfiguration).toContain("focus-events on");
		expect(tmuxConfiguration).toContain("mouse on");
		expect(tmuxConfiguration).toContain("default-terminal tmux-256color");
		expect(tmuxConfiguration).toContain("xterm-256color:RGB");
		expect((await stat(path.join(runtimeDirectory, "tmux.conf"))).mode & 0o777).toBe(0o600);
		expect(harness.commands.flat()).not.toContain("/fake/nvim");
		expect(await service.status("repo")).toEqual({
			profileId: "tmux",
			running: true,
			controllerConnected: false,
		});
		service.close();
		expect(harness.sessionRunning).toBe(true);
	});

	test("loads the host config into a preserved tmux server before applying overrides", async () => {
		const harness = commandHarness(true);
		const { runtimeDirectory, service } = await serviceFixture(harness, {
			userTmuxConfig: "set -g status-style bg=blue\n",
		});

		await service.issueAttachment("repo", "/project", attachmentRequest(), {
			host: "127.0.0.1:4173",
			origin: "http://127.0.0.1:4173",
		});
		await service.issueAttachment("repo", "/project", attachmentRequest(), {
			host: "127.0.0.1:4173",
			origin: "http://127.0.0.1:4173",
		});

		expect(harness.commands.some((command) => command.includes("new-session"))).toBe(false);
		const sourceIndexes = harness.commands.flatMap((command, index) =>
			command.includes("source-file") ? [index] : [],
		);
		expect(sourceIndexes).toHaveLength(1);
		expect(harness.commands[sourceIndexes[0]!]?.at(-1)).toBe(
			path.join(runtimeDirectory, "user-tmux.conf"),
		);
		const mouseOverrideIndex = harness.commands.findIndex(
			(command) =>
				command.includes("set-option") && command.includes("mouse") && command.includes("on"),
		);
		expect(sourceIndexes[0]!).toBeLessThan(mouseOverrideIndex);
		service.close();
		expect(harness.sessionRunning).toBe(true);
	});

	test("binds short-lived tickets to repository, host, and origin and consumes them once", async () => {
		const harness = commandHarness();
		let now = 1_000;
		let token = 0;
		const { service } = await serviceFixture(harness, {
			now: () => now,
			tokenFactory: () => `ticket-${++token}`,
		});
		const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
		const issued = await service.issueAttachment("repo", "/project", attachmentRequest(), binding);
		expect(service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding)).toMatchObject({
			repositoryId: "repo",
			clientId: "client_12345678",
			cols: 100,
			rows: 32,
		});
		expect(() => service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding)).toThrow(
			expect.objectContaining({ code: "terminal_ticket_invalid" }),
		);

		const wrongBinding = await service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest(),
			binding,
		);
		expect(() =>
			service.consumeUpgrade("repo", upgradeRequest(wrongBinding.ticket), {
				...binding,
				origin: "http://localhost:4173",
			}),
		).toThrow(expect.objectContaining({ code: "terminal_ticket_invalid" }));

		const expired = await service.issueAttachment("repo", "/project", attachmentRequest(), binding);
		now += 30_001;
		expect(() => service.consumeUpgrade("repo", upgradeRequest(expired.ticket), binding)).toThrow(
			expect.objectContaining({ code: "terminal_ticket_invalid" }),
		);
		service.close();
	});

	test("binds native tickets to a device and closes tickets and sockets on revocation", async () => {
		const harness = commandHarness();
		let token = 0;
		const { service } = await serviceFixture(harness, {
			tokenFactory: () => `ticket-${++token}`,
			withPty: true,
		});
		const nativeBinding = { host: "127.0.0.1:4173", nativeClientId: "native-device" };
		const issued = await service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest(),
			nativeBinding,
		);
		const data = service.consumeUpgrade("repo", upgradeRequest(issued.ticket), {
			host: nativeBinding.host,
			origin: null,
		});
		expect(data).toMatchObject({ nativeClientId: "native-device", origin: null });
		const socket = fakeSocket(data);
		service.websocket.open?.(socket as unknown as Bun.ServerWebSocket<TerminalSocketData>);

		const pending = await service.issueAttachment(
			"other-repo",
			"/project",
			attachmentRequest("other_client"),
			nativeBinding,
		);
		service.revokeNativeClient("native-device");
		expect(socket.closes).toContainEqual({ code: 4006, reason: "native_client_revoked" });
		expect(() =>
			service.consumeUpgrade("other-repo", upgradeRequest(pending.ticket), {
				host: nativeBinding.host,
				origin: null,
			}),
		).toThrow(expect.objectContaining({ code: "terminal_ticket_invalid" }));
		service.close();
	});

	test("enforces one controller and explicit takeover while leaving tmux alive", async () => {
		const harness = commandHarness();
		let token = 0;
		const fixture = await serviceFixture(harness, {
			tokenFactory: () => `ticket-${++token}`,
			withPty: true,
		});
		const { service } = fixture;
		const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
		const first = await service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest("first_client"),
			binding,
		);
		const firstSocket = fakeSocket(
			service.consumeUpgrade("repo", upgradeRequest(first.ticket), binding),
		);
		service.websocket.open!(firstSocket);
		expect(firstSocket.sent.map((value) => JSON.parse(value))).toContainEqual(
			expect.objectContaining({ type: "ready" }),
		);
		service.websocket.message!(firstSocket, JSON.stringify({ type: "ping", id: 7 }));
		expect(firstSocket.sent.map((value) => JSON.parse(value))).toContainEqual({
			type: "pong",
			id: 7,
		});

		await expect(
			service.issueAttachment("repo", "/project", attachmentRequest("second_client"), binding),
		).rejects.toMatchObject({ status: 409, code: "terminal_in_use" });

		const takeover = await service.issueAttachment(
			"repo",
			"/project",
			{ ...attachmentRequest("second_client"), takeover: true },
			binding,
		);
		const secondSocket = fakeSocket(
			service.consumeUpgrade("repo", upgradeRequest(takeover.ticket), binding),
		);
		service.websocket.open!(secondSocket);
		expect(firstSocket.closes).toContainEqual({ code: 4001, reason: "taken_over" });
		expect(await service.status("repo")).toMatchObject({ controllerConnected: true });

		service.close();
		expect(fixture.processKilled()).toBeGreaterThan(0);
		expect(fixture.terminalClosed()).toBeGreaterThan(0);
		expect(harness.commands.some((command) => command.includes("kill-session"))).toBe(false);
		expect(harness.sessionRunning).toBe(true);
	});

	test("ends running sessions directly even when terminal access is now disabled", async () => {
		const harness = commandHarness(true);
		const enabled = await serviceFixture(harness);
		expect(await enabled.service.end("repo")).toEqual({ status: "ended" });
		expect(harness.sessionRunning).toBe(false);
		expect(harness.commands.some((command) => command.includes("kill-session"))).toBe(true);
		enabled.service.close();

		const disabledHarness = commandHarness(true);
		const disabled = await serviceFixture(disabledHarness, { enabled: false });
		expect(await disabled.service.status("repo")).toMatchObject({ running: true });
		expect(await disabled.service.end("repo")).toEqual({ status: "ended" });
		expect(disabledHarness.sessionRunning).toBe(false);
		disabled.service.close();
	});

	test("closes controllers and invalidates pending tickets when a session ends", async () => {
		const harness = commandHarness(true);
		let token = 0;
		const fixture = await serviceFixture(harness, {
			tokenFactory: () => `ticket-${++token}`,
			withPty: true,
		});
		const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
		const first = await fixture.service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest(),
			binding,
		);
		const socket = fakeSocket(
			fixture.service.consumeUpgrade("repo", upgradeRequest(first.ticket), binding),
		);
		fixture.service.websocket.open!(socket);
		const pending = await fixture.service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest(),
			binding,
		);

		await fixture.service.end("repo");

		expect(socket.closes).toContainEqual({
			code: TERMINAL_ENDED_CLOSE_CODE,
			reason: "terminal_ended",
		});
		expect(() =>
			fixture.service.consumeUpgrade("repo", upgradeRequest(pending.ticket), binding),
		).toThrow(expect.objectContaining({ code: "terminal_ticket_invalid" }));
		expect(harness.sessionRunning).toBe(false);
		fixture.service.close();
	});
});

const applicationOffer = {
	type: "offer" as const,
	sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
};

async function finishNegotiation(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("direct terminal transport", () => {
	test("hands off in order and routes terminal bytes, controls, and leases through WebRTC", async () => {
		const harness = commandHarness();
		const peer = new FakePeerConnection();
		const fixture = await serviceFixture(harness, {
			withPty: true,
			p2pEnabled: true,
			peerConnectionFactory: () => peer,
		});
		const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
		const issued = await fixture.service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest(),
			binding,
		);
		expect(issued.webRtc).toEqual({
			iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
			negotiationTimeoutMs: 10_000,
			leaseRenewIntervalMs: 30_000,
		});
		const socket = fakeSocket(
			fixture.service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding),
		);
		fixture.service.websocket.open!(socket);
		fixture.service.websocket.message!(
			socket,
			JSON.stringify({
				type: "webrtc-offer",
				offer: applicationOffer,
			}),
		);
		await finishNegotiation();
		expect(peer.remoteDescription).toEqual(applicationOffer);
		expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual(
			expect.objectContaining({ type: "webrtc-answer" }),
		);

		const channel = new FakeDataChannel();
		peer.onDataChannel.emit(channel);
		channel.open();
		expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
			type: "webrtc-switch",
		});
		const terminalData = fixture.terminalOptions()?.data;
		if (!terminalData) throw new Error("terminal data callback missing");
		terminalData({} as Bun.Terminal, Uint8Array.from([1, 2, 3]));
		expect(socket.binary).toHaveLength(0);

		fixture.service.websocket.message!(socket, JSON.stringify({ type: "webrtc-activate" }));
		expect(JSON.parse(channel.sent[0] as string)).toMatchObject({
			type: "ready",
			transport: "webrtc",
		});
		expect([...(channel.sent[1] as Buffer)]).toEqual([1, 2, 3]);

		channel.onMessage.emit(Buffer.from("input"));
		channel.onMessage.emit(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
		channel.onMessage.emit(JSON.stringify({ type: "ping", id: 9 }));
		fixture.service.websocket.message!(socket, Buffer.from("ignored"));
		expect(fixture.terminalWrites.map((value) => new TextDecoder().decode(value))).toEqual([
			"input",
		]);
		expect(fixture.terminalResizes).toEqual([{ cols: 120, rows: 40 }]);
		expect(
			channel.sent.map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
		).toContainEqual({ type: "pong", id: 9 });

		const renewed = fixture.service.renewLease(
			"repo",
			{
				clientId: "client_12345678",
			},
			binding,
		);
		expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.now());
		expect(() =>
			fixture.service.renewLease(
				"repo",
				{
					clientId: "different_client",
				},
				binding,
			),
		).toThrow(expect.objectContaining({ code: "terminal_lease_forbidden" }));

		fixture.service.websocket.close!(socket, 1000, "closed");
		expect(peer.closed).toBe(true);
		expect(harness.sessionRunning).toBe(true);
		fixture.service.close();
	});

	test("rejects malformed, oversized, and invalid-channel negotiations without losing WebSocket", async () => {
		const harness = commandHarness();
		const peers: FakePeerConnection[] = [];
		const fixture = await serviceFixture(harness, {
			withPty: true,
			p2pEnabled: true,
			peerConnectionFactory: () => {
				const peer = new FakePeerConnection();
				peers.push(peer);
				return peer;
			},
		});
		const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
		const issued = await fixture.service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest(),
			binding,
		);
		const socket = fakeSocket(
			fixture.service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding),
		);
		fixture.service.websocket.open!(socket);

		fixture.service.websocket.message!(
			socket,
			JSON.stringify({
				type: "webrtc-offer",
				offer: { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" },
			}),
		);
		fixture.service.websocket.message!(
			socket,
			JSON.stringify({
				type: "webrtc-offer",
				offer: { ...applicationOffer, sdp: `${applicationOffer.sdp}${"a".repeat(49 * 1024)}` },
			}),
		);
		expect(socket.closes).toHaveLength(0);
		expect(
			socket.sent
				.map((value) => JSON.parse(value))
				.filter((value) => value.type === "webrtc-unavailable"),
		).toHaveLength(2);

		fixture.service.websocket.message!(
			socket,
			JSON.stringify({
				type: "webrtc-offer",
				offer: applicationOffer,
			}),
		);
		await finishNegotiation();
		const invalid = new FakeDataChannel({ ordered: false });
		peers[0]!.onDataChannel.emit(invalid);
		expect(peers[0]!.closed).toBe(true);
		expect(socket.closes).toHaveLength(0);

		const terminalData = fixture.terminalOptions()?.data;
		if (!terminalData) throw new Error("terminal data callback missing");
		terminalData({} as Bun.Terminal, Uint8Array.from([7]));
		expect(socket.binary.map((value) => [...value])).toEqual([[7]]);
		fixture.service.close();
	});

	test("times out negotiation while retaining the attached WebSocket", async () => {
		const harness = commandHarness();
		const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
		const setTimer = ((callback: () => void, delay = 0) => {
			timers.push({ callback, delay, cleared: false });
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout;
		const clearTimer = ((handle: ReturnType<typeof setTimeout>) => {
			const timer = timers[Number(handle) - 1];
			if (timer) timer.cleared = true;
		}) as typeof clearTimeout;
		const peer = new FakePeerConnection();
		const fixture = await serviceFixture(harness, {
			withPty: true,
			p2pEnabled: true,
			peerConnectionFactory: () => peer,
			setTimer,
			clearTimer,
		});
		const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
		const issued = await fixture.service.issueAttachment(
			"repo",
			"/project",
			attachmentRequest(),
			binding,
		);
		const socket = fakeSocket(
			fixture.service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding),
		);
		fixture.service.websocket.open!(socket);
		fixture.service.websocket.message!(
			socket,
			JSON.stringify({
				type: "webrtc-offer",
				offer: applicationOffer,
			}),
		);
		await finishNegotiation();
		const negotiationTimer = timers.find((timer) => timer.delay === 10_000);
		if (!negotiationTimer) throw new Error("negotiation timer missing");
		negotiationTimer.callback();
		expect(socket.closes).toHaveLength(0);
		expect(peer.closed).toBe(true);
		expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual(
			expect.objectContaining({ type: "webrtc-unavailable" }),
		);
		fixture.service.close();
	});

	test("expires leases and enforces active-channel backpressure with dedicated close codes", async () => {
		let now = 1_000;
		const harness = commandHarness();
		const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
		const setTimer = ((callback: () => void, delay = 0) => {
			timers.push({ callback, delay, cleared: false });
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout;
		const clearTimer = ((handle: ReturnType<typeof setTimeout>) => {
			const timer = timers[Number(handle) - 1];
			if (timer) timer.cleared = true;
		}) as typeof clearTimeout;
		const peers: FakePeerConnection[] = [];
		const fixture = await serviceFixture(harness, {
			withPty: true,
			p2pEnabled: true,
			now: () => now,
			setTimer,
			clearTimer,
			peerConnectionFactory: () => {
				const peer = new FakePeerConnection();
				peers.push(peer);
				return peer;
			},
		});
		const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
		const attach = async (clientId: string) => {
			const issued = await fixture.service.issueAttachment(
				"repo",
				"/project",
				attachmentRequest(clientId),
				binding,
			);
			const socket = fakeSocket(
				fixture.service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding),
			);
			fixture.service.websocket.open!(socket);
			fixture.service.websocket.message!(
				socket,
				JSON.stringify({
					type: "webrtc-offer",
					offer: applicationOffer,
				}),
			);
			await finishNegotiation();
			const channel = new FakeDataChannel();
			peers.at(-1)!.onDataChannel.emit(channel);
			channel.open();
			fixture.service.websocket.message!(socket, JSON.stringify({ type: "webrtc-activate" }));
			return { channel, socket };
		};

		const leased = await attach("client_12345678");
		fixture.service.renewLease("repo", { clientId: "client_12345678" }, binding);
		const leaseTimer = [...timers]
			.reverse()
			.find((timer) => timer.delay === 120_000 && !timer.cleared);
		if (!leaseTimer) throw new Error("lease timer missing");
		now += 120_001;
		leaseTimer.callback();
		expect(leased.socket.closes).toContainEqual({
			code: TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
			reason: "terminal_lease_expired",
		});
		expect(harness.sessionRunning).toBe(true);

		const pressured = await attach("client_abcdefgh");
		pressured.channel.bufferedAmount = 1024 * 1024;
		const terminalData = fixture.terminalOptions()?.data;
		if (!terminalData) throw new Error("terminal data callback missing");
		terminalData({} as Bun.Terminal, Uint8Array.from([9]));
		expect(pressured.socket.closes).toContainEqual({
			code: TERMINAL_P2P_FAILED_CLOSE_CODE,
			reason: "terminal_p2p_backpressure",
		});
		expect(harness.sessionRunning).toBe(true);
		fixture.service.close();
	});
});
