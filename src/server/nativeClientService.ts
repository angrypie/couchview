import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
	type ClaimNativeClientPairingRequest,
	NATIVE_CLIENT_PROTOCOL,
	type NativeClientClaimResponse,
	type NativeClientDevice,
	type NativeClientPairingResponse,
	nativeClientPairingCodeIsValid,
	normalizeNativeClientLabel,
} from "../shared/nativeClients.ts";
import { HttpError } from "./errors.ts";
import type { NativeClientDatabase } from "./nativeClientDatabase.ts";

const PAIRING_LIFETIME_MS = 5 * 60 * 1000;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_PAIRINGS = 32;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface StoredPairing {
	expiresAt: number;
	baseUrl: string;
}

interface NativeClientServiceOptions {
	database: NativeClientDatabase;
	now?: () => number;
	pairingCodeFactory?: () => string;
	tokenFactory?: () => string;
	idFactory?: () => string;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function randomPairingCode(): string {
	const bytes = randomBytes(8);
	let code = "";
	for (const byte of bytes) code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
	return code;
}

function normalizeBaseUrl(value: string): string {
	const url = new URL(value);
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new HttpError(400, "native_pairing_url_invalid", "Pairing server URL is invalid");
	}
	return url.origin;
}

export class NativeClientService {
	private readonly database: NativeClientDatabase;
	private readonly now: () => number;
	private readonly pairingCodeFactory: () => string;
	private readonly tokenFactory: () => string;
	private readonly idFactory: () => string;
	private readonly pairings = new Map<string, StoredPairing>();

	constructor(options: NativeClientServiceOptions) {
		this.database = options.database;
		this.now = options.now ?? Date.now;
		this.pairingCodeFactory = options.pairingCodeFactory ?? randomPairingCode;
		this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
		this.idFactory = options.idFactory ?? randomUUID;
	}

	serverId(): string {
		return this.database.serverId();
	}

	private cleanPairings(): void {
		const now = this.now();
		for (const [codeHash, pairing] of this.pairings) {
			if (pairing.expiresAt <= now) this.pairings.delete(codeHash);
		}
		while (this.pairings.size >= MAX_ACTIVE_PAIRINGS) {
			const oldest = this.pairings.keys().next().value;
			if (!oldest) break;
			this.pairings.delete(oldest);
		}
	}

	createPairing(baseUrlValue: string): NativeClientPairingResponse {
		const baseUrl = normalizeBaseUrl(baseUrlValue);
		this.cleanPairings();
		const code = this.pairingCodeFactory();
		if (!nativeClientPairingCodeIsValid(code)) {
			throw new Error("Native pairing code factory returned an invalid code");
		}
		const codeHash = hash(code);
		if (this.pairings.has(codeHash)) {
			throw new Error("Native pairing code factory returned a duplicate code");
		}
		const expiresAt = this.now() + PAIRING_LIFETIME_MS;
		this.pairings.set(codeHash, { baseUrl, expiresAt });
		const deepLink = new URL("couchview://pair");
		deepLink.searchParams.set("protocol", NATIVE_CLIENT_PROTOCOL);
		deepLink.searchParams.set("baseUrl", baseUrl);
		deepLink.searchParams.set("serverId", this.serverId());
		deepLink.searchParams.set("code", code);
		deepLink.searchParams.set("expiresAt", new Date(expiresAt).toISOString());
		return {
			protocol: NATIVE_CLIENT_PROTOCOL,
			baseUrl,
			serverId: this.serverId(),
			code,
			expiresAt: new Date(expiresAt).toISOString(),
			deepLink: deepLink.toString(),
		};
	}

	claimPairing(input: ClaimNativeClientPairingRequest): NativeClientClaimResponse {
		if (!nativeClientPairingCodeIsValid(input.code)) {
			throw new HttpError(400, "native_pairing_invalid", "Pairing code is invalid or expired");
		}
		let label: string;
		try {
			label = normalizeNativeClientLabel(input.deviceLabel);
		} catch (error) {
			throw new HttpError(
				400,
				"native_device_label_invalid",
				error instanceof Error ? error.message : "Device label is invalid",
			);
		}
		const codeHash = hash(input.code);
		const pairing = this.pairings.get(codeHash);
		if (codeHash) this.pairings.delete(codeHash);
		if (!pairing || pairing.expiresAt <= this.now()) {
			throw new HttpError(400, "native_pairing_invalid", "Pairing code is invalid or expired");
		}
		const token = this.tokenFactory();
		if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
			throw new Error("Native client token factory returned an invalid token");
		}
		const device = this.database.createClient({
			id: this.idFactory(),
			label,
			tokenHash: hash(token),
			createdAt: new Date(this.now()).toISOString(),
		});
		return {
			protocol: NATIVE_CLIENT_PROTOCOL,
			serverId: this.serverId(),
			device,
			token,
		};
	}

	clients(): NativeClientDevice[] {
		return this.database.clients();
	}

	authenticate(token: string | null): NativeClientDevice {
		if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
			throw new HttpError(
				401,
				"native_client_unauthorized",
				"Native client credential is invalid or revoked",
			);
		}
		const now = this.now();
		const client = this.database.authenticate(
			hash(token),
			new Date(now).toISOString(),
			new Date(now - LAST_USED_WRITE_INTERVAL_MS).toISOString(),
		);
		if (!client) {
			throw new HttpError(
				401,
				"native_client_unauthorized",
				"Native client credential is invalid or revoked",
			);
		}
		return client;
	}

	revoke(id: string): NativeClientDevice {
		const client = this.database.revoke(id, new Date(this.now()).toISOString());
		if (!client) {
			throw new HttpError(404, "native_client_not_found", "Native client not found");
		}
		return client;
	}
}
