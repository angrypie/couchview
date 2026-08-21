import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { resolve } from "node:path";

import {
	API_ROUTES,
	CSRF_HEADER,
	type InstanceResponse,
	NATIVE_CLIENT_TOKEN_HEADER,
	type NativeClientClaimResponse,
	type NativeClientPairingResponse,
} from "../src/shared/contracts.ts";
import { fixtureCsrfToken } from "./e2eFixtureHttp.ts";
import { FIXTURE_NATIVE_INSTANCE_ID, FIXTURE_NATIVE_SERVER_ID } from "./e2eFixtureNativeClients.ts";

let fixtureProcess: ReturnType<typeof Bun.spawn> | null = null;
let baseUrl = "";

async function availablePort(): Promise<number> {
	const reservation = createServer();
	await new Promise<void>((resolveListening, rejectListening) => {
		reservation.once("error", rejectListening);
		reservation.listen(0, "127.0.0.1", resolveListening);
	});
	const address = reservation.address();
	if (!address || typeof address === "string") throw new Error("Could not reserve a fixture port");
	await new Promise<void>((resolveClose, rejectClose) => {
		reservation.close((error) => (error ? rejectClose(error) : resolveClose()));
	});
	return address.port;
}

async function startFixture(): Promise<string> {
	const port = await availablePort();
	fixtureProcess = Bun.spawn([process.execPath, resolve(import.meta.dir, "e2e-fixture.ts")], {
		cwd: resolve(import.meta.dir, ".."),
		env: {
			...process.env,
			E2E_HOST: "127.0.0.1",
			E2E_PORT: String(port),
		},
		stderr: "inherit",
		stdout: "ignore",
	});
	const origin = `http://127.0.0.1:${port}`;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (fixtureProcess.exitCode !== null) {
			throw new Error(`E2E fixture exited with code ${fixtureProcess.exitCode}`);
		}
		try {
			const response = await fetch(`${origin}${API_ROUTES.bootstrap}`);
			if (response.ok) return origin;
		} catch {
			// The child process is still binding its HTTP listener.
		}
		await Bun.sleep(20);
	}
	throw new Error("E2E fixture did not start");
}

async function resetFixture(): Promise<Response> {
	return fetch(`${baseUrl}/api/e2e/reset`, {
		method: "POST",
		headers: { [CSRF_HEADER]: fixtureCsrfToken },
	});
}

async function pairNativeClient(deviceLabel = "Agent Device iPhone"): Promise<{
	claim: NativeClientClaimResponse;
	pairing: NativeClientPairingResponse;
}> {
	const pairingResponse = await fetch(`${baseUrl}${API_ROUTES.nativeClientPairings}`, {
		method: "POST",
		headers: { origin: baseUrl, [CSRF_HEADER]: fixtureCsrfToken },
	});
	expect(pairingResponse.status).toBe(201);
	const pairing = (await pairingResponse.json()) as NativeClientPairingResponse;
	const claimResponse = await fetch(`${baseUrl}${API_ROUTES.nativeClientPairingClaim}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code: pairing.code, deviceLabel }),
	});
	expect(claimResponse.status).toBe(201);
	return { pairing, claim: (await claimResponse.json()) as NativeClientClaimResponse };
}

beforeAll(async () => {
	baseUrl = await startFixture();
});

beforeEach(async () => {
	expect((await resetFixture()).status).toBe(200);
});

afterAll(async () => {
	if (!fixtureProcess) return;
	fixtureProcess.kill("SIGKILL");
	await fixtureProcess.exited;
	fixtureProcess = null;
});

describe("E2E fixture native client authority", () => {
	test("requires, rejects, and accepts native credentials without breaking browser requests", async () => {
		expect((await fetch(`${baseUrl}${API_ROUTES.instance}`)).status).toBe(401);
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.instance}`, {
					headers: { [NATIVE_CLIENT_TOKEN_HEADER]: "x".repeat(43) },
				})
			).status,
		).toBe(401);

		expect((await fetch(`${baseUrl}${API_ROUTES.bootstrap}`)).status).toBe(200);
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.settingsProfiles}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: baseUrl,
						[CSRF_HEADER]: fixtureCsrfToken,
					},
					body: JSON.stringify({ name: "Browser profile" }),
				})
			).status,
		).toBe(201);

		const { pairing, claim } = await pairNativeClient();
		expect(pairing).toMatchObject({
			serverId: FIXTURE_NATIVE_SERVER_ID,
			code: "ABCDEFAB",
		});
		expect(claim).toMatchObject({
			serverId: FIXTURE_NATIVE_SERVER_ID,
			token: "fixture_native_client_token_0000000000000001",
			device: {
				id: "fixture-native-client-1",
				label: "Agent Device iPhone",
				lastUsedAt: null,
			},
		});
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.nativeClientPairingClaim}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: pairing.code, deviceLabel: "Replay" }),
				})
			).status,
		).toBe(400);

		const nativeHeaders = { [NATIVE_CLIENT_TOKEN_HEADER]: claim.token };
		const instanceResponse = await fetch(`${baseUrl}${API_ROUTES.instance}`, {
			headers: nativeHeaders,
		});
		expect(instanceResponse.status).toBe(200);
		const instance = (await instanceResponse.json()) as InstanceResponse;
		expect(instance).toMatchObject({
			service: "couchview",
			serverId: FIXTURE_NATIVE_SERVER_ID,
			instanceId: FIXTURE_NATIVE_INSTANCE_ID,
		});
		expect(
			(await fetch(`${baseUrl}${API_ROUTES.bootstrap}`, { headers: nativeHeaders })).status,
		).toBe(200);
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.settingsProfiles}`, {
					method: "POST",
					headers: { ...nativeHeaders, "content-type": "application/json" },
					body: JSON.stringify({ name: "Native profile" }),
				})
			).status,
		).toBe(201);
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.bootstrap}`, {
					headers: { [NATIVE_CLIENT_TOKEN_HEADER]: "y".repeat(43) },
				})
			).status,
		).toBe(401);
	});

	test("reset invalidates issued tokens and restores deterministic pairing state", async () => {
		const first = await pairNativeClient("Resettable iPad");
		const nativeHeaders = { [NATIVE_CLIENT_TOKEN_HEADER]: first.claim.token };
		expect(
			(await fetch(`${baseUrl}${API_ROUTES.instance}`, { headers: nativeHeaders })).status,
		).toBe(200);

		expect((await resetFixture()).status).toBe(200);
		expect(
			(await fetch(`${baseUrl}${API_ROUTES.instance}`, { headers: nativeHeaders })).status,
		).toBe(401);
		const devices = (await (await fetch(`${baseUrl}${API_ROUTES.nativeClients}`)).json()) as {
			devices: Array<{ id: string }>;
		};
		expect(devices.devices.map(({ id }) => id)).toEqual(["fixture-native-app"]);

		const second = await pairNativeClient("Repaired iPad");
		expect(second.pairing.code).toBe(first.pairing.code);
		expect(second.claim.token).toBe(first.claim.token);
		expect(second.claim.device.id).toBe(first.claim.device.id);
	});
});
