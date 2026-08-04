import { userInfo } from "node:os";

import type { StateDatabase } from "./database.ts";
import type { RemoteBridgeTcpSocket, TerminalPeerConnection } from "./remoteBridgeTransport.ts";

export const BRIDGE_LIMITS = {
	negotiationMs: 10_000,
	leaseMs: 120_000,
	bufferedBytes: 1024 * 1024,
	frameBytes: 32 * 1024,
} as const;

export interface RemoteBridgeServiceOptions {
	enabled: boolean;
	database: StateDatabase;
	disabledReason?: string;
	p2pEnabled?: boolean;
	stunUrls?: readonly string[];
	targetHost?: string;
	targetPort?: number;
	username?: string;
	now?: () => number;
	tokenFactory?: () => string;
	tcpSocketFactory?: () => RemoteBridgeTcpSocket;
	peerConnectionFactory?: (iceServers: readonly string[]) => TerminalPeerConnection;
	setTimer?: typeof setTimeout;
	clearTimer?: typeof clearTimeout;
}

function defaultUsername(): string {
	try {
		return userInfo().username;
	} catch {
		return process.env.USER ?? "user";
	}
}

export function resolveRemoteBridgeServiceConfig(options: RemoteBridgeServiceOptions) {
	const p2pEnabled = options.p2pEnabled ?? false;
	if (p2pEnabled && !options.enabled) {
		throw new Error("Remote bridge P2P requires the remote bridge to be enabled");
	}
	const targetHost = options.targetHost ?? "127.0.0.1";
	const targetPort = options.targetPort ?? 22;
	if (targetHost !== "127.0.0.1" && targetHost !== "::1") {
		throw new Error("The native bridge SSH target must be loopback");
	}
	if (!Number.isSafeInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
		throw new Error("The native bridge SSH target port must be between 1 and 65535");
	}
	const username = options.username ?? defaultUsername();
	if (!/^[A-Za-z0-9._-]{1,255}$/.test(username)) {
		throw new Error("The native bridge SSH username is invalid");
	}
	return {
		p2pEnabled,
		stunUrls: [...(options.stunUrls ?? ["stun:stun.cloudflare.com:3478"])],
		targetHost,
		targetPort,
		username,
	};
}
