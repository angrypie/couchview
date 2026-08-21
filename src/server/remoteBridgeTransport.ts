import { Socket } from "node:net";
import type { RemoteBridgeSocketData } from "./remoteBridgeAccess.ts";
import type { TerminalDataChannel, TerminalPeerConnection } from "./terminalSessions.ts";

export const MAX_CONTROL_BYTES = 48 * 1024;

export function validApplicationSdp(value: string): boolean {
	if (Buffer.byteLength(value, "utf8") > MAX_CONTROL_BYTES) return false;
	const mediaLines = value.split(/\r?\n/).filter((line) => line.startsWith("m="));
	return mediaLines.length === 1 && mediaLines[0]?.startsWith("m=application ") === true;
}

export interface BridgeWebRtcState {
	peer: TerminalPeerConnection;
	channel: TerminalDataChannel | null;
	negotiationTimer: ReturnType<typeof setTimeout> | null;
	outputBuffer: Buffer<ArrayBuffer>[];
	outputBufferBytes: number;
}

export interface BridgeAttachment {
	socket: Bun.ServerWebSocket<RemoteBridgeSocketData>;
	tcp: RemoteBridgeTcpSocket;
	deviceId: string;
	host: string;
	transport: "websocket" | "switching" | "webrtc";
	webRtc: BridgeWebRtcState | null;
	leaseExpiresAt: number;
	leaseTimer: ReturnType<typeof setTimeout> | null;
	ready: boolean;
}

export interface RemoteBridgeTcpSocket {
	readonly writableLength: number;
	onOpen(handler: () => void): void;
	onData(handler: (data: Buffer<ArrayBufferLike>) => void): void;
	onClose(handler: () => void): void;
	onError(handler: (error: Error) => void): void;
	connect(host: string, port: number): void;
	write(data: Buffer<ArrayBufferLike>): boolean;
	destroy(): void;
}

class NodeRemoteBridgeTcpSocket implements RemoteBridgeTcpSocket {
	private readonly socket: Socket = new Socket();

	get writableLength(): number {
		return this.socket.writableLength;
	}

	onOpen(handler: () => void): void {
		this.socket.once("connect", handler);
	}

	onData(handler: (data: Buffer<ArrayBufferLike>) => void): void {
		this.socket.on("data", handler);
	}

	onClose(handler: () => void): void {
		this.socket.once("close", handler);
	}

	onError(handler: (error: Error) => void): void {
		this.socket.once("error", handler);
	}

	connect(host: string, port: number): void {
		this.socket.connect(port, host);
	}

	write(data: Buffer<ArrayBufferLike>): boolean {
		return this.socket.write(data);
	}

	destroy(): void {
		this.socket.destroy();
	}
}

export function createNodeRemoteBridgeTcpSocket(): RemoteBridgeTcpSocket {
	return new NodeRemoteBridgeTcpSocket();
}

export function sendRemoteBridgeJson(
	socket: Bun.ServerWebSocket<RemoteBridgeSocketData>,
	value: unknown,
): void {
	socket.sendText(JSON.stringify(value), false);
}

export function sendRemoteBridgeDataChannelJson(
	channel: TerminalDataChannel,
	value: unknown,
): void {
	channel.send(JSON.stringify(value));
}

export type { TerminalPeerConnection };
