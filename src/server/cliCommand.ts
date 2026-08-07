import path from "node:path";
import { parseArgs } from "node:util";

import {
	REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
	remoteBridgeOriginAccessIdIsValid,
} from "../shared/contracts.ts";
import {
	type CliCommandName,
	type CliInvocation,
	CliUsageError,
	type CompletionShell,
	type ParsedArtifactArguments,
	type ParsedRestartArguments,
	type ParsedServeArguments,
} from "./cliCommandTypes.ts";
import {
	type CliOptionDefinition,
	type CliOptionType,
	commandNames,
	completionShells,
	nearestValue,
	optionsFor,
} from "./cliOptions.ts";

export {
	CLI_VERSION,
	type CliInvocation,
	CliPromptInterrupted,
	CliUsageError,
	type CompletionShell,
	type InteractivePrompter,
	type ParsedRestartArguments,
	type ParsedServeArguments,
} from "./cliCommandTypes.ts";
export { fishCompletionPath, renderCliHelp, renderCompletion } from "./cliHelp.ts";
export { createInteractivePrompter, promptForServeArguments } from "./cliPrompt.ts";

function normalizeSingleDashValues(command: CliCommandName, args: string[]): string[] {
	const stringOptions = new Map<string, CliOptionDefinition>();
	for (const option of optionsFor(command)) {
		if (option.type !== "string") continue;
		stringOptions.set(`--${option.name}`, option);
		if (option.short) stringOptions.set(`-${option.short}`, option);
	}
	const normalized: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--") {
			normalized.push(...args.slice(index));
			break;
		}
		const option = argument ? stringOptions.get(argument) : undefined;
		const value = args[index + 1];
		if (option && value?.startsWith("-") && !value.startsWith("--")) {
			normalized.push(`--${option.name}=${value}`);
			index += 1;
		} else if (argument !== undefined) {
			normalized.push(argument);
		}
	}
	return normalized;
}

function parseOptions(command: CliCommandName, args: string[]) {
	const options: Record<string, { type: CliOptionType; short?: string }> = {};
	for (const definition of optionsFor(command)) {
		options[definition.name] = {
			type: definition.type,
			...(definition.short ? { short: definition.short } : {}),
		};
	}
	try {
		return parseArgs({
			args: normalizeSingleDashValues(command, args),
			options,
			strict: true,
			allowPositionals: true,
			tokens: true,
		});
	} catch (error) {
		const message = (error as Error).message.replace(/^TypeError:\s*/i, "");
		const unknown = /Unknown option ['\"]?([^'\"\s]+)['\"]?/i.exec(message)?.[1];
		const suggestion = unknown
			? nearestValue(
					unknown,
					optionsFor(command).flatMap((option) => [
						`--${option.name}`,
						...(option.short ? [`-${option.short}`] : []),
					]),
				)
			: null;
		const missingValue = [
			["repo", "Repository path is required"],
			["host", "Host is required"],
			["port", "Port must be between 1 and 65535"],
			["url", "Couchview bridge URL is required"],
			["code", "Couchview bridge pairing code is required"],
			["profile", "Couchview bridge profile ID is required"],
			["origin-access", "Couchview bridge origin-access provider is required"],
			["repository", "Server repository ID or name is required"],
			["build", "Artifact build ID is required"],
			["output", "Artifact output file is required"],
			["remote-bridge-origin-access", "Native bridge origin-access provider is required"],
		].find(
			([name]) =>
				message.includes(`--${name}`) &&
				(/argument missing/i.test(message) || /argument is ambiguous/i.test(message)),
		)?.[1];
		const conciseMessage = missingValue ?? (unknown ? `Unknown option: ${unknown}.` : message);
		throw new CliUsageError(
			`${conciseMessage}${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
			command,
		);
	}
}

function booleanValue(values: Record<string, unknown>, name: string): boolean {
	return values[name] === true;
}

function stringValue(values: Record<string, unknown>, name: string): string | undefined {
	const value = values[name];
	return typeof value === "string" ? value : undefined;
}

function optionCount(tokens: ReturnType<typeof parseOptions>["tokens"], name: string): number {
	return tokens.filter((token) => token.kind === "option" && token.name === name).length;
}

function rejectDuplicateOptions(
	command: CliCommandName,
	tokens: ReturnType<typeof parseOptions>["tokens"],
): void {
	for (const definition of optionsFor(command)) {
		if (optionCount(tokens, definition.name) > 1) {
			throw new CliUsageError(`Option '--${definition.name}' may only be provided once.`, command);
		}
	}
}

export function parseServeArguments(
	args: string[],
	allowPositionalRepo = false,
): ParsedServeArguments {
	const parsed = parseOptions("serve", args);
	rejectDuplicateOptions("serve", parsed.tokens);
	const positionalRepo = parsed.positionals[0];
	const optionRepo = stringValue(parsed.values, "repo");
	if (optionRepo !== undefined && positionalRepo !== undefined) {
		throw new CliUsageError("Repository path may only be provided once.", "serve");
	}
	if (positionalRepo !== undefined && !allowPositionalRepo) {
		throw new CliUsageError(
			"Repository paths must follow the 'serve' command or '--repo'.",
			"serve",
		);
	}
	if (parsed.positionals.length > 1) {
		throw new CliUsageError("Repository path may only be provided once.", "serve");
	}
	const terminalEnabled = booleanValue(parsed.values, "enable-terminal");
	const terminalDisabled = booleanValue(parsed.values, "disable-terminal");
	if (terminalEnabled && terminalDisabled) {
		throw new CliUsageError(
			"--enable-terminal and --disable-terminal cannot be used together.",
			"serve",
		);
	}
	const terminalP2pEnabled = booleanValue(parsed.values, "enable-terminal-p2p");
	const terminalP2pDisabled = booleanValue(parsed.values, "disable-terminal-p2p");
	if (terminalP2pEnabled && terminalP2pDisabled) {
		throw new CliUsageError(
			"--enable-terminal-p2p and --disable-terminal-p2p cannot be used together.",
			"serve",
		);
	}
	const remoteBridgeEnabled = booleanValue(parsed.values, "enable-remote-bridge");
	const remoteBridgeDisabled = booleanValue(parsed.values, "disable-remote-bridge");
	if (remoteBridgeEnabled && remoteBridgeDisabled) {
		throw new CliUsageError(
			"--enable-remote-bridge and --disable-remote-bridge cannot be used together.",
			"serve",
		);
	}
	const remoteBridgeP2pEnabled = booleanValue(parsed.values, "enable-remote-bridge-p2p");
	const remoteBridgeP2pDisabled = booleanValue(parsed.values, "disable-remote-bridge-p2p");
	if (remoteBridgeP2pEnabled && remoteBridgeP2pDisabled) {
		throw new CliUsageError(
			"--enable-remote-bridge-p2p and --disable-remote-bridge-p2p cannot be used together.",
			"serve",
		);
	}
	const remoteBridgeOriginAccess = stringValue(parsed.values, "remote-bridge-origin-access");
	if (
		remoteBridgeOriginAccess !== undefined &&
		remoteBridgeOriginAccess !== "auto" &&
		!remoteBridgeOriginAccessIdIsValid(remoteBridgeOriginAccess)
	) {
		throw new CliUsageError(
			"The native bridge origin-access provider must be auto or use lowercase letters, numbers, and hyphens.",
			"serve",
		);
	}
	return {
		repo: optionRepo ?? positionalRepo,
		host: stringValue(parsed.values, "host"),
		port: stringValue(parsed.values, "port"),
		interactive: booleanValue(parsed.values, "interactive"),
		help: booleanValue(parsed.values, "help"),
		version: booleanValue(parsed.values, "version"),
		terminalMode: terminalEnabled ? "enabled" : terminalDisabled ? "disabled" : undefined,
		terminalP2pMode: terminalP2pEnabled ? "enabled" : terminalP2pDisabled ? "disabled" : undefined,
		remoteBridgeMode: remoteBridgeEnabled
			? "enabled"
			: remoteBridgeDisabled
				? "disabled"
				: undefined,
		remoteBridgeP2pMode: remoteBridgeP2pEnabled
			? "enabled"
			: remoteBridgeP2pDisabled
				? "disabled"
				: undefined,
		remoteBridgeOriginAccess,
		explicit: {
			repo: optionRepo !== undefined || positionalRepo !== undefined,
			host: optionCount(parsed.tokens, "host") === 1,
			port: optionCount(parsed.tokens, "port") === 1,
			terminal: terminalEnabled || terminalDisabled || terminalP2pEnabled || terminalP2pDisabled,
			remoteBridge:
				remoteBridgeEnabled ||
				remoteBridgeDisabled ||
				remoteBridgeP2pEnabled ||
				remoteBridgeP2pDisabled ||
				remoteBridgeOriginAccess !== undefined,
		},
	};
}

export function parseRestartArguments(args: string[]): ParsedRestartArguments {
	const parsed = parseOptions("restart", args);
	rejectDuplicateOptions("restart", parsed.tokens);
	if (parsed.positionals.length > 0) {
		throw new CliUsageError("The restart command does not accept a repository path.", "restart");
	}
	return {
		host: stringValue(parsed.values, "host"),
		port: stringValue(parsed.values, "port"),
		help: booleanValue(parsed.values, "help"),
		version: booleanValue(parsed.values, "version"),
	};
}

function parseCompletionArguments(args: string[]): {
	shell: CompletionShell | undefined;
	help: boolean;
	version: boolean;
	install: boolean;
} {
	const parsed = parseOptions("completion", args);
	rejectDuplicateOptions("completion", parsed.tokens);
	if (parsed.positionals.length > 1) {
		throw new CliUsageError("The completion command accepts exactly one shell.", "completion");
	}
	const rawShell = parsed.positionals[0];
	if (rawShell !== undefined && !completionShells.includes(rawShell as CompletionShell)) {
		const suggestion = nearestValue(rawShell, completionShells);
		throw new CliUsageError(
			`Unsupported shell '${rawShell}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
			"completion",
		);
	}
	const install = booleanValue(parsed.values, "install");
	if (install && rawShell !== "fish") {
		throw new CliUsageError(
			"Automatic completion installation currently supports Fish only.",
			"completion",
		);
	}
	return {
		shell: rawShell as CompletionShell | undefined,
		help: booleanValue(parsed.values, "help"),
		version: booleanValue(parsed.values, "version"),
		install,
	};
}

function parseBridgeArguments(args: string[]): CliInvocation {
	const separatorIndex = args.indexOf("--");
	const bridgeArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
	const passthroughArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
	const parsed = parseOptions("bridge", bridgeArgs);
	rejectDuplicateOptions("bridge", parsed.tokens);
	if (booleanValue(parsed.values, "help")) return { kind: "help", command: "bridge" };
	if (booleanValue(parsed.values, "version")) return { kind: "version" };
	if (parsed.positionals.length !== 1) {
		throw new CliUsageError(
			"The bridge command requires exactly one action: pair, proxy, codex, terminal, or claude.",
			"bridge",
		);
	}
	const action = parsed.positionals[0];
	const origin = stringValue(parsed.values, "url");
	const code = stringValue(parsed.values, "code");
	const profileId = stringValue(parsed.values, "profile");
	const repositoryRoot = stringValue(parsed.values, "repo");
	const explicitOriginAccess = stringValue(parsed.values, "origin-access");
	const originAccess = explicitOriginAccess ?? REMOTE_BRIDGE_NO_ORIGIN_ACCESS;
	if (!remoteBridgeOriginAccessIdIsValid(originAccess)) {
		throw new CliUsageError(
			"The bridge origin-access provider must use lowercase letters, numbers, and hyphens.",
			"bridge",
		);
	}
	if (action === "pair") {
		if (passthroughArgs.length > 0) {
			throw new CliUsageError(
				"Arguments after '--' are only valid for bridge codex or bridge claude.",
				"bridge",
			);
		}
		if (!origin || !code) {
			throw new CliUsageError("The pair action requires --url and --code.", "bridge");
		}
		if (profileId) {
			throw new CliUsageError(
				"--profile is only valid for bridge proxy, codex, terminal, or claude.",
				"bridge",
			);
		}
		if (repositoryRoot) {
			throw new CliUsageError(
				"--repo is only valid for bridge codex, terminal, or claude.",
				"bridge",
			);
		}
		return { kind: "bridge-pair", origin, code, originAccess };
	}
	if (action === "proxy") {
		if (passthroughArgs.length > 0) {
			throw new CliUsageError(
				"Arguments after '--' are only valid for bridge codex or bridge claude.",
				"bridge",
			);
		}
		if (!profileId) {
			throw new CliUsageError("The proxy action requires --profile.", "bridge");
		}
		if (repositoryRoot) {
			throw new CliUsageError(
				"--repo is only valid for bridge codex, terminal, or claude.",
				"bridge",
			);
		}
		if (origin || code || explicitOriginAccess) {
			throw new CliUsageError(
				"--url, --code, and --origin-access are only valid for bridge pair.",
				"bridge",
			);
		}
		return { kind: "bridge-proxy", profileId };
	}
	if (action === "codex") {
		if (origin || code || explicitOriginAccess) {
			throw new CliUsageError(
				"--url, --code, and --origin-access are only valid for bridge pair.",
				"bridge",
			);
		}
		if (repositoryRoot !== undefined && !path.isAbsolute(repositoryRoot)) {
			throw new CliUsageError("The bridge codex repository path must be absolute.", "bridge");
		}
		return {
			kind: "bridge-codex",
			profileSelector: profileId ?? null,
			repositoryRoot: repositoryRoot ?? null,
			codexArgs: passthroughArgs,
		};
	}
	if (action === "terminal") {
		if (passthroughArgs.length > 0) {
			throw new CliUsageError(
				"The terminal action opens a login shell and does not accept arguments after '--'.",
				"bridge",
			);
		}
		if (origin || code || explicitOriginAccess) {
			throw new CliUsageError(
				"--url, --code, and --origin-access are only valid for bridge pair.",
				"bridge",
			);
		}
		if (repositoryRoot !== undefined && !path.isAbsolute(repositoryRoot)) {
			throw new CliUsageError("The bridge terminal repository path must be absolute.", "bridge");
		}
		return {
			kind: "bridge-terminal",
			profileSelector: profileId ?? null,
			repositoryRoot: repositoryRoot ?? null,
		};
	}
	if (action === "claude") {
		if (origin || code || explicitOriginAccess) {
			throw new CliUsageError(
				"--url, --code, and --origin-access are only valid for bridge pair.",
				"bridge",
			);
		}
		if (repositoryRoot !== undefined && !path.isAbsolute(repositoryRoot)) {
			throw new CliUsageError("The bridge claude repository path must be absolute.", "bridge");
		}
		return {
			kind: "bridge-claude",
			profileSelector: profileId ?? null,
			repositoryRoot: repositoryRoot ?? null,
			claudeArgs: passthroughArgs,
		};
	}
	const suggestion = nearestValue(action ?? "", ["pair", "proxy", "codex", "terminal", "claude"]);
	throw new CliUsageError(
		`Unknown bridge action '${action ?? ""}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
		"bridge",
	);
}

function parseArtifactArguments(args: string[]): CliInvocation {
	const parsed = parseOptions("artifacts", args);
	rejectDuplicateOptions("artifacts", parsed.tokens);
	if (booleanValue(parsed.values, "help")) return { kind: "help", command: "artifacts" };
	if (booleanValue(parsed.values, "version")) return { kind: "version" };
	const action = parsed.positionals[0];
	const actions = ["list", "build", "download", "pull"] as const;
	if (!action || !actions.includes(action as (typeof actions)[number])) {
		const suggestion = action ? nearestValue(action, actions) : null;
		throw new CliUsageError(
			`The artifacts command requires list, build, download, or pull.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
			"artifacts",
		);
	}
	const artifactAction = action as ParsedArtifactArguments["action"];
	const expectedPositionals = artifactAction === "list" ? 1 : 2;
	if (parsed.positionals.length !== expectedPositionals) {
		throw new CliUsageError(
			artifactAction === "list"
				? "The artifacts list command does not accept an artifact name."
				: `The artifacts ${artifactAction} command requires exactly one artifact name.`,
			"artifacts",
		);
	}
	const name = parsed.positionals[1] ?? null;
	if (name && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
		throw new CliUsageError("Artifact name is invalid.", "artifacts");
	}
	const profile = stringValue(parsed.values, "profile") ?? null;
	const repository = stringValue(parsed.values, "repository") ?? null;
	const repo = stringValue(parsed.values, "repo") ?? null;
	const build = stringValue(parsed.values, "build") ?? null;
	const output = stringValue(parsed.values, "output") ?? null;
	const force = booleanValue(parsed.values, "force");
	if (build && artifactAction !== "download") {
		throw new CliUsageError("--build is only valid for artifacts download.", "artifacts");
	}
	if ((output || force) && artifactAction !== "download" && artifactAction !== "pull") {
		throw new CliUsageError(
			"--output and --force are only valid for artifacts download or pull.",
			"artifacts",
		);
	}
	for (const [option, value] of [
		["profile", profile],
		["repository", repository],
		["repo", repo],
		["build", build],
		["output", output],
	] as const) {
		if (value !== null && (!value || value.includes("\0"))) {
			throw new CliUsageError(`--${option} is invalid.`, "artifacts");
		}
	}
	return {
		kind: "artifacts",
		parsed: {
			action: artifactAction,
			name,
			profile,
			repository,
			repo,
			build,
			output,
			force,
			json: booleanValue(parsed.values, "json"),
		},
	};
}

function canonicalServeArguments(parsed: ParsedServeArguments): string[] {
	const argv: string[] = [];
	if (parsed.explicit.repo && parsed.repo !== undefined) argv.push(`--repo=${parsed.repo}`);
	if (parsed.explicit.host && parsed.host !== undefined) argv.push("--host", parsed.host);
	if (parsed.explicit.port && parsed.port !== undefined) argv.push("--port", parsed.port);
	if (parsed.interactive) argv.push("--interactive");
	if (parsed.terminalMode === "enabled") argv.push("--enable-terminal");
	if (parsed.terminalMode === "disabled") argv.push("--disable-terminal");
	if (parsed.terminalP2pMode === "enabled") argv.push("--enable-terminal-p2p");
	if (parsed.terminalP2pMode === "disabled") argv.push("--disable-terminal-p2p");
	if (parsed.remoteBridgeMode === "enabled") argv.push("--enable-remote-bridge");
	if (parsed.remoteBridgeMode === "disabled") argv.push("--disable-remote-bridge");
	if (parsed.remoteBridgeP2pMode === "enabled") argv.push("--enable-remote-bridge-p2p");
	if (parsed.remoteBridgeP2pMode === "disabled") argv.push("--disable-remote-bridge-p2p");
	if (parsed.remoteBridgeOriginAccess !== undefined) {
		argv.push("--remote-bridge-origin-access", parsed.remoteBridgeOriginAccess);
	}
	return argv;
}

export function parseCliInvocation(argv: string[]): CliInvocation {
	const first = argv[0];
	if (first === "help") {
		if (argv.length === 1) return { kind: "help", command: null };
		if (argv.length > 2) {
			throw new CliUsageError("The help command accepts at most one command name.");
		}
		const requested = argv[1];
		if (requested === "help") return { kind: "help", command: null };
		if (
			!requested ||
			!["serve", "restart", "completion", "bridge", "artifacts"].includes(requested)
		) {
			const suggestion = requested ? nearestValue(requested, commandNames) : null;
			throw new CliUsageError(
				`Unknown command '${requested ?? ""}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
			);
		}
		return { kind: "help", command: requested as CliCommandName };
	}

	if (
		first &&
		!first.startsWith("-") &&
		!commandNames.includes(first as (typeof commandNames)[number])
	) {
		const suggestion = nearestValue(first, commandNames);
		throw new CliUsageError(
			`Unknown command '${first}'.${suggestion ? ` Did you mean '${suggestion}'?` : " Repository paths must follow 'serve' or '--repo'."}`,
		);
	}

	if (first === "restart") {
		const commandArgv = argv.slice(1);
		const parsed = parseRestartArguments(commandArgv);
		if (parsed.help) return { kind: "help", command: "restart" };
		if (parsed.version) return { kind: "version" };
		return { kind: "restart", argv: commandArgv, parsed };
	}

	if (first === "completion") {
		const parsed = parseCompletionArguments(argv.slice(1));
		if (parsed.help) return { kind: "help", command: "completion" };
		if (parsed.version) return { kind: "version" };
		if (!parsed.shell) {
			throw new CliUsageError("A shell is required: zsh, bash, or fish.", "completion");
		}
		return { kind: "completion", shell: parsed.shell, install: parsed.install };
	}

	if (first === "bridge") return parseBridgeArguments(argv.slice(1));
	if (first === "artifacts") return parseArtifactArguments(argv.slice(1));

	const explicitServe = first === "serve";
	const commandArgv = explicitServe ? argv.slice(1) : argv;
	const parsed = parseServeArguments(commandArgv, explicitServe);
	if (parsed.help) return { kind: "help", command: first === "serve" ? "serve" : null };
	if (parsed.version) return { kind: "version" };
	return { kind: "serve", argv: canonicalServeArguments(parsed), parsed };
}
