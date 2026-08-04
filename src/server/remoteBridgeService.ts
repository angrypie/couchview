import {
	type ClaimRemoteBridgePairingRequest,
	type CreateRemoteBridgePairingRequest,
	REMOTE_BRIDGE_DATA_CHANNEL_LABEL,
	REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL,
	REMOTE_BRIDGE_LEASE_EXPIRED_CLOSE_CODE,
	REMOTE_BRIDGE_P2P_FAILED_CLOSE_CODE,
	type RemoteBridgeCapability,
	type RemoteBridgeDevice,
	type RemoteBridgeDevicesResponse,
	type RemoteBridgeLeaseRequest,
	type RemoteBridgeLeaseResponse,
	type RemoteBridgePairingResponse,
	type RemoteBridgeProfile,
	type RemoteBridgeTicketRequest,
	type RemoteBridgeTicketResponse,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { RemoteBridgeAccess, type RemoteBridgeSocketData } from "./remoteBridgeAccess.ts";
import {
	BRIDGE_LIMITS,
	type RemoteBridgeServiceOptions,
	resolveRemoteBridgeServiceConfig,
} from "./remoteBridgeServiceConfig.ts";
import {
	type BridgeAttachment,
	type BridgeWebRtcState,
	createNodeRemoteBridgeTcpSocket,
	MAX_CONTROL_BYTES,
	type RemoteBridgeTcpSocket,
	sendRemoteBridgeDataChannelJson,
	sendRemoteBridgeJson,
	validApplicationSdp,
} from "./remoteBridgeTransport.ts";
import { type TerminalDataChannel, type TerminalPeerConnection } from "./terminalSessions.ts";

export type { RemoteBridgeSocketData } from "./remoteBridgeAccess.ts";
export type { RemoteBridgeServiceOptions } from "./remoteBridgeServiceConfig.ts";
export type { RemoteBridgeTcpSocket } from "./remoteBridgeTransport.ts";

import { RTCPeerConnection } from "werift";

export class RemoteBridgeService {
	readonly enabled: boolean;
	readonly p2pEnabled: boolean;
	readonly stunUrls: readonly string[];
	readonly targetPort: number;
	readonly capability: RemoteBridgeCapability;
	readonly websocket: Bun.WebSocketHandler<RemoteBridgeSocketData>;

	private readonly access: RemoteBridgeAccess;
	private readonly targetHost: string;
	private readonly username: string;
	private readonly now: () => number;
	private readonly tcpSocketFactory: () => RemoteBridgeTcpSocket;
	private readonly peerConnectionFactory: (iceServers: readonly string[]) => TerminalPeerConnection;
	private readonly setTimer: typeof setTimeout;
	private readonly clearTimer: typeof clearTimeout;
	private readonly attachments = new Map<string, BridgeAttachment>();
	private closed = false;

	constructor(options: RemoteBridgeServiceOptions) {
		const config = resolveRemoteBridgeServiceConfig(options);
		this.enabled = options.enabled;
		this.p2pEnabled = config.p2pEnabled;
		this.stunUrls = config.stunUrls;
		this.targetHost = config.targetHost;
		this.targetPort = config.targetPort;
		this.username = config.username;
		this.access = new RemoteBridgeAccess({
			database: options.database,
			now: options.now,
			p2pEnabled: this.p2pEnabled,
			stunUrls: this.stunUrls,
			tokenFactory: options.tokenFactory,
			username: this.username,
		});
		this.now = options.now ?? Date.now;
		this.tcpSocketFactory = options.tcpSocketFactory ?? createNodeRemoteBridgeTcpSocket;
		this.peerConnectionFactory =
			options.peerConnectionFactory ??
			((iceServers) =>
				new RTCPeerConnection({
					iceServers: iceServers.map((urls) => ({ urls })),
				}) as unknown as TerminalPeerConnection);
		this.setTimer = options.setTimer ?? setTimeout;
		this.clearTimer = options.clearTimer ?? clearTimeout;
		this.capability = {
			available: options.enabled,
			reason: options.enabled
				? null
				: (options.disabledReason ?? "Native remote development is disabled on this server."),
			p2pEnabled: this.p2pEnabled,
		};
		this.websocket = {
			data: {} as RemoteBridgeSocketData,
			maxPayloadLength: 64 * 1024,
			backpressureLimit: BRIDGE_LIMITS.bufferedBytes,
			closeOnBackpressureLimit: true,
			idleTimeout: 120,
			sendPings: true,
			open: (socket) => this.openSocket(socket),
			message: (socket, message) => this.message(socket, message),
			close: (socket) => this.closeSocket(socket),
		};
	}

	private assertAvailable(): void {
		if (!this.enabled) {
			throw new HttpError(
				403,
				"remote_bridge_disabled",
				this.capability.reason ?? "Native remote development is disabled",
			);
		}
		if (this.closed) {
			throw new HttpError(503, "remote_bridge_unavailable", "The native bridge is shutting down");
		}
	}

	listDevices(): RemoteBridgeDevicesResponse {
		this.assertAvailable();
		return this.access.listDevices();
	}

	authenticateDevice(token: string | null): RemoteBridgeDevice {
		this.assertAvailable();
		return this.access.authenticateDevice(token).device;
	}

	createPairing(
		repository: { id: string; name: string; root: string },
		input: CreateRemoteBridgePairingRequest,
		context: { origin: string; originAccess: string },
	): RemoteBridgePairingResponse {
		this.assertAvailable();
		return this.access.createPairing(repository, input, context);
	}

	claimPairing(input: ClaimRemoteBridgePairingRequest): RemoteBridgeProfile {
		this.assertAvailable();
		return this.access.claimPairing(input);
	}

	revokeDevice(deviceId: string): void {
		this.assertAvailable();
		if (!this.access.revokeDevice(deviceId)) {
			throw new HttpError(404, "remote_bridge_device_not_found", "The paired device was not found");
		}
		for (const [connectionId, attachment] of this.attachments) {
			if (attachment.deviceId === deviceId) {
				this.destroyAttachment(connectionId, attachment, {
					code: 4003,
					reason: "remote_bridge_device_revoked",
				});
			}
		}
	}

	issueTicket(
		token: string | null,
		input: RemoteBridgeTicketRequest,
		binding: { host: string },
	): RemoteBridgeTicketResponse {
		this.assertAvailable();
		return this.access.issueTicket(token, input, binding);
	}

	renewLease(
		token: string | null,
		input: RemoteBridgeLeaseRequest,
		binding: { host: string },
	): RemoteBridgeLeaseResponse {
		this.assertAvailable();
		const device = this.access.authenticateLease(token, input.connectionId);
		const attachment = this.attachments.get(input.connectionId);
		if (!attachment || attachment.deviceId !== device.id || attachment.host !== binding.host) {
			throw new HttpError(
				403,
				"remote_bridge_lease_forbidden",
				"The bridge lease does not match this connection",
			);
		}
		attachment.leaseExpiresAt = this.now() + BRIDGE_LIMITS.leaseMs;
		this.scheduleLeaseExpiry(input.connectionId, attachment);
		this.access.touchDevice(device.id);
		return { expiresAt: new Date(attachment.leaseExpiresAt).toISOString() };
	}

	consumeUpgrade(request: Request, binding: { host: string }): RemoteBridgeSocketData {
		this.assertAvailable();
		return this.access.consumeUpgrade(request, binding);
	}

	private sendWebSocketBytes(attachment: BridgeAttachment, bytes: Buffer<ArrayBuffer>): void {
		for (let offset = 0; offset < bytes.byteLength; offset += BRIDGE_LIMITS.frameBytes) {
			const frame = bytes.subarray(
				offset,
				Math.min(bytes.byteLength, offset + BRIDGE_LIMITS.frameBytes),
			);
			if (attachment.socket.sendBinary(frame, false) === 0) {
				attachment.socket.close(1013, "remote_bridge_backpressure");
				return;
			}
		}
	}

	private sendDataChannelBytes(
		connectionId: string,
		attachment: BridgeAttachment,
		bytes: Buffer<ArrayBuffer>,
	): void {
		const channel = attachment.webRtc?.channel;
		if (!channel || channel.readyState !== "open") {
			this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_state_lost");
			return;
		}
		for (let offset = 0; offset < bytes.byteLength; offset += BRIDGE_LIMITS.frameBytes) {
			const frame = bytes.subarray(
				offset,
				Math.min(bytes.byteLength, offset + BRIDGE_LIMITS.frameBytes),
			);
			if (channel.bufferedAmount + frame.byteLength > BRIDGE_LIMITS.bufferedBytes) {
				this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_backpressure");
				return;
			}
			try {
				channel.send(frame);
			} catch {
				this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_send_failed");
				return;
			}
		}
	}

	private routeTcpOutput(
		connectionId: string,
		attachment: BridgeAttachment,
		source: Buffer<ArrayBufferLike>,
	): void {
		if (this.attachments.get(connectionId) !== attachment) return;
		const bytes = Buffer.from(source) as Buffer<ArrayBuffer>;
		if (attachment.transport === "websocket") {
			this.sendWebSocketBytes(attachment, bytes);
			return;
		}
		const state = attachment.webRtc;
		if (!state) {
			this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_state_lost");
			return;
		}
		if (attachment.transport === "switching") {
			if (state.outputBufferBytes + bytes.byteLength > BRIDGE_LIMITS.bufferedBytes) {
				this.fallbackNegotiation(
					connectionId,
					attachment,
					"The direct-path handoff exceeded its output buffer.",
				);
				return;
			}
			state.outputBuffer.push(bytes);
			state.outputBufferBytes += bytes.byteLength;
			return;
		}
		this.sendDataChannelBytes(connectionId, attachment, bytes);
	}

	private writeTcp(
		connectionId: string,
		attachment: BridgeAttachment,
		bytes: Buffer<ArrayBufferLike>,
	): void {
		if (
			!attachment.ready ||
			attachment.tcp.writableLength + bytes.byteLength > BRIDGE_LIMITS.bufferedBytes
		) {
			this.destroyAttachment(connectionId, attachment, {
				code: 1013,
				reason: "remote_bridge_tcp_backpressure",
			});
			return;
		}
		try {
			attachment.tcp.write(bytes);
		} catch {
			this.destroyAttachment(connectionId, attachment, {
				code: 1011,
				reason: "remote_bridge_tcp_write_failed",
			});
		}
	}

	private scheduleLeaseExpiry(connectionId: string, attachment: BridgeAttachment): void {
		if (attachment.leaseTimer !== null) this.clearTimer(attachment.leaseTimer);
		attachment.leaseTimer = this.setTimer(
			() => {
				attachment.leaseTimer = null;
				if (this.attachments.get(connectionId) !== attachment) return;
				if (attachment.leaseExpiresAt > this.now()) {
					this.scheduleLeaseExpiry(connectionId, attachment);
					return;
				}
				this.destroyAttachment(connectionId, attachment, {
					code: REMOTE_BRIDGE_LEASE_EXPIRED_CLOSE_CODE,
					reason: "remote_bridge_lease_expired",
				});
			},
			Math.max(0, attachment.leaseExpiresAt - this.now()),
		);
	}

	private disposeWebRtc(attachment: BridgeAttachment): void {
		const state = attachment.webRtc;
		attachment.webRtc = null;
		attachment.transport = "websocket";
		if (!state) return;
		if (state.negotiationTimer !== null) this.clearTimer(state.negotiationTimer);
		try {
			state.channel?.close();
		} catch {
			// A failed association may already be closed.
		}
		void state.peer.close().catch(() => undefined);
	}

	private destroyAttachment(
		connectionId: string,
		attachment: BridgeAttachment,
		closeSocket?: { code: number; reason: string },
	): void {
		if (this.attachments.get(connectionId) === attachment) this.attachments.delete(connectionId);
		if (attachment.leaseTimer !== null) this.clearTimer(attachment.leaseTimer);
		attachment.leaseTimer = null;
		this.disposeWebRtc(attachment);
		try {
			attachment.tcp.destroy();
		} catch {
			// The loopback SSH socket may already be closed.
		}
		if (closeSocket) attachment.socket.close(closeSocket.code, closeSocket.reason);
	}

	private failActiveP2p(connectionId: string, attachment: BridgeAttachment, reason: string): void {
		if (this.attachments.get(connectionId) !== attachment) return;
		this.destroyAttachment(connectionId, attachment, {
			code: REMOTE_BRIDGE_P2P_FAILED_CLOSE_CODE,
			reason,
		});
	}

	private fallbackNegotiation(
		connectionId: string,
		attachment: BridgeAttachment,
		message: string,
	): void {
		if (this.attachments.get(connectionId) !== attachment) return;
		const buffered = attachment.webRtc?.outputBuffer ?? [];
		this.disposeWebRtc(attachment);
		sendRemoteBridgeJson(attachment.socket, { type: "webrtc-unavailable", message });
		for (const bytes of buffered) this.sendWebSocketBytes(attachment, bytes);
	}

	private validDataChannel(channel: TerminalDataChannel): boolean {
		return (
			channel.label === REMOTE_BRIDGE_DATA_CHANNEL_LABEL &&
			channel.protocol === REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL &&
			channel.ordered === true &&
			channel.maxRetransmits == null &&
			channel.maxPacketLifeTime == null
		);
	}

	private validateOffer(value: unknown): { type: "offer"; sdp: string } {
		if (!value || typeof value !== "object") throw new Error("The WebRTC offer is missing.");
		const offer = value as { type?: unknown; sdp?: unknown };
		if (
			offer.type !== "offer" ||
			typeof offer.sdp !== "string" ||
			!validApplicationSdp(offer.sdp)
		) {
			throw new Error("The WebRTC offer is malformed.");
		}
		return { type: "offer", sdp: offer.sdp };
	}

	private activateWebRtc(connectionId: string, attachment: BridgeAttachment): void {
		const state = attachment.webRtc;
		const channel = state?.channel;
		if (
			this.attachments.get(connectionId) !== attachment ||
			attachment.transport !== "switching" ||
			!state ||
			!channel ||
			channel.readyState !== "open"
		) {
			this.fallbackNegotiation(connectionId, attachment, "The direct path was not ready.");
			return;
		}
		if (state.negotiationTimer !== null) this.clearTimer(state.negotiationTimer);
		state.negotiationTimer = null;
		attachment.transport = "webrtc";
		try {
			sendRemoteBridgeDataChannelJson(channel, { type: "ready", transport: "webrtc" });
			for (const bytes of state.outputBuffer) {
				this.sendDataChannelBytes(connectionId, attachment, bytes);
				if (this.attachments.get(connectionId) !== attachment) return;
			}
			state.outputBuffer = [];
			state.outputBufferBytes = 0;
		} catch {
			this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_handoff_failed");
		}
	}

	private acceptDataChannel(
		connectionId: string,
		attachment: BridgeAttachment,
		state: BridgeWebRtcState,
		channel: TerminalDataChannel,
	): void {
		if (
			this.attachments.get(connectionId) !== attachment ||
			attachment.webRtc !== state ||
			state.channel
		) {
			channel.close();
			return;
		}
		if (!this.validDataChannel(channel)) {
			channel.close();
			this.fallbackNegotiation(
				connectionId,
				attachment,
				"The direct bridge channel was not reliable and ordered.",
			);
			return;
		}
		state.channel = channel;
		channel.onMessage.subscribe((message) => {
			if (
				this.attachments.get(connectionId) !== attachment ||
				attachment.webRtc !== state ||
				attachment.transport !== "webrtc"
			)
				return;
			if (typeof message === "string") {
				if (Buffer.byteLength(message, "utf8") > MAX_CONTROL_BYTES) {
					this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_control_too_large");
					return;
				}
				try {
					const control = JSON.parse(message) as Record<string, unknown>;
					if (control.type !== "ping" || !Number.isSafeInteger(control.id))
						throw new Error("invalid");
					sendRemoteBridgeDataChannelJson(channel, { type: "pong", id: control.id });
				} catch {
					this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_control_invalid");
				}
				return;
			}
			if (message.byteLength > BRIDGE_LIMITS.bufferedBytes) {
				this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_message_too_large");
				return;
			}
			this.writeTcp(connectionId, attachment, message);
		});
		channel.error.subscribe(() => {
			if (attachment.webRtc !== state) return;
			if (attachment.transport === "webrtc") {
				this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_channel_failed");
			} else {
				this.fallbackNegotiation(connectionId, attachment, "The direct bridge channel failed.");
			}
		});
		const opened = () => {
			if (
				this.attachments.get(connectionId) !== attachment ||
				attachment.webRtc !== state ||
				attachment.transport !== "websocket"
			)
				return;
			attachment.transport = "switching";
			sendRemoteBridgeJson(attachment.socket, { type: "webrtc-switch" });
		};
		channel.stateChanged.subscribe((readyState) => {
			if (attachment.webRtc !== state) return;
			if (readyState === "open") opened();
			if (readyState === "closed") {
				if (attachment.transport === "webrtc") {
					this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_channel_closed");
				} else {
					this.fallbackNegotiation(connectionId, attachment, "The direct bridge channel closed.");
				}
			}
		});
		if (channel.readyState === "open") opened();
	}

	private async negotiateWebRtc(
		connectionId: string,
		attachment: BridgeAttachment,
		rawOffer: unknown,
	): Promise<void> {
		if (!this.p2pEnabled) {
			sendRemoteBridgeJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: "Direct bridge transport is disabled.",
			});
			return;
		}
		if (attachment.webRtc) {
			sendRemoteBridgeJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: "Direct-path negotiation is already running.",
			});
			return;
		}
		let offer: { type: "offer"; sdp: string };
		try {
			offer = this.validateOffer(rawOffer);
		} catch (error) {
			sendRemoteBridgeJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: (error as Error).message,
			});
			return;
		}
		let peer: TerminalPeerConnection;
		try {
			peer = this.peerConnectionFactory(this.stunUrls);
		} catch (error) {
			sendRemoteBridgeJson(attachment.socket, {
				type: "webrtc-unavailable",
				message: (error as Error).message,
			});
			return;
		}
		const state: BridgeWebRtcState = {
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
					connectionId,
					attachment,
					"No direct bridge path was found within 10 seconds.",
				);
			}
		}, BRIDGE_LIMITS.negotiationMs);
		peer.onDataChannel.subscribe((channel) =>
			this.acceptDataChannel(connectionId, attachment, state, channel),
		);
		peer.connectionStateChange.subscribe((connectionState) => {
			if (attachment.webRtc !== state) return;
			if (
				connectionState !== "failed" &&
				connectionState !== "closed" &&
				connectionState !== "disconnected"
			)
				return;
			if (attachment.transport === "webrtc") {
				this.failActiveP2p(connectionId, attachment, "remote_bridge_p2p_connection_lost");
			} else {
				this.fallbackNegotiation(
					connectionId,
					attachment,
					"The direct bridge path could not connect.",
				);
			}
		});
		try {
			await peer.setRemoteDescription(offer);
			const answer = await peer.createAnswer();
			await peer.setLocalDescription(answer);
			if (this.attachments.get(connectionId) !== attachment || attachment.webRtc !== state) return;
			const localDescription = peer.localDescription;
			if (
				!localDescription ||
				localDescription.type !== "answer" ||
				!validApplicationSdp(localDescription.sdp)
			) {
				throw new Error("The WebRTC answer could not be created.");
			}
			sendRemoteBridgeJson(attachment.socket, {
				type: "webrtc-answer",
				answer: { type: "answer", sdp: localDescription.sdp },
			});
		} catch (error) {
			if (attachment.webRtc === state) {
				this.fallbackNegotiation(connectionId, attachment, (error as Error).message);
			}
		}
	}

	private openSocket(socket: Bun.ServerWebSocket<RemoteBridgeSocketData>): void {
		socket.binaryType = "nodebuffer";
		const data = socket.data;
		const existing = this.attachments.get(data.connectionId);
		if (existing) {
			this.destroyAttachment(data.connectionId, existing, {
				code: 4001,
				reason: "remote_bridge_replaced",
			});
		}
		const tcp = this.tcpSocketFactory();
		const attachment: BridgeAttachment = {
			socket,
			tcp,
			deviceId: data.deviceId,
			host: data.host,
			transport: "websocket",
			webRtc: null,
			leaseExpiresAt: this.now() + BRIDGE_LIMITS.leaseMs,
			leaseTimer: null,
			ready: false,
		};
		this.attachments.set(data.connectionId, attachment);
		this.scheduleLeaseExpiry(data.connectionId, attachment);
		tcp.onOpen(() => {
			if (this.attachments.get(data.connectionId) !== attachment) return;
			attachment.ready = true;
			sendRemoteBridgeJson(socket, {
				type: "ready",
				transport: "websocket",
				target: `${this.targetHost}:${this.targetPort}`,
			});
		});
		tcp.onData((bytes) => this.routeTcpOutput(data.connectionId, attachment, bytes));
		tcp.onClose(() => {
			if (this.attachments.get(data.connectionId) === attachment) {
				this.destroyAttachment(data.connectionId, attachment, {
					code: 1000,
					reason: "remote_bridge_target_closed",
				});
			}
		});
		tcp.onError((error) => {
			if (this.attachments.get(data.connectionId) !== attachment) return;
			try {
				sendRemoteBridgeJson(socket, {
					type: "error",
					code: "remote_bridge_target_unavailable",
					message: `Could not reach SSH on ${this.targetHost}:${this.targetPort}: ${error.message}`,
				});
			} finally {
				this.destroyAttachment(data.connectionId, attachment, {
					code: 1011,
					reason: "remote_bridge_target_unavailable",
				});
			}
		});
		try {
			tcp.connect(this.targetHost, this.targetPort);
		} catch (error) {
			sendRemoteBridgeJson(socket, {
				type: "error",
				code: "remote_bridge_target_unavailable",
				message: (error as Error).message,
			});
			this.destroyAttachment(data.connectionId, attachment, {
				code: 1011,
				reason: "remote_bridge_target_unavailable",
			});
		}
	}

	private message(
		socket: Bun.ServerWebSocket<RemoteBridgeSocketData>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		const connectionId = socket.data.connectionId;
		const attachment = this.attachments.get(connectionId);
		if (!attachment || attachment.socket !== socket) return;
		if (typeof message !== "string") {
			if (message.byteLength > BRIDGE_LIMITS.bufferedBytes || attachment.transport === "webrtc") {
				socket.close(1009, "remote_bridge_message_invalid");
				return;
			}
			this.writeTcp(connectionId, attachment, message);
			return;
		}
		if (Buffer.byteLength(message, "utf8") > MAX_CONTROL_BYTES) {
			socket.close(1009, "remote_bridge_control_too_large");
			return;
		}
		let control: Record<string, unknown>;
		try {
			control = JSON.parse(message) as Record<string, unknown>;
			if (!control || typeof control !== "object") throw new Error("invalid");
		} catch {
			socket.close(1003, "remote_bridge_control_invalid");
			return;
		}
		if (control.type === "webrtc-offer") {
			void this.negotiateWebRtc(connectionId, attachment, control.offer);
			return;
		}
		if (control.type === "webrtc-activate") {
			this.activateWebRtc(connectionId, attachment);
			return;
		}
		if (control.type === "ping" && Number.isSafeInteger(control.id)) {
			sendRemoteBridgeJson(socket, { type: "pong", id: control.id });
			return;
		}
		socket.close(1003, "remote_bridge_control_invalid");
	}

	private closeSocket(socket: Bun.ServerWebSocket<RemoteBridgeSocketData>): void {
		const connectionId = socket.data.connectionId;
		const attachment = this.attachments.get(connectionId);
		if (attachment?.socket === socket) this.destroyAttachment(connectionId, attachment);
	}

	closeRepository(repositoryId: string): void {
		this.access.closeRepository(repositoryId);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.access.close();
		for (const [connectionId, attachment] of this.attachments) {
			this.destroyAttachment(connectionId, attachment, {
				code: 1001,
				reason: "remote_bridge_shutting_down",
			});
		}
	}
}
