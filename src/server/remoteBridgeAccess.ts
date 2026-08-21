import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
	type ClaimRemoteBridgePairingRequest,
	type CreateRemoteBridgePairingRequest,
	REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
	REMOTE_BRIDGE_PROTOCOL,
	REMOTE_BRIDGE_TICKET_PREFIX,
	type RemoteBridgeDevice,
	type RemoteBridgeDevicesResponse,
	type RemoteBridgePairingResponse,
	type RemoteBridgeProfile,
	type RemoteBridgeTicketRequest,
	type RemoteBridgeTicketResponse,
	remoteBridgeOriginAccessIdIsValid,
} from "../shared/contracts.ts";
import type { StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";

const PAIRING_TTL_MS = 5 * 60_000;
const TICKET_TTL_MS = 30_000;
const NEGOTIATION_TIMEOUT_MS = 10_000;
const LEASE_RENEW_INTERVAL_MS = 30_000;
const MAX_PENDING_PAIRINGS = 256;
const MAX_PENDING_TICKETS = 512;

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function slug(value: string): string {
	return (
		value
			.normalize("NFKD")
			.replace(/[^A-Za-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase()
			.slice(0, 32) || "project"
	);
}

function validConnectionId(value: string): boolean {
	return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

interface PendingPairing {
	deviceId: string;
	repositoryId: string;
	repositoryName: string;
	repositoryRoot: string;
	label: string;
	sshAlias: string;
	username: string;
	origin: string;
	originAccess: string;
	expiresAt: number;
}

export interface RemoteBridgeSocketData {
	kind: "remote-bridge";
	connectionId: string;
	deviceId: string;
	host: string;
}

interface StoredTicket extends RemoteBridgeSocketData {
	deviceTokenHash: string;
	expiresAt: number;
}

interface RemoteBridgeAccessOptions {
	database: StateDatabase;
	p2pEnabled: boolean;
	stunUrls: readonly string[];
	username: string;
	now?: () => number;
	tokenFactory?: () => string;
}

export class RemoteBridgeAccess {
	private readonly database: StateDatabase;
	private readonly p2pEnabled: boolean;
	private readonly stunUrls: readonly string[];
	private readonly username: string;
	private readonly now: () => number;
	private readonly tokenFactory: () => string;
	private readonly pairings = new Map<string, PendingPairing>();
	private readonly tickets = new Map<string, StoredTicket>();

	constructor(options: RemoteBridgeAccessOptions) {
		this.database = options.database;
		this.p2pEnabled = options.p2pEnabled;
		this.stunUrls = options.stunUrls;
		this.username = options.username;
		this.now = options.now ?? Date.now;
		this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
	}

	listDevices(): RemoteBridgeDevicesResponse {
		return { devices: this.database.remoteBridgeDevices() };
	}

	createPairing(
		repository: { id: string; name: string; root: string },
		input: CreateRemoteBridgePairingRequest,
		context: { origin: string; originAccess: string },
	): RemoteBridgePairingResponse {
		if (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 80) {
			throw new HttpError(
				400,
				"remote_bridge_label_invalid",
				"Device label must contain between 1 and 80 characters",
			);
		}
		if (!remoteBridgeOriginAccessIdIsValid(context.originAccess)) {
			throw new HttpError(
				500,
				"remote_bridge_origin_access_invalid",
				"The configured bridge origin-access provider is invalid",
			);
		}
		const deviceId = randomUUID();
		const sshAlias = `couchview-${slug(repository.name)}-${deviceId.slice(0, 8)}`;
		const code = this.tokenFactory();
		const expiresAt = this.now() + PAIRING_TTL_MS;
		this.pairings.set(hash(code), {
			deviceId,
			repositoryId: repository.id,
			repositoryName: repository.name,
			repositoryRoot: repository.root,
			label: input.label.trim(),
			sshAlias,
			username: this.username,
			origin: context.origin,
			originAccess: context.originAccess,
			expiresAt,
		});
		this.pruneExpired();
		while (this.pairings.size > MAX_PENDING_PAIRINGS) {
			const oldest = this.pairings.keys().next().value;
			if (typeof oldest !== "string") break;
			this.pairings.delete(oldest);
		}
		const command = [
			"couchview bridge pair",
			`--url ${shellQuote(context.origin)}`,
			`--code ${shellQuote(code)}`,
			...(context.originAccess === REMOTE_BRIDGE_NO_ORIGIN_ACCESS
				? []
				: [`--origin-access ${shellQuote(context.originAccess)}`]),
		].join(" ");
		return {
			command,
			expiresAt: new Date(expiresAt).toISOString(),
			sshAlias,
		};
	}

	claimPairing(input: ClaimRemoteBridgePairingRequest): RemoteBridgeProfile {
		if (typeof input.code !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(input.code)) {
			throw new HttpError(400, "remote_bridge_pairing_invalid", "The pairing code is invalid");
		}
		const codeHash = hash(input.code);
		const pairing = this.pairings.get(codeHash);
		if (pairing) this.pairings.delete(codeHash);
		if (!pairing || pairing.expiresAt <= this.now()) {
			throw new HttpError(
				403,
				"remote_bridge_pairing_expired",
				"The pairing code is invalid or expired",
			);
		}
		const deviceToken = this.tokenFactory();
		const createdAt = new Date(this.now()).toISOString();
		const device: RemoteBridgeDevice = {
			id: pairing.deviceId,
			repositoryId: pairing.repositoryId,
			label: pairing.label,
			sshAlias: pairing.sshAlias,
			createdAt,
			lastUsedAt: null,
		};
		this.database.insertRemoteBridgeDevice(device, hash(deviceToken));
		return {
			id: pairing.deviceId,
			origin: pairing.origin,
			repositoryId: pairing.repositoryId,
			repositoryName: pairing.repositoryName,
			repositoryRoot: pairing.repositoryRoot,
			deviceId: pairing.deviceId,
			deviceToken,
			deviceLabel: pairing.label,
			sshAlias: pairing.sshAlias,
			username: pairing.username,
			originAccess: pairing.originAccess,
		};
	}

	authenticateDevice(token: string | null): { device: RemoteBridgeDevice; tokenHash: string } {
		if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
			throw new HttpError(
				403,
				"remote_bridge_token_invalid",
				"The bridge device credential is missing or invalid",
			);
		}
		const tokenHash = hash(token);
		const device = this.database.remoteBridgeDeviceByTokenHash(tokenHash);
		if (!device) {
			throw new HttpError(
				403,
				"remote_bridge_token_invalid",
				"The bridge device credential is missing or invalid",
			);
		}
		return { device, tokenHash };
	}

	authenticateLease(token: string | null, connectionId: unknown): RemoteBridgeDevice {
		if (typeof connectionId !== "string" || !validConnectionId(connectionId)) {
			throw new HttpError(
				400,
				"remote_bridge_connection_invalid",
				"The bridge connection ID is invalid",
			);
		}
		return this.authenticateDevice(token).device;
	}

	touchDevice(deviceId: string): void {
		this.database.touchRemoteBridgeDevice(deviceId, new Date(this.now()).toISOString());
	}

	issueTicket(
		token: string | null,
		input: RemoteBridgeTicketRequest,
		binding: { host: string },
	): RemoteBridgeTicketResponse {
		if (typeof input.connectionId !== "string" || !validConnectionId(input.connectionId)) {
			throw new HttpError(
				400,
				"remote_bridge_connection_invalid",
				"The bridge connection ID is invalid",
			);
		}
		const { device, tokenHash } = this.authenticateDevice(token);
		const rawTicket = this.tokenFactory();
		const expiresAt = this.now() + TICKET_TTL_MS;
		this.tickets.set(hash(rawTicket), {
			kind: "remote-bridge",
			connectionId: input.connectionId,
			deviceId: device.id,
			deviceTokenHash: tokenHash,
			host: binding.host,
			expiresAt,
		});
		this.database.touchRemoteBridgeDevice(device.id, new Date(this.now()).toISOString());
		this.pruneExpired();
		while (this.tickets.size > MAX_PENDING_TICKETS) {
			const oldest = this.tickets.keys().next().value;
			if (typeof oldest !== "string") break;
			this.tickets.delete(oldest);
		}
		return {
			ticket: rawTicket,
			expiresAt: new Date(expiresAt).toISOString(),
			protocol: REMOTE_BRIDGE_PROTOCOL,
			leaseRenewIntervalMs: LEASE_RENEW_INTERVAL_MS,
			...(this.p2pEnabled
				? {
						webRtc: {
							iceServers: this.stunUrls.map((urls) => ({ urls })),
							negotiationTimeoutMs: NEGOTIATION_TIMEOUT_MS,
							leaseRenewIntervalMs: LEASE_RENEW_INTERVAL_MS,
						},
					}
				: {}),
		};
	}

	consumeUpgrade(request: Request, binding: { host: string }): RemoteBridgeSocketData {
		const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		if (!protocols.includes(REMOTE_BRIDGE_PROTOCOL)) {
			throw new HttpError(
				400,
				"remote_bridge_protocol_invalid",
				"The native bridge protocol is unsupported",
			);
		}
		const ticketProtocol = protocols.find((value) => value.startsWith(REMOTE_BRIDGE_TICKET_PREFIX));
		const rawTicket = ticketProtocol?.slice(REMOTE_BRIDGE_TICKET_PREFIX.length) ?? "";
		const ticketHash = rawTicket ? hash(rawTicket) : "";
		const ticket = this.tickets.get(ticketHash);
		if (ticketHash) this.tickets.delete(ticketHash);
		const device = ticket
			? this.database.remoteBridgeDeviceByTokenHash(ticket.deviceTokenHash)
			: null;
		if (
			!ticket ||
			!device ||
			device.id !== ticket.deviceId ||
			ticket.expiresAt <= this.now() ||
			ticket.host !== binding.host
		) {
			throw new HttpError(
				403,
				"remote_bridge_ticket_invalid",
				"The native bridge ticket is invalid or expired",
			);
		}
		const { deviceTokenHash: _deviceTokenHash, expiresAt: _expiresAt, ...data } = ticket;
		return data;
	}

	private pruneExpired(): void {
		const now = this.now();
		for (const [key, value] of this.pairings) {
			if (value.expiresAt <= now) this.pairings.delete(key);
		}
		for (const [key, value] of this.tickets) {
			if (value.expiresAt <= now) this.tickets.delete(key);
		}
	}

	revokeDevice(deviceId: string): boolean {
		if (!this.database.deleteRemoteBridgeDevice(deviceId)) return false;
		for (const [ticketHash, ticket] of this.tickets) {
			if (ticket.deviceId === deviceId) this.tickets.delete(ticketHash);
		}
		return true;
	}

	closeRepository(repositoryId: string): void {
		for (const [key, pairing] of this.pairings) {
			if (pairing.repositoryId === repositoryId) this.pairings.delete(key);
		}
	}

	close(): void {
		this.pairings.clear();
		this.tickets.clear();
	}
}
