import { NATIVE_CLIENT_PROTOCOL } from "../../../shared/nativeClients.ts";
import type { NativePairingDescriptor } from "./types.ts";

function ipv4IsLocal(hostname: string): boolean {
	const octets = hostname.split(".").map(Number);
	if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value > 255)) {
		return false;
	}
	const [first = -1, second = -1] = octets;
	return (
		first === 10 ||
		first === 127 ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

function hostnameIsLocal(hostnameValue: string): boolean {
	const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/g, "");
	if (hostname === "localhost" || hostname === "::1") return true;
	if (ipv4IsLocal(hostname)) return true;
	if (hostname.startsWith("fe8") || hostname.startsWith("fe9")) return true;
	if (hostname.startsWith("fea") || hostname.startsWith("feb")) return true;
	if (/^f[cd][0-9a-f]{2}:/i.test(hostname)) return true;
	return hostname.endsWith(".local") || !hostname.includes(".");
}

export function nativeServerBaseUrl(value: string): string {
	const url = new URL(value);
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error("Server URL must be an HTTP or HTTPS origin");
	}
	if (url.protocol === "http:" && !hostnameIsLocal(url.hostname)) {
		throw new Error("Plain HTTP is allowed only for loopback or private local-network servers");
	}
	return url.origin;
}

export function parseNativePairingLink(value: string): NativePairingDescriptor {
	let link: URL;
	try {
		link = new URL(value.trim());
	} catch {
		throw new Error("Paste a complete couchview://pair link");
	}
	if (link.protocol !== "couchview:" || link.hostname !== "pair") {
		throw new Error("Pairing link must start with couchview://pair");
	}
	if (link.searchParams.get("protocol") !== NATIVE_CLIENT_PROTOCOL) {
		throw new Error("This pairing link uses an unsupported Couchview protocol");
	}
	const serverId = link.searchParams.get("serverId") ?? "";
	const code = link.searchParams.get("code") ?? "";
	const expiresAt = link.searchParams.get("expiresAt") ?? "";
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serverId) ||
		!/^[A-HJ-NP-Z2-9]{8}$/.test(code)
	) {
		throw new Error("Pairing link is incomplete or invalid");
	}
	const expiry = Date.parse(expiresAt);
	if (!Number.isFinite(expiry) || expiry <= Date.now()) {
		throw new Error("This pairing link has expired");
	}
	return {
		baseUrl: nativeServerBaseUrl(link.searchParams.get("baseUrl") ?? ""),
		serverId,
		code,
		expiresAt: new Date(expiry).toISOString(),
	};
}
