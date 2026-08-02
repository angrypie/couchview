import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	API_ROUTES,
	type ApiErrorBody,
	type BootstrapResponse,
	type ChangesResponse,
	CSRF_HEADER,
	type GenerateCommitMessageResponse,
	type PackageRunEvent,
	type RegisterRepositoryResponse,
	type RepositoryCatalogResponse,
	type ReviewStateResponse,
	type ServerEvent,
	type StageFilesResponse,
} from "../shared/contracts.ts";
import type { CodexAppServerService } from "./codexAppServer.ts";
import type { CommitMessageGenerator } from "./commitMessage.ts";
import { GitCommandError } from "./git.ts";
import {
	accessOriginsForHost,
	type CouchviewApp,
	type CouchviewAppOptions,
	createCouchviewApp,
} from "./server.ts";
import type { TerminalSessionService } from "./terminalSessions.ts";

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

async function repositoryFixture(fileName: string): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-repository-"));
	temporaryDirectories.push(directory);
	expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
	await writeFile(
		path.join(directory, fileName),
		`export const ${fileName.replace(/\W/g, "_")} = true;\n`,
	);
	return directory;
}

async function nextSseEvent(
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

async function _nextPackageRunEvent(
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

describe("Couchview HTTP advanced routes", () => {
	test("generates a protected staged-only commit message and rejects stale output", async () => {
		const contexts: string[] = [];
		let mutateDuringGeneration = false;
		let app!: CouchviewApp;
		const commitMessages: CommitMessageGenerator = {
			capability: { available: true, reason: null },
			async generate(context) {
				contexts.push(context);
				if (mutateDuringGeneration) {
					await writeFile(
						path.join(app.repository.root, "sample.ts"),
						'const sample = "changed while generating";\n',
					);
				}
				return "feat(review): generate commit messages";
			},
			close() {},
		};
		app = await fixture(undefined, undefined, commitMessages);
		await writeFile(
			path.join(app.repository.root, "unstaged.txt"),
			"not part of the staged context\n",
		);
		expect(
			Bun.spawnSync(["git", "-C", app.repository.root, "add", "--", "sample.ts"]).exitCode,
		).toBe(0);
		const changes = await app.repository.changes();
		const requestBody = JSON.stringify({
			operationRevision: changes.operationRevision,
		});

		const unprotected = await app.fetch(
			request(API_ROUTES.commitMessage(app.repository.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
				},
				body: requestBody,
			}),
		);
		expect(unprotected.status).toBe(403);
		expect(contexts).toHaveLength(0);

		const generated = await app.fetch(
			request(API_ROUTES.commitMessage(app.repository.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[CSRF_HEADER]: app.csrfToken,
					origin: "http://127.0.0.1:3001",
				},
				body: requestBody,
			}),
		);
		expect(generated.status).toBe(200);
		expect((await generated.json()) as GenerateCommitMessageResponse).toEqual({
			message: "feat(review): generate commit messages",
			operationRevision: changes.operationRevision,
		});
		expect(contexts[0]).toContain('"path":"sample.ts"');
		expect(contexts[0]).toContain("+const sample = true;");
		expect(contexts[0]).not.toContain("not part of the staged context");

		mutateDuringGeneration = true;
		const stale = await app.fetch(
			request(API_ROUTES.commitMessage(app.repository.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[CSRF_HEADER]: app.csrfToken,
					origin: "http://127.0.0.1:3001",
				},
				body: requestBody,
			}),
		);
		expect(stale.status).toBe(409);
		expect((await stale.json()) as ApiErrorBody).toMatchObject({
			error: { code: "operation_changed" },
		});
	});

	test("reports and secures the rebuild-and-restart action", async () => {
		let restartRequests = 0;
		const app = await fixture(undefined, {
			available: true,
			reason: null,
			request: async () => {
				restartRequests += 1;
			},
		});
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		expect(bootstrap.restart).toEqual({ available: true, reason: null });

		const rejected = await app.fetch(
			request(API_ROUTES.restart, {
				method: "POST",
				headers: { origin: "http://127.0.0.1:3001" },
			}),
		);
		expect(rejected.status).toBe(403);
		expect(restartRequests).toBe(0);

		const rejectedControl = await app.fetch(request(API_ROUTES.controlRestart, { method: "POST" }));
		expect(rejectedControl.status).toBe(403);
		expect((await rejectedControl.json()) as ApiErrorBody).toMatchObject({
			error: { code: "control_token_failed" },
		});
		expect(restartRequests).toBe(0);

		const acceptedControl = await app.fetch(
			request(API_ROUTES.controlRestart, {
				method: "POST",
				headers: { authorization: `Bearer ${app.controlToken}` },
			}),
		);
		expect(acceptedControl.status).toBe(202);
		expect(await acceptedControl.json()).toEqual({
			status: "restarting",
			previousInstanceId: app.instanceId,
		});
		expect(restartRequests).toBe(1);

		const accepted = await app.fetch(
			request(API_ROUTES.restart, {
				method: "POST",
				headers: {
					[CSRF_HEADER]: bootstrap.csrfToken,
					origin: "http://127.0.0.1:3001",
				},
			}),
		);
		expect(accepted.status).toBe(202);
		expect(await accepted.json()).toEqual({
			status: "restarting",
			previousInstanceId: app.instanceId,
		});
		expect(restartRequests).toBe(2);
	});

	test("bulk stages an exact validated set of files", async () => {
		const app = await fixture();
		await writeFile(path.join(app.repository.root, "second.ts"), "const second = true;\n", "utf8");
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		const changes = (await (
			await app.fetch(request(API_ROUTES.files(app.repository.id)))
		).json()) as ChangesResponse;
		expect(changes.files).toHaveLength(2);
		const headers = {
			"content-type": "application/json",
			[CSRF_HEADER]: bootstrap.csrfToken,
			origin: "http://127.0.0.1:3001",
		};

		const duplicate = await app.fetch(
			request(API_ROUTES.fileStages(app.repository.id), {
				method: "POST",
				headers,
				body: JSON.stringify({
					files: [
						{
							fileId: changes.files[0]!.id,
							contentRevision: changes.files[0]!.contentRevision,
						},
						{
							fileId: changes.files[0]!.id,
							contentRevision: changes.files[0]!.contentRevision,
						},
					],
					operationRevision: changes.operationRevision,
				}),
			}),
		);
		expect(duplicate.status).toBe(400);

		const staged = await app.fetch(
			request(API_ROUTES.fileStages(app.repository.id), {
				method: "POST",
				headers,
				body: JSON.stringify({
					files: changes.files.map((file) => ({
						fileId: file.id,
						contentRevision: file.contentRevision,
					})),
					operationRevision: changes.operationRevision,
				}),
			}),
		);
		expect(staged.status).toBe(200);
		const result = (await staged.json()) as StageFilesResponse;
		expect(result.files).toHaveLength(2);
		expect(result.files.every((file) => file.staged && !file.unstaged)).toBe(true);
		expect(result.changes.upserted).toHaveLength(2);
	});

	test("rejects missing origins and malformed mutation bodies with structured errors", async () => {
		const app = await fixture();
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		const changes = (await (
			await app.fetch(request(API_ROUTES.files(app.repository.id)))
		).json()) as ChangesResponse;
		const file = changes.files[0];
		if (!file) throw new Error("fixture file missing");
		const baseHeaders = {
			"content-type": "application/json",
			[CSRF_HEADER]: bootstrap.csrfToken,
		};

		const missingOrigin = await app.fetch(
			request(API_ROUTES.fileReview(app.repository.id, file.id), {
				method: "PUT",
				headers: baseHeaders,
				body: JSON.stringify({
					fileId: file.id,
					contentRevision: file.contentRevision,
					reviewed: true,
				}),
			}),
		);
		expect(missingOrigin.status).toBe(403);

		const nullBody = await app.fetch(
			request(API_ROUTES.fileReview(app.repository.id, file.id), {
				method: "PUT",
				headers: { ...baseHeaders, origin: "http://127.0.0.1:3001" },
				body: "null",
			}),
		);
		expect(nullBody.status).toBe(400);
		expect(await nullBody.json()).toEqual({
			error: { code: "invalid_request", message: "Request body must be a JSON object" },
		});

		const wrongBoolean = await app.fetch(
			request(API_ROUTES.fileReview(app.repository.id, file.id), {
				method: "PUT",
				headers: { ...baseHeaders, origin: "http://127.0.0.1:3001" },
				body: JSON.stringify({
					fileId: file.id,
					contentRevision: file.contentRevision,
					reviewed: "false",
				}),
			}),
		);
		expect(wrongBoolean.status).toBe(400);

		const malformedStage = await app.fetch(
			request(API_ROUTES.fileStage(app.repository.id, file.id), {
				method: "POST",
				headers: { ...baseHeaders, origin: "http://127.0.0.1:3001" },
				body: JSON.stringify({
					fileId: file.id,
					operationRevision: 42,
					contentRevision: file.contentRevision,
				}),
			}),
		);
		expect(malformedStage.status).toBe(400);

		const misleadingContentType = await app.fetch(
			request(API_ROUTES.fileReview(app.repository.id, file.id), {
				method: "PUT",
				headers: {
					...baseHeaders,
					origin: "http://127.0.0.1:3001",
					"content-type": "application/jsonish",
				},
				body: JSON.stringify({
					fileId: file.id,
					contentRevision: file.contentRevision,
					reviewed: true,
				}),
			}),
		);
		expect(misleadingContentType.status).toBe(415);

		const preflight = await app.fetch(
			request(API_ROUTES.fileStage(app.repository.id, file.id), {
				method: "OPTIONS",
				headers: { origin: "http://127.0.0.1:3001" },
			}),
		);
		expect(preflight.status).toBe(404);
		expect(preflight.headers.has("access-control-allow-origin")).toBe(false);
	});

	test("returns actionable Git diagnostics for command failures and timeouts", async () => {
		const app = await fixture();
		const backend = app.repository as unknown as {
			changes: typeof app.repository.changes;
		};
		const originalChanges = app.repository.changes.bind(app.repository);
		const originalConsoleError = console.error;
		console.error = () => undefined;
		try {
			backend.changes = async () => {
				throw new GitCommandError(["diff", "--", "sample.ts"], 128, "fatal: bad object HEAD");
			};
			const failed = await app.fetch(request(API_ROUTES.files(app.repository.id)));
			const failedBody = (await failed.json()) as ApiErrorBody;
			expect(failed.status).toBe(500);
			expect(failedBody.error.message).toContain("fatal: bad object HEAD");
			expect(failedBody.error.diagnostic).toMatchObject({
				source: "git",
				operation: "diff",
				kind: "exit",
				exitCode: 128,
				stderr: "fatal: bad object HEAD",
				retryable: false,
			});
			expect(failed.headers.get("x-couchview-diagnostic")).toBe(
				failedBody.error.diagnostic?.id ?? null,
			);

			backend.changes = async () => {
				throw new GitCommandError(["diff"], -1, "", "timeout", 15_000);
			};
			const timedOut = await app.fetch(request(API_ROUTES.files(app.repository.id)));
			const timedOutBody = (await timedOut.json()) as ApiErrorBody;
			expect(timedOut.status).toBe(504);
			expect(timedOutBody.error).toMatchObject({
				code: "git_timeout",
				message: "Git diff stopped responding after 15 seconds",
				diagnostic: {
					operation: "diff",
					kind: "timeout",
					retryable: true,
					timeoutMs: 15_000,
				},
			});
		} finally {
			backend.changes = originalChanges;
			console.error = originalConsoleError;
		}
	});

	test("rejects traversal, forged hosts, mismatched paths, and oversized bodies", async () => {
		const app = await fixture();
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		const changes = (await (
			await app.fetch(request(API_ROUTES.files(app.repository.id)))
		).json()) as ChangesResponse;
		const file = changes.files[0];
		if (!file) throw new Error("fixture file missing");

		const diff = await app.fetch(request(API_ROUTES.fileDiff(app.repository.id, file.id)));
		expect(diff.status).toBe(200);

		const traversal = await app.fetch(
			request(
				`${API_ROUTES.source(app.repository.id)}?path=${encodeURIComponent("../secret")}&line=1`,
			),
		);
		expect(traversal.status).toBe(400);

		const forgedHost = await app.fetch(
			new Request("http://attacker.invalid/api/files", {
				headers: { host: "attacker.invalid" },
			}),
		);
		expect(forgedHost.status).toBe(403);

		const mismatched = await app.fetch(
			request(API_ROUTES.fileStage(app.repository.id, file.id), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: bootstrap.csrfToken,
				},
				body: JSON.stringify({
					fileId: "another-file",
					operationRevision: changes.operationRevision,
					contentRevision: file.contentRevision,
				}),
			}),
		);
		expect(mismatched.status).toBe(400);

		const oversized = await app.fetch(
			request(API_ROUTES.fileReview(app.repository.id, file.id), {
				method: "PUT",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: bootstrap.csrfToken,
				},
				body: JSON.stringify({ payload: "x".repeat(70 * 1024) }),
			}),
		);
		expect(oversized.status).toBe(413);

		const malformedOrigin = await app.fetch(
			request(API_ROUTES.files(app.repository.id), { headers: { origin: "not a URL" } }),
		);
		expect(malformedOrigin.status).toBe(403);
	});

	test("streams default SSE message events", async () => {
		const app = await fixture();
		const response = await app.fetch(request(API_ROUTES.events(app.repository.id)));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const reader = response.body?.getReader();
		if (!reader) throw new Error("SSE body missing");
		const first = await reader.read();
		const payload = new TextDecoder().decode(first.value);
		expect(payload.startsWith("data: ")).toBe(true);
		expect(payload).toContain('"type":"ready"');
		await reader.cancel();
	});

	test("keeps the API namespace structured and accepts exact configured LAN hosts", async () => {
		const app = await fixture();
		const apiRoot = await app.fetch(request("/api"));
		expect(apiRoot.status).toBe(404);
		expect(await apiRoot.json()).toEqual({
			error: { code: "route_not_found", message: "API route not found" },
		});

		const lanApp = await createCouchviewApp({
			root: app.repository.root,
			host: "192.0.2.25",
			port: 3001,
			stateDatabasePath: await (async () => {
				const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-state-"));
				temporaryDirectories.push(directory);
				return path.join(directory, "state.sqlite");
			})(),
		});
		applications.push(lanApp);
		const accepted = await lanApp.fetch(
			new Request("http://192.0.2.25:3001/api/bootstrap", {
				headers: { host: "192.0.2.25:3001", origin: "http://192.0.2.25:3001" },
			}),
		);
		expect(accepted.status).toBe(200);
		const alias = await lanApp.fetch(
			new Request("http://phone-alias.local:3001/api/bootstrap", {
				headers: { host: "phone-alias.local:3001" },
			}),
		);
		expect(alias.status).toBe(403);
	});

	test("registers, isolates, lists, and forgets repositories through secured routes", async () => {
		const app = await fixture();
		const secondRoot = await repositoryFixture("sample.ts");

		const instance = await app.fetch(request(API_ROUTES.instance));
		expect(instance.status).toBe(200);
		expect(await instance.json()).toMatchObject({
			service: "couchview",
			protocolVersion: 5,
			instanceId: app.instanceId,
			bindHost: "127.0.0.1",
			port: 3001,
		});

		const rejected = await app.fetch(
			request(API_ROUTES.controlRepositories, {
				method: "POST",
				headers: {
					authorization: "Bearer wrong-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({ root: secondRoot }),
			}),
		);
		expect(rejected.status).toBe(403);

		const registeredResponse = await app.fetch(
			request(API_ROUTES.controlRepositories, {
				method: "POST",
				headers: {
					authorization: `Bearer ${app.controlToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ root: secondRoot }),
			}),
		);
		expect(registeredResponse.status).toBe(201);
		const registered = (await registeredResponse.json()) as RegisterRepositoryResponse;
		expect(registered.added).toBe(true);

		const nested = path.join(secondRoot, "nested");
		await mkdir(nested);
		const duplicateResponse = await app.fetch(
			request(API_ROUTES.controlRepositories, {
				method: "POST",
				headers: {
					authorization: `Bearer ${app.controlToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ root: nested }),
			}),
		);
		expect(duplicateResponse.status).toBe(200);
		expect((await duplicateResponse.json()) as RegisterRepositoryResponse).toMatchObject({
			added: false,
			repository: { id: registered.repository.id },
		});

		const catalog = (await (
			await app.fetch(request(API_ROUTES.repositories))
		).json()) as RepositoryCatalogResponse;
		expect(catalog.repositories).toHaveLength(2);

		const firstChanges = (await (
			await app.fetch(request(API_ROUTES.files(app.repository.id)))
		).json()) as ChangesResponse;
		const secondChanges = (await (
			await app.fetch(request(API_ROUTES.files(registered.repository.id)))
		).json()) as ChangesResponse;
		expect(firstChanges.repository.id).not.toBe(secondChanges.repository.id);
		expect(secondChanges.files.map((file) => file.path)).toEqual(["sample.ts"]);
		const firstFile = firstChanges.files[0];
		if (!firstFile) throw new Error("first repository fixture missing");
		expect(secondChanges.files[0]?.id).not.toBe(firstFile.id);

		const crossed = await app.fetch(
			request(API_ROUTES.fileDiff(registered.repository.id, firstFile.id)),
		);
		expect(crossed.status).toBe(404);

		const reviewed = await app.fetch(
			request(API_ROUTES.fileReview(app.repository.id, firstFile.id), {
				method: "PUT",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
				},
				body: JSON.stringify({
					fileId: firstFile.id,
					contentRevision: firstFile.contentRevision,
					reviewed: true,
				}),
			}),
		);
		expect(reviewed.status).toBe(200);
		const firstState = (await (
			await app.fetch(request(API_ROUTES.comments(app.repository.id)))
		).json()) as ReviewStateResponse;
		const secondState = (await (
			await app.fetch(request(API_ROUTES.comments(registered.repository.id)))
		).json()) as ReviewStateResponse;
		expect(firstState.reviews).toHaveLength(1);
		expect(secondState.reviews).toHaveLength(0);

		const missingOrigin = await app.fetch(
			request(API_ROUTES.repository(registered.repository.id), {
				method: "DELETE",
				headers: { [CSRF_HEADER]: app.csrfToken },
				body: JSON.stringify({ repositoryId: registered.repository.id }),
			}),
		);
		expect(missingOrigin.status).toBe(403);

		const movedSecondRoot = `${secondRoot}-moved`;
		await rename(secondRoot, movedSecondRoot);
		temporaryDirectories.push(movedSecondRoot);
		const unavailable = (await (
			await app.fetch(request(API_ROUTES.repositories))
		).json()) as RepositoryCatalogResponse;
		expect(unavailable.repositories).toContainEqual(
			expect.objectContaining({ id: registered.repository.id, available: false }),
		);

		const forgotten = await app.fetch(
			request(API_ROUTES.repository(registered.repository.id), {
				method: "DELETE",
				headers: {
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: app.csrfToken,
					"content-type": "application/json",
				},
				body: JSON.stringify({ repositoryId: registered.repository.id }),
			}),
		);
		expect(forgotten.status).toBe(200);
		expect((await app.repositories.list()).map((item) => item.id)).toEqual([app.repository.id]);
	});

	test("polls shared SQLite revisions into repository-aware SSE events", async () => {
		const first = await fixture(25);
		const secondRoot = await repositoryFixture("second.ts");
		const second = await createCouchviewApp({
			root: secondRoot,
			host: "127.0.0.1",
			port: 3001,
			stateDatabasePath: first.database.filePath,
			revisionPollIntervalMs: 25,
		});
		applications.push(second);

		const response = await first.fetch(request(API_ROUTES.events(first.repository.id)));
		const reader = response.body?.getReader();
		if (!reader) throw new Error("SSE body missing");
		expect((await nextSseEvent(reader, "ready")).repositoryId).toBe(first.repository.id);

		const changes = (await (
			await second.fetch(request(API_ROUTES.files(first.repository.id)))
		).json()) as ChangesResponse;
		const file = changes.files[0];
		if (!file) throw new Error("shared repository fixture missing");
		const mutation = await second.fetch(
			request(API_ROUTES.fileReview(first.repository.id, file.id), {
				method: "PUT",
				headers: {
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
					[CSRF_HEADER]: second.csrfToken,
				},
				body: JSON.stringify({
					fileId: file.id,
					contentRevision: file.contentRevision,
					reviewed: true,
				}),
			}),
		);
		expect(mutation.status).toBe(200);
		const stateEvent = await nextSseEvent(reader, "state");
		expect(stateEvent).toMatchObject({ repositoryId: first.repository.id, stateRevision: 1 });

		const thirdRoot = await repositoryFixture("third.ts");
		const catalogMutation = await second.fetch(
			request(API_ROUTES.controlRepositories, {
				method: "POST",
				headers: {
					authorization: `Bearer ${second.controlToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ root: thirdRoot }),
			}),
		);
		expect(catalogMutation.status).toBe(201);
		const catalogEvent = await nextSseEvent(reader, "repositories");
		expect(catalogEvent.repositoryId).toBe(first.repository.id);
		expect(catalogEvent.catalogRevision).toBeGreaterThan(1);
		await reader.cancel();
	});

	test("allows independent versions on production and development endpoints to share state", async () => {
		const development = await fixture();
		const productionRoot = await repositoryFixture("production.ts");
		const production = await createCouchviewApp({
			root: productionRoot,
			host: "127.0.0.1",
			port: 4173,
			version: "9.9.9-test",
			stateDatabasePath: development.database.filePath,
		});
		applications.push(production);
		development.registerServerInstance();
		production.registerServerInstance();

		expect(development.database.repositories()).toHaveLength(2);
		expect(development.database.serverInstance(development.instanceId)).toMatchObject({
			port: 3001,
		});
		expect(production.database.serverInstance(production.instanceId)).toMatchObject({
			port: 4173,
			version: "9.9.9-test",
		});

		const metadata = await production.fetch(
			new Request("http://127.0.0.1:4173/api/instance", {
				headers: { host: "127.0.0.1:4173" },
			}),
		);
		expect(await metadata.json()).toMatchObject({ version: "9.9.9-test", port: 4173 });
	});

	test("defaults the application host to loopback", async () => {
		const root = await repositoryFixture("loopback-default.ts");
		const stateDirectory = await mkdtemp(path.join(tmpdir(), "couchview-server-state-"));
		temporaryDirectories.push(stateDirectory);
		const app = await createCouchviewApp({
			root,
			stateDatabasePath: path.join(stateDirectory, "state.sqlite"),
		});
		applications.push(app);

		expect(app.bindHost).toBe("127.0.0.1");
		expect(app.accessOrigins).toEqual(["http://127.0.0.1:4173"]);
	});

	test("derives copyable exact origins from wildcard network interfaces", () => {
		expect(
			accessOriginsForHost("0.0.0.0", 4173, ["192.168.50.4", "10.0.0.8", "2001:db8::1"]),
		).toEqual([
			"http://0.0.0.0:4173",
			"http://127.0.0.1:4173",
			"http://localhost:4173",
			"http://192.168.50.4:4173",
			"http://10.0.0.8:4173",
		]);
		expect(accessOriginsForHost("::", 4173, ["192.168.50.4", "2001:db8::1"])).toContain(
			"http://[2001:db8::1]:4173",
		);
	});
});
