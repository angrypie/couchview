import {
	API_ROUTES,
	type ClaimNativeClientPairingRequest,
	type InstanceResponse,
	NATIVE_CLIENT_PROTOCOL,
	NATIVE_CLIENT_TOKEN_HEADER,
	type NativeClientClaimResponse,
	type NativeClientPairingResponse,
	nativeClientPairingCodeIsValid,
	normalizeNativeClientLabel,
} from "../src/shared/contracts.ts";
import { fixtureJson, fixtureSecurityHeaders } from "./e2eFixtureHttp.ts";
import type { FixtureMutableState, FixtureRequestContext } from "./e2eFixtureRouteTypes.ts";

export const FIXTURE_NATIVE_SERVER_ID = "11111111-2222-4333-8444-555555555555";
export const FIXTURE_NATIVE_INSTANCE_ID = "fixture-instance-0001";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FIXTURE_DEVICE_CREATED_AT = "2026-08-07T12:00:00.000Z";
const FIXTURE_DEVICE_USED_AT = "2026-08-07T12:00:01.000Z";

export interface FixtureNativeAuthorization {
	clientId: string | null;
	error: Response | null;
}

function nativeUnauthorized(): Response {
	return fixtureJson(
		{
			error: {
				code: "native_client_unauthorized",
				message: "Native client credential is invalid or revoked",
			},
		},
		401,
	);
}

function pairingInvalid(): Response {
	return fixtureJson(
		{ error: { code: "native_pairing_invalid", message: "Pairing code is invalid or expired" } },
		400,
	);
}

function pairingCode(sequence: number): string {
	const left =
		PAIRING_ALPHABET[Math.floor(sequence / PAIRING_ALPHABET.length) % PAIRING_ALPHABET.length];
	const right = PAIRING_ALPHABET[sequence % PAIRING_ALPHABET.length];
	return `ABCDEF${left}${right}`;
}

function tokenFor(sequence: number): string {
	return `fixture_native_client_token_${String(sequence).padStart(16, "0")}`;
}

function touchClient(state: FixtureMutableState, clientId: string): void {
	state.nativeClients = state.nativeClients.map((client) =>
		client.id === clientId ? { ...client, lastUsedAt: FIXTURE_DEVICE_USED_AT } : client,
	);
}

export function authorizeFixtureNativeRequest(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): FixtureNativeAuthorization {
	if (!context.url.pathname.startsWith("/api/")) return { clientId: null, error: null };
	const token = context.request.headers.get(NATIVE_CLIENT_TOKEN_HEADER);
	if (token === null) {
		return context.url.pathname === API_ROUTES.instance
			? { clientId: null, error: nativeUnauthorized() }
			: { clientId: null, error: null };
	}
	const clientId = state.nativeClientTokens.get(token) ?? null;
	const client = state.nativeClients.find(
		(candidate) => candidate.id === clientId && candidate.revokedAt === null,
	);
	if (!client) return { clientId: null, error: nativeUnauthorized() };
	touchClient(state, client.id);
	return { clientId: client.id, error: null };
}

function instanceResponse(context: FixtureRequestContext): InstanceResponse {
	const port = context.url.port
		? Number(context.url.port)
		: context.url.protocol === "https:"
			? 443
			: 80;
	return {
		service: "couchview",
		protocolVersion: 6,
		version: "0.0.0-e2e",
		serverId: FIXTURE_NATIVE_SERVER_ID,
		instanceId: FIXTURE_NATIVE_INSTANCE_ID,
		bindHost: context.url.hostname,
		port,
		accessOrigins: [],
		speechEnabled: false,
		terminalEnabled: true,
		terminalP2pEnabled: true,
		terminalStunUrls: [],
		remoteBridgeEnabled: true,
		remoteBridgeP2pEnabled: true,
		remoteBridgeStunUrls: [],
		remoteBridgeTargetPort: 22,
		remoteBridgeOriginAccess: "auto",
	};
}

export function handleFixtureNativeClientReadRoute(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): Response | null {
	if (context.request.method !== "GET") return null;
	if (context.url.pathname === API_ROUTES.instance) {
		return fixtureJson(instanceResponse(context));
	}
	if (context.url.pathname === API_ROUTES.nativeClients) {
		return fixtureJson({ devices: state.nativeClients });
	}
	return null;
}

function createPairing(state: FixtureMutableState, context: FixtureRequestContext): Response {
	const sequence = ++state.nativePairingCounter;
	const code = pairingCode(sequence);
	const expiresAtMs = Date.now() + 5 * 60_000;
	const expiresAt = new Date(expiresAtMs).toISOString();
	state.nativePairings.set(code, { expiresAt: expiresAtMs, sequence });
	const deepLink = new URL("couchview://pair");
	deepLink.searchParams.set("protocol", NATIVE_CLIENT_PROTOCOL);
	deepLink.searchParams.set("baseUrl", context.url.origin);
	deepLink.searchParams.set("serverId", FIXTURE_NATIVE_SERVER_ID);
	deepLink.searchParams.set("code", code);
	deepLink.searchParams.set("expiresAt", expiresAt);
	const response: NativeClientPairingResponse = {
		protocol: NATIVE_CLIENT_PROTOCOL,
		baseUrl: context.url.origin,
		serverId: FIXTURE_NATIVE_SERVER_ID,
		code,
		expiresAt,
		deepLink: deepLink.toString(),
	};
	return fixtureJson(response, 201);
}

async function claimPairing(state: FixtureMutableState, request: Request): Promise<Response> {
	let input: Partial<ClaimNativeClientPairingRequest>;
	try {
		const value = await request.json();
		if (!value || typeof value !== "object") return pairingInvalid();
		input = value as Partial<ClaimNativeClientPairingRequest>;
	} catch {
		return pairingInvalid();
	}
	if (!nativeClientPairingCodeIsValid(input.code)) return pairingInvalid();
	let label: string;
	try {
		label = normalizeNativeClientLabel(input.deviceLabel);
	} catch (error) {
		return fixtureJson(
			{
				error: {
					code: "native_device_label_invalid",
					message: error instanceof Error ? error.message : "Device label is invalid",
				},
			},
			400,
		);
	}
	const pairing = state.nativePairings.get(input.code);
	state.nativePairings.delete(input.code);
	if (!pairing || pairing.expiresAt <= Date.now()) return pairingInvalid();
	const device = {
		id: `fixture-native-client-${pairing.sequence}`,
		label,
		createdAt: FIXTURE_DEVICE_CREATED_AT,
		lastUsedAt: null,
		revokedAt: null,
	};
	const token = tokenFor(pairing.sequence);
	state.nativeClients = [...state.nativeClients, device];
	state.nativeClientTokens.set(token, device.id);
	const response: NativeClientClaimResponse = {
		protocol: NATIVE_CLIENT_PROTOCOL,
		serverId: FIXTURE_NATIVE_SERVER_ID,
		device,
		token,
	};
	return fixtureJson(response, 201);
}

function revokeClient(state: FixtureMutableState, clientId: string): Response {
	if (!state.nativeClients.some((client) => client.id === clientId)) {
		return fixtureJson(
			{ error: { code: "native_client_not_found", message: "Fixture native client not found" } },
			404,
		);
	}
	state.nativeClients = state.nativeClients.filter((client) => client.id !== clientId);
	for (const [token, tokenClientId] of state.nativeClientTokens) {
		if (tokenClientId === clientId) state.nativeClientTokens.delete(token);
	}
	return new Response(null, { status: 204, headers: fixtureSecurityHeaders });
}

export async function handleFixtureNativeClientMutation(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): Promise<Response | null> {
	const { request, url } = context;
	if (url.pathname === API_ROUTES.nativeClientPairings && request.method === "POST") {
		return createPairing(state, context);
	}
	if (url.pathname === API_ROUTES.nativeClientPairingClaim && request.method === "POST") {
		return claimPairing(state, request);
	}
	const clientRoute = /^\/api\/native-clients\/([^/]+)$/.exec(url.pathname);
	if (clientRoute && request.method === "DELETE") {
		return revokeClient(state, decodeURIComponent(clientRoute[1] ?? ""));
	}
	return null;
}
