import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	replaceStaticBuild,
	restartCapability,
	restartRunningServer,
	SUPERVISOR_RESTART_EXIT_CODE,
	startServer,
	superviseServer,
} from "./cli.ts";
import { cliProcessCommand } from "./cliSupervisor.ts";
import { type CouchviewApp, createCouchviewApp } from "./server.ts";

const initialRoot = Bun.env.COUCHVIEW_ROOT;
const initialHost = Bun.env.COUCHVIEW_HOST;
const initialPort = Bun.env.PORT;
const initialTerminal = Bun.env.COUCHVIEW_TERMINAL;
const initialTerminalP2p = Bun.env.COUCHVIEW_TERMINAL_P2P;
const initialTerminalStun = Bun.env.COUCHVIEW_TERMINAL_STUN;
const initialRemoteBridge = Bun.env.COUCHVIEW_REMOTE_BRIDGE;
const initialRemoteBridgeP2p = Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
const initialRemoteBridgeStun = Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
const initialRemoteBridgePort = Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
const initialRemoteBridgeOriginAccess = Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
const initialDataHome = Bun.env.XDG_DATA_HOME;
const initialAllowedOrigins = Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
const initialInternalAllowedOrigins = Bun.env.ALLOWED_ORIGINS;
const initialDisableReuse = Bun.env.COUCHVIEW_DISABLE_REUSE;

function restoreEnvironment() {
	if (initialRoot === undefined) delete Bun.env.COUCHVIEW_ROOT;
	else Bun.env.COUCHVIEW_ROOT = initialRoot;

	if (initialHost === undefined) delete Bun.env.COUCHVIEW_HOST;
	else Bun.env.COUCHVIEW_HOST = initialHost;

	if (initialPort === undefined) delete Bun.env.PORT;
	else Bun.env.PORT = initialPort;

	if (initialTerminal === undefined) delete Bun.env.COUCHVIEW_TERMINAL;
	else Bun.env.COUCHVIEW_TERMINAL = initialTerminal;

	if (initialTerminalP2p === undefined) delete Bun.env.COUCHVIEW_TERMINAL_P2P;
	else Bun.env.COUCHVIEW_TERMINAL_P2P = initialTerminalP2p;

	if (initialTerminalStun === undefined) delete Bun.env.COUCHVIEW_TERMINAL_STUN;
	else Bun.env.COUCHVIEW_TERMINAL_STUN = initialTerminalStun;

	if (initialRemoteBridge === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE = initialRemoteBridge;

	if (initialRemoteBridgeP2p === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P = initialRemoteBridgeP2p;

	if (initialRemoteBridgeStun === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN = initialRemoteBridgeStun;

	if (initialRemoteBridgePort === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT = initialRemoteBridgePort;

	if (initialRemoteBridgeOriginAccess === undefined) {
		delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
	} else {
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS = initialRemoteBridgeOriginAccess;
	}

	if (initialDataHome === undefined) delete Bun.env.XDG_DATA_HOME;
	else Bun.env.XDG_DATA_HOME = initialDataHome;

	if (initialAllowedOrigins === undefined) {
		delete Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
	} else {
		Bun.env.COUCHVIEW_ALLOWED_ORIGINS = initialAllowedOrigins;
	}

	if (initialInternalAllowedOrigins === undefined) {
		delete Bun.env.ALLOWED_ORIGINS;
	} else {
		Bun.env.ALLOWED_ORIGINS = initialInternalAllowedOrigins;
	}

	if (initialDisableReuse === undefined) delete Bun.env.COUCHVIEW_DISABLE_REUSE;
	else Bun.env.COUCHVIEW_DISABLE_REUSE = initialDisableReuse;
}

describe("restartCapability", () => {
	test("enables production source launches", () => {
		expect(restartCapability({})).toEqual({
			available: true,
			reason: null,
		});
	});

	test("explains development and custom static-directory launches", () => {
		expect(restartCapability({ NODE_ENV: "development" })).toEqual({
			available: false,
			reason: "Development mode reloads source changes automatically.",
		});
		expect(restartCapability({ STATIC_DIR: "/tmp/custom-couchview-dist" })).toEqual({
			available: false,
			reason: "Restart is unavailable when Couchview uses a custom STATIC_DIR.",
		});
	});
});

describe("server supervisor", () => {
	test("invokes source workers through Bun and compiled workers directly", () => {
		expect(
			cliProcessCommand(["--version"], {
				bunMain: "/workspace/src/server/cli.ts",
				executable: "/opt/bun",
				cliPath: "/workspace/src/server/cli.ts",
			}),
		).toEqual(["/opt/bun", "run", "/workspace/src/server/cli.ts", "--version"]);
		expect(
			cliProcessCommand(["--version"], {
				bunMain: "/$bunfs/root/couchview",
				executable: "/opt/couchview",
			}),
		).toEqual(["/opt/couchview", "--version"]);
	});

	test("keeps the foreground owner alive while replacing a restarted worker", async () => {
		const exitCodes = [SUPERVISOR_RESTART_EXIT_CODE, 0];
		const commands: string[][] = [];
		const environments: NodeJS.ProcessEnv[] = [];
		const listeners = new Map<string, () => void>();

		const exitCode = await superviseServer(
			["--repo", "/tmp/project", "--port", "4999", "--enable-terminal-p2p"],
			{
				spawn(command, options) {
					commands.push(command);
					environments.push(options.env);
					return {
						exited: Promise.resolve(exitCodes.shift() ?? 1),
						kill() {},
					};
				},
				onSignal(signal, listener) {
					listeners.set(signal, listener);
				},
				offSignal(signal, listener) {
					if (listeners.get(signal) === listener) listeners.delete(signal);
				},
			},
		);

		expect(exitCode).toBe(0);
		expect(commands).toHaveLength(2);
		expect(commands[0]?.slice(-5)).toEqual([
			"--repo",
			"/tmp/project",
			"--port",
			"4999",
			"--enable-terminal-p2p",
		]);
		expect(environments[0]?.COUCHVIEW_SUPERVISED_WORKER).toBe("1");
		expect(environments[1]?.COUCHVIEW_SUPERVISED_WORKER).toBe("1");
		expect(environments[1]?.COUCHVIEW_DISABLE_REUSE).toBe("1");
		expect(listeners.size).toBe(0);
	});

	test("forwards termination to the active worker without respawning it", async () => {
		const listeners = new Map<string, () => void>();
		const killed: NodeJS.Signals[] = [];
		let finishWorker!: (exitCode: number) => void;
		const workerExited = new Promise<number>((resolve) => {
			finishWorker = resolve;
		});
		let spawnCount = 0;
		const supervised = superviseServer([], {
			spawn() {
				spawnCount += 1;
				return {
					exited: workerExited,
					kill(signal) {
						killed.push(signal);
						finishWorker(0);
					},
				};
			},
			onSignal(signal, listener) {
				listeners.set(signal, listener);
			},
			offSignal(signal, listener) {
				if (listeners.get(signal) === listener) listeners.delete(signal);
			},
		});

		listeners.get("SIGTERM")?.();

		expect(await supervised).toBe(0);
		expect(killed).toEqual(["SIGTERM"]);
		expect(spawnCount).toBe(1);
		expect(listeners.size).toBe(0);
	});
});

describe("replaceStaticBuild", () => {
	test("atomically promotes a successful build and removes the previous one", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "couchview-build-swap-"));
		const current = path.join(root, "dist");
		const candidate = path.join(root, ".couchview-build-candidate");
		try {
			await mkdir(current);
			await mkdir(candidate);
			await writeFile(path.join(current, "index.html"), "old");
			await writeFile(path.join(candidate, "index.html"), "new");

			await replaceStaticBuild(candidate, current);

			expect(await Bun.file(path.join(current, "index.html")).text()).toBe("new");
			expect(await readdir(root)).toEqual(["dist"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("restores the current build when promotion fails", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "couchview-build-restore-"));
		const current = path.join(root, "dist");
		const missingCandidate = path.join(root, "missing-build");
		try {
			await mkdir(current);
			await writeFile(path.join(current, "index.html"), "old");

			await expect(replaceStaticBuild(missingCandidate, current)).rejects.toThrow();

			expect(await Bun.file(path.join(current, "index.html")).text()).toBe("old");
			expect(await readdir(root)).toEqual(["dist"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];
const endpoints = new Map<number, (request: Request) => Response | Promise<Response>>();
let nextPort = 43_100;

async function repositoryFixture(name: string): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), `couchview-cli-${name}-`));
	temporaryDirectories.push(directory);
	expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
	await writeFile(path.join(directory, `${name}.ts`), `export const ${name} = true;\n`);
	return directory;
}

function freePort(): number {
	nextPort += 1;
	return nextPort;
}

async function runningApp(
	root: string,
	port: number,
	stateDatabasePath?: string,
	allowedOrigins?: string[],
) {
	const app = await createCouchviewApp({
		root,
		host: "127.0.0.1",
		port,
		stateDatabasePath,
		allowedOrigins,
	});
	app.registerServerInstance();
	applications.push(app);
	endpoints.set(port, app.fetch);
	return app;
}

const runtimeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const request = new Request(input, init);
	const port = Number(new URL(request.url).port);
	const endpoint = endpoints.get(port);
	if (!endpoint) throw new TypeError("Endpoint is not listening");
	return endpoint(request);
}) as typeof globalThis.fetch;

const runtimeServe = ((options: {
	hostname?: string;
	port?: number;
	fetch(request: Request): Response | Promise<Response>;
}) => {
	const port = options.port ?? 0;
	if (endpoints.has(port)) {
		const error = new Error(`Failed to listen: address already in use (${port})`);
		Object.assign(error, { code: "EADDRINUSE" });
		throw error;
	}
	endpoints.set(port, options.fetch);
	return {
		port,
		stop() {
			endpoints.delete(port);
		},
	} as ReturnType<typeof Bun.serve>;
}) as unknown as typeof Bun.serve;

const runtime = { fetch: runtimeFetch, serve: runtimeServe };

describe("multi-project CLI startup", () => {
	beforeEach(async () => {
		delete Bun.env.COUCHVIEW_ROOT;
		delete Bun.env.COUCHVIEW_HOST;
		delete Bun.env.PORT;
		delete Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
		delete Bun.env.ALLOWED_ORIGINS;
		delete Bun.env.COUCHVIEW_TERMINAL;
		delete Bun.env.COUCHVIEW_TERMINAL_P2P;
		delete Bun.env.COUCHVIEW_TERMINAL_STUN;
		delete Bun.env.COUCHVIEW_DISABLE_REUSE;
		const dataHome = await mkdtemp(path.join(tmpdir(), "couchview-cli-data-"));
		temporaryDirectories.push(dataHome);
		Bun.env.XDG_DATA_HOME = dataHome;
	});

	afterEach(async () => {
		endpoints.clear();
		for (const application of applications.splice(0)) application.close();
		await Promise.all(
			temporaryDirectories
				.splice(0)
				.map((directory) => rm(directory, { recursive: true, force: true })),
		);
		restoreEnvironment();
	});

	test("starts the first endpoint with a project-specific URL and global state", async () => {
		const root = await repositoryFixture("first");
		const port = freePort();
		const messages: string[] = [];
		const originalLog = console.log;
		console.log = (...values: unknown[]) => messages.push(values.join(" "));
		try {
			const result = await startServer(["--repo", root, "--port", String(port)], runtime);
			if (!result.app || !result.server || !result.stop) {
				throw new Error("CLI unexpectedly attached to another server");
			}
			expect(result.app.database.repositories()).toHaveLength(1);
			expect(messages.join("\n")).toContain(`/?repo=${result.app.repository.id}`);
			expect(messages.join("\n")).toContain(`Repository: ${result.app.repository.root}`);
			expect(await Bun.file(path.join(root, ".git", "couchview", "state.json")).exists()).toBe(
				false,
			);
			result.stop();
		} finally {
			console.log = originalLog;
		}
	});

	test("asks the owning server to rebuild and waits for its replacement", async () => {
		const root = await repositoryFixture("restart-owner");
		const port = freePort();
		let restartRequests = 0;
		let replacementReady = false;
		const app = await createCouchviewApp({
			root,
			host: "127.0.0.1",
			port,
			restart: {
				available: true,
				reason: null,
				request: async () => {
					restartRequests += 1;
					replacementReady = true;
				},
			},
		});
		app.registerServerInstance();
		applications.push(app);
		const replacementId = "replacement-instance";
		endpoints.set(port, async (request) => {
			if (
				replacementReady &&
				request.method === "GET" &&
				new URL(request.url).pathname === "/api/instance"
			) {
				return Response.json({
					service: "couchview",
					protocolVersion: app.protocolVersion,
					version: app.version,
					instanceId: replacementId,
					bindHost: app.bindHost,
					port: app.port,
					accessOrigins: app.accessOrigins,
					speechEnabled: app.speech.enabled,
					voiceCommandsEnabled: app.voiceCommands.enabled,
					terminalEnabled: app.terminalSessions.enabled,
					terminalP2pEnabled: app.terminalSessions.p2pEnabled,
					terminalStunUrls: [...app.terminalSessions.stunUrls],
					remoteBridgeEnabled: app.remoteBridge.enabled,
					remoteBridgeP2pEnabled: app.remoteBridge.p2pEnabled,
					remoteBridgeStunUrls: [...app.remoteBridge.stunUrls],
					remoteBridgeTargetPort: app.remoteBridge.targetPort,
				});
			}
			return app.fetch(request);
		});

		const result = await restartRunningServer(["--port", String(port)], {
			fetch: runtimeFetch,
			wait: async () => undefined,
		});

		expect(restartRequests).toBe(1);
		expect(result.previous.instanceId).toBe(app.instanceId);
		expect(result.replacement.instanceId).toBe(replacementId);
		expect(result.replacement.remoteBridgeOriginAccess).toBe("auto");
	});

	test("accepts exact public and internal reverse-proxy origins", async () => {
		const root = await repositoryFixture("public-origin");
		const port = freePort();
		Bun.env.COUCHVIEW_ALLOWED_ORIGINS = "https://review.example.com";
		Bun.env.ALLOWED_ORIGINS = "https://internal-proxy.example.com";

		const result = await startServer(
			["--repo", root, "--host", "127.0.0.1", "--port", String(port)],
			runtime,
		);
		if (!result.app || !result.stop) {
			throw new Error("CLI unexpectedly attached to another server");
		}
		try {
			for (const origin of ["https://review.example.com", "https://internal-proxy.example.com"]) {
				const response = await result.app.fetch(
					new Request(`${origin}/api/instance`, {
						headers: {
							host: new URL(origin).host,
							origin,
						},
					}),
				);
				expect(response.status).toBe(200);
			}
		} finally {
			result.stop();
		}
	});

	test("enables terminal access automatically only for loopback origins", async () => {
		const loopbackRoot = await repositoryFixture("terminal-loopback");
		const loopback = await startServer(
			["--repo", loopbackRoot, "--port", String(freePort())],
			runtime,
		);
		if (!loopback.app || !loopback.stop) {
			throw new Error("CLI unexpectedly attached to another server");
		}
		expect(loopback.app.terminalSessions.enabled).toBe(true);
		loopback.stop();

		const publicRoot = await repositoryFixture("terminal-public");
		Bun.env.COUCHVIEW_ALLOWED_ORIGINS = "https://review.example.com";
		const publicServer = await startServer(
			["--repo", publicRoot, "--port", String(freePort())],
			runtime,
		);
		if (!publicServer.app || !publicServer.stop) {
			throw new Error("CLI unexpectedly attached to another server");
		}
		expect(publicServer.app.terminalSessions.enabled).toBe(false);
		publicServer.stop();

		const warningRoot = await repositoryFixture("terminal-explicit-public");
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...values: unknown[]) => warnings.push(values.join(" "));
		try {
			const explicit = await startServer(
				["--repo", warningRoot, "--port", String(freePort()), "--enable-terminal"],
				runtime,
			);
			if (!explicit.app || !explicit.stop) {
				throw new Error("CLI unexpectedly attached to another server");
			}
			expect(explicit.app.terminalSessions.enabled).toBe(true);
			expect(warnings.join("\n")).toContain("OS-user permissions");
			explicit.stop();
		} finally {
			console.warn = originalWarn;
		}
	});

	test("rejects reuse when explicit terminal policy conflicts", async () => {
		const firstRoot = await repositoryFixture("terminal-owner");
		const secondRoot = await repositoryFixture("terminal-client");
		const port = freePort();
		await runningApp(firstRoot, port);
		await expect(
			startServer(["--repo", secondRoot, "--port", String(port), "--disable-terminal"], runtime),
		).rejects.toThrow("terminal access enabled");
	});

	test("requires terminal access for P2P and reports the privacy boundary when enabled", async () => {
		const disabledRoot = await repositoryFixture("p2p-terminal-disabled");
		await expect(
			startServer(
				[
					"--repo",
					disabledRoot,
					"--port",
					String(freePort()),
					"--disable-terminal",
					"--enable-terminal-p2p",
				],
				runtime,
			),
		).rejects.toThrow("Terminal P2P requires terminal access");

		const enabledRoot = await repositoryFixture("p2p-enabled");
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...values: unknown[]) => warnings.push(values.join(" "));
		try {
			const result = await startServer(
				["--repo", enabledRoot, "--port", String(freePort()), "--enable-terminal-p2p"],
				runtime,
			);
			if (!result.app || !result.stop) throw new Error("CLI unexpectedly reused a server");
			expect(result.app.terminalSessions.p2pEnabled).toBe(true);
			expect(result.app.terminalSessions.stunUrls).toEqual(["stun:stun.cloudflare.com:3478"]);
			expect(warnings.join("\n")).toContain("peer");
			expect(warnings.join("\n")).toContain("bypass Cloudflare");
			result.stop();
		} finally {
			console.warn = originalWarn;
		}
	});

	test("rejects running-server reuse when explicit P2P policy conflicts", async () => {
		const firstRoot = await repositoryFixture("p2p-owner");
		const secondRoot = await repositoryFixture("p2p-client");
		const port = freePort();
		await runningApp(firstRoot, port);
		await expect(
			startServer(["--repo", secondRoot, "--port", String(port), "--enable-terminal-p2p"], runtime),
		).rejects.toThrow("terminal P2P disabled");
	});

	test("adds a second project to a compatible server, then reports duplicates", async () => {
		const firstRoot = await repositoryFixture("first");
		const secondRoot = await repositoryFixture("second");
		const port = freePort();
		const publicOrigin = "https://review.example.com";
		const app = await runningApp(firstRoot, port, undefined, [publicOrigin]);
		const messages: string[] = [];
		const originalLog = console.log;
		console.log = (...values: unknown[]) => messages.push(values.join(" "));
		try {
			const added = await startServer(["--repo", secondRoot, "--port", String(port)], runtime);
			if (!added.registered) throw new Error("CLI unexpectedly started another server");
			expect(added.registered.registration.added).toBe(true);
			expect(app.database.repositories()).toHaveLength(2);
			expect(messages.join("\n")).toContain("Repository added to the running Couchview server.");
			expect(messages.join("\n")).toContain(
				`/?repo=${added.registered.registration.repository.id}`,
			);
			expect(messages.join("\n")).toContain(
				`${publicOrigin}/?repo=${added.registered.registration.repository.id}`,
			);
			expect(messages.join("\n")).toContain(
				`http://127.0.0.1:${port}/?repo=${added.registered.registration.repository.id}`,
			);

			messages.length = 0;
			const duplicate = await startServer(["--repo", secondRoot, "--port", String(port)], runtime);
			if (!duplicate.registered) throw new Error("CLI unexpectedly started another server");
			expect(duplicate.registered.registration.added).toBe(false);
			expect(messages.join("\n")).toContain(
				"Repository is already available in the running Couchview server.",
			);
		} finally {
			console.log = originalLog;
		}
	});

	test("rejects unrelated services, data-directory mismatches, and incompatible binds", async () => {
		const root = await repositoryFixture("first");
		const otherRoot = await repositoryFixture("second");

		const unrelatedPort = freePort();
		endpoints.set(unrelatedPort, () => Response.json({ service: "something-else" }));
		await expect(
			startServer(["--repo", root, "--port", String(unrelatedPort)], runtime),
		).rejects.toThrow("not a compatible Couchview server");

		const incompatiblePort = freePort();
		await runningApp(root, incompatiblePort);
		await expect(
			startServer(
				["--repo", otherRoot, "--host", "0.0.0.0", "--port", String(incompatiblePort)],
				runtime,
			),
		).rejects.toThrow("does not satisfy --host 0.0.0.0");

		const dataMismatchPort = freePort();
		const otherDataHome = await mkdtemp(path.join(tmpdir(), "couchview-cli-other-data-"));
		temporaryDirectories.push(otherDataHome);
		await runningApp(root, dataMismatchPort, path.join(otherDataHome, "couchview", "state.sqlite"));
		await expect(
			startServer(["--repo", otherRoot, "--port", String(dataMismatchPort)], runtime),
		).rejects.toThrow("different XDG data directory");
	});

	test("development ownership mode refuses to attach to an occupied endpoint", async () => {
		const firstRoot = await repositoryFixture("first");
		const secondRoot = await repositoryFixture("second");
		const port = freePort();
		await runningApp(firstRoot, port);
		Bun.env.COUCHVIEW_DISABLE_REUSE = "1";
		await expect(
			startServer(["--repo", secondRoot, "--port", String(port)], runtime),
		).rejects.toThrow(/EADDRINUSE|address already in use/i);
	});

	test("retries discovery when another process wins the startup bind race", async () => {
		const firstRoot = await repositoryFixture("first");
		const secondRoot = await repositoryFixture("second");
		const port = freePort();
		const incumbent = await createCouchviewApp({
			root: firstRoot,
			host: "127.0.0.1",
			port,
		});
		incumbent.registerServerInstance();
		applications.push(incumbent);

		let raced = false;
		const raceServe = ((options: Parameters<typeof runtimeServe>[0]) => {
			if (!raced) {
				raced = true;
				endpoints.set(port, incumbent.fetch);
				const error = new Error("Failed to listen: address already in use");
				Object.assign(error, { code: "EADDRINUSE" });
				throw error;
			}
			return runtimeServe(options as never);
		}) as typeof Bun.serve;

		const originalLog = console.log;
		console.log = () => undefined;
		try {
			const result = await startServer(["--repo", secondRoot, "--port", String(port)], {
				fetch: runtimeFetch,
				serve: raceServe,
			});
			expect(result.registered?.registration.repository.root).toContain(
				secondRoot.split("/").at(-1)!,
			);
			expect(incumbent.database.repositories()).toHaveLength(2);
		} finally {
			console.log = originalLog;
		}
	});
});
