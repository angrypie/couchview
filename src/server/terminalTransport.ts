import {
	TERMINAL_DATA_CHANNEL_LABEL,
	TERMINAL_DATA_CHANNEL_PROTOCOL,
} from "../shared/contracts.ts";
import type { TerminalDataChannel, TerminalSocketData } from "./terminalSessionTypes.ts";

export const MAX_TERMINAL_CONTROL_BYTES = 48 * 1024;

export function validTerminalDimensions(cols: number, rows: number): boolean {
	return (
		Number.isSafeInteger(cols) &&
		cols >= 2 &&
		cols <= 500 &&
		Number.isSafeInteger(rows) &&
		rows >= 1 &&
		rows <= 300
	);
}

export function sendTerminalJson(
	socket: Bun.ServerWebSocket<TerminalSocketData>,
	value: unknown,
): void {
	socket.sendText(JSON.stringify(value), false);
}

export function sendTerminalDataChannelJson(channel: TerminalDataChannel, value: unknown): void {
	channel.send(JSON.stringify(value));
}

export function validTerminalDataChannel(channel: TerminalDataChannel): boolean {
	return (
		channel.label === TERMINAL_DATA_CHANNEL_LABEL &&
		channel.protocol === TERMINAL_DATA_CHANNEL_PROTOCOL &&
		channel.ordered === true &&
		channel.maxRetransmits == null &&
		channel.maxPacketLifeTime == null
	);
}

export function validateTerminalOffer(value: unknown): { type: "offer"; sdp: string } {
	if (!value || typeof value !== "object") {
		throw new Error("The WebRTC offer is missing.");
	}
	const offer = value as { type?: unknown; sdp?: unknown };
	if (offer.type !== "offer" || typeof offer.sdp !== "string") {
		throw new Error("The WebRTC offer is malformed.");
	}
	if (Buffer.byteLength(offer.sdp, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
		throw new Error("The WebRTC offer is too large.");
	}
	const mediaLines = offer.sdp.split(/\r?\n/).filter((line) => line.startsWith("m="));
	if (mediaLines.length !== 1 || !mediaLines[0]?.startsWith("m=application ")) {
		throw new Error("Only an application DataChannel is allowed.");
	}
	return { type: "offer", sdp: offer.sdp };
}
