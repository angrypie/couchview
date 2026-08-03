import path from "node:path";

import type { RemoteBridgeProfile } from "../shared/contracts.ts";
import {
	type RemoteBridgePaths,
	resolveRemoteBridgePaths,
	resolveRemoteBridgeProfile,
} from "./remoteBridgeClient.ts";

interface RemoteInteractiveProcess {
	exited: Promise<number>;
	kill(signal: NodeJS.Signals): void;
}

interface RemoteInteractiveSpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	stdin: "inherit";
	stdout: "inherit";
	stderr: "inherit";
}

export interface RemoteTerminalClientRuntime {
	paths: RemoteBridgePaths;
	env: NodeJS.ProcessEnv;
	which(command: "ssh"): string | null;
	spawn(command: string[], options: RemoteInteractiveSpawnOptions): RemoteInteractiveProcess;
	onExit(listener: () => void): void;
	offExit(listener: () => void): void;
	stderr(message: string): void;
}

export interface RunRemoteTerminalOptions {
	profileSelector?: string | null;
	repositoryRoot?: string | null;
}

export interface RunRemoteClaudeOptions extends RunRemoteTerminalOptions {
	claudeArgs?: readonly string[];
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function assertAbsoluteRepository(repositoryRoot: string, launcher: string): void {
	if (!path.isAbsolute(repositoryRoot)) {
		throw new Error(`The remote ${launcher} repository path must be absolute`);
	}
}

function remoteShellCommand(script: string): string {
	return `exec /bin/sh -c ${shellQuote(script)}`;
}

function remoteInteractiveEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	if (environment.TERM !== "xterm-ghostty") return environment;
	return { ...environment, TERM: "xterm-256color" };
}

export function remoteTerminalLaunchCommand(
	profile: RemoteBridgeProfile,
	options: {
		sshExecutable: string;
		repositoryRoot?: string;
	},
): string[] {
	const repositoryRoot = options.repositoryRoot ?? profile.repositoryRoot;
	assertAbsoluteRepository(repositoryRoot, "terminal");
	const unavailableMessage =
		"The remote login shell is unavailable; verify the account's SHELL setting.";
	const script = [
		`cd -- ${shellQuote(repositoryRoot)} || exit $?;`,
		'login_shell="${SHELL:-/bin/sh}";',
		'if [ ! -x "$login_shell" ]; then',
		'login_shell="$(command -v "$login_shell" 2>/dev/null)";',
		"fi;",
		'if [ -z "$login_shell" ] || [ ! -x "$login_shell" ]; then',
		`printf '%s\\n' ${shellQuote(unavailableMessage)} >&2;`,
		"exit 127;",
		"fi;",
		'exec "$login_shell" -l',
	].join(" ");
	return [options.sshExecutable, "-t", profile.sshAlias, remoteShellCommand(script)];
}

export function remoteClaudeLaunchCommand(
	profile: RemoteBridgeProfile,
	options: {
		sshExecutable: string;
		repositoryRoot?: string;
		claudeArgs?: readonly string[];
	},
): string[] {
	const repositoryRoot = options.repositoryRoot ?? profile.repositoryRoot;
	assertAbsoluteRepository(repositoryRoot, "Claude Code");
	const unavailableMessage =
		"Claude Code is not available in the remote login shell or standard user-local bin directories; install it and run claude auth login there.";
	const argumentsSuffix = options.claudeArgs?.length
		? ` ${options.claudeArgs.map(shellQuote).join(" ")}`
		: "";
	const script = [
		'PATH="${HOME}/.local/bin:${HOME}/.claude/local:${HOME}/.bun/bin:${HOME}/.npm-global/bin:${HOME}/.volta/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}";',
		"export PATH;",
		'claude_executable="$(command -v claude 2>/dev/null)";',
		'if [ -z "$claude_executable" ] || [ ! -x "$claude_executable" ]; then',
		`printf '%s\\n' ${shellQuote(unavailableMessage)} >&2;`,
		"exit 127;",
		"fi;",
		`cd -- ${shellQuote(repositoryRoot)} &&`,
		`exec \"$claude_executable\" remote-control${argumentsSuffix}`,
	].join(" ");
	return [options.sshExecutable, "-t", profile.sshAlias, remoteShellCommand(script)];
}

function defaultRuntime(): RemoteTerminalClientRuntime {
	return {
		paths: resolveRemoteBridgePaths(),
		env: process.env,
		which: (command) => Bun.which(command),
		spawn(command, options) {
			const child = Bun.spawn(command, options);
			return {
				exited: child.exited,
				kill(signal) {
					child.kill(signal);
				},
			};
		},
		onExit: (listener) => process.on("exit", listener),
		offExit: (listener) => process.off("exit", listener),
		stderr: (message) => process.stderr.write(`${message}\n`),
	};
}

function safeKill(child: RemoteInteractiveProcess | null): void {
	try {
		child?.kill("SIGTERM");
	} catch {
		// The SSH process may already have exited.
	}
}

async function runRemoteInteractive(
	kind: "terminal" | "claude",
	options: RunRemoteClaudeOptions,
	runtimeOverrides: Partial<RemoteTerminalClientRuntime>,
): Promise<number> {
	const runtime = { ...defaultRuntime(), ...runtimeOverrides };
	const profile = await resolveRemoteBridgeProfile(options.profileSelector, runtime.paths);
	const repositoryRoot = options.repositoryRoot ?? profile.repositoryRoot;
	assertAbsoluteRepository(repositoryRoot, kind === "terminal" ? "terminal" : "Claude Code");
	const sshExecutable = runtime.which("ssh");
	if (!sshExecutable) {
		throw new Error("OpenSSH is not available on this computer");
	}
	const command =
		kind === "terminal"
			? remoteTerminalLaunchCommand(profile, {
					sshExecutable,
					repositoryRoot,
				})
			: remoteClaudeLaunchCommand(profile, {
					sshExecutable,
					repositoryRoot,
					claudeArgs: options.claudeArgs,
				});
	runtime.stderr(
		kind === "terminal"
			? `Couchview bridge: opening a terminal in ${repositoryRoot} on ${profile.sshAlias}…`
			: `Couchview bridge: starting Claude Code Remote Control in ${repositoryRoot} on ${profile.sshAlias}…`,
	);

	let child: RemoteInteractiveProcess | null = null;
	let exited = false;
	const stopChild = (): void => safeKill(child);
	runtime.onExit(stopChild);
	try {
		child = runtime.spawn(command, {
			cwd: process.cwd(),
			env: remoteInteractiveEnvironment(runtime.env),
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await child.exited;
		exited = true;
		return exitCode;
	} finally {
		runtime.offExit(stopChild);
		if (!exited) safeKill(child);
	}
}

export async function runRemoteTerminal(
	options: RunRemoteTerminalOptions = {},
	runtimeOverrides: Partial<RemoteTerminalClientRuntime> = {},
): Promise<number> {
	return await runRemoteInteractive("terminal", options, runtimeOverrides);
}

export async function runRemoteClaude(
	options: RunRemoteClaudeOptions = {},
	runtimeOverrides: Partial<RemoteTerminalClientRuntime> = {},
): Promise<number> {
	return await runRemoteInteractive("claude", options, runtimeOverrides);
}
