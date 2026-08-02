import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
	type RemoteBridgeProfile,
	remoteBridgeOriginAccessIdIsValid,
} from "../shared/contracts.ts";
import {
	remoteBridgeClaudeCommand as buildRemoteBridgeClaudeCommand,
	remoteBridgeCodexCommand as buildRemoteBridgeCodexCommand,
	remoteBridgeTerminalCommand as buildRemoteBridgeTerminalCommand,
	remoteBridgeZedUrl as buildRemoteBridgeZedUrl,
} from "../shared/remoteBridgeCommands.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";

const CONFIG_VERSION = 2;
const MAX_CONFIG_BYTES = 1024 * 1024;

interface RemoteBridgeConfigFile {
	version: typeof CONFIG_VERSION;
	profiles: RemoteBridgeProfile[];
}

export interface RemoteBridgePaths {
	configDirectory: string;
	configFile: string;
	sshDirectory: string;
	sshConfigFile: string;
	managedSshConfigFile: string;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function normalizeRemoteBridgeOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("The Couchview bridge URL must be an HTTP or HTTPS origin");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error("The Couchview bridge URL must be an HTTP or HTTPS origin");
	}
	return url.origin;
}

export function resolveRemoteBridgePaths(
	environment: Record<string, string | undefined> = process.env,
	userHome = homedir(),
): RemoteBridgePaths {
	const configured = environment.XDG_CONFIG_HOME;
	const configHome =
		configured && path.isAbsolute(configured) ? configured : path.join(userHome, ".config");
	const configDirectory = path.join(configHome, "couchview");
	const sshDirectory = path.join(userHome, ".ssh");
	return {
		configDirectory,
		configFile: path.join(configDirectory, "remote-bridges.json"),
		sshDirectory,
		sshConfigFile: path.join(sshDirectory, "config"),
		managedSshConfigFile: path.join(sshDirectory, "couchview_config"),
	};
}

function profileIsValid(value: unknown): value is RemoteBridgeProfile {
	if (!value || typeof value !== "object") return false;
	const profile = value as Partial<RemoteBridgeProfile>;
	return (
		typeof profile.id === "string" &&
		/^[A-Za-z0-9-]{8,128}$/.test(profile.id) &&
		typeof profile.origin === "string" &&
		typeof profile.repositoryId === "string" &&
		typeof profile.repositoryName === "string" &&
		typeof profile.repositoryRoot === "string" &&
		path.isAbsolute(profile.repositoryRoot) &&
		typeof profile.deviceId === "string" &&
		typeof profile.deviceToken === "string" &&
		/^[A-Za-z0-9_-]{32,128}$/.test(profile.deviceToken) &&
		typeof profile.deviceLabel === "string" &&
		typeof profile.sshAlias === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(profile.sshAlias) &&
		typeof profile.username === "string" &&
		/^[A-Za-z0-9._-]{1,255}$/.test(profile.username) &&
		remoteBridgeOriginAccessIdIsValid(profile.originAccess)
	);
}

function normalizeProfile(
	value: unknown,
	originAccessOverride?: string,
): RemoteBridgeProfile | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	const legacyCloudflareAccess = candidate.cloudflareAccess;
	const originAccess =
		originAccessOverride ??
		candidate.originAccess ??
		(typeof legacyCloudflareAccess === "boolean"
			? legacyCloudflareAccess
				? CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID
				: REMOTE_BRIDGE_NO_ORIGIN_ACCESS
			: undefined);
	const normalized: Record<string, unknown> = { ...candidate, originAccess };
	delete normalized.cloudflareAccess;
	if (!profileIsValid(normalized)) return null;
	return { ...normalized, origin: normalizeRemoteBridgeOrigin(normalized.origin) };
}

export function validateRemoteBridgeProfile(
	value: unknown,
	originAccessOverride?: string,
): RemoteBridgeProfile {
	const profile = normalizeProfile(value, originAccessOverride);
	if (!profile) {
		throw new Error("The Couchview server returned an invalid remote bridge profile");
	}
	return profile;
}

function emptyConfig(): RemoteBridgeConfigFile {
	return { version: CONFIG_VERSION, profiles: [] };
}

export async function readRemoteBridgeConfig(
	paths = resolveRemoteBridgePaths(),
): Promise<RemoteBridgeConfigFile> {
	if (!existsSync(paths.configFile)) return emptyConfig();
	const raw = await readFile(paths.configFile);
	if (raw.byteLength > MAX_CONFIG_BYTES) {
		throw new Error("The Couchview remote bridge config is unexpectedly large");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.toString("utf8"));
	} catch {
		throw new Error(`The Couchview remote bridge config is invalid: ${paths.configFile}`);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`The Couchview remote bridge config is invalid: ${paths.configFile}`);
	}
	const candidate = parsed as { version?: unknown; profiles?: unknown };
	if (
		(candidate.version !== 1 && candidate.version !== CONFIG_VERSION) ||
		!Array.isArray(candidate.profiles)
	) {
		throw new Error(`The Couchview remote bridge config is invalid: ${paths.configFile}`);
	}
	const profiles = candidate.profiles.map((profile) => normalizeProfile(profile));
	if (profiles.some((profile) => profile === null)) {
		throw new Error(`The Couchview remote bridge config is invalid: ${paths.configFile}`);
	}
	return {
		version: CONFIG_VERSION,
		profiles: profiles as RemoteBridgeProfile[],
	};
}

export async function resolveRemoteBridgeProfile(
	selector: string | null | undefined,
	paths = resolveRemoteBridgePaths(),
): Promise<RemoteBridgeProfile> {
	const profiles = (await readRemoteBridgeConfig(paths)).profiles;
	if (selector) {
		const selected = profiles.find(
			(profile) => profile.id === selector || profile.sshAlias === selector,
		);
		if (selected) return selected;
		const available = profiles.map((profile) => profile.sshAlias).sort();
		throw new Error(
			available.length === 0
				? "No paired Couchview bridge profiles are available"
				: `Couchview bridge profile '${selector}' was not found. Available SSH hosts: ${available.join(", ")}`,
		);
	}
	if (profiles.length === 1) return profiles[0]!;
	if (profiles.length === 0) {
		throw new Error(
			"No paired Couchview bridge profiles are available; pair this computer from Couchview first",
		);
	}
	throw new Error(
		`More than one Couchview bridge profile is available; choose one with --profile (${profiles
			.map((profile) => profile.sshAlias)
			.sort()
			.join(", ")})`,
	);
}

async function writePrivateFile(filePath: string, contents: string): Promise<void> {
	const temporary = `${filePath}.tmp-${randomUUID()}`;
	await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	await chmod(path.dirname(filePath), 0o700);
	try {
		await writeFile(temporary, contents, { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, filePath);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined);
		throw error;
	}
}

function managedSshConfig(
	profiles: readonly RemoteBridgeProfile[],
	executableCommand: string,
): string {
	const blocks = [...profiles]
		.sort((left, right) => left.sshAlias.localeCompare(right.sshAlias))
		.map((profile) =>
			[
				`Host ${profile.sshAlias}`,
				`  HostName ${profile.sshAlias}.invalid`,
				`  User ${profile.username}`,
				`  ProxyCommand ${executableCommand} bridge proxy --profile ${shellQuote(profile.id)}`,
				"  ConnectTimeout 20",
				"  ServerAliveInterval 15",
				"  ServerAliveCountMax 3",
			].join("\n"),
		);
	return [
		"# Managed by Couchview. Pair or revoke devices through Couchview instead of editing this file.",
		...blocks,
		"",
	].join("\n\n");
}

async function ensureSshInclude(paths: RemoteBridgePaths): Promise<void> {
	await mkdir(paths.sshDirectory, { recursive: true, mode: 0o700 });
	await chmod(paths.sshDirectory, 0o700);
	const current = await readFile(paths.sshConfigFile, "utf8").catch((error) => {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	});
	const includePattern = /^\s*Include\s+"?~\/\.ssh\/couchview_config"?\s*$/im;
	if (includePattern.test(current)) {
		await chmod(paths.sshConfigFile, 0o600);
		return;
	}
	const include = "Include ~/.ssh/couchview_config";
	const updated = current ? `${include}\n\n${current}` : `${include}\n`;
	await writeFile(paths.sshConfigFile, updated, { mode: 0o600 });
	await chmod(paths.sshConfigFile, 0o600);
}

export async function storeRemoteBridgeProfile(
	profile: RemoteBridgeProfile,
	options: {
		paths?: RemoteBridgePaths;
		executableCommand?: string;
	} = {},
): Promise<void> {
	const validated = validateRemoteBridgeProfile(profile);
	const paths = options.paths ?? resolveRemoteBridgePaths();
	const executableCommand = options.executableCommand ?? defaultRemoteBridgeExecutableCommand();
	const current = await readRemoteBridgeConfig(paths);
	const profiles = [
		...current.profiles.filter(
			(candidate) => candidate.id !== validated.id && candidate.sshAlias !== validated.sshAlias,
		),
		validated,
	];
	await writePrivateFile(paths.managedSshConfigFile, managedSshConfig(profiles, executableCommand));
	await ensureSshInclude(paths);
	await writePrivateFile(
		paths.configFile,
		`${JSON.stringify({ version: CONFIG_VERSION, profiles }, null, 2)}\n`,
	);
}

export function remoteBridgeZedUrl(profile: RemoteBridgeProfile): string {
	return buildRemoteBridgeZedUrl(profile.sshAlias, profile.repositoryRoot);
}

export function remoteBridgeCodexCommand(
	profile: RemoteBridgeProfile,
	repositoryRoot = profile.repositoryRoot,
): string {
	return buildRemoteBridgeCodexCommand(profile.sshAlias, repositoryRoot);
}

export function remoteBridgeTerminalCommand(
	profile: RemoteBridgeProfile,
	repositoryRoot = profile.repositoryRoot,
): string {
	return buildRemoteBridgeTerminalCommand(profile.sshAlias, repositoryRoot);
}

export function remoteBridgeClaudeCommand(
	profile: RemoteBridgeProfile,
	repositoryRoot = profile.repositoryRoot,
): string {
	return buildRemoteBridgeClaudeCommand(profile.sshAlias, repositoryRoot);
}

export function defaultRemoteBridgeExecutableCommand(): string {
	const executable = Bun.which("couchview");
	if (executable) return shellQuote(executable);
	const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
	return `${shellQuote(process.execPath)} run ${shellQuote(cliPath)}`;
}
