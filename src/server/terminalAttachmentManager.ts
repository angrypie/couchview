import {
	TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
	TERMINAL_P2P_FAILED_CLOSE_CODE,
	type TerminalLeaseRequest,
	type TerminalLeaseResponse,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import type {
	TerminalAttachment,
	TerminalDataChannel,
	TerminalPeerConnection,
	TerminalRequestBinding,
	TerminalSessionServiceOptions,
	TerminalSocketData,
	TerminalWebRtcState,
} from "./terminalSessionTypes.ts";
import {
	MAX_TERMINAL_CONTROL_BYTES,
	sendTerminalDataChannelJson,
	sendTerminalJson,
	validateTerminalOffer,
	validTerminalDataChannel,
	validTerminalDimensions,
} from "./terminalTransport.ts";

export const TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS = 10_000;
export const TERMINAL_P2P_LEASE_RENEW_INTERVAL_MS = 30_000;
export const TERMINAL_P2P_LEASE_TTL_MS = 120_000;

const MAX_TERMINAL_TRANSPORT_BUFFER_BYTES = 1024 * 1024;

interface TerminalAttachmentManagerOptions {
	p2pEnabled: boolean;
	stunUrls: readonly string[];
	now: () => number;
	terminalFactory: (options: Bun.TerminalOptions) => Bun.Terminal;
	terminalSpawner: NonNullable<TerminalSessionServiceOptions["terminalSpawner"]>;
	peerConnectionFactory: NonNullable<TerminalSessionServiceOptions["peerConnectionFactory"]>;
	setTimer: typeof setTimeout;
	clearTimer: typeof clearTimeout;
	attachmentArgs: (repositoryId: string) => readonly string[];
}

export class TerminalAttachmentManager {
	readonly websocket: Bun.WebSocketHandler<TerminalSocketData>;

	private readonly attachments = new Map<string, TerminalAttachment>();
	private readonly p2pEnabled: boolean;
	private readonly stunUrls: readonly string[];
	private readonly now: () => number;
	private readonly terminalFactory: (options: Bun.TerminalOptions) => Bun.Terminal;
	private readonly terminalSpawner: NonNullable<TerminalSessionServiceOptions["terminalSpawner"]>;
	private readonly peerConnectionFactory: NonNullable<
		TerminalSessionServiceOptions["peerConnectionFactory"]
	>;
	private readonly setTimer: typeof setTimeout;
	private readonly clearTimer: typeof clearTimeout;
	private readonly attachmentArgs: (repositoryId: string) => readonly string[];

	constructor(options: TerminalAttachmentManagerOptions) {
		this.p2pEnabled = options.p2pEnabled;
		this.stunUrls = options.stunUrls;
		this.now = options.now;
		this.terminalFactory = options.terminalFactory;
		this.terminalSpawner = options.terminalSpawner;
		this.peerConnectionFactory = options.peerConnectionFactory;
		this.setTimer = options.setTimer;
		this.clearTimer = options.clearTimer;
		this.attachmentArgs = options.attachmentArgs;
		this.websocket = {
			data: {} as TerminalSocketData,
			maxPayloadLength: 64 * 1024,
			backpressureLimit: 1024 * 1024,
			closeOnBackpressureLimit: true,
			idleTimeout: 120,
			sendPings: true,
			open: (socket) => this.openSocket(socket),
			message: (socket, message) => this.message(socket, message),
			close: (socket) => this.closeSocket(socket),
		};
	}

	controllerConnected(repositoryId: string): boolean {
		return this.attachments.has(repositoryId);
	}

	assertAttachable(repositoryId: string, clientId: string, takeover: boolean): void {
		const current = this.attachments.get(repositoryId);
		if (current && current.clientId !== clientId && !takeover) {
			throw new HttpError(
				409,
				"terminal_in_use",
				"The tmux terminal is controlled by another browser tab",
			);
		}
	}

	private disposeWebRtc(attachment: TerminalAttachment): void {
		const state = attachment.webRtc;
		attachment.webRtc = null;
		attachment.transport = "websocket";
		if (attachment.leaseTimer !== null) {
			this.clearTimer(attachment.leaseTimer);
			attachment.leaseTimer = null;
		}
		attachment.leaseExpiresAt = null;
		if (!state) return;
		if (state.negotiationTimer !== null) this.clearTimer(state.negotiationTimer);
		try {
			state.channel?.close();
		} catch {
			// A failed SCTP association may already have closed the channel.
		}
		void state.peer.close().catch(() => undefined);
	}

	private destroyAttachment(
		repositoryId: string,
		attachment: TerminalAttachment,
		closeSocket?: { code: number; reason: string },
	): void {
		if (this.attachments.get(repositoryId) === attachment) {
			this.attachments.delete(repositoryId);
		}
		this.disposeWebRtc(attachment);
		if (closeSocket) attachment.socket.close(closeSocket.code, closeSocket.reason);
		try {
			attachment.terminal.close();
		} catch {
			// The PTY can already be closed after its exit callback.
		}
		try {
			attachment.process.kill();
		} catch {
			// The detached tmux client may already have exited.
		}
	}

	private sendWebSocketOutput(attachment: TerminalAttachment, bytes: Buffer<ArrayBuffer>): void {
		const sent = attachment.socket.sendBinary(bytes, false);
		if (sent === 0) {
			attachment.socket.close(1013, "terminal_backpressure");
		}
	}

	private failActiveP2p(
		repositoryId: string,
		attachment: TerminalAttachment,
		reason: string,
	): void {
		if (this.attachments.get(repositoryId) !== attachment) return;
		this.destroyAttachment(repositoryId, attachment, {
			code: TERMINAL_P2P_FAILED_CLOSE_CODE,
			reason,
		});
	}

	private fallbackNegotiation(
		repositoryId: string,
		attachment: TerminalAttachment,
		message: string,
	): void {
		if (this.attachments.get(repositoryId) !== attachment) return;
		const buffered = attachment.webRtc?.outputBuffer ?? [];
		this.disposeWebRtc(attachment);
		sendTerminalJson(attachment.socket, { type: "webrtc-unavailable", message });
		for (const bytes of buffered) this.sendWebSocketOutput(attachment, bytes);
	}

	private routeTerminalOutput(
		repositoryId: string,
		attachment: TerminalAttachment,
		source: Uint8Array<ArrayBufferLike>,
	): void {
		if (this.attachments.get(repositoryId) !== attachment) return;
		const bytes = Buffer.from(source) as Buffer<ArrayBuffer>;
		if (attachment.transport === "websocket") {
			this.sendWebSocketOutput(attachment, bytes);
			return;
		}
		const state = attachment.webRtc;
		if (!state) {
			this.failActiveP2p(repositoryId, attachment, "terminal_p2p_state_lost");
			return;
		}
		if (attachment.transport === "switching") {
			if (state.outputBufferBytes + bytes.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES) {
				this.fallbackNegotiation(
					repositoryId,
					attachment,
					"The direct-path handoff exceeded its output buffer.",
				);
				return;
			}
			state.outputBuffer.push(bytes);
			state.outputBufferBytes += bytes.byteLength;
			return;
		}
		const channel = state.channel;
		if (
			!channel ||
			channel.readyState !== "open" ||
			channel.bufferedAmount + bytes.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES
		) {
			this.failActiveP2p(repositoryId, attachment, "terminal_p2p_backpressure");
			return;
		}
		try {
			channel.send(bytes);
		} catch {
			this.failActiveP2p(repositoryId, attachment, "terminal_p2p_send_failed");
		}
	}

	private scheduleLeaseExpiry(repositoryId: string, attachment: TerminalAttachment): void {
		if (attachment.leaseTimer !== null) this.clearTimer(attachment.leaseTimer);
		const expiresAt = attachment.leaseExpiresAt;
		if (expiresAt === null) return;
		attachment.leaseTimer = this.setTimer(
			() => {
				attachment.leaseTimer = null;
				if (this.attachments.get(repositoryId) !== attachment) return;
				if (attachment.leaseExpiresAt !== null && attachment.leaseExpiresAt > this.now()) {
					this.scheduleLeaseExpiry(repositoryId, attachment);
					return;
				}
				this.destroyAttachment(repositoryId, attachment, {
					code: TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
					reason: "terminal_lease_expired",
				});
			},
			Math.max(0, expiresAt - this.now()),
		);
	}

	private activateWebRtc(repositoryId: string, attachment: TerminalAttachment): void {
		const state = attachment.webRtc;
		const channel = state?.channel;
		if (
			this.attachments.get(repositoryId) !== attachment ||
			attachment.transport !== "switching" ||
			!state ||
			!channel ||
			channel.readyState !== "open"
		) {
			this.fallbackNegotiation(repositoryId, attachment, "The direct path was not ready.");
			return;
		}
		if (state.negotiationTimer !== null) {
			this.clearTimer(state.negotiationTimer);
			state.negotiationTimer = null;
		}
		attachment.transport = "webrtc";
		attachment.leaseExpiresAt = this.now() + TERMINAL_P2P_LEASE_TTL_MS;
		this.scheduleLeaseExpiry(repositoryId, attachment);
		try {
			sendTerminalDataChannelJson(channel, {
				type: "ready",
				transport: "webrtc",
				leaseExpiresAt: new Date(attachment.leaseExpiresAt).toISOString(),
			});
			for (const bytes of state.outputBuffer) {
				if (channel.bufferedAmount + bytes.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES) {
					throw new Error("terminal_p2p_backpressure");
				}
				channel.send(bytes);
			}
			state.outputBuffer = [];
			state.outputBufferBytes = 0;
		} catch {
			this.failActiveP2p(repositoryId, attachment, "terminal_p2p_handoff_failed");
		}
	}

	private handleTransportControl(
		repositoryId: string,
		attachment: TerminalAttachment,
		control: Record<string, unknown>,
		transport: "websocket" | "webrtc",
	): boolean {
		if (control.type === "ping") {
			const { id } = control;
			if (!Number.isSafeInteger(id) || (id as number) < 1) return false;
			if (transport === "websocket") {
				sendTerminalJson(attachment.socket, { type: "pong", id });
			} else {
				const channel = attachment.webRtc?.channel;
				if (!channel) return false;
				sendTerminalDataChannelJson(channel, { type: "pong", id });
			}
			return true;
		}
		if (control.type !== "resize") return false;
		const { cols, rows } = control;
		if (
			typeof cols !== "number" ||
			typeof rows !== "number" ||
			!validTerminalDimensions(cols, rows)
		) {
			return false;
		}
		attachment.terminal.resize(cols, rows);
		return true;
	}

	private handleDataChannelMessage(
		repositoryId: string,
		attachment: TerminalAttachment,
		state: TerminalWebRtcState,
		message: string | Buffer<ArrayBufferLike>,
	): void {
		if (
			this.attachments.get(repositoryId) !== attachment ||
			attachment.webRtc !== state ||
			attachment.transport !== "webrtc"
		)
			return;
		if (typeof message !== "string") {
			if (message.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES) {
				this.failActiveP2p(repositoryId, attachment, "terminal_p2p_message_too_large");
				return;
			}
			attachment.terminal.write(message);
			return;
		}
		if (Buffer.byteLength(message, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
			this.failActiveP2p(repositoryId, attachment, "terminal_p2p_control_too_large");
			return;
		}
		try {
			const control = JSON.parse(message) as Record<string, unknown>;
			if (
				!control ||
				typeof control !== "object" ||
				!this.handleTransportControl(repositoryId, attachment, control, "webrtc")
			) {
				throw new Error("invalid control");
			}
		} catch {
			this.failActiveP2p(repositoryId, attachment, "terminal_p2p_control_invalid");
		}
	}

	private acceptDataChannel(
		repositoryId: string,
		attachment: TerminalAttachment,
		state: TerminalWebRtcState,
		channel: TerminalDataChannel,
	): void {
		if (
			this.attachments.get(repositoryId) !== attachment ||
			attachment.webRtc !== state ||
			state.channel
		) {
			channel.close();
			return;
		}
		if (!validTerminalDataChannel(channel)) {
			channel.close();
			this.fallbackNegotiation(
				repositoryId,
				attachment,
				"The direct terminal channel did not match the required reliable protocol.",
			);
			return;
		}
		state.channel = channel;
		channel.onMessage.subscribe((message) => {
			this.handleDataChannelMessage(repositoryId, attachment, state, message);
		});
		channel.error.subscribe(() => {
			if (attachment.webRtc !== state) return;
			if (attachment.transport === "webrtc") {
				this.failActiveP2p(repositoryId, attachment, "terminal_p2p_channel_failed");
			} else {
				this.fallbackNegotiation(repositoryId, attachment, "The direct terminal channel failed.");
			}
		});
		const opened = () => {
			if (
				this.attachments.get(repositoryId) !== attachment ||
				attachment.webRtc !== state ||
				attachment.transport !== "websocket"
			)
				return;
			attachment.transport = "switching";
			sendTerminalJson(attachment.socket, { type: "webrtc-switch" });
		};
		channel.stateChanged.subscribe((readyState) => {
			if (attachment.webRtc !== state) return;
			if (readyState === "open") {
				opened();
			} else if (readyState === "closed") {
				if (attachment.transport === "webrtc") {
					this.failActiveP2p(repositoryId, attachment, "terminal_p2p_channel_closed");
				} else {
					this.fallbackNegotiation(repositoryId, attachment, "The direct terminal channel closed.");
				}
			}
		});
		if (channel.readyState === "open") opened();
	}

	private async negotiateWebRtc(
		repositoryId: string,
		attachment: TerminalAttachment,
		rawOffer: unknown,
	): Promise<void> {
		if (!this.p2pEnabled) {
			sendTerminalJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: "Direct terminal transport is disabled on this server.",
			});
			return;
		}
		if (attachment.webRtc) {
			sendTerminalJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: "A direct-path negotiation is already running.",
			});
			return;
		}
		let offer: { type: "offer"; sdp: string };
		try {
			offer = validateTerminalOffer(rawOffer);
		} catch (error) {
			sendTerminalJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: (error as Error).message,
			});
			return;
		}
		let peer: TerminalPeerConnection;
		try {
			peer = this.peerConnectionFactory(this.stunUrls);
		} catch (error) {
			sendTerminalJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: (error as Error).message,
			});
			return;
		}
		const state: TerminalWebRtcState = {
			peer,
			channel: null,
			negotiationTimer: null,
			outputBuffer: [],
			outputBufferBytes: 0,
		};
		attachment.webRtc = state;
		state.negotiationTimer = this.setTimer(() => {
			if (attachment.webRtc === state && attachment.transport !== "webrtc") {
				this.fallbackNegotiation(
					repositoryId,
					attachment,
					"No direct path was found within 10 seconds.",
				);
			}
		}, TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS);
		peer.onDataChannel.subscribe((channel) => {
			this.acceptDataChannel(repositoryId, attachment, state, channel);
		});
		peer.connectionStateChange.subscribe((connectionState) => {
			if (attachment.webRtc !== state) return;
			if (
				connectionState !== "failed" &&
				connectionState !== "closed" &&
				connectionState !== "disconnected"
			)
				return;
			if (attachment.transport === "webrtc") {
				this.failActiveP2p(repositoryId, attachment, "terminal_p2p_connection_lost");
			} else if (attachment.webRtc === state) {
				this.fallbackNegotiation(repositoryId, attachment, "The direct path could not connect.");
			}
		});
		try {
			await peer.setRemoteDescription(offer);
			const answer = await peer.createAnswer();
			await peer.setLocalDescription(answer);
			if (this.attachments.get(repositoryId) !== attachment || attachment.webRtc !== state) return;
			const localDescription = peer.localDescription;
			if (!localDescription || localDescription.type !== "answer") {
				throw new Error("The WebRTC answer could not be created.");
			}
			if (Buffer.byteLength(localDescription.sdp, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
				throw new Error("The WebRTC answer is too large.");
			}
			const answerControl = {
				type: "webrtc-answer",
				answer: localDescription,
			};
			if (Buffer.byteLength(JSON.stringify(answerControl), "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
				throw new Error("The WebRTC answer control message is too large.");
			}
			sendTerminalJson(attachment.socket, answerControl);
		} catch (error) {
			if (attachment.webRtc === state) {
				this.fallbackNegotiation(repositoryId, attachment, (error as Error).message);
			}
		}
	}

	private openSocket(socket: Bun.ServerWebSocket<TerminalSocketData>): void {
		socket.binaryType = "nodebuffer";
		const data = socket.data;
		const existing = this.attachments.get(data.repositoryId);
		if (existing && existing.clientId !== data.clientId && !data.takeover) {
			sendTerminalJson(socket, {
				type: "error",
				code: "terminal_in_use",
				message: "The tmux terminal is controlled by another browser tab",
				retryable: false,
			});
			socket.close(4003, "terminal_in_use");
			return;
		}
		if (existing) {
			this.destroyAttachment(data.repositoryId, existing, {
				code: 4001,
				reason: "taken_over",
			});
		}

		let terminal: Bun.Terminal | null = null;
		let subprocess: ReturnType<typeof Bun.spawn> | null = null;
		try {
			terminal = this.terminalFactory({
				cols: data.cols,
				rows: data.rows,
				name: "xterm-256color",
				data: (_pty, bytes) => {
					const current = this.attachments.get(data.repositoryId);
					if (current?.socket === socket) {
						this.routeTerminalOutput(data.repositoryId, current, bytes);
					}
				},
				exit: () => {
					const current = this.attachments.get(data.repositoryId);
					if (current?.socket === socket) socket.close(1000, "terminal_closed");
				},
			});
			terminal.setRawMode(true);
			subprocess = this.terminalSpawner(this.attachmentArgs(data.repositoryId), {
				cwd: data.repositoryRoot,
				env: {
					...process.env,
					TERM: "xterm-256color",
					COLORTERM: "truecolor",
				},
				terminal,
			});
			const attachment: TerminalAttachment = {
				socket,
				terminal,
				process: subprocess,
				clientId: data.clientId,
				host: data.host,
				origin: data.origin,
				nativeClientId: data.nativeClientId ?? null,
				transport: "websocket",
				webRtc: null,
				leaseExpiresAt: null,
				leaseTimer: null,
			};
			this.attachments.set(data.repositoryId, attachment);
			void subprocess.exited.then((exitCode) => {
				const current = this.attachments.get(data.repositoryId);
				if (current !== attachment) return;
				sendTerminalJson(socket, { type: "exit", exitCode });
				this.destroyAttachment(data.repositoryId, attachment, {
					code: 1000,
					reason: "terminal_process_exited",
				});
			});
			sendTerminalJson(socket, {
				type: "ready",
				profileId: data.profileId,
				cols: data.cols,
				rows: data.rows,
			});
		} catch (error) {
			const current = this.attachments.get(data.repositoryId);
			if (current?.socket === socket) this.attachments.delete(data.repositoryId);
			try {
				terminal?.close();
			} catch {
				// A partially initialized PTY may already be closed.
			}
			try {
				subprocess?.kill();
			} catch {
				// A failed tmux client may already have exited.
			}
			try {
				sendTerminalJson(socket, {
					type: "error",
					code: "terminal_attach_failed",
					message: (error as Error).message,
					retryable: true,
				});
			} catch {
				// The WebSocket may have closed while the PTY was being initialized.
			}
			socket.close(1011, "terminal_attach_failed");
		}
	}

	private message(
		socket: Bun.ServerWebSocket<TerminalSocketData>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		const attachment = this.attachments.get(socket.data.repositoryId);
		if (!attachment || attachment.socket !== socket) return;
		if (typeof message !== "string") {
			if (attachment.transport !== "webrtc") attachment.terminal.write(message);
			return;
		}
		if (Buffer.byteLength(message, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
			if (message.includes('"webrtc-offer"')) {
				sendTerminalJson(socket, {
					type: "webrtc-unavailable",
					message: "The WebRTC offer is too large.",
				});
			} else {
				socket.close(1009, "terminal_control_too_large");
			}
			return;
		}
		let control: unknown;
		try {
			control = JSON.parse(message);
		} catch {
			socket.close(1003, "terminal_control_invalid");
			return;
		}
		if (!control || typeof control !== "object") {
			socket.close(1003, "terminal_control_invalid");
			return;
		}
		const typedControl = control as Record<string, unknown>;
		if (typedControl.type === "webrtc-offer") {
			void this.negotiateWebRtc(socket.data.repositoryId, attachment, typedControl.offer);
			return;
		}
		if (typedControl.type === "webrtc-activate") {
			this.activateWebRtc(socket.data.repositoryId, attachment);
			return;
		}
		if (
			attachment.transport === "webrtc" ||
			!this.handleTransportControl(socket.data.repositoryId, attachment, typedControl, "websocket")
		) {
			socket.close(1003, "terminal_control_invalid");
		}
	}

	renewLease(
		repositoryId: string,
		request: TerminalLeaseRequest,
		binding: TerminalRequestBinding,
	): TerminalLeaseResponse {
		if (!/^[A-Za-z0-9_-]{8,128}$/.test(request.clientId)) {
			throw new HttpError(400, "terminal_client_invalid", "Terminal client ID is invalid");
		}
		const attachment = this.attachments.get(repositoryId);
		if (!attachment || attachment.transport !== "webrtc") {
			throw new HttpError(409, "terminal_p2p_inactive", "No direct terminal attachment is active");
		}
		const bindingOrigin = "origin" in binding ? binding.origin : null;
		const bindingNativeClientId = "nativeClientId" in binding ? binding.nativeClientId : null;
		if (
			attachment.clientId !== request.clientId ||
			attachment.host !== binding.host ||
			attachment.origin !== bindingOrigin ||
			attachment.nativeClientId !== bindingNativeClientId
		) {
			throw new HttpError(
				403,
				"terminal_lease_forbidden",
				"The terminal lease does not match this controller",
			);
		}
		attachment.leaseExpiresAt = this.now() + TERMINAL_P2P_LEASE_TTL_MS;
		this.scheduleLeaseExpiry(repositoryId, attachment);
		return { expiresAt: new Date(attachment.leaseExpiresAt).toISOString() };
	}

	private closeSocket(socket: Bun.ServerWebSocket<TerminalSocketData>): void {
		const attachment = this.attachments.get(socket.data.repositoryId);
		if (!attachment || attachment.socket !== socket) return;
		this.destroyAttachment(socket.data.repositoryId, attachment);
	}

	closeRepository(repositoryId: string, code: number, reason: string): void {
		const attachment = this.attachments.get(repositoryId);
		if (!attachment) return;
		this.destroyAttachment(repositoryId, attachment, { code, reason });
	}

	closeNativeClient(nativeClientId: string): void {
		for (const [repositoryId, attachment] of this.attachments) {
			if (attachment.nativeClientId === nativeClientId) {
				this.destroyAttachment(repositoryId, attachment, {
					code: 4006,
					reason: "native_client_revoked",
				});
			}
		}
	}

	close(): void {
		for (const repositoryId of [...this.attachments.keys()]) {
			this.closeRepository(repositoryId, 1001, "server_restarting");
		}
	}
}
