import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	API_ROUTES,
	ARTIFACT_EXECUTABLE_HEADER,
	type ArtifactCatalogResponse,
	type ArtifactDefinitionResponse,
	type BootstrapResponse,
	CSRF_HEADER,
	type RemoteBridgeProfile,
} from "../shared/contracts.ts";
import { runArtifactCli } from "./artifactCli.ts";
import type { ParsedArtifactArguments } from "./cliCommandTypes.ts";
import { type CouchviewApp, type CouchviewSocketData, createCouchviewApp } from "./server.ts";

const CLI_PATH = path.resolve(import.meta.dir, "cli.ts");
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

async function gitRepository(prefix: string, remote: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	fixtures.push(root);
	expect(Bun.spawnSync(["git", "init", "-q", root]).exitCode).toBe(0);
	expect(Bun.spawnSync(["git", "-C", root, "remote", "add", "origin", remote]).exitCode).toBe(0);
	return root;
}

async function fixture() {
	const firstRoot = await gitRepository(
		"couchview-artifact-cli-one-",
		"https://example.invalid/team/one.git",
	);
	const xdgData = await mkdtemp(path.join(tmpdir(), "couchview-artifact-cli-data-"));
	const xdgConfig = await mkdtemp(path.join(tmpdir(), "couchview-artifact-cli-config-"));
	const clientDirectory = await mkdtemp(path.join(tmpdir(), "couchview-artifact-cli-client-"));
	fixtures.push(xdgData, xdgConfig, clientDirectory);
	const port = await availablePort();
	const app = await createCouchviewApp({
		root: firstRoot,
		host: "127.0.0.1",
		port,
		stateDatabasePath: path.join(xdgData, "couchview", "state.sqlite"),
		remoteBridge: { enabled: true },
	});
	applications.push(app);
	app.registerServerInstance();
	const server = Bun.serve<CouchviewSocketData>({
		hostname: "127.0.0.1",
		port,
		websocket: app.websocket,
		async fetch(request, bunServer) {
			return (await app.fetchWithServer(request, bunServer)) ?? new Response(null, { status: 426 });
		},
	});
	servers.push(server);
	return {
		app,
		firstRoot,
		xdgData,
		xdgConfig,
		clientDirectory,
		baseUrl: `http://127.0.0.1:${port}`,
	};
}

async function runCli(
	args: string[],
	options: { cwd: string; xdgData: string; xdgConfig: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const processHandle = Bun.spawn([process.execPath, CLI_PATH, ...args], {
		cwd: options.cwd,
		env: {
			...process.env,
			XDG_DATA_HOME: options.xdgData,
			XDG_CONFIG_HOME: options.xdgConfig,
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function browserHeaders(baseUrl: string): Promise<Record<string, string>> {
	const bootstrap = (await (
		await fetch(`${baseUrl}${API_ROUTES.bootstrap}`)
	).json()) as BootstrapResponse;
	return {
		"content-type": "application/json",
		origin: baseUrl,
		[CSRF_HEADER]: bootstrap.csrfToken,
	};
}

async function createDefinition(
	baseUrl: string,
	repositoryId: string,
	name: string,
	headers: Record<string, string>,
	executable = true,
) {
	const payload = `${name} bytes`.repeat(32);
	const outputPath = `${name}.bin`;
	const makeExecutable = executable
		? `; await (await import("node:fs/promises")).chmod(${JSON.stringify(outputPath)}, 0o755)`
		: "";
	const response = await fetch(`${baseUrl}${API_ROUTES.artifacts(repositoryId)}`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			name,
			argv: [
				process.execPath,
				"-e",
				`console.log("building ${name}"); await Bun.write(${JSON.stringify(outputPath)}, ${JSON.stringify(payload)})${makeExecutable}`,
			],
			workingDirectory: ".",
			outputPath,
			outputKind: "file",
		}),
	});
	expect(response.status).toBe(201);
	return ((await response.json()) as ArtifactDefinitionResponse).definition;
}

function expectedDownloadMode(executable: boolean): number {
	const base = (executable ? 0o777 : 0o666) & ~process.umask();
	return executable ? base | 0o100 : base;
}

async function pair(baseUrl: string, repositoryId: string, headers: Record<string, string>) {
	const pairingResponse = await fetch(
		`${baseUrl}${API_ROUTES.remoteBridgePairings(repositoryId)}`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ label: "CLI Mac" }),
		},
	);
	const pairing = (await pairingResponse.json()) as { command: string };
	const code = /--code '([^']+)'/.exec(pairing.command)?.[1];
	const claim = await fetch(`${baseUrl}${API_ROUTES.remoteBridgeClaim}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code }),
	});
	return (await claim.json()) as RemoteBridgeProfile;
}

describe("artifact CLI against a real server", () => {
	test("lists, pulls, verifies, selects retained builds, and resolves paired repositories", async () => {
		const resources = await fixture();
		const { app, firstRoot, baseUrl, clientDirectory, xdgData, xdgConfig } = resources;
		const headers = await browserHeaders(baseUrl);
		const firstDefinition = await createDefinition(
			baseUrl,
			app.repository.id,
			"couchview-cli",
			headers,
		);
		const cliOptions = { cwd: clientDirectory, xdgData, xdgConfig };

		const listed = await runCli(["artifacts", "list", "--repo", firstRoot, "--json"], cliOptions);
		expect(listed.exitCode, listed.stderr).toBe(0);
		expect(JSON.parse(listed.stdout)).toMatchObject({
			repository: { id: app.repository.id },
			artifacts: [{ definition: { name: "couchview-cli" } }],
		});

		const pulled = await runCli(
			["artifacts", "pull", "couchview-cli", "--repo", firstRoot, "--json"],
			cliOptions,
		);
		expect(pulled.exitCode, pulled.stderr).toBe(0);
		expect(pulled.stderr).toContain("building couchview-cli");
		const pulledJson = JSON.parse(pulled.stdout) as {
			output: string;
			build: { sha256: string; executable: boolean };
		};
		expect(pulledJson.build.executable).toBe(true);
		expect(await realpath(pulledJson.output)).toBe(
			await realpath(path.join(clientDirectory, "couchview-cli.bin")),
		);
		expect(await readFile(pulledJson.output, "utf8")).toBe("couchview-cli bytes".repeat(32));
		if (process.platform !== "win32") {
			expect((await stat(pulledJson.output)).mode & 0o777).toBe(expectedDownloadMode(true));
		}
		expect(
			new Bun.CryptoHasher("sha256").update(await readFile(pulledJson.output)).digest("hex"),
		).toBe(pulledJson.build.sha256);

		const refused = await runCli(
			["artifacts", "download", "couchview-cli", "--repo", firstRoot],
			cliOptions,
		);
		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain("Refusing to overwrite");
		const secondPull = await runCli(
			["artifacts", "pull", "couchview-cli", "--repo", firstRoot, "--force", "--json"],
			cliOptions,
		);
		expect(secondPull.exitCode, secondPull.stderr).toBe(0);
		if (process.platform !== "win32") {
			expect((await stat(pulledJson.output)).mode & 0o777).toBe(expectedDownloadMode(true));
		}
		const catalog = (await (
			await fetch(`${baseUrl}${API_ROUTES.artifacts(app.repository.id)}`)
		).json()) as ArtifactCatalogResponse;
		expect(catalog.artifacts[0]?.builds).toHaveLength(2);
		const older = catalog.artifacts[0]!.builds[1]!;
		const olderOutput = path.join(clientDirectory, "older.bin");
		const olderDownload = await runCli(
			[
				"artifacts",
				"download",
				firstDefinition.name,
				"--repo",
				firstRoot,
				"--build",
				older.id,
				"--output",
				olderOutput,
			],
			cliOptions,
		);
		expect(olderDownload.exitCode, olderDownload.stderr).toBe(0);
		expect(await readFile(olderOutput, "utf8")).toBe("couchview-cli bytes".repeat(32));
		if (process.platform !== "win32") {
			expect((await stat(olderOutput)).mode & 0o777).toBe(expectedDownloadMode(true));
		}

		await createDefinition(baseUrl, app.repository.id, "plain-data", headers, false);
		const plainPull = await runCli(
			["artifacts", "pull", "plain-data", "--repo", firstRoot, "--json"],
			cliOptions,
		);
		expect(plainPull.exitCode, plainPull.stderr).toBe(0);
		const plainJson = JSON.parse(plainPull.stdout) as {
			output: string;
			build: { executable: boolean };
		};
		expect(plainJson.build.executable).toBe(false);
		if (process.platform !== "win32") {
			expect((await stat(plainJson.output)).mode & 0o777).toBe(expectedDownloadMode(false));
		}

		const secondRoot = await gitRepository(
			"couchview-artifact-cli-two-",
			"git@example.invalid:team/two.git",
		);
		const second = await app.repositories.register(secondRoot);
		await createDefinition(baseUrl, second.repository.id, "tablet-app", headers);
		const profile = await pair(baseUrl, app.repository.id, headers);
		const configFile = path.join(xdgConfig, "couchview", "remote-bridges.json");
		await mkdir(path.dirname(configFile), { recursive: true });
		await writeFile(configFile, JSON.stringify({ version: 2, profiles: [profile] }), {
			mode: 0o600,
		});
		const pairedExplicit = await runCli(
			[
				"artifacts",
				"list",
				"--profile",
				profile.sshAlias,
				"--repository",
				second.repository.id,
				"--json",
			],
			cliOptions,
		);
		expect(pairedExplicit.exitCode, pairedExplicit.stderr).toBe(0);
		expect(JSON.parse(pairedExplicit.stdout)).toMatchObject({
			repository: { id: second.repository.id },
			artifacts: [{ definition: { name: "tablet-app" } }],
		});

		const clientCheckout = await gitRepository(
			"couchview-artifact-cli-checkout-",
			"https://example.invalid/team/two.git",
		);
		const pairedDetected = await runCli(
			["artifacts", "list", "--profile", profile.id, "--repo", clientCheckout, "--json"],
			cliOptions,
		);
		expect(pairedDetected.exitCode, pairedDetected.stderr).toBe(0);
		expect(JSON.parse(pairedDetected.stdout).repository.id).toBe(second.repository.id);

		const duplicateRoot = await gitRepository(
			"couchview-artifact-cli-duplicate-",
			"ssh://git@example.invalid/team/two.git",
		);
		const duplicate = await app.repositories.register(duplicateRoot);
		const ambiguous = await runCli(
			["artifacts", "list", "--profile", profile.id, "--repo", clientCheckout],
			cliOptions,
		);
		expect(ambiguous.exitCode).toBe(1);
		expect(ambiguous.stderr).toContain("Available repositories");
		expect(ambiguous.stderr).toContain(second.repository.id);
		expect(ambiguous.stderr).toContain(duplicate.repository.id);

		const slowResponse = await fetch(`${baseUrl}${API_ROUTES.artifacts(app.repository.id)}`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				name: "slow-cli",
				argv: [
					process.execPath,
					"-e",
					'console.log("slow build started"); await Bun.sleep(30_000)',
				],
				workingDirectory: ".",
				outputPath: "slow.bin",
				outputKind: "file",
			}),
		});
		expect(slowResponse.status).toBe(201);
		const slow = Bun.spawn(
			[process.execPath, CLI_PATH, "artifacts", "build", "slow-cli", "--repo", firstRoot],
			{
				cwd: clientDirectory,
				env: { ...process.env, XDG_DATA_HOME: xdgData, XDG_CONFIG_HOME: xdgConfig },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		await Bun.sleep(500);
		slow.kill("SIGINT");
		const [slowExit, slowStderr] = await Promise.all([
			slow.exited,
			new Response(slow.stderr).text(),
		]);
		expect(slowExit, slowStderr).toBe(130);
		expect(slowStderr).toContain("slow build started");
		let cancelledStatus: string | undefined;
		const cancellationDeadline = Date.now() + 5_000;
		while (Date.now() < cancellationDeadline) {
			const cancelledCatalog = (await (
				await fetch(`${baseUrl}${API_ROUTES.artifacts(app.repository.id)}`)
			).json()) as ArtifactCatalogResponse;
			cancelledStatus = cancelledCatalog.artifacts.find(
				(item) => item.definition.name === "slow-cli",
			)?.recentRun?.status;
			if (cancelledStatus === "stopped") break;
			await Bun.sleep(20);
		}
		expect(cancelledStatus).toBe("stopped");
	});

	test("verifies a real download when an intermediary omits Content-Length", async () => {
		const { app, firstRoot, baseUrl, clientDirectory, xdgData } = await fixture();
		const headers = await browserHeaders(baseUrl);
		await createDefinition(baseUrl, app.repository.id, "proxied-cli", headers);
		const output = path.join(clientDirectory, "proxied-cli.bin");
		const options: ParsedArtifactArguments = {
			action: "pull",
			name: "proxied-cli",
			profile: null,
			repository: null,
			repo: firstRoot,
			build: null,
			output,
			force: false,
			json: false,
		};
		const intermediaryFetch: typeof fetch = Object.assign(
			async (input: URL | RequestInfo, init?: RequestInit) => {
				const response = await fetch(input, init);
				const requestUrl = input instanceof Request ? input.url : String(input);
				if (!response.ok || !requestUrl.endsWith("/download")) return response;
				const responseHeaders = new Headers(response.headers);
				responseHeaders.delete("content-length");
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: responseHeaders,
				});
			},
			{ preconnect: fetch.preconnect },
		);
		let stderr = "";
		const exitCode = await runArtifactCli(options, {
			fetch: intermediaryFetch,
			cwd: () => clientDirectory,
			stateDatabasePath: path.join(xdgData, "couchview", "state.sqlite"),
			onInterrupt: () => () => undefined,
			stdout: { write: () => undefined },
			stderr: { write: (text) => (stderr += text) },
		});

		expect(exitCode, stderr).toBe(0);
		expect(await readFile(output, "utf8")).toBe("proxied-cli bytes".repeat(32));
		if (process.platform !== "win32") {
			expect((await stat(output)).mode & 0o777).toBe(expectedDownloadMode(true));
		}

		const downloadOptions: ParsedArtifactArguments = {
			...options,
			action: "download",
			output: path.join(clientDirectory, "missing-metadata.bin"),
		};
		const withoutExecutableMetadata: typeof fetch = Object.assign(
			async (input: URL | RequestInfo, init?: RequestInit) => {
				const response = await fetch(input, init);
				const requestUrl = input instanceof Request ? input.url : String(input);
				if (!response.ok || !requestUrl.endsWith("/download")) return response;
				const responseHeaders = new Headers(response.headers);
				responseHeaders.delete(ARTIFACT_EXECUTABLE_HEADER);
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: responseHeaders,
				});
			},
			{ preconnect: fetch.preconnect },
		);
		await expect(
			runArtifactCli(downloadOptions, {
				fetch: withoutExecutableMetadata,
				cwd: () => clientDirectory,
				stateDatabasePath: path.join(xdgData, "couchview", "state.sqlite"),
				onInterrupt: () => () => undefined,
				stdout: { write: () => undefined },
				stderr: { write: () => undefined },
			}),
		).rejects.toThrow("does not provide executable artifact metadata");

		const mismatchedExecutableMetadata: typeof fetch = Object.assign(
			async (input: URL | RequestInfo, init?: RequestInit) => {
				const response = await fetch(input, init);
				const requestUrl = input instanceof Request ? input.url : String(input);
				if (!response.ok || !requestUrl.endsWith("/download")) return response;
				const responseHeaders = new Headers(response.headers);
				responseHeaders.set(ARTIFACT_EXECUTABLE_HEADER, "0");
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: responseHeaders,
				});
			},
			{ preconnect: fetch.preconnect },
		);
		await expect(
			runArtifactCli(
				{ ...downloadOptions, output: path.join(clientDirectory, "mismatched-metadata.bin") },
				{
					fetch: mismatchedExecutableMetadata,
					cwd: () => clientDirectory,
					stateDatabasePath: path.join(xdgData, "couchview", "state.sqlite"),
					onInterrupt: () => () => undefined,
					stdout: { write: () => undefined },
					stderr: { write: () => undefined },
				},
			),
		).rejects.toThrow("inconsistent artifact metadata");
	});
});
