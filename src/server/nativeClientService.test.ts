import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NATIVE_CLIENT_PROTOCOL } from "../shared/nativeClients.ts";
import { StateDatabase } from "./database.ts";
import { NativeClientService } from "./nativeClientService.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function databaseFixture(): Promise<{ state: StateDatabase; filePath: string }> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-native-clients-"));
	temporaryDirectories.push(directory);
	const filePath = path.join(directory, "state.sqlite");
	return { state: await StateDatabase.open(filePath), filePath };
}

describe("native client pairing and credentials", () => {
	test("persists a restart-stable identity and stores only a device token hash", async () => {
		const { state, filePath } = await databaseFixture();
		const serverId = state.nativeClients.serverId();
		const service = new NativeClientService({
			database: state.nativeClients,
			pairingCodeFactory: () => "ABCDEFG2",
			tokenFactory: () => "t".repeat(43),
			idFactory: () => "device-one",
			now: () => Date.parse("2026-08-05T12:00:00.000Z"),
		});
		const pairing = service.createPairing("http://192.168.1.20:4173");
		expect(pairing).toMatchObject({
			protocol: NATIVE_CLIENT_PROTOCOL,
			baseUrl: "http://192.168.1.20:4173",
			serverId,
			code: "ABCDEFG2",
			expiresAt: "2026-08-05T12:05:00.000Z",
		});
		expect(Object.fromEntries(new URL(pairing.deepLink).searchParams)).toMatchObject({
			protocol: NATIVE_CLIENT_PROTOCOL,
			serverId,
			code: "ABCDEFG2",
		});

		const claimed = service.claimPairing({ code: "ABCDEFG2", deviceLabel: "  Niki's iPad  " });
		expect(claimed).toMatchObject({
			serverId,
			token: "t".repeat(43),
			device: { id: "device-one", label: "Niki's iPad", revokedAt: null },
		});
		expect(() => service.claimPairing({ code: "ABCDEFG2", deviceLabel: "Replay" })).toThrow(
			expect.objectContaining({ code: "native_pairing_invalid" }),
		);

		const raw = new Database(filePath, { readonly: true, strict: true });
		const stored = raw
			.query<{ token_hash: string }, []>("SELECT token_hash FROM native_clients")
			.get();
		expect(stored?.token_hash).toBe(createHash("sha256").update("t".repeat(43)).digest("hex"));
		expect(JSON.stringify(stored)).not.toContain("t".repeat(43));
		raw.close();
		state.close();

		const reopened = await StateDatabase.open(filePath);
		expect(reopened.nativeClients.serverId()).toBe(serverId);
		reopened.close();
	});

	test("expires pairings, supports multiple devices, bounds last-used writes, and revokes", async () => {
		const { state } = await databaseFixture();
		let now = Date.parse("2026-08-05T12:00:00.000Z");
		const codes = ["ABCDEFG2", "ABCDEFG3", "ABCDEFG4"];
		const tokens = ["a".repeat(43), "b".repeat(43)];
		let id = 0;
		const service = new NativeClientService({
			database: state.nativeClients,
			pairingCodeFactory: () => codes.shift() ?? "ABCDEFG5",
			tokenFactory: () => tokens.shift() ?? "c".repeat(43),
			idFactory: () => `device-${++id}`,
			now: () => now,
		});
		service.createPairing("https://review.example.com");
		now += 5 * 60 * 1000;
		expect(() => service.claimPairing({ code: "ABCDEFG2", deviceLabel: "Expired" })).toThrow(
			expect.objectContaining({ code: "native_pairing_invalid" }),
		);

		const firstPairing = service.createPairing("https://review.example.com");
		const first = service.claimPairing({ code: firstPairing.code, deviceLabel: "Phone" });
		const secondPairing = service.createPairing("https://review.example.com");
		service.claimPairing({ code: secondPairing.code, deviceLabel: "Tablet" });
		expect(service.clients().map(({ label }) => label)).toEqual(["Phone", "Tablet"]);

		const firstUse = service.authenticate(first.token);
		expect(firstUse.lastUsedAt).toBe("2026-08-05T12:05:00.000Z");
		now += 60 * 1000;
		expect(service.authenticate(first.token).lastUsedAt).toBe(firstUse.lastUsedAt);
		now += 5 * 60 * 1000;
		expect(service.authenticate(first.token).lastUsedAt).toBe("2026-08-05T12:11:00.000Z");

		expect(service.revoke(first.device.id).revokedAt).toBe("2026-08-05T12:11:00.000Z");
		expect(() => service.authenticate(first.token)).toThrow(
			expect.objectContaining({ code: "native_client_unauthorized" }),
		);
		state.close();
	});
});
