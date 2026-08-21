import { describe, expect, test } from "bun:test";

import { NATIVE_CLIENT_PROTOCOL } from "../../../shared/nativeClients.ts";
import { nativeServerBaseUrl, parseNativePairingLink } from "./pairingLink.ts";

const SERVER_ID = "2d2f2b4c-4a6e-4ac6-8d9b-294a8b046e11";

function pairingLink(baseUrl: string, expiresAt = "2099-08-05T12:00:00.000Z"): string {
	const link = new URL("couchview://pair");
	link.searchParams.set("protocol", NATIVE_CLIENT_PROTOCOL);
	link.searchParams.set("baseUrl", baseUrl);
	link.searchParams.set("serverId", SERVER_ID);
	link.searchParams.set("code", "ABCDEFGH");
	link.searchParams.set("expiresAt", expiresAt);
	return link.toString();
}

describe("native Couchview server links", () => {
	test("accepts trusted HTTPS and local-network HTTP origins", () => {
		for (const origin of [
			"https://review.example.test",
			"http://localhost:4173",
			"http://127.0.0.1:4173",
			"http://10.0.0.8:4173",
			"http://172.31.4.2:4173",
			"http://192.168.1.8:4173",
			"http://169.254.2.3:4173",
			"http://[::1]:4173",
			"http://[fe80::1]:4173",
			"http://[fd12:3456::1]:4173",
			"http://couchview.local:4173",
			"http://couchview:4173",
		]) {
			expect(nativeServerBaseUrl(origin)).toBe(origin);
		}
	});

	test("rejects public HTTP, credentials, paths, and malformed pairing metadata", () => {
		expect(() => nativeServerBaseUrl("http://review.example.test")).toThrow("private");
		expect(() => nativeServerBaseUrl("https://user:secret@review.example.test")).toThrow("origin");
		expect(() => nativeServerBaseUrl("https://review.example.test/repository")).toThrow("origin");
		expect(() =>
			parseNativePairingLink(pairingLink("https://review.example.test").replace(SERVER_ID, "bad")),
		).toThrow("incomplete");
		expect(() => parseNativePairingLink("https://review.example.test")).toThrow("couchview://pair");
	});

	test("parses a versioned link and rejects expired or mismatched protocols", () => {
		expect(parseNativePairingLink(pairingLink("http://192.168.1.8:4173"))).toEqual({
			baseUrl: "http://192.168.1.8:4173",
			serverId: SERVER_ID,
			code: "ABCDEFGH",
			expiresAt: "2099-08-05T12:00:00.000Z",
		});
		expect(() =>
			parseNativePairingLink(pairingLink("http://192.168.1.8:4173", "2020-01-01T00:00:00Z")),
		).toThrow("expired");
		expect(() =>
			parseNativePairingLink(
				pairingLink("http://192.168.1.8:4173").replace(
					NATIVE_CLIENT_PROTOCOL,
					"couchview-native-v2",
				),
			),
		).toThrow("unsupported");
	});
});
