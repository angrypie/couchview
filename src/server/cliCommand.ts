import path from "node:path";

import { type ArgsDef, type ParsedArgs, parseArgs } from "citty";

import {
	REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
	remoteBridgeOriginAccessIdIsValid,
} from "../shared/contracts.ts";
import {
	artifactActionNames,
	artifactBuildArgs,
	artifactDownloadArgs,
	artifactListArgs,
	artifactPullArgs,
	bridgeActionNames,
	bridgeClaudeArgs,
	bridgeCodexArgs,
	bridgeCommandArgs,
	bridgePairArgs,
	bridgeProxyArgs,
	bridgeTerminalArgs,
	cliHelpPathExists,
	defaultServeArgs,
	explicitServeArgs,
	helpCommandArgs,
	restartArgs,
	topLevelCommandNames,
} from "./cliCommandDefinitions.ts";
import {
	type ArtifactCliAction,
	type CliInvocation,
	CliUsageError,
	type ParsedArtifactArguments,
	type ParsedRestartArguments,
	type ParsedServeArguments,
} from "./cliCommandTypes.ts";

export { renderCliHelp } from "./cliCommandDefinitions.ts";
export {
	CLI_VERSION,
	type CliInvocation,
	CliPromptInterrupted,
	CliUsageError,
	type InteractivePrompter,
	type ParsedArtifactArguments,
	type ParsedRestartArguments,
	type ParsedServeArguments,
} from "./cliCommandTypes.ts";
export { createInteractivePrompter, promptForServeArguments } from "./cliPrompt.ts";

interface OptionDescriptor {
	canonicalName: string;
	type: "boolean" | "string" | "enum";
}

interface PreparedArguments {
	rawArgs: string[];
	enabledBooleans: Set<string>;
}

function editDistance(left: string, right: string): number {
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			current[rightIndex] = Math.min(
				(current[rightIndex - 1] ?? 0) + 1,
				(previous[rightIndex] ?? 0) + 1,
				(previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
			);
		}
		previous.splice(0, previous.length, ...current);
	}
	return previous[right.length] ?? Number.POSITIVE_INFINITY;
}

function nearestValue(value: string, candidates: readonly string[]): string | null {
	let nearest: string | null = null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	let nearestPrefixLength = -1;
	for (const candidate of candidates) {
		const normalizedValue = value.toLowerCase();
		const normalizedCandidate = candidate.toLowerCase();
		const distance = editDistance(normalizedValue, normalizedCandidate);
		let prefixLength = 0;
		while (
			normalizedValue[prefixLength] !== undefined &&
			normalizedValue[prefixLength] === normalizedCandidate[prefixLength]
		) {
			prefixLength += 1;
		}
		if (
			distance < nearestDistance ||
			(distance === nearestDistance && prefixLength > nearestPrefixLength)
		) {
			nearest = candidate;
			nearestDistance = distance;
			nearestPrefixLength = prefixLength;
		}
	}
	if (!nearest) return null;
	const comparisonLength = Math.max(value.length, nearest.length);
	return nearestDistance <= 2 && nearestDistance <= Math.ceil(comparisonLength / 3)
		? nearest
		: null;
}

function optionLookups(definition: ArgsDef): {
	long: Map<string, OptionDescriptor>;
	short: Map<string, OptionDescriptor>;
	candidates: string[];
} {
	const long = new Map<string, OptionDescriptor>();
	const short = new Map<string, OptionDescriptor>();
	const candidates: string[] = [];
	for (const [name, argument] of Object.entries(definition)) {
		if (!argument.type || argument.type === "positional") continue;
		const descriptor: OptionDescriptor = { canonicalName: name, type: argument.type };
		long.set(name, descriptor);
		candidates.push(`--${name}`);
		const alias = "alias" in argument ? argument.alias : undefined;
		const aliases = Array.isArray(alias) ? alias : alias ? [alias] : [];
		for (const alias of aliases) {
			if (alias.length === 1) {
				short.set(alias, descriptor);
				candidates.push(`-${alias}`);
			} else {
				long.set(alias, descriptor);
				candidates.push(`--${alias}`);
			}
		}
	}
	return { long, short, candidates };
}

function usageError(message: string, helpCommand: string | null): never {
	throw new CliUsageError(message, helpCommand);
}

function unknownOption(
	option: string,
	candidates: readonly string[],
	helpCommand: string | null,
): never {
	const suggestion = nearestValue(option, candidates);
	usageError(
		`Unknown option: ${option}.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
		helpCommand,
	);
}

function missingOptionValue(descriptor: OptionDescriptor, option: string): string {
	const message = new Map<string, string>([
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
	]).get(descriptor.canonicalName);
	return message ?? `Option '${option}' requires a value.`;
}

function prepareArguments(
	rawArgs: string[],
	definition: ArgsDef,
	helpCommand: string | null,
): PreparedArguments {
	const { long, short, candidates } = optionLookups(definition);
	const counts = new Map<string, number>();
	const enabledBooleans = new Set<string>();
	const normalizedArgs = [...rawArgs];
	const record = (descriptor: OptionDescriptor, enabled = true) => {
		const count = (counts.get(descriptor.canonicalName) ?? 0) + 1;
		if (count > 1) {
			usageError(`Option '--${descriptor.canonicalName}' may only be provided once.`, helpCommand);
		}
		counts.set(descriptor.canonicalName, count);
		if (descriptor.type === "boolean" && enabled) {
			enabledBooleans.add(descriptor.canonicalName);
		}
	};

	for (let index = 0; index < rawArgs.length; index += 1) {
		const argument = rawArgs[index];
		if (argument === undefined) continue;
		if (argument === "--") break;
		if (argument.startsWith("--")) {
			const equalsIndex = argument.indexOf("=");
			const flag = equalsIndex < 0 ? argument : argument.slice(0, equalsIndex);
			const descriptor = long.get(flag.slice(2));
			if (!descriptor) unknownOption(flag, candidates, helpCommand);
			const inlineValue = equalsIndex < 0 ? undefined : argument.slice(equalsIndex + 1);
			if (descriptor.type === "boolean") {
				if (inlineValue !== undefined && inlineValue !== "true" && inlineValue !== "false") {
					usageError(`Option '${flag}' expects true or false.`, helpCommand);
				}
				record(descriptor, inlineValue !== "false");
				continue;
			}
			record(descriptor);
			if (inlineValue !== undefined) {
				if (!inlineValue) usageError(missingOptionValue(descriptor, flag), helpCommand);
				continue;
			}
			if (rawArgs[index + 1] === undefined || rawArgs[index + 1]?.startsWith("--")) {
				usageError(missingOptionValue(descriptor, flag), helpCommand);
			}
			index += 1;
			continue;
		}
		if (!argument.startsWith("-") || argument === "-") continue;

		const compact = argument.slice(1);
		for (let compactIndex = 0; compactIndex < compact.length; compactIndex += 1) {
			const alias = compact[compactIndex];
			const descriptor = alias ? short.get(alias) : undefined;
			if (!descriptor) unknownOption(`-${alias ?? ""}`, candidates, helpCommand);
			record(descriptor);
			if (descriptor.type === "boolean") continue;
			let inlineValue = compact.slice(compactIndex + 1);
			if (inlineValue.startsWith("=")) {
				inlineValue = inlineValue.slice(1);
				normalizedArgs[index] = `-${compact.slice(0, compactIndex + 1)}${inlineValue}`;
			}
			if (inlineValue) break;
			if (rawArgs[index + 1] === undefined || rawArgs[index + 1]?.startsWith("--")) {
				usageError(missingOptionValue(descriptor, `-${alias}`), helpCommand);
			}
			index += 1;
			break;
		}
	}

	return { rawArgs: normalizedArgs, enabledBooleans };
}

function parsePreparedArguments(
	prepared: PreparedArguments,
	definition: ArgsDef,
	helpCommand: string | null,
): ParsedArgs {
	try {
		return parseArgs(prepared.rawArgs, definition);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Arguments are invalid.";
		throw new CliUsageError(message, helpCommand);
	}
}

function parseCommandArguments(
	rawArgs: string[],
	definition: ArgsDef,
	helpCommand: string | null,
): ParsedArgs {
	return parsePreparedArguments(
		prepareArguments(rawArgs, definition, helpCommand),
		definition,
		helpCommand,
	);
}

function booleanValue(args: ParsedArgs, name: string): boolean {
	return args[name] === true;
}

function stringValue(args: ParsedArgs, name: string): string | undefined {
	const value = args[name];
	return typeof value === "string" ? value : undefined;
}

function metaInvocation(
	prepared: PreparedArguments,
	path: readonly string[],
): CliInvocation | null {
	if (prepared.enabledBooleans.has("help")) return { kind: "help", path: [...path] };
	if (prepared.enabledBooleans.has("version")) return { kind: "version" };
	return null;
}

export function parseServeArguments(
	args: string[],
	allowPositionalRepo = false,
): ParsedServeArguments {
	const definition = allowPositionalRepo ? explicitServeArgs : defaultServeArgs;
	const parsed = parseCommandArguments(args, definition, "serve");
	const positionalRepo = parsed._[0];
	const optionRepo = stringValue(parsed, "repo");
	if (optionRepo !== undefined && positionalRepo !== undefined) {
		usageError("Repository path may only be provided once.", "serve");
	}
	if (positionalRepo !== undefined && !allowPositionalRepo) {
		usageError("Repository paths must follow the 'serve' command or '--repo'.", "serve");
	}
	if (parsed._.length > 1) {
		usageError("Repository path may only be provided once.", "serve");
	}
	const terminalEnabled = booleanValue(parsed, "enable-terminal");
	const terminalDisabled = booleanValue(parsed, "disable-terminal");
	if (terminalEnabled && terminalDisabled) {
		usageError("--enable-terminal and --disable-terminal cannot be used together.", "serve");
	}
	const terminalP2pEnabled = booleanValue(parsed, "enable-terminal-p2p");
	const terminalP2pDisabled = booleanValue(parsed, "disable-terminal-p2p");
	if (terminalP2pEnabled && terminalP2pDisabled) {
		usageError(
			"--enable-terminal-p2p and --disable-terminal-p2p cannot be used together.",
			"serve",
		);
	}
	const remoteBridgeEnabled = booleanValue(parsed, "enable-remote-bridge");
	const remoteBridgeDisabled = booleanValue(parsed, "disable-remote-bridge");
	if (remoteBridgeEnabled && remoteBridgeDisabled) {
		usageError(
			"--enable-remote-bridge and --disable-remote-bridge cannot be used together.",
			"serve",
		);
	}
	const remoteBridgeP2pEnabled = booleanValue(parsed, "enable-remote-bridge-p2p");
	const remoteBridgeP2pDisabled = booleanValue(parsed, "disable-remote-bridge-p2p");
	if (remoteBridgeP2pEnabled && remoteBridgeP2pDisabled) {
		usageError(
			"--enable-remote-bridge-p2p and --disable-remote-bridge-p2p cannot be used together.",
			"serve",
		);
	}
	const speechEnabled = booleanValue(parsed, "enable-speech");
	const speechDisabled = booleanValue(parsed, "disable-speech");
	const voiceCommandsEnabled = booleanValue(parsed, "enable-voice-commands");
	if (speechEnabled && speechDisabled) {
		usageError("--enable-speech and --disable-speech cannot be used together.", "serve");
	}
	const remoteBridgeOriginAccess = stringValue(parsed, "remote-bridge-origin-access");
	if (
		remoteBridgeOriginAccess !== undefined &&
		remoteBridgeOriginAccess !== "auto" &&
		!remoteBridgeOriginAccessIdIsValid(remoteBridgeOriginAccess)
	) {
		usageError(
			"The native bridge origin-access provider must be auto or use lowercase letters, numbers, and hyphens.",
			"serve",
		);
	}
	return {
		repo: optionRepo ?? positionalRepo,
		host: stringValue(parsed, "host"),
		port: stringValue(parsed, "port"),
		interactive: booleanValue(parsed, "interactive"),
		help: booleanValue(parsed, "help"),
		version: booleanValue(parsed, "version"),
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
		speechMode: speechEnabled ? "enabled" : speechDisabled ? "disabled" : undefined,
		voiceCommandsEnabled,
		explicit: {
			repo: optionRepo !== undefined || positionalRepo !== undefined,
			host: stringValue(parsed, "host") !== undefined,
			port: stringValue(parsed, "port") !== undefined,
			terminal: terminalEnabled || terminalDisabled || terminalP2pEnabled || terminalP2pDisabled,
			remoteBridge:
				remoteBridgeEnabled ||
				remoteBridgeDisabled ||
				remoteBridgeP2pEnabled ||
				remoteBridgeP2pDisabled ||
				remoteBridgeOriginAccess !== undefined,
			speech: speechEnabled || speechDisabled,
			voiceCommands: voiceCommandsEnabled,
		},
	};
}

export function parseRestartArguments(args: string[]): ParsedRestartArguments {
	const parsed = parseCommandArguments(args, restartArgs, "restart");
	if (parsed._.length > 0) {
		usageError("The restart command does not accept a repository path.", "restart");
	}
	return {
		host: stringValue(parsed, "host"),
		port: stringValue(parsed, "port"),
		help: booleanValue(parsed, "help"),
		version: booleanValue(parsed, "version"),
	};
}

function noExtraPositionals(parsed: ParsedArgs, helpCommand: string): void {
	if (parsed._.length > 0)
		usageError(`The ${helpCommand} command does not accept arguments.`, helpCommand);
}

function parseBridgeArguments(args: string[]): CliInvocation {
	if (!args[0] || args[0].startsWith("-")) {
		const prepared = prepareArguments(args, bridgeCommandArgs, "bridge");
		const meta = metaInvocation(prepared, ["bridge"]);
		if (meta) return meta;
		parsePreparedArguments(prepared, bridgeCommandArgs, "bridge");
		usageError("The bridge command requires pair, proxy, codex, terminal, or claude.", "bridge");
	}
	const action = args[0];
	if (!bridgeActionNames.includes(action as (typeof bridgeActionNames)[number])) {
		const suggestion = nearestValue(action, bridgeActionNames);
		usageError(
			`Unknown bridge action '${action}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
			"bridge",
		);
	}
	const bridgeAction = action as (typeof bridgeActionNames)[number];
	const rawActionArgs = args.slice(1);
	const separatorIndex = rawActionArgs.indexOf("--");
	const actionArgs = separatorIndex < 0 ? rawActionArgs : rawActionArgs.slice(0, separatorIndex);
	const passthroughArgs = separatorIndex < 0 ? [] : rawActionArgs.slice(separatorIndex + 1);
	const helpCommand = `bridge ${bridgeAction}`;
	const definition =
		bridgeAction === "pair"
			? bridgePairArgs
			: bridgeAction === "proxy"
				? bridgeProxyArgs
				: bridgeAction === "codex"
					? bridgeCodexArgs
					: bridgeAction === "terminal"
						? bridgeTerminalArgs
						: bridgeClaudeArgs;
	const prepared = prepareArguments(actionArgs, definition, helpCommand);
	const meta = metaInvocation(prepared, ["bridge", bridgeAction]);
	if (meta) return meta;
	const parsed = parsePreparedArguments(prepared, definition, helpCommand);
	noExtraPositionals(parsed, helpCommand);

	if (bridgeAction === "terminal" && passthroughArgs.length > 0) {
		usageError(
			"The terminal action opens a login shell and does not accept arguments after '--'.",
			helpCommand,
		);
	}
	if (bridgeAction !== "codex" && bridgeAction !== "claude" && passthroughArgs.length > 0) {
		usageError(
			"Arguments after '--' are only valid for bridge codex or bridge claude.",
			helpCommand,
		);
	}
	if (bridgeAction === "pair") {
		const origin = stringValue(parsed, "url");
		const code = stringValue(parsed, "code");
		if (!origin || !code) usageError("The pair action requires --url and --code.", helpCommand);
		const originAccess = stringValue(parsed, "origin-access") ?? REMOTE_BRIDGE_NO_ORIGIN_ACCESS;
		if (!remoteBridgeOriginAccessIdIsValid(originAccess)) {
			usageError(
				"The bridge origin-access provider must use lowercase letters, numbers, and hyphens.",
				helpCommand,
			);
		}
		return { kind: "bridge-pair", origin, code, originAccess };
	}
	if (bridgeAction === "proxy") {
		const profileId = stringValue(parsed, "profile");
		if (!profileId) usageError("The proxy action requires --profile.", helpCommand);
		return { kind: "bridge-proxy", profileId };
	}
	const profileSelector = stringValue(parsed, "profile") ?? null;
	const repositoryRoot = stringValue(parsed, "repo") ?? null;
	if (repositoryRoot !== null && !path.isAbsolute(repositoryRoot)) {
		usageError(`The bridge ${bridgeAction} repository path must be absolute.`, helpCommand);
	}
	if (bridgeAction === "terminal") {
		return { kind: "bridge-terminal", profileSelector, repositoryRoot };
	}
	if (bridgeAction === "codex") {
		return { kind: "bridge-codex", profileSelector, repositoryRoot, codexArgs: passthroughArgs };
	}
	return { kind: "bridge-claude", profileSelector, repositoryRoot, claudeArgs: passthroughArgs };
}

function artifactDefinition(action: ArtifactCliAction): ArgsDef {
	if (action === "list") return artifactListArgs;
	if (action === "build") return artifactBuildArgs;
	if (action === "download") return artifactDownloadArgs;
	return artifactPullArgs;
}

function parseArtifactArguments(args: string[]): CliInvocation {
	if (!args[0] || args[0].startsWith("-")) {
		const prepared = prepareArguments(args, bridgeCommandArgs, "artifacts");
		const meta = metaInvocation(prepared, ["artifacts"]);
		if (meta) return meta;
		parsePreparedArguments(prepared, bridgeCommandArgs, "artifacts");
		usageError("The artifacts command requires list, build, download, or pull.", "artifacts");
	}
	const action = args[0];
	if (!artifactActionNames.includes(action as ArtifactCliAction)) {
		const suggestion = nearestValue(action, artifactActionNames);
		usageError(
			`Unknown artifacts action '${action}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
			"artifacts",
		);
	}
	const artifactAction = action as ArtifactCliAction;
	const helpCommand = `artifacts ${artifactAction}`;
	const definition = artifactDefinition(artifactAction);
	const prepared = prepareArguments(args.slice(1), definition, helpCommand);
	const meta = metaInvocation(prepared, ["artifacts", artifactAction]);
	if (meta) return meta;
	const parsed = parsePreparedArguments(prepared, definition, helpCommand);
	const expectedPositionals = artifactAction === "list" ? 0 : 1;
	if (parsed._.length !== expectedPositionals) {
		usageError(
			artifactAction === "list"
				? "The artifacts list command does not accept an artifact name."
				: `The artifacts ${artifactAction} command requires exactly one artifact name.`,
			helpCommand,
		);
	}
	const name = parsed._[0] ?? null;
	if (name && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
		usageError("Artifact name is invalid.", helpCommand);
	}
	const values = {
		profile: stringValue(parsed, "profile") ?? null,
		repository: stringValue(parsed, "repository") ?? null,
		repo: stringValue(parsed, "repo") ?? null,
		build: stringValue(parsed, "build") ?? null,
		output: stringValue(parsed, "output") ?? null,
	};
	for (const [option, value] of Object.entries(values)) {
		if (value !== null && (!value || value.includes("\0"))) {
			usageError(`--${option} is invalid.`, helpCommand);
		}
	}
	const parsedArtifact: ParsedArtifactArguments = {
		action: artifactAction,
		name,
		...values,
		force: booleanValue(parsed, "force"),
		json: booleanValue(parsed, "json"),
	};
	return { kind: "artifacts", parsed: parsedArtifact };
}

function helpInvocation(args: string[]): CliInvocation {
	const prepared = prepareArguments(args, helpCommandArgs, "help");
	const meta = metaInvocation(prepared, ["help"]);
	if (meta) return meta;
	const parsed = parsePreparedArguments(prepared, helpCommandArgs, "help");
	if (parsed._.length > 2)
		usageError("The help command accepts at most two command names.", "help");
	const path = parsed._;
	if (path.length === 0) return { kind: "help", path: [] };
	if (!cliHelpPathExists(path)) {
		const candidates =
			path.length === 1
				? topLevelCommandNames
				: path[0] === "artifacts"
					? artifactActionNames
					: bridgeActionNames;
		const requested = path.at(-1) ?? "";
		const suggestion = nearestValue(requested, candidates);
		usageError(
			`Unknown command '${path.join(" ")}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
			"help",
		);
	}
	return { kind: "help", path: [...path] };
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
	if (parsed.speechMode === "enabled") argv.push("--enable-speech");
	if (parsed.speechMode === "disabled") argv.push("--disable-speech");
	if (parsed.voiceCommandsEnabled) argv.push("--enable-voice-commands");
	return argv;
}

export function parseCliInvocation(argv: string[]): CliInvocation {
	const first = argv[0];
	if (first === "help") return helpInvocation(argv.slice(1));
	if (
		first &&
		!first.startsWith("-") &&
		!topLevelCommandNames.includes(first as (typeof topLevelCommandNames)[number])
	) {
		const suggestion = nearestValue(first, topLevelCommandNames);
		usageError(
			`Unknown command '${first}'.${
				suggestion
					? ` Did you mean '${suggestion}'?`
					: " Repository paths must follow 'serve' or '--repo'."
			}`,
			null,
		);
	}
	if (first === "restart") {
		const commandArgv = argv.slice(1);
		const parsed = parseRestartArguments(commandArgv);
		if (parsed.help) return { kind: "help", path: ["restart"] };
		if (parsed.version) return { kind: "version" };
		return { kind: "restart", argv: commandArgv, parsed };
	}
	if (first === "bridge") return parseBridgeArguments(argv.slice(1));
	if (first === "artifacts") return parseArtifactArguments(argv.slice(1));
	if (first === "serve") {
		const parsed = parseServeArguments(argv.slice(1), true);
		if (parsed.help) return { kind: "help", path: ["serve"] };
		if (parsed.version) return { kind: "version" };
		return { kind: "serve", argv: canonicalServeArguments(parsed), parsed };
	}
	const parsed = parseServeArguments(argv);
	if (parsed.help) return { kind: "help", path: [] };
	if (parsed.version) return { kind: "version" };
	return { kind: "serve", argv: canonicalServeArguments(parsed), parsed };
}
