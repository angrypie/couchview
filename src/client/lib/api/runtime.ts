import { NATIVE_CLIENT_TOKEN_HEADER } from "../../../shared/nativeClients.ts";
import type { FetchLike, FetchResponseLike } from "./fetchTypes.ts";
import { platformFetch } from "./transport";

export interface ApiRuntimeConfiguration {
	baseUrl?: string | null;
	fetch?: FetchLike;
	nativeClientToken?: string | null;
}

interface ApiRuntime {
	baseUrl: string | null;
	fetch: FetchLike;
	nativeClientToken: string | null;
}

const PATH_BASE = "https://couchview.invalid";

function defaultRuntime(): ApiRuntime {
	return {
		baseUrl: null,
		fetch: platformFetch,
		nativeClientToken: null,
	};
}

let runtime = defaultRuntime();

function apiOrigin(value: string): string {
	const url = new URL(value);
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error("API base URL must be an HTTP or HTTPS origin");
	}
	return url.origin;
}

function apiPath(value: string): string {
	if (!value.startsWith("/") || value.startsWith("//")) {
		throw new Error("API paths must be same-origin absolute paths");
	}
	const url = new URL(value, PATH_BASE);
	if (url.origin !== PATH_BASE || url.hash) {
		throw new Error("API paths must not contain an origin or fragment");
	}
	return `${url.pathname}${url.search}`;
}

function absoluteOrigin(): string {
	if (runtime.baseUrl) return runtime.baseUrl;
	if (typeof globalThis.location !== "undefined") {
		const { origin, protocol } = globalThis.location;
		if ((protocol === "http:" || protocol === "https:") && origin) return origin;
	}
	throw new Error("An API origin is required to construct an absolute URL");
}

export function configureApiRuntime(configuration: ApiRuntimeConfiguration): void {
	const baseUrl = configuration.baseUrl ? apiOrigin(configuration.baseUrl) : null;
	const nativeClientToken = configuration.nativeClientToken ?? null;
	if (nativeClientToken !== null && baseUrl === null) {
		throw new Error("A native client token requires an API base URL");
	}
	if (nativeClientToken !== null && nativeClientToken.length === 0) {
		throw new Error("Native client token must not be empty");
	}
	runtime = {
		baseUrl,
		fetch: configuration.fetch ?? platformFetch,
		nativeClientToken,
	};
}

export function resetApiRuntime(): void {
	runtime = defaultRuntime();
}

export function apiRequestUrl(path: string): string {
	const normalizedPath = apiPath(path);
	return runtime.baseUrl
		? new URL(normalizedPath, `${runtime.baseUrl}/`).toString()
		: normalizedPath;
}

export function absoluteApiHttpUrl(path: string): string {
	return new URL(apiPath(path), `${absoluteOrigin()}/`).toString();
}

export function absoluteApiDownloadUrl(path: string): string {
	return absoluteApiHttpUrl(path);
}

export function absoluteApiWebSocketUrl(path: string): string {
	const url = new URL(apiPath(path), `${absoluteOrigin()}/`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

export function apiRequestHeaders(initial?: HeadersInit): Headers {
	const headers = new Headers(initial);
	if (runtime.nativeClientToken) {
		headers.set(NATIVE_CLIENT_TOKEN_HEADER, runtime.nativeClientToken);
	}
	return headers;
}

export function fetchApi(path: string, init: RequestInit = {}): Promise<FetchResponseLike> {
	return runtime.fetch(apiRequestUrl(path), {
		credentials: runtime.nativeClientToken ? "omit" : runtime.baseUrl ? "include" : "same-origin",
		...init,
		headers: apiRequestHeaders(init.headers),
	});
}
