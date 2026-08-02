import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	API_ROUTES,
	type ApiErrorBody,
	type BootstrapResponse,
	type ChangesResponse,
	type CommitResponse,
	CSRF_HEADER,
	type PackageRunEvent,
	type PackageRunResponse,
	type PackageRunsResponse,
	type PackageScriptsResponse,
	REMOTE_BRIDGE_DEVICE_TOKEN_HEADER,
	REMOTE_BRIDGE_PROTOCOL,
	REMOTE_BRIDGE_TICKET_PREFIX,
	type RemoteBridgeProfile,
	type RemoteBridgeTicketResponse,
	type ServerEvent,
	type SettingsProfileResponse,
	type SettingsProfilesResponse,
	type StageFileResponse,
} from "../shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
} from "../shared/settings.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";
import type { CodexAppServerService } from "./codexAppServer.ts";
import type { CommitMessageGenerator } from "./commitMessage.ts";
import {
	type CouchviewApp,
	type CouchviewAppOptions,
	type CouchviewSocketData,
	createCouchviewApp,
} from "./server.ts";
import type { TerminalSessionService, TerminalSocketData } from "./terminalSessions.ts";

const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];

afterEach(async () => {
	for (const application of applications.splice(0)) application.close();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function fixture(
	revisionPollIntervalMs?: number,
	restart?: CouchviewAppOptions["restart"],
	commitMessages?: CommitMessageGenerator,
	codex?: CodexAppServerService,
	terminalSessions?: TerminalSessionService,
	remoteBridge?: CouchviewAppOptions["remoteBridge"],
) {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-"));
	temporaryDirectories.push(directory);
	expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
	expect(
		Bun.spawnSync(["git", "-C", directory, "config", "user.name", "Couchview Tests"]).exitCode,
	).toBe(0);
	expect(
		Bun.spawnSync(["git", "-C", directory, "config", "user.email", "couchview@example.invalid"])
			.exitCode,
	).toBe(0);
	await writeFile(path.join(directory, "sample.ts"), "const sample = true;\n", "utf8");
	const stateDirectory = await mkdtemp(path.join(tmpdir(), "couchview-server-state-"));
	temporaryDirectories.push(stateDirectory);
	const app = await createCouchviewApp({
		root: directory,
		host: "127.0.0.1",
		port: 3001,
		stateDatabasePath: path.join(stateDirectory, "state.sqlite"),
		revisionPollIntervalMs,
		restart,
		commitMessages,
		codex,
		terminalSessions,
		remoteBridge,
	});
	applications.push(app);
	return app;
}

function request(pathname: string, init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set("host", "127.0.0.1:3001");
	return new Request(`http://127.0.0.1:3001${pathname}`, { ...init, headers });
}

async function _repositoryFixture(fileName: string): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-repository-"));
	temporaryDirectories.push(directory);
	expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
	await writeFile(
		path.join(directory, fileName),
		`export const ${fileName.replace(/\W/g, "_")} = true;\n`,
	);
	return directory;
}

async function _nextSseEvent(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	expectedType: ServerEvent["type"],
): Promise<ServerEvent> {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		const remaining = deadline - Date.now();
		const result = await Promise.race([
			reader.read(),
			new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
		]);
		if (result === "timeout" || result.done) break;
		const text = new TextDecoder().decode(result.value);
		for (const line of text.split("\n")) {
			if (!line.startsWith("data: ")) continue;
			const event = JSON.parse(line.slice(6)) as ServerEvent;
			if (event.type === expectedType) return event;
		}
	}
	throw new Error(`Timed out waiting for ${expectedType} SSE event`);
}

async function nextPackageRunEvent(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<PackageRunEvent> {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		const result = await Promise.race([
			reader.read(),
			new Promise<"timeout">((resolve) =>
				setTimeout(() => resolve("timeout"), deadline - Date.now()),
			),
		]);
		if (result === "timeout" || result.done) break;
		const text = new TextDecoder().decode(result.value);
		for (const line of text.split("\n")) {
			if (line.startsWith("data: ")) {
				return JSON.parse(line.slice(6)) as PackageRunEvent;
			}
		}
	}
	throw new Error("Timed out waiting for package-run SSE event");
}

describe("Couchview HTTP security and routes", () => {
	test("serves protected profile CRUD with validation and optimistic revisions", async () => {
		const app = await fixture();
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		expect(bootstrap.settingsProfiles).toEqual([
			expect.objectContaining({
				id: DEFAULT_SETTINGS_PROFILE_ID,
				name: "Default",
				data: createDefaultSettingsProfileData(),
				revision: 1,
			}),
		]);
		const listed = (await (
			await app.fetch(request(API_ROUTES.settingsProfiles))
		).json()) as SettingsProfilesResponse;
		expect(listed.profiles).toEqual(bootstrap.settingsProfiles);

		const withoutCsrf = await app.fetch(
			request(API_ROUTES.settingsProfiles, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "Desk" }),
			}),
		);
		expect(withoutCsrf.status).toBe(403);
		const mutationHeaders = {
			"content-type": "application/json",
			origin: "http://127.0.0.1:3001",
			[CSRF_HEADER]: app.csrfToken,
		};
		const malformedCreate = await app.fetch(
			request(API_ROUTES.settingsProfiles, {
				method: "POST",
				headers: mutationHeaders,
				body: JSON.stringify({ name: "   " }),
			}),
		);
		expect(malformedCreate.status).toBe(400);

		const createdResponse = await app.fetch(
			request(API_ROUTES.settingsProfiles, {
				method: "POST",
				headers: mutationHeaders,
				body: JSON.stringify({
					name: "Desk",
					sourceProfileId: DEFAULT_SETTINGS_PROFILE_ID,
				}),
			}),
		);
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as SettingsProfileResponse;
		expect(created.profile).toMatchObject({ name: "Desk", revision: 1 });

		const duplicateName = await app.fetch(
			request(API_ROUTES.settingsProfiles, {
				method: "POST",
				headers: mutationHeaders,
				body: JSON.stringify({ name: "dEsK" }),
			}),
		);
		expect(duplicateName.status).toBe(409);
		expect((await duplicateName.json()) as ApiErrorBody).toMatchObject({
			error: { code: "settings_profile_name_conflict" },
		});

		const malformedUpdate = await app.fetch(
			request(API_ROUTES.settingsProfile(created.profile.id), {
				method: "PUT",
				headers: mutationHeaders,
				body: JSON.stringify({
					name: "Desk",
					data: { ...created.profile.data, typography: undefined },
					expectedRevision: 1,
				}),
			}),
		);
		expect(malformedUpdate.status).toBe(400);

		const changedData = structuredClone(created.profile.data);
		changedData.keyboard.layout = "dvorak";
		const updatedResponse = await app.fetch(
			request(API_ROUTES.settingsProfile(created.profile.id), {
				method: "PUT",
				headers: mutationHeaders,
				body: JSON.stringify({
					name: "Desk keyboard",
					data: changedData,
					expectedRevision: 1,
				}),
			}),
		);
		expect(updatedResponse.status).toBe(200);
		expect((await updatedResponse.json()) as SettingsProfileResponse).toMatchObject({
			profile: {
				name: "Desk keyboard",
				data: { keyboard: { layout: "dvorak" } },
				revision: 2,
			},
		});
		const stale = await app.fetch(
			request(API_ROUTES.settingsProfile(created.profile.id), {
				method: "PUT",
				headers: mutationHeaders,
				body: JSON.stringify({ name: "Old draft", data: changedData, expectedRevision: 1 }),
			}),
		);
		expect(stale.status).toBe(409);
		expect((await stale.json()) as ApiErrorBody).toMatchObject({
			error: { code: "stale_settings_profile" },
		});

		const deleteDefault = await app.fetch(
			request(API_ROUTES.settingsProfile(DEFAULT_SETTINGS_PROFILE_ID), {
				method: "DELETE",
				headers: mutationHeaders,
			}),
		);
		expect(deleteDefault.status).toBe(409);
		const deleted = await app.fetch(
			request(API_ROUTES.settingsProfile(created.profile.id), {
				method: "DELETE",
				headers: mutationHeaders,
			}),
		);
		expect(deleted.status).toBe(204);
		expect(
			(
				(await (
					await app.fetch(request(API_ROUTES.settingsProfiles))
				).json()) as SettingsProfilesResponse
			).profiles,
		).toHaveLength(1);
	});

	test("guards tmux APIs and upgrades only authenticated sockets", async () => {
		const attachmentCalls: Array<{
			repositoryId: string;
			repositoryRoot: string;
		}> = [];
		const endCalls: string[] = [];
		const leaseCalls: Array<{ repositoryId: string; clientId: string }> = [];
		let consumedUpgrade = false;
		let closed = false;
		const terminalSessions = {
			enabled: true,
			p2pEnabled: true,
			stunUrls: ["stun:stun.cloudflare.com:3478"],
			capability: {
				available: true,
				reason: null,
				persistence: "tmux",
				profiles: [{ id: "tmux", label: "tmux", available: true, reason: null }],
			},
			websocket: {},
			async status() {
				return { profileId: "tmux", running: true, controllerConnected: false };
			},
			async issueAttachment(
				repositoryId: string,
				repositoryRoot: string,
				_input: unknown,
				_binding: unknown,
			) {
				attachmentCalls.push({ repositoryId, repositoryRoot });
				return {
					ticket: "single-use-ticket",
					expiresAt: "2026-07-26T12:00:30.000Z",
					protocol: "couchview-terminal-v1",
					session: { profileId: "tmux", running: true, controllerConnected: false },
				};
			},
			async end(repositoryId: string) {
				endCalls.push(repositoryId);
				return { status: "ended" };
			},
			renewLease(repositoryId: string, input: { clientId: string }) {
				leaseCalls.push({ repositoryId, clientId: input.clientId });
				return { expiresAt: "2026-07-26T12:02:00.000Z" };
			},
			consumeUpgrade(
				repositoryId: string,
				_request: Request,
				_binding: unknown,
			): TerminalSocketData {
				consumedUpgrade = true;
				return {
					kind: "terminal",
					repositoryId,
					repositoryRoot: "/project",
					clientId: "client_12345678",
					profileId: "tmux",
					cols: 100,
					rows: 32,
					takeover: false,
					host: "127.0.0.1:3001",
					origin: "http://127.0.0.1:3001",
				};
			},
			close() {
				closed = true;
			},
		} as unknown as TerminalSessionService;
		const app = await fixture(undefined, undefined, undefined, undefined, terminalSessions);
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		expect(bootstrap.terminal).toMatchObject({ available: true, persistence: "tmux" });

		const attachmentBody = JSON.stringify({
			clientId: "client_12345678",
			profileId: "tmux",
			cols: 100,
			rows: 32,
			takeover: false,
		});
		const mutationHeaders = {
			"content-type": "application/json",
			origin: "http://127.0.0.1:3001",
			[CSRF_HEADER]: app.csrfToken,
		};

		const unprotected = await app.fetch(
			request(API_ROUTES.terminalAttachments(app.repository.id), {
				method: "POST",
				headers: { "content-type": "application/json", origin: "http://127.0.0.1:3001" },
				body: attachmentBody,
			}),
		);
		expect(unprotected.status).toBe(403);

		const attached = await app.fetch(
			request(API_ROUTES.terminalAttachments(app.repository.id), {
				method: "POST",
				headers: mutationHeaders,
				body: attachmentBody,
			}),
		);
		expect(attached.status).toBe(201);
		expect(attachmentCalls).toEqual([
			{
				repositoryId: app.repository.id,
				repositoryRoot: app.repository.root,
			},
		]);

		const leased = await app.fetch(
			request(API_ROUTES.terminalLease(app.repository.id), {
				method: "POST",
				headers: mutationHeaders,
				body: JSON.stringify({ clientId: "client_12345678" }),
			}),
		);
		expect(leased.status).toBe(200);
		expect(leaseCalls).toEqual([
			{
				repositoryId: app.repository.id,
				clientId: "client_12345678",
			},
		]);

		const ended = await app.fetch(
			request(API_ROUTES.terminalEnd(app.repository.id), {
				method: "POST",
				headers: mutationHeaders,
			}),
		);
		expect(ended.status).toBe(200);
		expect(endCalls).toEqual([app.repository.id]);

		let upgradedData: TerminalSocketData | null = null;
		let selectedProtocol: string | null = null;
		const fakeServer = {
			upgrade(_request: Request, options: { data: TerminalSocketData; headers: HeadersInit }) {
				upgradedData = options.data;
				selectedProtocol = new Headers(options.headers).get("sec-websocket-protocol");
				return true;
			},
		} as unknown as Bun.Server<TerminalSocketData>;
		const socketRequest = (origin = "http://127.0.0.1:3001") =>
			request(API_ROUTES.terminalSocket(app.repository.id), {
				headers: {
					origin,
					upgrade: "websocket",
					connection: "Upgrade",
					"sec-websocket-protocol": "couchview-terminal-v1, couchview-ticket.single-use-ticket",
				},
			});
		const missingOrigin = await app.fetchWithServer(
			request(API_ROUTES.terminalSocket(app.repository.id), {
				headers: { upgrade: "websocket" },
			}),
			fakeServer,
		);
		expect(missingOrigin?.status).toBe(403);
		const upgraded = await app.fetchWithServer(socketRequest(), fakeServer);
		expect(upgraded).toBeUndefined();
		expect(consumedUpgrade).toBe(true);
		expect(upgradedData).toMatchObject({ repositoryId: app.repository.id });
		expect(String(selectedProtocol)).toBe("couchview-terminal-v1");

		app.close();
		expect(closed).toBe(true);
		applications.splice(applications.indexOf(app), 1);
	});

	test("pairs, authenticates, upgrades, and revokes native IDE devices", async () => {
		const app = await fixture(undefined, undefined, undefined, undefined, undefined, {
			enabled: true,
			p2pEnabled: true,
			stunUrls: ["stun:stun.cloudflare.com:3478"],
		});
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		expect(bootstrap.remoteBridge).toMatchObject({
			available: true,
			p2pEnabled: true,
		});
		const route = API_ROUTES.remoteBridgePairings(app.repository.id);
		const unauthenticated = await app.fetch(
			request(route, {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3001",
					"content-type": "application/json",
				},
				body: JSON.stringify({ label: "MacBook Air" }),
			}),
		);
		expect(unauthenticated.status).toBe(403);

		const created = await app.fetch(
			request(route, {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
					"content-type": "application/json",
					"cf-access-jwt-assertion": "edge-verified-jwt",
				},
				body: JSON.stringify({ label: "MacBook Air" }),
			}),
		);
		expect(created.status).toBe(201);
		const pairing = (await created.json()) as { command: string; sshAlias: string };
		expect(pairing.command).toContain("--origin-access 'cloudflare-access'");
		const code = /--code '([^']+)'/.exec(pairing.command)?.[1];
		expect(code).toBeString();

		const claimed = await app.fetch(
			request(API_ROUTES.remoteBridgeClaim, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code }),
			}),
		);
		expect(claimed.status).toBe(201);
		const profile = (await claimed.json()) as RemoteBridgeProfile;
		expect(profile).toMatchObject({
			sshAlias: pairing.sshAlias,
			repositoryId: app.repository.id,
			originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
		});

		const listed = await app.fetch(request(route));
		expect(await listed.json()).toMatchObject({
			devices: [{ id: profile.deviceId, label: "MacBook Air" }],
		});
		const missingCredential = await app.fetch(
			request(API_ROUTES.remoteBridgeHostTickets, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ connectionId: "connection_123" }),
			}),
		);
		expect(missingCredential.status).toBe(403);
		const legacyCredential = await app.fetch(
			request(API_ROUTES.remoteBridgeTickets(app.repository.id), {
				method: "POST",
				headers: {
					authorization: `Bearer ${profile.deviceToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ connectionId: "connection_legacy" }),
			}),
		);
		expect(legacyCredential.status).toBe(201);
		const ticketResponse = await app.fetch(
			request(API_ROUTES.remoteBridgeHostTickets, {
				method: "POST",
				headers: {
					[REMOTE_BRIDGE_DEVICE_TOKEN_HEADER]: profile.deviceToken,
					"content-type": "application/json",
				},
				body: JSON.stringify({ connectionId: "connection_123" }),
			}),
		);
		expect(ticketResponse.status).toBe(201);
		const ticket = (await ticketResponse.json()) as RemoteBridgeTicketResponse;
		expect(ticket.webRtc?.iceServers).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);

		let upgradedData: CouchviewSocketData | null = null;
		let selectedProtocol: string | null = null;
		const fakeServer = {
			upgrade(_request: Request, options: { data: CouchviewSocketData; headers: HeadersInit }) {
				upgradedData = options.data;
				selectedProtocol = new Headers(options.headers).get("sec-websocket-protocol");
				return true;
			},
		} as unknown as Bun.Server<CouchviewSocketData>;
		const socketRequest = request(API_ROUTES.remoteBridgeHostSocket, {
			headers: {
				upgrade: "websocket",
				connection: "Upgrade",
				"sec-websocket-protocol": `${REMOTE_BRIDGE_PROTOCOL}, ${REMOTE_BRIDGE_TICKET_PREFIX}${ticket.ticket}`,
			},
		});
		expect(await app.fetchWithServer(socketRequest, fakeServer)).toBeUndefined();
		expect(upgradedData).toMatchObject({
			kind: "remote-bridge",
			deviceId: profile.deviceId,
			connectionId: "connection_123",
		});
		expect(String(selectedProtocol)).toBe(REMOTE_BRIDGE_PROTOCOL);
		const replay = await app.fetchWithServer(socketRequest, fakeServer);
		expect(replay?.status).toBe(403);

		const revoked = await app.fetch(
			request(API_ROUTES.remoteBridgePairing(app.repository.id, profile.deviceId), {
				method: "DELETE",
				headers: {
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
				},
			}),
		);
		expect(revoked.status).toBe(204);
		expect(await (await app.fetch(request(route))).json()).toEqual({ devices: [] });
	});

	test("embeds a configured tunnel-neutral origin-access provider in pairings", async () => {
		const app = await fixture(undefined, undefined, undefined, undefined, undefined, {
			enabled: true,
			originAccess: "private-relay",
		});
		const route = API_ROUTES.remoteBridgePairings(app.repository.id);
		const created = await app.fetch(
			request(route, {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
					"content-type": "application/json",
				},
				body: JSON.stringify({ label: "MacBook Air" }),
			}),
		);
		const pairing = (await created.json()) as { command: string };
		expect(pairing.command).toContain("--origin-access 'private-relay'");
		const code = /--code '([^']+)'/.exec(pairing.command)?.[1];
		const claimed = await app.fetch(
			request(API_ROUTES.remoteBridgeClaim, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code }),
			}),
		);
		expect(await claimed.json()).toMatchObject({ originAccess: "private-relay" });
		expect(app.remoteBridgeOriginAccess).toBe("private-relay");
	});

	test("exposes project-scoped Codex threads and sends only current comments", async () => {
		let activeRoot = "";
		let prompt = "";
		const capability = { available: true, reason: null };
		const summary = (id: string, cwd: string, status: "idle" | "active" = "idle") => ({
			id,
			preview: id,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:01:00.000Z",
			recencyAt: "2026-01-01T00:01:00.000Z",
			modelProvider: "fake",
			status,
			cwd,
		});
		const codex = {
			capability,
			capabilityFor() {
				return capability;
			},
			async listThreads(root: string) {
				activeRoot = root;
				return { threads: [summary("project-thread", root)], nextCursor: "older" };
			},
			async startThread(root: string) {
				return summary("new-thread", root);
			},
			async readThread(threadId: string) {
				if (threadId === "active-thread") return summary(threadId, activeRoot, "active");
				return summary(threadId, threadId === "cross-project" ? "/another/project" : activeRoot);
			},
			async resumeThread(threadId: string) {
				return summary(threadId, activeRoot);
			},
			async startTurn(threadId: string, value: string) {
				prompt = value;
				return { threadId, turnId: "turn-1", status: "started" as const };
			},
			async interruptTurn() {},
			events() {
				return { events: [], unsubscribe() {} };
			},
			async respondApproval() {},
			close() {},
		} as unknown as CouchviewAppOptions["codex"];
		const app = await fixture(undefined, undefined, undefined, codex);

		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		expect(bootstrap.codex).toEqual({ available: true, reason: null });
		const threadsResponse = await app.fetch(request(API_ROUTES.codexThreads(app.repository.id)));
		expect(threadsResponse.status).toBe(200);
		expect(await threadsResponse.json()).toMatchObject({
			threads: [{ id: "project-thread" }],
			nextCursor: "older",
		});

		const createWithoutCsrf = await app.fetch(
			request(API_ROUTES.codexThreads(app.repository.id), {
				method: "POST",
				headers: { origin: "http://127.0.0.1:3001", "content-type": "application/json" },
				body: "{}",
			}),
		);
		expect(createWithoutCsrf.status).toBe(403);
		const created = await app.fetch(
			request(API_ROUTES.codexThreads(app.repository.id), {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3001",
					"content-type": "application/json",
					[CSRF_HEADER]: app.csrfToken,
				},
				body: "{}",
			}),
		);
		expect(created.status).toBe(201);

		const crossProject = await app.fetch(
			request(API_ROUTES.codexThread(app.repository.id, "cross-project")),
		);
		expect(crossProject.status).toBe(404);
		const activeSend = await app.fetch(
			request(API_ROUTES.codexThreadTurns(app.repository.id, "active-thread"), {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
					"content-type": "application/json",
				},
				body: "{}",
			}),
		);
		expect(activeSend.status).toBe(409);
		expect((await activeSend.json()) as ApiErrorBody).toMatchObject({
			error: { code: "codex_thread_in_use" },
		});
		const emptySend = await app.fetch(
			request(API_ROUTES.codexThreadTurns(app.repository.id, "project-thread"), {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
					"content-type": "application/json",
				},
				body: "{}",
			}),
		);
		expect(emptySend.status).toBe(409);
		expect((await emptySend.json()) as ApiErrorBody).toMatchObject({
			error: { code: "codex_no_comments" },
		});

		const firstChanges = await app.repository.changes();
		const firstFile = firstChanges.files[0]!;
		const firstDiff = await app.repository.diff(firstFile.id);
		await app.repository.createComment({
			fileId: firstFile.id,
			contentRevision: firstFile.contentRevision,
			side: "new",
			startLine: 1,
			endLine: 1,
			hunkHeader: firstDiff.diff.hunks[0]?.header ?? "",
			excerpt: ["stale"],
			body: "stale comment",
		});
		await writeFile(path.join(app.repository.root, "sample.ts"), "const sample = false;\n", "utf8");
		const secondChanges = await app.repository.changes();
		const secondFile = secondChanges.files[0]!;
		const secondDiff = await app.repository.diff(secondFile.id);
		await app.repository.createComment({
			fileId: secondFile.id,
			contentRevision: secondFile.contentRevision,
			side: "new",
			startLine: 1,
			endLine: 1,
			hunkHeader: secondDiff.diff.hunks[0]?.header ?? "",
			excerpt: ["current"],
			body: "current comment",
		});
		const sent = await app.fetch(
			request(API_ROUTES.codexThreadTurns(app.repository.id, "project-thread"), {
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
					"content-type": "application/json",
				},
				body: "{}",
			}),
		);
		expect(sent.status).toBe(202);
		expect(prompt).toContain("current comment");
		expect(prompt).not.toContain("stale comment");
	});

	test("discovers and runs package scripts through protected repository routes", async () => {
		const app = await fixture();
		await writeFile(
			path.join(app.repository.root, "package.json"),
			JSON.stringify({
				scripts: {
					verify: "printf 'server-route-output'",
					dev: "sleep 30",
				},
			}),
		);

		const scriptsResponse = await app.fetch(request(API_ROUTES.packageScripts(app.repository.id)));
		expect(scriptsResponse.status).toBe(200);
		const scripts = (await scriptsResponse.json()) as PackageScriptsResponse;
		expect(scripts.packages).toHaveLength(1);
		expect(scripts.packages[0]).toMatchObject({
			packagePath: "package.json",
			directory: ".",
			runner: "bun",
		});
		const packageEntry = scripts.packages[0]!;
		const startBody = JSON.stringify({
			packagePath: packageEntry.packagePath,
			scriptName: "verify",
			manifestRevision: packageEntry.manifestRevision,
		});

		const unprotected = await app.fetch(
			request(API_ROUTES.packageRuns(app.repository.id), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: startBody,
			}),
		);
		expect(unprotected.status).toBe(403);

		const startedResponse = await app.fetch(
			request(API_ROUTES.packageRuns(app.repository.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
				},
				body: startBody,
			}),
		);
		expect(startedResponse.status).toBe(201);
		const started = (await startedResponse.json()) as PackageRunResponse;
		await Bun.sleep(80);

		const eventsResponse = await app.fetch(
			request(API_ROUTES.packageRunEvents(app.repository.id, started.run.id)),
		);
		expect(eventsResponse.status).toBe(200);
		const reader = eventsResponse.body!.getReader();
		const event = await nextPackageRunEvent(reader);
		expect(event.type).toBe("snapshot");
		if (event.type !== "snapshot") throw new Error("Package snapshot missing");
		expect(
			event.snapshot.run,
			event.snapshot.output.map((chunk) => chunk.text).join(""),
		).toMatchObject({
			id: started.run.id,
			status: "succeeded",
			exitCode: 0,
		});
		expect(event.snapshot.output.map((chunk) => chunk.text).join("")).toContain(
			"server-route-output",
		);
		await reader.cancel();

		const runs = (await (
			await app.fetch(request(API_ROUTES.packageRuns(app.repository.id)))
		).json()) as PackageRunsResponse;
		expect(runs.runs.map((run) => run.id)).toContain(started.run.id);

		const longRunResponse = await app.fetch(
			request(API_ROUTES.packageRuns(app.repository.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
				},
				body: JSON.stringify({
					packagePath: packageEntry.packagePath,
					scriptName: "dev",
					manifestRevision: packageEntry.manifestRevision,
				}),
			}),
		);
		const longRun = (await longRunResponse.json()) as PackageRunResponse;
		const stop = async () =>
			app.fetch(
				request(API_ROUTES.packageRunStop(app.repository.id, longRun.run.id), {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://127.0.0.1:3001",
						[CSRF_HEADER]: app.csrfToken,
					},
					body: "{}",
				}),
			);
		expect(((await (await stop()).json()) as PackageRunResponse).run.status).toBe("stopping");
		expect(((await (await stop()).json()) as PackageRunResponse).run.status).toMatch(
			/stopping|stopped/,
		);
	});

	test("bootstraps, rejects foreign origins, and protects staging and committing", async () => {
		const app = await fixture();
		const bootstrapResponse = await app.fetch(request(API_ROUTES.bootstrap));
		expect(bootstrapResponse.status).toBe(200);
		const bootstrap = (await bootstrapResponse.json()) as BootstrapResponse;
		expect(bootstrap.csrfToken).toHaveLength(43);
		expect(bootstrap.restart).toEqual({
			available: false,
			reason: "Restart is unavailable for this Couchview process.",
		});
		const unavailableRestart = await app.fetch(
			request(API_ROUTES.restart, {
				method: "POST",
				headers: {
					[CSRF_HEADER]: bootstrap.csrfToken,
					origin: "http://127.0.0.1:3001",
				},
			}),
		);
		expect(unavailableRestart.status).toBe(409);
		expect((await unavailableRestart.json()) as ApiErrorBody).toMatchObject({
			error: { code: "restart_unavailable" },
		});

		const changes = (await (
			await app.fetch(request(API_ROUTES.files(app.repository.id)))
		).json()) as ChangesResponse;
		const file = changes.files.find((candidate) => candidate.path === "sample.ts");
		if (!file) throw new Error("fixture file missing");
		const body = JSON.stringify({
			fileId: file.id,
			operationRevision: changes.operationRevision,
			contentRevision: file.contentRevision,
		});

		const withoutToken = await app.fetch(
			request(API_ROUTES.fileStage(app.repository.id, file.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
				},
				body,
			}),
		);
		expect(withoutToken.status).toBe(403);

		const foreign = await app.fetch(
			request(API_ROUTES.files(app.repository.id), {
				headers: { origin: "https://attacker.example" },
			}),
		);
		expect(foreign.status).toBe(403);

		const staged = await app.fetch(
			request(API_ROUTES.fileStage(app.repository.id, file.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[CSRF_HEADER]: bootstrap.csrfToken,
					origin: "http://127.0.0.1:3001",
				},
				body,
			}),
		);
		expect(staged.status).toBe(200);
		expect(staged.headers.has("access-control-allow-origin")).toBe(false);
		const stagedState = (await staged.json()) as StageFileResponse;
		if (!stagedState.file) throw new Error("staged fixture disappeared");
		expect(stagedState.changes).toEqual({
			upserted: [stagedState.file],
			removedFileIds: [],
			orderedFileIds: [stagedState.file.id],
		});

		const committed = await app.fetch(
			request(API_ROUTES.commit(app.repository.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[CSRF_HEADER]: bootstrap.csrfToken,
					origin: "http://127.0.0.1:3001",
				},
				body: JSON.stringify({
					message: "Commit from Couchview",
					operationRevision: stagedState.operationRevision,
				}),
			}),
		);
		expect(committed.status).toBe(201);
		const commit = (await committed.json()) as CommitResponse;
		expect(commit.commit).toMatch(/^[0-9a-f]{40}$/);
		expect((await app.repository.changes()).files).toHaveLength(0);
	});

	test("returns from Access sign-in through an uncached safe redirect", async () => {
		const app = await fixture();
		const refresh = await app.fetch(
			request(`${API_ROUTES.accessRefresh}?repo=${encodeURIComponent(app.repository.id)}`),
		);
		expect(refresh.status).toBe(302);
		expect(refresh.headers.get("location")).toBe(
			`/?repo=${encodeURIComponent(app.repository.id)}&access_refresh=1`,
		);
		expect(refresh.headers.get("cache-control")).toBe("no-store");
		expect(refresh.headers.get("content-security-policy")).toContain("default-src 'self'");

		const defaultRefresh = await app.fetch(request(API_ROUTES.accessRefresh));
		expect(defaultRefresh.status).toBe(302);
		expect(defaultRefresh.headers.get("location")).toBe("/?access_refresh=1");

		const logout = await app.fetch(request(API_ROUTES.accessLogout));
		expect(logout.status).toBe(302);
		expect(logout.headers.get("location")).toBe("/cdn-cgi/access/logout");
		expect(logout.headers.get("cache-control")).toBe("no-store");
	});
});
