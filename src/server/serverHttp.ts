import { timingSafeEqual } from "node:crypto";

import { REMOTE_BRIDGE_DEVICE_TOKEN_HEADER } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";

const MAX_BODY_BYTES = 64 * 1024;

export function json(value: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set("Content-Type", "application/json; charset=utf-8");
	headers.set("Cache-Control", "no-store");
	return new Response(JSON.stringify(value), { ...init, headers });
}

export function isMutation(method: string): boolean {
	return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export function tokenMatches(actual: string | null, expected: string): boolean {
	if (!actual) return false;
	const actualBytes = Buffer.from(actual);
	const expectedBytes = Buffer.from(expected);
	return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function bearerToken(request: Request): string | null {
	const authorization = request.headers.get("authorization");
	return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

export function remoteBridgeDeviceToken(request: Request): string | null {
	return request.headers.get(REMOTE_BRIDGE_DEVICE_TOKEN_HEADER) ?? bearerToken(request);
}

export async function readJsonObject<T extends object>(request: Request): Promise<T> {
	const type = request.headers.get("content-type")?.toLowerCase() ?? "";
	if (type.split(";", 1)[0]?.trim() !== "application/json") {
		throw new HttpError(415, "json_required", "Request body must be JSON");
	}
	const declared = Number(request.headers.get("content-length") ?? 0);
	if (declared > MAX_BODY_BYTES) {
		throw new HttpError(413, "body_too_large", "Request body is too large");
	}
	if (!request.body) {
		throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			total += result.value.byteLength;
			if (total > MAX_BODY_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new HttpError(413, "body_too_large", "Request body is too large");
			}
			chunks.push(result.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new HttpError(400, "invalid_request", "Request body must be a JSON object");
		}
		return parsed as T;
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
	}
}

export function normalizeRequestHost(value: string): string {
	if (!value || value !== value.trim() || /[/?#@]/.test(value)) {
		throw new Error("Invalid Host header");
	}
	const url = new URL(`http://${value}`);
	if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
		throw new Error("Invalid Host header");
	}
	return url.host;
}

export function normalizeOrigin(value: string): string {
	const url = new URL(value);
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		!/^https?:\/\/[^/?#]+$/i.test(value)
	) {
		throw new Error("Origin must be an exact HTTP or HTTPS origin");
	}
	return url.origin;
}

export function decodeSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		throw new HttpError(400, "invalid_path", "API path is invalid");
	}
}
