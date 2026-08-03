import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { replaceStaticBuild, restartCapability } from "./cliBuild.ts";
import { type RunningRegistration, registerWithRunningServer } from "./cliRunningServer.ts";
import { type CliOptions, parseCliState } from "./cliServeOptions.ts";
import {
	restartDelayMs,
	SUPERVISOR_RESTART_EXIT_CODE,
	supervisedWorkerEnvironment,
} from "./cliSupervisor.ts";
import { HttpError } from "./errors.ts";
import { createCouchviewApp } from "./server.ts";
import { terminalAccessIsLoopback } from "./terminalSessions.ts";

interface StartServerRuntime {
	fetch: typeof globalThis.fetch;
	serve: typeof Bun.serve;
}

function projectOrigins(origins: readonly string[], repositoryId: string): string[] {
	return origins
		.filter((origin) => !origin.includes("//0.0.0.0:") && !origin.includes("//[::]:"))
		.sort((left, right) => {
			const leftLoopback = /\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(left);
			const rightLoopback = /\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(right);
			return Number(leftLoopback) - Number(rightLoopback) || left.localeCompare(right);
		})
		.map((origin) => {
			const url = new URL(origin);
			url.searchParams.set("repo", repositoryId);
			return url.toString();
		});
}

export function printServerAccess(
	origins: readonly string[],
	repositoryId: string,
	repositoryRoot: string,
	bindHost: string,
): void {
	const copyableOrigins = projectOrigins(origins, repositoryId);
	console.log(copyableOrigins.length === 1 ? "Couchview URL:" : "Couchview URLs:");
	for (const origin of copyableOrigins) console.log(`  ${origin}`);
	console.log(`Repository: ${repositoryRoot}`);
	if (bindHost === "0.0.0.0" || bindHost === "::") {
		console.warn("LAN access is enabled. Use a non-loopback URL above on your phone.");
	}
}

function addressInUse(error: unknown): boolean {
	return /EADDRINUSE|address already in use/i.test((error as Error).message);
}

async function retryRunningRegistration(
	options: CliOptions,
	explicitHost: boolean,
	fetchImplementation: typeof globalThis.fetch,
): Promise<RunningRegistration | null> {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		const result = await registerWithRunningServer(options, explicitHost, fetchImplementation);
		if (result) return result;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return null;
}

export async function startServer(
	argv = process.argv.slice(2),
	runtimeOverrides: Partial<StartServerRuntime> = {},
) {
	const runtime: StartServerRuntime = {
		fetch: runtimeOverrides.fetch ?? globalThis.fetch,
		serve: runtimeOverrides.serve ?? Bun.serve,
	};
	const { options, parsed } = parseCliState(argv);
	const explicitHost = parsed.explicit.host || Bun.env.COUCHVIEW_HOST !== undefined;
	const reuseEnabled = Bun.env.COUCHVIEW_DISABLE_REUSE !== "1";
	if (reuseEnabled) {
		const running = await registerWithRunningServer(options, explicitHost, runtime.fetch);
		if (running) {
			console.log(
				running.registration.added
					? "Repository added to the running Couchview server."
					: "Repository is already available in the running Couchview server.",
			);
			printServerAccess(
				running.instance.accessOrigins,
				running.registration.repository.id,
				running.registration.repository.root,
				running.instance.bindHost,
			);
			return { registered: running } as const;
		}
	}

	const defaultStaticDirectory = fileURLToPath(new URL("../../dist/", import.meta.url));
	const staticDirectory = path.resolve(Bun.env.STATIC_DIR ?? defaultStaticDirectory);
	const appRoot = fileURLToPath(new URL("../../", import.meta.url));
	const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
	const allowedOrigins = [Bun.env.COUCHVIEW_ALLOWED_ORIGINS, Bun.env.ALLOWED_ORIGINS]
		.filter((value): value is string => Boolean(value))
		.join(",")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	if (Bun.env.NODE_ENV === "development") {
		allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
	}
	const terminalLoopbackOnly = terminalAccessIsLoopback(options.host, allowedOrigins);
	const terminalEnabled =
		options.terminalMode === "enabled" || (options.terminalMode === "auto" && terminalLoopbackOnly);
	const terminalP2pEnabled = options.terminalP2pMode === "enabled";
	if (terminalP2pEnabled && !terminalEnabled) {
		throw new Error(
			"Terminal P2P requires terminal access; add --enable-terminal or remove --enable-terminal-p2p",
		);
	}
	const terminalDisabledReason =
		options.terminalMode === "disabled"
			? "Terminal access was disabled by configuration."
			: "Terminal access on non-loopback hosts requires --enable-terminal or COUCHVIEW_TERMINAL=1.";
	const remoteBridgeEnabled = options.remoteBridgeMode === "enabled";
	const remoteBridgeP2pEnabled = options.remoteBridgeP2pMode === "enabled";
	if (remoteBridgeP2pEnabled && !remoteBridgeEnabled) {
		throw new Error(
			"Native bridge P2P requires the native bridge; add --enable-remote-bridge or remove --enable-remote-bridge-p2p",
		);
	}
	const remoteBridgeDisabledReason =
		options.remoteBridgeMode === "disabled"
			? "Native remote development was disabled by configuration."
			: "Native remote development requires --enable-remote-bridge or COUCHVIEW_REMOTE_BRIDGE=1.";
	const capability = restartCapability();
	let restartInProgress = false;
	let relaunch: () => void = () => undefined;
	const app = await createCouchviewApp({
		root: options.root,
		host: options.host,
		port: options.port,
		staticDirectory,
		allowedOrigins,
		terminal: {
			enabled: terminalEnabled,
			disabledReason: terminalEnabled ? undefined : terminalDisabledReason,
			p2pEnabled: terminalP2pEnabled,
			stunUrls: options.terminalStunUrls,
		},
		remoteBridge: {
			enabled: remoteBridgeEnabled,
			disabledReason: remoteBridgeEnabled ? undefined : remoteBridgeDisabledReason,
			p2pEnabled: remoteBridgeP2pEnabled,
			stunUrls: options.remoteBridgeStunUrls,
			targetPort: options.remoteBridgePort,
			originAccess: options.remoteBridgeOriginAccess,
		},
		restart: {
			...capability,
			request: capability.available
				? async () => {
						if (restartInProgress) {
							throw new HttpError(409, "restart_in_progress", "Couchview is already rebuilding.");
						}
						restartInProgress = true;
						console.log("Rebuilding Couchview before restart...");
						const candidateDirectory = path.join(appRoot, `.couchview-build-${randomUUID()}`);
						let exitCode: number;
						try {
							const build = Bun.spawn(
								[process.execPath, "run", "build", "--outDir", candidateDirectory],
								{
									cwd: appRoot,
									env: process.env,
									stdin: "ignore",
									stdout: "inherit",
									stderr: "inherit",
									timeout: 5 * 60_000,
								},
							);
							exitCode = await build.exited;
						} catch (error) {
							restartInProgress = false;
							await rm(candidateDirectory, { recursive: true, force: true });
							console.error(`Couchview build could not start: ${(error as Error).message}`);
							throw new HttpError(
								500,
								"restart_build_failed",
								"The Couchview build could not start. Check the server terminal for details.",
							);
						}
						if (exitCode !== 0) {
							restartInProgress = false;
							await rm(candidateDirectory, { recursive: true, force: true });
							throw new HttpError(
								500,
								"restart_build_failed",
								"The Couchview build failed. Check the server terminal for details.",
							);
						}
						try {
							await replaceStaticBuild(candidateDirectory, staticDirectory);
						} catch (error) {
							restartInProgress = false;
							await rm(candidateDirectory, { recursive: true, force: true });
							console.error(
								`Couchview could not install its new build: ${(error as Error).message}`,
							);
							throw new HttpError(
								500,
								"restart_build_install_failed",
								"The new Couchview build could not replace the current build. Check the server terminal for details.",
							);
						}
						console.log("Couchview build finished. Restarting...");
						setTimeout(relaunch, restartDelayMs);
					}
				: undefined,
		},
	});

	let server: ReturnType<typeof Bun.serve>;
	try {
		server = runtime.serve({
			hostname: options.host,
			port: options.port,
			// EventSource connections stay open for the review session. The app
			// emits SSE heartbeats, while this avoids Bun's 10-second default.
			idleTimeout: 255,
			fetch: (request, bunServer) => app.fetchWithServer(request, bunServer),
			websocket: app.websocket,
		});
	} catch (error) {
		app.close();
		if (reuseEnabled && addressInUse(error)) {
			const running = await retryRunningRegistration(options, explicitHost, runtime.fetch);
			if (running) {
				console.log(
					running.registration.added
						? "Repository added to the running Couchview server."
						: "Repository is already available in the running Couchview server.",
				);
				printServerAccess(
					running.instance.accessOrigins,
					running.registration.repository.id,
					running.registration.repository.root,
					running.instance.bindHost,
				);
				return { registered: running } as const;
			}
		}
		throw error;
	}

	try {
		app.registerServerInstance();
	} catch (error) {
		void server.stop();
		app.close();
		throw error;
	}
	printServerAccess(app.accessOrigins, app.repository.id, app.repository.root, options.host);
	if (terminalEnabled && !terminalLoopbackOnly) {
		console.warn(
			"Browser terminal access is enabled beyond loopback. tmux and its programs run with your OS-user permissions; protect every exposed origin with trusted access control.",
		);
	}
	if (terminalP2pEnabled) {
		console.warn(
			"Direct terminal P2P is enabled. Authorized peers can learn this host's network addresses, and terminal payloads bypass Cloudflare after signaling; Access and the tunnel still protect signaling, authorization renewal, and WebSocket fallback.",
		);
	}
	if (remoteBridgeEnabled) {
		console.warn(
			`Native IDE bridge access is enabled for paired devices and can reach SSH only on 127.0.0.1:${options.remoteBridgePort}. Protect exposed Couchview origins with trusted access control.`,
		);
	}
	if (remoteBridgeP2pEnabled) {
		console.warn(
			"Direct native bridge P2P is enabled. Paired devices can learn this host's network addresses, and SSH payloads bypass Cloudflare after signaling; Access and the tunnel still protect signaling, lease renewal, and WebSocket fallback.",
		);
	}

	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		app.close();
		void server.stop();
	};
	relaunch = () => {
		if (stopped) return;
		const repositoryRoot = app.repository.root;
		stopped = true;
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		app.close();
		server.stop(true);
		if (Bun.env[supervisedWorkerEnvironment] === "1") {
			process.exit(SUPERVISOR_RESTART_EXIT_CODE);
		}
		try {
			const replacement = Bun.spawn(
				[
					process.execPath,
					"run",
					cliPath,
					"--repo",
					repositoryRoot,
					"--host",
					options.host,
					"--port",
					String(options.port),
					...(options.terminalMode === "enabled"
						? ["--enable-terminal"]
						: options.terminalMode === "disabled"
							? ["--disable-terminal"]
							: []),
					...(options.terminalP2pMode === "enabled"
						? ["--enable-terminal-p2p"]
						: options.terminalP2pMode === "disabled"
							? ["--disable-terminal-p2p"]
							: []),
					...(options.remoteBridgeMode === "enabled"
						? ["--enable-remote-bridge"]
						: options.remoteBridgeMode === "disabled"
							? ["--disable-remote-bridge"]
							: []),
					...(options.remoteBridgeP2pMode === "enabled"
						? ["--enable-remote-bridge-p2p"]
						: options.remoteBridgeP2pMode === "disabled"
							? ["--disable-remote-bridge-p2p"]
							: []),
				],
				{
					cwd: appRoot,
					env: {
						...process.env,
						COUCHVIEW_DISABLE_REUSE: "1",
					},
					stdin: "inherit",
					stdout: "inherit",
					stderr: "inherit",
				},
			);
			replacement.unref();
		} catch (error) {
			console.error(`Couchview could not relaunch: ${(error as Error).message}`);
			process.exitCode = 1;
		}
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	return { app, server, stop } as const;
}
