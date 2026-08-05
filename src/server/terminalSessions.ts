import { createHash, randomBytes } from "node:crypto";
import { RTCPeerConnection } from "werift";

import {
	TERMINAL_ENDED_CLOSE_CODE,
	TERMINAL_PROTOCOL,
	TERMINAL_TICKET_PREFIX,
	type TerminalAttachmentRequest,
	type TerminalAttachmentResponse,
	type TerminalCapability,
	type TerminalEndResponse,
	type TerminalLeaseRequest,
	type TerminalLeaseResponse,
	type TerminalSessionStatus,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import {
	TERMINAL_P2P_LEASE_RENEW_INTERVAL_MS,
	TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS,
	TerminalAttachmentManager,
} from "./terminalAttachmentManager.ts";
import type {
	TerminalPeerConnection,
	TerminalRequestBinding,
	TerminalSessionServiceOptions,
	TerminalSocketData,
} from "./terminalSessionTypes.ts";
import { TerminalTmuxSession } from "./terminalTmuxSession.ts";
import { validTerminalDimensions } from "./terminalTransport.ts";

export { TERMINAL_PROTOCOL, TERMINAL_TICKET_PREFIX } from "../shared/contracts.ts";
export {
	TERMINAL_P2P_LEASE_RENEW_INTERVAL_MS,
	TERMINAL_P2P_LEASE_TTL_MS,
	TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS,
} from "./terminalAttachmentManager.ts";
export type {
	TerminalCommandRunner,
	TerminalDataChannel,
	TerminalDependencies,
	TerminalEvent,
	TerminalPeerConnection,
	TerminalSessionServiceOptions,
	TerminalSocketData,
} from "./terminalSessionTypes.ts";
export { resolveUserTmuxConfigPath } from "./terminalTmuxSession.ts";

const TICKET_LIFETIME_MS = 30_000;
const MAX_TICKETS = 256;
const DEFAULT_STUN_URLS = ["stun:stun.cloudflare.com:3478"];

interface StoredTicket extends TerminalSocketData {
	expiresAt: number;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function isLoopbackHostname(hostname: string): boolean {
	const normalized =
		hostname.startsWith("[") && hostname.endsWith("]")
			? hostname.slice(1, -1)
			: hostname.toLowerCase();
	if (normalized === "localhost" || normalized === "::1") return true;
	const octets = normalized.split(".");
	return (
		octets.length === 4 &&
		octets[0] === "127" &&
		octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
	);
}

export function terminalAccessIsLoopback(
	bindHost: string,
	allowedOrigins: readonly string[],
): boolean {
	if (!isLoopbackHostname(bindHost)) return false;
	return allowedOrigins.every((origin) => {
		try {
			return isLoopbackHostname(new URL(origin).hostname);
		} catch {
			return false;
		}
	});
}

export class TerminalSessionService {
	readonly capability: TerminalCapability;
	readonly enabled: boolean;
	readonly p2pEnabled: boolean;
	readonly stunUrls: readonly string[];
	readonly websocket: Bun.WebSocketHandler<TerminalSocketData>;

	private readonly now: () => number;
	private readonly tokenFactory: () => string;
	private readonly tickets = new Map<string, StoredTicket>();
	private readonly tmux: TerminalTmuxSession;
	private readonly attachments: TerminalAttachmentManager;
	private closed = false;

	constructor(options: TerminalSessionServiceOptions) {
		this.enabled = options.enabled;
		this.p2pEnabled = options.p2pEnabled ?? false;
		if (this.p2pEnabled && !this.enabled) {
			throw new Error("Terminal P2P requires terminal access to be enabled");
		}
		this.stunUrls = [...(options.stunUrls ?? DEFAULT_STUN_URLS)];
		this.now = options.now ?? Date.now;
		this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
		this.tmux = new TerminalTmuxSession(options);
		this.capability = this.tmux.capability;

		const terminalFactory =
			options.terminalFactory ?? ((terminalOptions) => new Bun.Terminal(terminalOptions));
		const terminalSpawner =
			options.terminalSpawner ??
			((argv, spawnOptions) =>
				Bun.spawn([...argv], {
					cwd: spawnOptions.cwd,
					env: spawnOptions.env,
					terminal: spawnOptions.terminal,
				}));
		const peerConnectionFactory =
			options.peerConnectionFactory ??
			((iceServers) =>
				new RTCPeerConnection({
					iceServers: iceServers.map((urls) => ({ urls })),
				}) as unknown as TerminalPeerConnection);

		this.attachments = new TerminalAttachmentManager({
			p2pEnabled: this.p2pEnabled,
			stunUrls: this.stunUrls,
			now: this.now,
			terminalFactory,
			terminalSpawner,
			peerConnectionFactory,
			setTimer: options.setTimer ?? setTimeout,
			clearTimer: options.clearTimer ?? clearTimeout,
			attachmentArgs: (repositoryId) => this.tmux.attachmentArgs(repositoryId),
		});
		this.websocket = this.attachments.websocket;
	}

	private assertAvailable(): void {
		this.tmux.assertAvailable();
		if (this.closed) {
			throw new HttpError(503, "terminal_unavailable", "The terminal service is shutting down");
		}
	}

	async status(repositoryId: string): Promise<TerminalSessionStatus> {
		return {
			profileId: "tmux",
			running: await this.tmux.status(repositoryId),
			controllerConnected: this.attachments.controllerConnected(repositoryId),
		};
	}

	private cleanExpiredTickets(): void {
		const now = this.now();
		for (const [ticketHash, ticket] of this.tickets) {
			if (ticket.expiresAt <= now) this.tickets.delete(ticketHash);
		}
		while (this.tickets.size >= MAX_TICKETS) {
			const oldest = this.tickets.keys().next().value;
			if (!oldest) break;
			this.tickets.delete(oldest);
		}
	}

	private clearTickets(repositoryId: string): void {
		for (const [ticketHash, ticket] of this.tickets) {
			if (ticket.repositoryId === repositoryId) this.tickets.delete(ticketHash);
		}
	}

	private clearNativeClientTickets(nativeClientId: string): void {
		for (const [ticketHash, ticket] of this.tickets) {
			if (ticket.nativeClientId === nativeClientId) this.tickets.delete(ticketHash);
		}
	}

	async issueAttachment(
		repositoryId: string,
		repositoryRoot: string,
		request: TerminalAttachmentRequest,
		binding: TerminalRequestBinding,
	): Promise<TerminalAttachmentResponse> {
		this.assertAvailable();
		if (request.profileId !== "tmux") {
			throw new HttpError(
				400,
				"terminal_profile_invalid",
				"The requested terminal profile is unavailable",
			);
		}
		if (!/^[A-Za-z0-9_-]{8,128}$/.test(request.clientId)) {
			throw new HttpError(400, "terminal_client_invalid", "Terminal client ID is invalid");
		}
		if (!validTerminalDimensions(request.cols, request.rows)) {
			throw new HttpError(
				400,
				"terminal_size_invalid",
				"Terminal dimensions are outside the supported range",
			);
		}
		if (typeof request.takeover !== "boolean") {
			throw new HttpError(400, "terminal_takeover_invalid", "Terminal takeover mode is invalid");
		}
		this.attachments.assertAttachable(repositoryId, request.clientId, request.takeover);
		await this.tmux.ensureSession(repositoryId, repositoryRoot);
		this.cleanExpiredTickets();
		for (const [ticketHash, ticket] of this.tickets) {
			if (ticket.repositoryId === repositoryId && ticket.clientId === request.clientId) {
				this.tickets.delete(ticketHash);
			}
		}
		const ticket = this.tokenFactory();
		const expiresAt = this.now() + TICKET_LIFETIME_MS;
		this.tickets.set(hash(ticket), {
			kind: "terminal",
			repositoryId,
			repositoryRoot,
			clientId: request.clientId,
			profileId: "tmux",
			cols: request.cols,
			rows: request.rows,
			takeover: request.takeover,
			expiresAt,
			host: binding.host,
			origin: "origin" in binding ? (binding.origin ?? null) : null,
			nativeClientId: "nativeClientId" in binding ? (binding.nativeClientId ?? null) : null,
		});
		return {
			ticket,
			expiresAt: new Date(expiresAt).toISOString(),
			protocol: TERMINAL_PROTOCOL,
			session: await this.status(repositoryId),
			...(this.p2pEnabled
				? {
						webRtc: {
							iceServers: this.stunUrls.map((urls) => ({ urls })),
							negotiationTimeoutMs: TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS,
							leaseRenewIntervalMs: TERMINAL_P2P_LEASE_RENEW_INTERVAL_MS,
						},
					}
				: {}),
		};
	}

	consumeUpgrade(
		repositoryId: string,
		request: Request,
		binding: { host: string; origin: string | null },
	): TerminalSocketData {
		this.assertAvailable();
		const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		if (!protocols.includes(TERMINAL_PROTOCOL)) {
			throw new HttpError(
				400,
				"terminal_protocol_invalid",
				"The terminal WebSocket protocol is unsupported",
			);
		}
		const ticketProtocol = protocols.find((value) => value.startsWith(TERMINAL_TICKET_PREFIX));
		const rawTicket = ticketProtocol?.slice(TERMINAL_TICKET_PREFIX.length) ?? "";
		const ticketHash = rawTicket ? hash(rawTicket) : "";
		const ticket = this.tickets.get(ticketHash);
		if (ticketHash) this.tickets.delete(ticketHash);
		if (
			!ticket ||
			ticket.expiresAt <= this.now() ||
			ticket.repositoryId !== repositoryId ||
			ticket.host !== binding.host ||
			(ticket.nativeClientId === null && ticket.origin !== binding.origin)
		) {
			throw new HttpError(
				403,
				"terminal_ticket_invalid",
				"The terminal connection ticket is invalid or expired",
			);
		}
		const { expiresAt: _expiresAt, ...data } = ticket;
		return data;
	}

	renewLease(
		repositoryId: string,
		request: TerminalLeaseRequest,
		binding: TerminalRequestBinding,
	): TerminalLeaseResponse {
		return this.attachments.renewLease(repositoryId, request, binding);
	}

	async end(repositoryId: string): Promise<TerminalEndResponse> {
		if (this.closed) {
			throw new HttpError(503, "terminal_unavailable", "The terminal service is shutting down");
		}
		this.clearTickets(repositoryId);
		await this.tmux.end(repositoryId);
		this.attachments.closeRepository(repositoryId, TERMINAL_ENDED_CLOSE_CODE, "terminal_ended");
		return { status: "ended" };
	}

	revokeNativeClient(nativeClientId: string): void {
		this.clearNativeClientTickets(nativeClientId);
		this.attachments.closeNativeClient(nativeClientId);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.tickets.clear();
		this.attachments.close();
	}
}
