import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	API_ROUTES,
	CSRF_HEADER,
	type InstanceResponse,
	NATIVE_CLIENT_TOKEN_HEADER,
	type NativeClientClaimResponse,
	type NativeClientPairingResponse,
} from "../shared/contracts.ts";
import { type CouchviewApp, type CouchviewSocketData, createCouchviewApp } from "./server.ts";

const temporaryDirectories: string[] = [];
let application: CouchviewApp | null = null;
let server: Bun.Server<CouchviewSocketData> | null = null;

afterEach(async () => {
	server?.stop(true);
	server = null;
	application?.close();
	application = null;
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function startFixture(): Promise<{ app: CouchviewApp; baseUrl: string }> {
	const repository = await mkdtemp(path.join(tmpdir(), "couchview-native-http-repo-"));
	const stateDirectory = await mkdtemp(path.join(tmpdir(), "couchview-native-http-state-"));
	temporaryDirectories.push(repository, stateDirectory);
	expect(Bun.spawnSync(["git", "init", "-q", repository]).exitCode).toBe(0);
	await writeFile(path.join(repository, "sample.ts"), "export const sample = true;\n");

	const reservation = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 503 }) });
	const port = reservation.port;
	reservation.stop(true);
	const app = await createCouchviewApp({
		root: repository,
		host: "127.0.0.1",
		port,
		stateDatabasePath: path.join(stateDirectory, "state.sqlite"),
	});
	application = app;
	server = Bun.serve<CouchviewSocketData>({
		hostname: "127.0.0.1",
		port,
		fetch: (request, bunServer) => app.fetchWithServer(request, bunServer),
		websocket: app.websocket,
	});
	return { app, baseUrl: `http://127.0.0.1:${port}` };
}

describe("native client HTTP authority", () => {
	test("pairs once, authenticates streams and mutations, preserves CSRF, and revokes", async () => {
		const { app, baseUrl } = await startFixture();
		const bootstrapResponse = await fetch(`${baseUrl}${API_ROUTES.bootstrap}`);
		const bootstrap = (await bootstrapResponse.json()) as { csrfToken: string };
		const pairingResponse = await fetch(`${baseUrl}${API_ROUTES.nativeClientPairings}`, {
			method: "POST",
			headers: { origin: baseUrl, [CSRF_HEADER]: bootstrap.csrfToken },
		});
		expect(pairingResponse.status).toBe(201);
		const pairing = (await pairingResponse.json()) as NativeClientPairingResponse;

		const claimResponse = await fetch(`${baseUrl}${API_ROUTES.nativeClientPairingClaim}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: pairing.code, deviceLabel: "Travel iPad" }),
		});
		expect(claimResponse.status).toBe(201);
		const claim = (await claimResponse.json()) as NativeClientClaimResponse;
		expect(claim.serverId).toBe(pairing.serverId);
		expect(
			await fetch(`${baseUrl}${API_ROUTES.nativeClientPairingClaim}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: pairing.code, deviceLabel: "Replay" }),
			}),
		).toMatchObject({ status: 400 });

		const nativeHeaders = { [NATIVE_CLIENT_TOKEN_HEADER]: claim.token };
		const instance = (await (
			await fetch(`${baseUrl}${API_ROUTES.instance}`, { headers: nativeHeaders })
		).json()) as InstanceResponse;
		expect(instance).toMatchObject({ serverId: pairing.serverId, instanceId: app.instanceId });
		const profileMutation = await fetch(`${baseUrl}${API_ROUTES.settingsProfiles}`, {
			method: "POST",
			headers: { ...nativeHeaders, "content-type": "application/json" },
			body: JSON.stringify({ name: "Native profile" }),
		});
		expect(profileMutation.status).toBe(201);
		expect(
			await fetch(`${baseUrl}${API_ROUTES.settingsProfiles}`, {
				method: "POST",
				headers: { origin: baseUrl, "content-type": "application/json" },
				body: JSON.stringify({ name: "Missing CSRF" }),
			}),
		).toMatchObject({ status: 403 });
		expect(
			await fetch(`${baseUrl}${API_ROUTES.bootstrap}`, {
				headers: { [NATIVE_CLIENT_TOKEN_HEADER]: "x".repeat(43) },
			}),
		).toMatchObject({ status: 401 });

		const streamController = new AbortController();
		const stream = await fetch(`${baseUrl}${API_ROUTES.events(app.repository.id)}`, {
			headers: nativeHeaders,
			signal: streamController.signal,
		});
		expect(stream.status).toBe(200);
		const firstChunk = await stream.body?.getReader().read();
		expect(new TextDecoder().decode(firstChunk?.value)).toContain('"type":"ready"');
		streamController.abort();

		const revoked = await fetch(`${baseUrl}${API_ROUTES.nativeClient(claim.device.id)}`, {
			method: "DELETE",
			headers: { origin: baseUrl, [CSRF_HEADER]: bootstrap.csrfToken },
		});
		expect(revoked.status).toBe(204);
		expect(
			await fetch(`${baseUrl}${API_ROUTES.instance}`, { headers: nativeHeaders }),
		).toMatchObject({ status: 401 });
	});
});
