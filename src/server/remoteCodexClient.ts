import { randomInt } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";

import type { RemoteBridgeProfile } from "../shared/contracts.ts";
import {
	type RemoteBridgePaths,
	resolveRemoteBridgePaths,
	resolveRemoteBridgeProfile,
} from "./remoteBridgeClient.ts";

const CODEX_STARTUP_TIMEOUT_MS = 20_000;
const CODEX_READY_POLL_MS = 100;
const CODEX_READY_REQUEST_TIMEOUT_MS = 500;
const PROCESS_STOP_TIMEOUT_MS = 2_000;
const MAX_DIAGNOSTIC_CHARACTERS = 16 * 1024;
const MAX_CODEX_START_ATTEMPTS = 3;
const MIN_REMOTE_CODEX_PORT = 40_000;
const MAX_REMOTE_CODEX_PORT_EXCLUSIVE = 60_000;
const PORT_CONFLICT_PATTERN =
	/address already in use|cannot listen to port|could not request local forwarding|bind.+failed/i;

interface RemoteCodexProcess {
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exited: Promise<number>;
	kill(signal: NodeJS.Signals): void;
}

interface RemoteCodexSpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	stdin: "ignore" | "inherit";
	stdout: "pipe" | "inherit";
	stderr: "pipe" | "inherit";
}

export interface RemoteCodexClientRuntime {
	paths: RemoteBridgePaths;
	which(command: "codex" | "ssh"): string | null;
	spawn(command: string[], options: RemoteCodexSpawnOptions): RemoteCodexProcess;
	allocateLocalPort(): Promise<number>;
	selectRemotePort(): number;
	probeReady(url: string): Promise<boolean>;
	now(): number;
	wait(milliseconds: number): Promise<void>;
	onExit(listener: () => void): void;
	offExit(listener: () => void): void;
	stderr(message: string): void;
}

export interface RunRemoteCodexOptions {
	profileSelector?: string | null;
	repositoryRoot?: string | null;
	codexArgs?: readonly string[];
}

export interface RemoteCodexLaunchCommands {
	tunnel: string[];
	client: string[];
	readyUrl: string;
}

interface CapturedStream {
	done: Promise<void>;
	text(): string;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function allocateLoopbackPort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer();
		const finish = (error?: Error): void => {
			server.removeAllListeners();
			if (error) reject(error);
		};
		server.once("error", finish);
		server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => finish(new Error("Could not allocate a local Codex port")));
				return;
			}
			const port = address.port;
			server.close((error) => {
				if (error) finish(error);
				else resolve(port);
			});
		});
		server.unref();
	});
}

async function probeCodexReady(url: string): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), CODEX_READY_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: "GET",
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

function defaultRuntime(): RemoteCodexClientRuntime {
	return {
		paths: resolveRemoteBridgePaths(),
		which: (command) => Bun.which(command),
		spawn(command, options) {
			const child = Bun.spawn(command, options);
			return {
				stdout: child.stdout ?? null,
				stderr: child.stderr ?? null,
				exited: child.exited,
				kill(signal) {
					child.kill(signal);
				},
			};
		},
		allocateLocalPort: allocateLoopbackPort,
		selectRemotePort: () => randomInt(MIN_REMOTE_CODEX_PORT, MAX_REMOTE_CODEX_PORT_EXCLUSIVE),
		probeReady: probeCodexReady,
		now: Date.now,
		wait: (milliseconds) => Bun.sleep(milliseconds),
		onExit: (listener) => process.on("exit", listener),
		offExit: (listener) => process.off("exit", listener),
		stderr: (message) => process.stderr.write(`${message}\n`),
	};
}

function appendDiagnostic(current: string, next: string): string {
	const combined = current + next;
	return combined.length <= MAX_DIAGNOSTIC_CHARACTERS
		? combined
		: combined.slice(combined.length - MAX_DIAGNOSTIC_CHARACTERS);
}

function captureStream(stream: ReadableStream<Uint8Array> | null): CapturedStream {
	let captured = "";
	const done = (async () => {
		if (!stream) return;
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const result = await reader.read();
				if (result.done) break;
				captured = appendDiagnostic(captured, decoder.decode(result.value, { stream: true }));
			}
			captured = appendDiagnostic(captured, decoder.decode());
		} finally {
			reader.releaseLock();
		}
	})().catch(() => undefined);
	return {
		done,
		text: () => captured,
	};
}

function processDiagnostic(stdout: CapturedStream, stderr: CapturedStream): string {
	return [stdout.text(), stderr.text()]
		.map((value) => value.trim())
		.filter(Boolean)
		.join("\n")
		.slice(-MAX_DIAGNOSTIC_CHARACTERS);
}

function isPortConflictDiagnostic(diagnostic: string): boolean {
	return PORT_CONFLICT_PATTERN.test(diagnostic);
}

function remoteCodexStartupError(
	profile: RemoteBridgeProfile,
	exitCode: number,
	diagnostic: string,
): Error {
	const details = diagnostic ? `\n${diagnostic}` : "";
	if (/host key verification failed/i.test(diagnostic)) {
		return new Error(
			`SSH host-key verification for ${profile.sshAlias} failed. Run 'ssh ${profile.sshAlias}' once to verify and store the Mini's host key.${details}`,
		);
	}
	if (
		/permission denied|too many authentication failures|no supported authentication methods/i.test(
			diagnostic,
		)
	) {
		return new Error(
			`SSH authentication to ${profile.sshAlias} failed. Verify it with 'ssh ${profile.sshAlias}' or install this computer's public key with 'ssh-copy-id ${profile.sshAlias}'.${details}`,
		);
	}
	return new Error(
		`SSH bridge to ${profile.sshAlias} exited with code ${exitCode}${
			diagnostic ? `:\n${diagnostic}` : ""
		}`,
	);
}

function safeKill(child: RemoteCodexProcess | null, signal: NodeJS.Signals): void {
	try {
		child?.kill(signal);
	} catch {
		// The child may already have exited.
	}
}

async function stopProcess(
	child: RemoteCodexProcess | null,
	runtime: RemoteCodexClientRuntime,
): Promise<void> {
	if (!child) return;
	let exited = false;
	void child.exited.then(
		() => {
			exited = true;
		},
		() => {
			exited = true;
		},
	);
	safeKill(child, "SIGTERM");
	await Promise.race([child.exited.catch(() => undefined), runtime.wait(PROCESS_STOP_TIMEOUT_MS)]);
	if (exited) return;
	safeKill(child, "SIGKILL");
	await Promise.race([child.exited.catch(() => undefined), runtime.wait(PROCESS_STOP_TIMEOUT_MS)]);
}

function assertCodexArguments(args: readonly string[]): void {
	const controlledOptions = ["--remote", "--remote-auth-token-env", "--cd", "--add-dir"];
	for (const argument of args) {
		if (
			argument.startsWith("-C") ||
			controlledOptions.some((option) => argument === option || argument.startsWith(`${option}=`))
		) {
			throw new Error(`Codex option '${argument}' is controlled by the Couchview bridge`);
		}
	}
}

export async function resolveRemoteCodexProfile(
	selector: string | null | undefined,
	paths = resolveRemoteBridgePaths(),
): Promise<RemoteBridgeProfile> {
	return await resolveRemoteBridgeProfile(selector, paths);
}

export function remoteCodexLaunchCommands(
	profile: RemoteBridgeProfile,
	options: {
		sshExecutable: string;
		codexExecutable: string;
		localPort: number;
		remotePort: number;
		repositoryRoot?: string;
		codexArgs?: readonly string[];
	},
): RemoteCodexLaunchCommands {
	const codexArgs = [...(options.codexArgs ?? [])];
	assertCodexArguments(codexArgs);
	const repositoryRoot = options.repositoryRoot ?? profile.repositoryRoot;
	if (!path.isAbsolute(repositoryRoot)) {
		throw new Error("The remote Codex repository path must be absolute");
	}
	const remoteEndpoint = `ws://127.0.0.1:${options.remotePort}`;
	const localEndpoint = `ws://127.0.0.1:${options.localPort}`;
	const unavailableMessage =
		"Codex CLI is not available in the Mini login shell or standard user-local bin directories; install it and run codex login there.";
	const appServerCommand = [
		'PATH="${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.npm-global/bin:${HOME}/.volta/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}";',
		"export PATH;",
		'codex_executable="$(command -v codex 2>/dev/null)";',
		'if [ -z "$codex_executable" ] || [ ! -x "$codex_executable" ]; then',
		`printf '%s\\n' ${shellQuote(unavailableMessage)} >&2;`,
		"exit 127;",
		"fi;",
		`cd -- ${shellQuote(repositoryRoot)} &&`,
		`exec "$codex_executable" app-server --listen ${shellQuote(remoteEndpoint)}`,
	].join(" ");
	const remoteShellCommand = `exec /bin/sh -c ${shellQuote(appServerCommand)}`;
	return {
		tunnel: [
			options.sshExecutable,
			"-T",
			"-o",
			"ExitOnForwardFailure=yes",
			"-L",
			`127.0.0.1:${options.localPort}:127.0.0.1:${options.remotePort}`,
			profile.sshAlias,
			remoteShellCommand,
		],
		client: [
			options.codexExecutable,
			"--remote",
			localEndpoint,
			"--cd",
			repositoryRoot,
			...codexArgs,
		],
		readyUrl: `http://127.0.0.1:${options.localPort}/readyz`,
	};
}

function cleanCodexEnvironment(): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	for (const key of [
		"CODEX_CI",
		"CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
		"CODEX_PERMISSION_PROFILE",
		"CODEX_SHELL",
		"CODEX_THREAD_ID",
	])
		delete environment[key];
	return environment;
}

export async function runRemoteCodex(
	options: RunRemoteCodexOptions = {},
	runtimeOverrides: Partial<RemoteCodexClientRuntime> = {},
): Promise<number> {
	const runtime = { ...defaultRuntime(), ...runtimeOverrides };
	const profile = await resolveRemoteCodexProfile(options.profileSelector, runtime.paths);
	const repositoryRoot = options.repositoryRoot ?? profile.repositoryRoot;
	if (!path.isAbsolute(repositoryRoot)) {
		throw new Error("The remote Codex repository path must be absolute");
	}
	const sshExecutable = runtime.which("ssh");
	if (!sshExecutable) {
		throw new Error("OpenSSH is not available on this computer");
	}
	const codexExecutable = runtime.which("codex");
	if (!codexExecutable) {
		throw new Error("Codex CLI is not available on this computer");
	}
	const environment = cleanCodexEnvironment();
	let commands: RemoteCodexLaunchCommands | null = null;
	let tunnel: RemoteCodexProcess | null = null;
	let client: RemoteCodexProcess | null = null;
	let tunnelExitCode: number | null = null;
	let clientExitCode: number | null = null;
	let tunnelStdout: CapturedStream | null = null;
	let tunnelStderr: CapturedStream | null = null;
	let tunnelExited: Promise<number> | null = null;
	const killChildren = (): void => {
		safeKill(client, "SIGTERM");
		safeKill(tunnel, "SIGTERM");
	};
	runtime.onExit(killChildren);
	try {
		runtime.stderr(`Couchview bridge: starting Codex in ${repositoryRoot} on ${profile.sshAlias}…`);
		for (let attempt = 1; attempt <= MAX_CODEX_START_ATTEMPTS; attempt += 1) {
			const localPort = await runtime.allocateLocalPort();
			const remotePort = runtime.selectRemotePort();
			commands = remoteCodexLaunchCommands(profile, {
				sshExecutable,
				codexExecutable,
				localPort,
				remotePort,
				repositoryRoot,
				codexArgs: options.codexArgs,
			});
			tunnelExitCode = null;
			tunnel = runtime.spawn(commands.tunnel, {
				cwd: process.cwd(),
				env: environment,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			tunnelStdout = captureStream(tunnel.stdout);
			tunnelStderr = captureStream(tunnel.stderr);
			tunnelExited = tunnel.exited.then((exitCode) => {
				tunnelExitCode = exitCode;
				return exitCode;
			});
			const deadline = runtime.now() + CODEX_STARTUP_TIMEOUT_MS;
			let ready = false;
			while (runtime.now() < deadline) {
				if (tunnelExitCode !== null) break;
				if (await runtime.probeReady(commands.readyUrl)) {
					ready = true;
					break;
				}
				await runtime.wait(CODEX_READY_POLL_MS);
			}
			if (ready) break;
			if (tunnelExitCode !== null) {
				await Promise.all([tunnelStdout.done, tunnelStderr.done]);
				const diagnostic = processDiagnostic(tunnelStdout, tunnelStderr);
				if (attempt < MAX_CODEX_START_ATTEMPTS && isPortConflictDiagnostic(diagnostic)) {
					runtime.stderr(
						`Couchview bridge: a Codex forwarding port was busy; retrying (${attempt + 1}/${MAX_CODEX_START_ATTEMPTS}).`,
					);
					tunnel = null;
					tunnelStdout = null;
					tunnelStderr = null;
					tunnelExited = null;
					commands = null;
					continue;
				}
				throw remoteCodexStartupError(profile, tunnelExitCode, diagnostic);
			}
			throw new Error(
				`Timed out waiting for the Mini's Codex app-server through ${profile.sshAlias}`,
			);
		}
		if (!commands || !tunnel || !tunnelExited || !tunnelStdout || !tunnelStderr) {
			throw new Error("Could not start the Mini's Codex app-server");
		}

		runtime.stderr("Couchview bridge: remote Codex is ready; launching the local terminal UI.");
		client = runtime.spawn(commands.client, {
			cwd: process.cwd(),
			env: environment,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const clientExited = client.exited.then((exitCode) => {
			clientExitCode = exitCode;
			return exitCode;
		});
		const outcome = await Promise.race([
			clientExited.then((exitCode) => ({ source: "client" as const, exitCode })),
			tunnelExited.then((exitCode) => ({ source: "tunnel" as const, exitCode })),
		]);
		if (outcome.source === "client") return outcome.exitCode;

		await stopProcess(client, runtime);
		await Promise.all([tunnelStdout.done, tunnelStderr.done]);
		const diagnostic = processDiagnostic(tunnelStdout, tunnelStderr);
		throw new Error(
			`SSH bridge to ${profile.sshAlias} closed while Codex was running (exit ${outcome.exitCode})${
				diagnostic ? `:\n${diagnostic}` : ""
			}`,
		);
	} finally {
		runtime.offExit(killChildren);
		if (client && clientExitCode === null) await stopProcess(client, runtime);
		if (tunnel && tunnelExitCode === null) await stopProcess(tunnel, runtime);
	}
}
