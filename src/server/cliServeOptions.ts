import { isIP } from "node:net";
import path from "node:path";

import { remoteBridgeOriginAccessIdIsValid } from "../shared/contracts.ts";
import { parseServeArguments } from "./cliCommand.ts";
import { normalizeBindHost } from "./server.ts";

export type TerminalMode = "auto" | "enabled" | "disabled";
export type TerminalP2pMode = "auto" | "enabled" | "disabled";
export type RemoteBridgeMode = "auto" | "enabled" | "disabled";
export type RemoteBridgeP2pMode = "auto" | "enabled" | "disabled";
export type SpeechMode = "auto" | "enabled" | "disabled";

export const DEFAULT_TERMINAL_STUN_URLS = ["stun:stun.cloudflare.com:3478"] as const;
export const DEFAULT_REMOTE_BRIDGE_STUN_URLS = ["stun:stun.cloudflare.com:3478"] as const;

export interface CliOptions {
	root: string;
	host: string;
	port: number;
	terminalMode: TerminalMode;
	terminalP2pMode: TerminalP2pMode;
	terminalStunUrls: string[];
	remoteBridgeMode: RemoteBridgeMode;
	remoteBridgeP2pMode: RemoteBridgeP2pMode;
	remoteBridgeStunUrls: string[];
	remoteBridgePort: number;
	remoteBridgeOriginAccess: string;
	speechMode: SpeechMode;
	voiceCommandsEnabled: boolean;
}

export function parseCli(argv: string[]): CliOptions {
	return parseCliState(argv).options;
}

export function parseCliState(argv: string[]): {
	options: CliOptions;
	parsed: ReturnType<typeof parseServeArguments>;
} {
	const parsed = parseServeArguments(argv);
	const root = parsed.repo ?? Bun.env.COUCHVIEW_ROOT ?? process.cwd();
	const host = parsed.host ?? Bun.env.COUCHVIEW_HOST ?? "127.0.0.1";
	const port = Number(parsed.port ?? Bun.env.PORT ?? 4173);
	const terminalEnvironment = Bun.env.COUCHVIEW_TERMINAL;
	let environmentTerminalMode: TerminalMode = "auto";
	if (terminalEnvironment !== undefined) {
		if (terminalEnvironment === "1") environmentTerminalMode = "enabled";
		else if (terminalEnvironment === "0") environmentTerminalMode = "disabled";
		else throw new Error("COUCHVIEW_TERMINAL must be 1 or 0");
	}
	const terminalP2pEnvironment = Bun.env.COUCHVIEW_TERMINAL_P2P;
	let environmentTerminalP2pMode: TerminalP2pMode = "auto";
	if (terminalP2pEnvironment !== undefined) {
		if (terminalP2pEnvironment === "1") environmentTerminalP2pMode = "enabled";
		else if (terminalP2pEnvironment === "0") environmentTerminalP2pMode = "disabled";
		else throw new Error("COUCHVIEW_TERMINAL_P2P must be 1 or 0");
	}
	const terminalStunUrls = parseTerminalStunUrls(Bun.env.COUCHVIEW_TERMINAL_STUN);
	const remoteBridgeEnvironment = Bun.env.COUCHVIEW_REMOTE_BRIDGE;
	let environmentRemoteBridgeMode: RemoteBridgeMode = "auto";
	if (remoteBridgeEnvironment !== undefined) {
		if (remoteBridgeEnvironment === "1") environmentRemoteBridgeMode = "enabled";
		else if (remoteBridgeEnvironment === "0") environmentRemoteBridgeMode = "disabled";
		else throw new Error("COUCHVIEW_REMOTE_BRIDGE must be 1 or 0");
	}
	const remoteBridgeP2pEnvironment = Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
	let environmentRemoteBridgeP2pMode: RemoteBridgeP2pMode = "auto";
	if (remoteBridgeP2pEnvironment !== undefined) {
		if (remoteBridgeP2pEnvironment === "1") environmentRemoteBridgeP2pMode = "enabled";
		else if (remoteBridgeP2pEnvironment === "0") environmentRemoteBridgeP2pMode = "disabled";
		else throw new Error("COUCHVIEW_REMOTE_BRIDGE_P2P must be 1 or 0");
	}
	const remoteBridgeStunUrls = parseRemoteBridgeStunUrls(Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN);
	const remoteBridgePort = Number(Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT ?? 22);
	const speechEnvironment = Bun.env.COUCHVIEW_ENABLE_SPEECH;
	let environmentSpeechMode: SpeechMode = "auto";
	if (speechEnvironment !== undefined) {
		if (speechEnvironment === "1") environmentSpeechMode = "enabled";
		else if (speechEnvironment === "0") environmentSpeechMode = "disabled";
		else throw new Error("COUCHVIEW_ENABLE_SPEECH must be 1 or 0");
	}
	const environmentRemoteBridgeOriginAccess =
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS ?? "auto";
	if (
		environmentRemoteBridgeOriginAccess !== "auto" &&
		!remoteBridgeOriginAccessIdIsValid(environmentRemoteBridgeOriginAccess)
	) {
		throw new Error(
			"COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS must be auto or a lowercase provider ID",
		);
	}
	if (!root) throw new Error("Repository path is required");
	if (!host) throw new Error("Host is required");
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		throw new Error("Port must be between 1 and 65535");
	}
	if (
		!Number.isSafeInteger(remoteBridgePort) ||
		remoteBridgePort < 1 ||
		remoteBridgePort > 65_535
	) {
		throw new Error("COUCHVIEW_REMOTE_BRIDGE_PORT must be between 1 and 65535");
	}
	return {
		parsed,
		options: {
			root: path.resolve(root),
			host: normalizeBindHost(host),
			port,
			terminalMode: parsed.terminalMode ?? environmentTerminalMode,
			terminalP2pMode: parsed.terminalP2pMode ?? environmentTerminalP2pMode,
			terminalStunUrls,
			remoteBridgeMode: parsed.remoteBridgeMode ?? environmentRemoteBridgeMode,
			remoteBridgeP2pMode: parsed.remoteBridgeP2pMode ?? environmentRemoteBridgeP2pMode,
			remoteBridgeStunUrls,
			remoteBridgePort,
			remoteBridgeOriginAccess:
				parsed.remoteBridgeOriginAccess ?? environmentRemoteBridgeOriginAccess,
			speechMode: parsed.speechMode ?? environmentSpeechMode,
			voiceCommandsEnabled: parsed.voiceCommandsEnabled,
		},
	};
}

function parseStunUrls(
	value: string | undefined,
	environmentName: string,
	defaults: readonly string[],
): string[] {
	const urls =
		value === undefined ? [...defaults] : value.split(",").map((candidate) => candidate.trim());
	if (urls.length < 1 || urls.length > 4 || urls.some((candidate) => !candidate)) {
		throw new Error(`${environmentName} must contain between 1 and 4 STUN URLs`);
	}
	for (const candidate of urls) {
		const match = /^stun:(\[[0-9A-Fa-f:.]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(candidate);
		const rawHost = match?.[1] ?? "";
		const host = rawHost.startsWith("[") ? rawHost.slice(1, -1) : rawHost;
		const validHost = rawHost.startsWith("[")
			? isIP(host) === 6
			: isIP(host) === 4 ||
				(host.length <= 253 &&
					host
						.split(".")
						.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)));
		const explicitPort = match?.[2];
		if (
			!match ||
			!validHost ||
			(explicitPort !== undefined && (Number(explicitPort) < 1 || Number(explicitPort) > 65_535))
		) {
			throw new Error(`${environmentName} entries must use stun:host or stun:host:port`);
		}
	}
	return [...new Set(urls)];
}

export function parseTerminalStunUrls(value: string | undefined): string[] {
	return parseStunUrls(value, "COUCHVIEW_TERMINAL_STUN", DEFAULT_TERMINAL_STUN_URLS);
}

export function parseRemoteBridgeStunUrls(value: string | undefined): string[] {
	return parseStunUrls(value, "COUCHVIEW_REMOTE_BRIDGE_STUN", DEFAULT_REMOTE_BRIDGE_STUN_URLS);
}
