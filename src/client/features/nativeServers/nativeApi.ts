import { fetch as expoFetch } from "expo/fetch";

import {
	API_ROUTES,
	type ApiErrorBody,
	type ClaimNativeClientPairingRequest,
	type InstanceResponse,
	NATIVE_CLIENT_TOKEN_HEADER,
	type NativeClientClaimResponse,
} from "../../../shared/contracts.ts";

export class NativeApiError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "NativeApiError";
	}
}

async function responseError(response: Response): Promise<NativeApiError> {
	try {
		const body = (await response.json()) as ApiErrorBody;
		return new NativeApiError(body.error.message, body.error.code);
	} catch {
		return new NativeApiError(`Request failed (${response.status})`, "request_failed");
	}
}

async function readResponse<T>(response: Response): Promise<T> {
	if (!response.ok) throw await responseError(response);
	return (await response.json()) as T;
}

export async function claimNativePairing(
	baseUrl: string,
	input: ClaimNativeClientPairingRequest,
	signal?: AbortSignal,
): Promise<NativeClientClaimResponse> {
	const response = await expoFetch(`${baseUrl}${API_ROUTES.nativeClientPairingClaim}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
		signal,
	});
	return readResponse(response);
}

export async function fetchNativeServerInstance(
	baseUrl: string,
	token: string,
	signal?: AbortSignal,
): Promise<InstanceResponse> {
	let response: Response;
	try {
		response = await expoFetch(`${baseUrl}${API_ROUTES.instance}`, {
			headers: {
				accept: "application/json",
				[NATIVE_CLIENT_TOKEN_HEADER]: token,
			},
			signal,
		});
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new NativeApiError("Could not reach this Couchview server", "disconnected");
	}
	return readResponse(response);
}
