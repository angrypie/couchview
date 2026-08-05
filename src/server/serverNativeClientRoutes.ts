import {
	API_ROUTES,
	type ClaimNativeClientPairingRequest,
	type NativeClientsResponse,
} from "../shared/contracts.ts";
import type { NativeClientService } from "./nativeClientService.ts";
import { decodeSegment, json, readJsonObject } from "./serverHttp.ts";

interface NativeClientRouteContext {
	nativeClients: NativeClientService;
	onRevoked(clientId: string): void;
}

export async function handleNativeClientApi(
	context: NativeClientRouteContext,
	request: Request,
	url: URL,
): Promise<Response | null> {
	if (url.pathname === API_ROUTES.nativeClientPairings && request.method === "POST") {
		return json(context.nativeClients.createPairing(url.origin), { status: 201 });
	}
	if (url.pathname === API_ROUTES.nativeClientPairingClaim && request.method === "POST") {
		const input = await readJsonObject<ClaimNativeClientPairingRequest>(request);
		return json(context.nativeClients.claimPairing(input), { status: 201 });
	}
	if (url.pathname === API_ROUTES.nativeClients && request.method === "GET") {
		const response: NativeClientsResponse = { devices: context.nativeClients.clients() };
		return json(response);
	}
	const clientRoute = /^\/api\/native-clients\/([^/]+)$/.exec(url.pathname);
	if (clientRoute && request.method === "DELETE") {
		const clientId = decodeSegment(clientRoute[1] ?? "");
		context.nativeClients.revoke(clientId);
		context.onRevoked(clientId);
		return new Response(null, { status: 204 });
	}
	return null;
}
