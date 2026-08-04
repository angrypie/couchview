import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	API_ROUTES,
	type ArtifactCatalogResponse,
	type ArtifactDefinitionResponse,
	type ArtifactRepositoryResolveResponse,
	type ArtifactRunEvent,
	type ArtifactRunResponse,
	type BootstrapResponse,
	CSRF_HEADER,
	REMOTE_BRIDGE_DEVICE_TOKEN_HEADER,
	type RegisterRepositoryResponse,
	type RemoteBridgeProfile,
} from "../shared/contracts.ts";
import type { ArtifactProposalGenerator } from "./artifactProposal.ts";
import { fingerprintGitRemoteIdentity } from "./artifactRepositoryIdentity.ts";
import { type CouchviewApp, type CouchviewSocketData, createCouchviewApp } from "./server.ts";

const fixtures: string[] = [];
const applications: CouchviewApp[] = [];
const servers: Bun.Server<CouchviewSocketData>[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true);
	for (const application of applications.splice(0)) application.close();
	await Promise.all(
		fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })),
	);
});

async function repository(name: string, remote: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), `couchview-artifact-http-${name}-`));
	fixtures.push(root);
	expect(Bun.spawnSync(["git", "init", "-q", root]).exitCode).toBe(0);
	expect(Bun.spawnSync(["git", "-C", root, "remote", "add", "origin", remote]).exitCode).toBe(0);
	return root;
}

async function availablePort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", resolve);
	});
	const address = probe.address();
	if (!address || typeof address === "string") throw new Error("Could not reserve a test port");
	await new Promise<void>((resolve, reject) =>
		probe.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

async function loopbackFixture(artifactProposals?: ArtifactProposalGenerator) {
	const root = await repository("one", "https://example.invalid/team/one.git");
	const state = await mkdtemp(path.join(tmpdir(), "couchview-artifact-http-state-"));
	fixtures.push(state);
	const port = await availablePort();
	const app = await createCouchviewApp({
		root,
		host: "127.0.0.1",
		port,
		stateDatabasePath: path.join(state, "state.sqlite"),
		remoteBridge: { enabled: true },
		artifactProposals,
	});
	applications.push(app);
	const server = Bun.serve<CouchviewSocketData>({
		hostname: "127.0.0.1",
		port,
		websocket: app.websocket,
		async fetch(request, bunServer) {
			return (await app.fetchWithServer(request, bunServer)) ?? new Response(null, { status: 426 });
		},
	});
	servers.push(server);
	return { app, root, baseUrl: `http://127.0.0.1:${port}` };
}

async function json<T>(response: Response): Promise<T> {
	const body = (await response.json()) as T;
	if (!response.ok) throw new Error(`Unexpected ${response.status}: ${JSON.stringify(body)}`);
	return body;
}

async function waitForBuild(baseUrl: string, repositoryId: string, artifactId: string) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const catalog = await json<ArtifactCatalogResponse>(
			await fetch(`${baseUrl}${API_ROUTES.artifacts(repositoryId)}`),
		);
		const item = catalog.artifacts.find(({ definition }) => definition.id === artifactId);
		if (item?.builds[0]) return item.builds[0];
		if (item && !item.activeRun) throw new Error("Artifact command ended without a build");
		await Bun.sleep(20);
	}
	throw new Error("Artifact build did not finish");
}

describe("artifact HTTP routes", () => {
	test("protects artifact proposals with browser CSRF and forwards adjustable Codex settings", async () => {
		let received:
			| {
					root: string;
					request: string;
					model: string;
					reasoning: string;
					names: readonly string[];
			  }
			| undefined;
		const artifactProposals: ArtifactProposalGenerator = {
			capability: { available: true, reason: null },
			async propose(root, input, names) {
				received = {
					root,
					request: input.request,
					model: input.codex.model,
					reasoning: input.codex.reasoning,
					names,
				};
				return {
					proposal: {
						name: "static-site",
						argv: ["bun", "run", "build"],
						workingDirectory: ".",
						outputPath: "dist",
						outputKind: "directory",
					},
					summary: "The build script emits dist.",
					configurationFiles: ["package.json"],
				};
			},
			close() {},
		};
		const { app, baseUrl } = await loopbackFixture(artifactProposals);
		const bootstrap = await json<BootstrapResponse>(
			await fetch(`${baseUrl}${API_ROUTES.bootstrap}`),
		);
		expect(bootstrap.artifactProposal).toEqual({ available: true, reason: null });
		const body = JSON.stringify({
			request: "static build",
			codex: { model: "gpt-5.6-terra", reasoning: "medium" },
		});
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.artifactProposal(app.repository.id)}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body,
				})
			).status,
		).toBe(403);

		const response = await json(
			await fetch(`${baseUrl}${API_ROUTES.artifactProposal(app.repository.id)}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseUrl,
					[CSRF_HEADER]: bootstrap.csrfToken,
				},
				body,
			}),
		);
		expect(response).toMatchObject({ proposal: { name: "static-site" } });
		expect(received).toEqual({
			root: app.repository.root,
			request: "static build",
			model: "gpt-5.6-terra",
			reasoning: "medium",
			names: [],
		});
	});

	test("secures mutations, authorizes host-wide devices, and streams ranged downloads", async () => {
		const { app, baseUrl } = await loopbackFixture();
		const bootstrap = await json<BootstrapResponse>(
			await fetch(`${baseUrl}${API_ROUTES.bootstrap}`),
		);
		const browserHeaders = {
			"content-type": "application/json",
			origin: baseUrl,
			[CSRF_HEADER]: bootstrap.csrfToken,
		};
		const definitionInput = {
			name: "couchview-cli",
			argv: [process.execPath, "-e", 'await Bun.write("couchview.bin", "artifact bytes")'],
			workingDirectory: ".",
			outputPath: "couchview.bin",
			outputKind: "file" as const,
		};
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.artifacts(app.repository.id)}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(definitionInput),
				})
			).status,
		).toBe(403);
		const created = await json<ArtifactDefinitionResponse>(
			await fetch(`${baseUrl}${API_ROUTES.artifacts(app.repository.id)}`, {
				method: "POST",
				headers: browserHeaders,
				body: JSON.stringify(definitionInput),
			}),
		);

		const started = await json<ArtifactRunResponse>(
			await fetch(
				`${baseUrl}${API_ROUTES.artifactRuns(app.repository.id, created.definition.id)}`,
				{
					method: "POST",
					headers: { authorization: `Bearer ${app.controlToken}` },
				},
			),
		);
		const eventResponse = await fetch(
			`${baseUrl}${API_ROUTES.artifactRunEvents(app.repository.id, created.definition.id, started.run.id)}`,
		);
		const eventReader = eventResponse.body!.getReader();
		const eventText = new TextDecoder().decode((await eventReader.read()).value);
		const event = JSON.parse(
			eventText
				.split("\n")
				.find((line) => line.startsWith("data: "))!
				.slice(6),
		) as ArtifactRunEvent;
		expect(event.type).toBe("snapshot");
		await eventReader.cancel();

		const build = await waitForBuild(baseUrl, app.repository.id, created.definition.id);
		const downloadUrl = `${baseUrl}${API_ROUTES.artifactDownload(
			app.repository.id,
			created.definition.id,
			build.id,
		)}`;
		const head = await fetch(downloadUrl, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe(String(build.sizeBytes));
		expect(head.headers.get("etag")).toBe(`"${build.sha256}"`);
		expect(head.headers.get("accept-ranges")).toBe("bytes");
		expect(head.headers.get("content-disposition")).toContain("attachment");
		expect((await head.arrayBuffer()).byteLength).toBe(0);
		const range = await fetch(downloadUrl, { headers: { range: "bytes=2-7" } });
		expect(range.status).toBe(206);
		expect(range.headers.get("content-range")).toBe(`bytes 2-7/${build.sizeBytes}`);
		expect(await range.text()).toBe("tifact");
		const invalidRange = await fetch(downloadUrl, { headers: { range: "bytes=999-1000" } });
		expect(invalidRange.status).toBe(416);
		expect(invalidRange.headers.get("content-range")).toBe(`bytes */${build.sizeBytes}`);

		const pairing = await json<{ command: string }>(
			await fetch(`${baseUrl}${API_ROUTES.remoteBridgePairings(app.repository.id)}`, {
				method: "POST",
				headers: browserHeaders,
				body: JSON.stringify({ label: "MacBook Air" }),
			}),
		);
		const code = /--code '([^']+)'/.exec(pairing.command)?.[1];
		expect(code).toBeString();
		const profile = await json<RemoteBridgeProfile>(
			await fetch(`${baseUrl}${API_ROUTES.remoteBridgeClaim}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code }),
			}),
		);

		const secondRoot = await repository("two", "git@example.invalid:team/two.git");
		const registered = await json<RegisterRepositoryResponse>(
			await fetch(`${baseUrl}${API_ROUTES.controlRepositories}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${app.controlToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ root: secondRoot }),
			}),
		);
		const remoteDefinition = await json<ArtifactDefinitionResponse>(
			await fetch(`${baseUrl}${API_ROUTES.artifacts(registered.repository.id)}`, {
				method: "POST",
				headers: browserHeaders,
				body: JSON.stringify({ ...definitionInput, name: "second-cli" }),
			}),
		);
		expect(
			(
				await fetch(
					`${baseUrl}${API_ROUTES.artifactRuns(
						registered.repository.id,
						remoteDefinition.definition.id,
					)}`,
					{
						method: "POST",
						headers: { [REMOTE_BRIDGE_DEVICE_TOKEN_HEADER]: profile.deviceToken },
					},
				)
			).status,
		).toBe(201);
		const resolved = await json<ArtifactRepositoryResolveResponse>(
			await fetch(`${baseUrl}${API_ROUTES.artifactRepositoryResolve}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[REMOTE_BRIDGE_DEVICE_TOKEN_HEADER]: profile.deviceToken,
				},
				body: JSON.stringify({
					fingerprints: [fingerprintGitRemoteIdentity("example.invalid/team/two")],
				}),
			}),
		);
		expect(resolved.repository).toEqual({
			id: registered.repository.id,
			name: registered.repository.name,
		});

		expect(
			(
				await fetch(
					`${baseUrl}${API_ROUTES.artifact(registered.repository.id, remoteDefinition.definition.id)}`,
					{
						method: "DELETE",
						headers: { [REMOTE_BRIDGE_DEVICE_TOKEN_HEADER]: profile.deviceToken },
					},
				)
			).status,
		).toBe(403);
		await fetch(
			`${baseUrl}${API_ROUTES.remoteBridgePairing(app.repository.id, profile.deviceId)}`,
			{
				method: "DELETE",
				headers: browserHeaders,
			},
		);
		expect(
			(
				await fetch(`${baseUrl}${API_ROUTES.artifacts(registered.repository.id)}`, {
					headers: { [REMOTE_BRIDGE_DEVICE_TOKEN_HEADER]: profile.deviceToken },
				})
			).status,
		).toBe(403);
		expect(
			(
				await fetch(
					`${baseUrl}${API_ROUTES.artifactRuns(
						registered.repository.id,
						remoteDefinition.definition.id,
					)}`,
					{
						method: "POST",
						headers: { [REMOTE_BRIDGE_DEVICE_TOKEN_HEADER]: profile.deviceToken },
					},
				)
			).status,
		).toBe(403);
	});
});
