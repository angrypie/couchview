#!/usr/bin/env bun

import path from "node:path";

import type { RemoteBridgeProfile } from "../shared/contracts.ts";
import { runArtifactCli } from "./artifactCli.ts";
import { browseRunningServer } from "./cliBrowse.ts";
import {
	CLI_VERSION,
	CliPromptInterrupted,
	CliUsageError,
	createInteractivePrompter,
	type InteractivePrompter,
	type ParsedArtifactArguments,
	parseCliInvocation,
	promptForServeArguments,
	renderCliHelp,
} from "./cliCommand.ts";
import {
	parseRestartCli,
	type RestartCliOptions,
	restartRunningServer,
} from "./cliRunningServer.ts";
import { type CliOptions, parseCli } from "./cliServeOptions.ts";
import { startServer } from "./cliServer.ts";
import { supervisedWorkerEnvironment, superviseServer } from "./cliSupervisor.ts";
import {
	pairRemoteBridge,
	remoteBridgeClaudeCommand,
	remoteBridgeCodexCommand,
	remoteBridgeTerminalCommand,
	remoteBridgeZedUrl,
	runRemoteBridgeProxy,
} from "./remoteBridgeClient.ts";
import { runRemoteCodex } from "./remoteCodexClient.ts";
import { runRemoteClaude, runRemoteTerminal } from "./remoteTerminalClient.ts";
import { normalizeBindHost } from "./server.ts";

export { replaceStaticBuild, restartCapability } from "./cliBuild.ts";
export { restartRunningServer } from "./cliRunningServer.ts";
export {
	DEFAULT_REMOTE_BRIDGE_STUN_URLS,
	DEFAULT_TERMINAL_STUN_URLS,
	parseCli,
	parseRemoteBridgeStunUrls,
	parseTerminalStunUrls,
	type RemoteBridgeMode,
	type RemoteBridgeP2pMode,
	type SpeechMode,
	type TerminalMode,
	type TerminalP2pMode,
} from "./cliServeOptions.ts";
export { printServerAccess, startServer } from "./cliServer.ts";
export { SUPERVISOR_RESTART_EXIT_CODE, superviseServer } from "./cliSupervisor.ts";

interface RunCliRuntime {
	supervise(argv: string[]): Promise<number>;
	start(argv: string[]): Promise<unknown>;
	restart(argv: string[]): Promise<unknown>;
	browse(argv: string[]): Promise<string>;
	pairBridge(options: {
		origin: string;
		code: string;
		originAccess: string;
	}): Promise<RemoteBridgeProfile>;
	proxyBridge(profileId: string): Promise<number>;
	codexBridge(options: {
		profileSelector: string | null;
		repositoryRoot: string | null;
		codexArgs: string[];
	}): Promise<number>;
	terminalBridge(options: {
		profileSelector: string | null;
		repositoryRoot: string | null;
	}): Promise<number>;
	claudeBridge(options: {
		profileSelector: string | null;
		repositoryRoot: string | null;
		claudeArgs: string[];
	}): Promise<number>;
	artifacts(options: ParsedArtifactArguments): Promise<number>;
	createPrompter(): InteractivePrompter;
	stdout(message: string): void;
	stderr(message: string): void;
	supervisedWorker: boolean;
}

function validateInteractivePort(value: string): number {
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		throw new Error("Port must be between 1 and 65535");
	}
	return port;
}

function validateServeInvocation(argv: string[]): CliOptions {
	try {
		return parseCli(argv);
	} catch (error) {
		if (error instanceof CliUsageError) throw error;
		throw new CliUsageError((error as Error).message, "serve");
	}
}

function validateRestartInvocation(argv: string[]): RestartCliOptions {
	try {
		return parseRestartCli(argv);
	} catch (error) {
		if (error instanceof CliUsageError) throw error;
		throw new CliUsageError((error as Error).message, "restart");
	}
}

export async function runCli(
	argv = process.argv.slice(2),
	runtimeOverrides: Partial<RunCliRuntime> = {},
): Promise<number> {
	const runtime: RunCliRuntime = {
		supervise: runtimeOverrides.supervise ?? superviseServer,
		start: runtimeOverrides.start ?? startServer,
		restart: runtimeOverrides.restart ?? restartRunningServer,
		browse: runtimeOverrides.browse ?? browseRunningServer,
		pairBridge: runtimeOverrides.pairBridge ?? pairRemoteBridge,
		proxyBridge: runtimeOverrides.proxyBridge ?? runRemoteBridgeProxy,
		codexBridge: runtimeOverrides.codexBridge ?? ((options) => runRemoteCodex(options)),
		terminalBridge: runtimeOverrides.terminalBridge ?? ((options) => runRemoteTerminal(options)),
		claudeBridge: runtimeOverrides.claudeBridge ?? ((options) => runRemoteClaude(options)),
		artifacts: runtimeOverrides.artifacts ?? runArtifactCli,
		createPrompter: runtimeOverrides.createPrompter ?? createInteractivePrompter,
		stdout: runtimeOverrides.stdout ?? ((message) => process.stdout.write(`${message}\n`)),
		stderr: runtimeOverrides.stderr ?? ((message) => process.stderr.write(`${message}\n`)),
		supervisedWorker:
			runtimeOverrides.supervisedWorker ?? Bun.env[supervisedWorkerEnvironment] === "1",
	};
	let action =
		argv[0] === "restart"
			? "restart"
			: argv[0] === "browse"
				? "open the repository in a browser"
				: argv[0] === "bridge"
					? "run the native bridge"
					: argv[0] === "artifacts"
						? "work with artifacts"
						: "start";
	try {
		const invocation = parseCliInvocation(argv);
		if (invocation.kind === "help") {
			runtime.stdout(await renderCliHelp(invocation.path));
			return 0;
		}
		if (invocation.kind === "version") {
			runtime.stdout(`couchview ${CLI_VERSION}`);
			return 0;
		}
		if (invocation.kind === "bridge-pair") {
			action = "pair the native bridge";
			const profile = await runtime.pairBridge({
				origin: invocation.origin,
				code: invocation.code,
				originAccess: invocation.originAccess,
			});
			runtime.stdout(`Paired '${profile.deviceLabel}' as SSH host ${profile.sshAlias}.`);
			runtime.stdout(`Open in Zed: ${remoteBridgeZedUrl(profile)}`);
			runtime.stdout(`Open in Codex CLI: ${remoteBridgeCodexCommand(profile)}`);
			runtime.stdout(`Open a remote terminal: ${remoteBridgeTerminalCommand(profile)}`);
			runtime.stdout(`Start Claude Code Remote Control: ${remoteBridgeClaudeCommand(profile)}`);
			return 0;
		}
		if (invocation.kind === "bridge-proxy") {
			action = "run the native bridge proxy";
			return await runtime.proxyBridge(invocation.profileId);
		}
		if (invocation.kind === "bridge-codex") {
			action = "connect Codex through the native bridge";
			return await runtime.codexBridge({
				profileSelector: invocation.profileSelector,
				repositoryRoot: invocation.repositoryRoot,
				codexArgs: invocation.codexArgs,
			});
		}
		if (invocation.kind === "bridge-terminal") {
			action = "open a terminal through the native bridge";
			return await runtime.terminalBridge({
				profileSelector: invocation.profileSelector,
				repositoryRoot: invocation.repositoryRoot,
			});
		}
		if (invocation.kind === "bridge-claude") {
			action = "start Claude Code Remote Control through the native bridge";
			return await runtime.claudeBridge({
				profileSelector: invocation.profileSelector,
				repositoryRoot: invocation.repositoryRoot,
				claudeArgs: invocation.claudeArgs,
			});
		}
		if (invocation.kind === "artifacts") {
			action = `${invocation.parsed.action} artifacts`;
			return await runtime.artifacts(invocation.parsed);
		}
		if (invocation.kind === "restart") {
			action = "restart";
			validateRestartInvocation(invocation.argv);
			await runtime.restart(invocation.argv);
			return 0;
		}
		if (invocation.kind === "browse") {
			action = "open the repository in a browser";
			const url = await runtime.browse(invocation.argv);
			runtime.stdout(`Opened ${url}`);
			return 0;
		}

		let serveArgv = invocation.argv;
		const options = validateServeInvocation(serveArgv);
		if (invocation.parsed.interactive) {
			const prompter = runtime.createPrompter();
			try {
				serveArgv = await promptForServeArguments(invocation.parsed, options, prompter, {
					root(value) {
						if (!value) throw new Error("Repository path is required");
						return path.resolve(value);
					},
					host(value) {
						if (!value) throw new Error("Host is required");
						return normalizeBindHost(value);
					},
					port: validateInteractivePort,
				});
			} finally {
				prompter.close();
			}
			validateServeInvocation(serveArgv);
		}

		if (runtime.supervisedWorker) {
			await runtime.start(serveArgv);
			return 0;
		}
		return await runtime.supervise(serveArgv);
	} catch (error) {
		if (error instanceof CliPromptInterrupted) {
			runtime.stderr(error.message);
			return 130;
		}
		if (error instanceof CliUsageError) {
			const help = error.helpCommand ? `couchview ${error.helpCommand} --help` : "couchview --help";
			runtime.stderr(`error: ${error.message}\nTry '${help}' for more information.`);
			return 2;
		}
		runtime.stderr(`Couchview could not ${action}: ${(error as Error).message}`);
		return 1;
	}
}

if (import.meta.main) {
	void runCli().then((exitCode) => {
		process.exitCode = exitCode;
	});
}
