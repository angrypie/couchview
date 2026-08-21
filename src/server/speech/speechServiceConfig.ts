import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { SPEECH_MODEL } from "./types.ts";

export const SPEECH_SERVICE_HOST = "127.0.0.1";
export const SPEECH_SERVICE_PORT = 52_781;
export const SPEECH_SERVICE_DEFAULT_URL = `http://${SPEECH_SERVICE_HOST}:${SPEECH_SERVICE_PORT}`;
export const SPEECH_SERVICE_NAME = "couchspeech";
export const SPEECH_SERVICE_VERSION = 1;
export const SPEECH_PROTOCOL_VERSION = 1;
export { SPEECH_MODEL };

export interface SpeechServiceConfiguration {
	url: string;
	token?: string;
}

export type SpeechServiceEnvironment = Readonly<Record<string, string | undefined>>;

interface StoredSpeechServiceConfiguration {
	service?: unknown;
	serviceVersion?: unknown;
	protocolVersion?: unknown;
	url?: unknown;
	token?: unknown;
}

export interface SpeechServiceConfigurationOptions {
	configPath?: string;
	env?: SpeechServiceEnvironment;
	homeDirectory?: string;
}

export function resolveSpeechServiceConfigPath(
	options: Pick<SpeechServiceConfigurationOptions, "env" | "homeDirectory"> = {},
): string {
	const env = options.env ?? process.env;
	const configuredRoot = env.XDG_CONFIG_HOME?.trim();
	const configRoot =
		configuredRoot && path.isAbsolute(configuredRoot)
			? configuredRoot
			: path.join(options.homeDirectory ?? homedir(), ".config");
	return path.join(configRoot, "couchspeech", "service.json");
}

function normalizedServiceUrl(value: unknown, source: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${source} must be a non-empty HTTP URL`);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${source} must be a valid HTTP URL`);
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error(`${source} must be an HTTP origin without credentials, query, or fragment`);
	}
	return url.href.replace(/\/$/, "");
}

function optionalToken(value: unknown, source: string): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" || value !== value.trim() || /[\r\n]/.test(value)) {
		throw new Error(`${source} must be a single-line string`);
	}
	return value;
}

async function readStoredConfiguration(
	configPath: string,
): Promise<StoredSpeechServiceConfiguration> {
	let metadata;
	try {
		metadata = await stat(configPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	if (!metadata.isFile())
		throw new Error(`Speech service config is not a regular file: ${configPath}`);
	if ((metadata.mode & 0o077) !== 0) {
		throw new Error(
			`Speech service config must not be accessible by group or other users: ${configPath}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(configPath, "utf8"));
	} catch (error) {
		throw new Error(`Speech service config is not valid JSON: ${(error as Error).message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Speech service config must be a JSON object");
	}
	return parsed as StoredSpeechServiceConfiguration;
}

export async function loadSpeechServiceConfiguration(
	options: SpeechServiceConfigurationOptions = {},
): Promise<SpeechServiceConfiguration> {
	const env = options.env ?? process.env;
	const configPath = options.configPath ?? resolveSpeechServiceConfigPath(options);
	const stored = await readStoredConfiguration(configPath);
	const urlOverridden = env.COUCHVIEW_SPEECH_URL !== undefined;
	if (
		!urlOverridden &&
		(stored.service !== SPEECH_SERVICE_NAME ||
			stored.serviceVersion !== SPEECH_SERVICE_VERSION ||
			stored.protocolVersion !== SPEECH_PROTOCOL_VERSION)
	) {
		throw new Error(
			"CouchSpeech is not installed or has incompatible service metadata; run couchspeech start",
		);
	}
	const configuredUrl = urlOverridden ? env.COUCHVIEW_SPEECH_URL : stored.url;
	const configuredToken =
		env.COUCHVIEW_SPEECH_TOKEN !== undefined
			? env.COUCHVIEW_SPEECH_TOKEN
			: urlOverridden
				? undefined
				: stored.token;
	const token = optionalToken(configuredToken, "Speech service token");
	if (!urlOverridden && !token) {
		throw new Error(
			"CouchSpeech credentials are not installed; run couchspeech start or explicitly set COUCHVIEW_SPEECH_URL",
		);
	}
	return {
		url: normalizedServiceUrl(configuredUrl ?? SPEECH_SERVICE_DEFAULT_URL, "Speech service URL"),
		token,
	};
}
