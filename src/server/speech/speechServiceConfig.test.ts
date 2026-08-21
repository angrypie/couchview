import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	loadSpeechServiceConfiguration,
	resolveSpeechServiceConfigPath,
	SPEECH_PROTOCOL_VERSION,
	SPEECH_SERVICE_DEFAULT_URL,
	SPEECH_SERVICE_NAME,
	SPEECH_SERVICE_VERSION,
} from "./speechServiceConfig.ts";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

async function fixtureDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchspeech-config-"));
	directories.push(directory);
	return directory;
}

describe("speech service configuration", () => {
	test("uses the XDG path and requires explicit installation by default", async () => {
		const directory = await fixtureDirectory();
		const env = { XDG_CONFIG_HOME: directory };
		expect(resolveSpeechServiceConfigPath({ env })).toBe(
			path.join(directory, "couchspeech", "service.json"),
		);
		await expect(loadSpeechServiceConfiguration({ env })).rejects.toThrow("run couchspeech start");
	});

	test("allows tokenless service discovery only for an explicit URL override", async () => {
		const directory = await fixtureDirectory();
		await expect(
			loadSpeechServiceConfiguration({
				configPath: path.join(directory, "missing.json"),
				env: { COUCHVIEW_SPEECH_URL: SPEECH_SERVICE_DEFAULT_URL },
			}),
		).resolves.toEqual({ url: SPEECH_SERVICE_DEFAULT_URL, token: undefined });
	});

	test("ignores a relative XDG config root", () => {
		expect(
			resolveSpeechServiceConfigPath({
				env: { XDG_CONFIG_HOME: "relative-config" },
				homeDirectory: "/Users/reviewer",
			}),
		).toBe("/Users/reviewer/.config/couchspeech/service.json");
	});

	test("loads a private config and lets environment values win", async () => {
		const directory = await fixtureDirectory();
		const configPath = path.join(directory, "couchspeech", "service.json");
		await mkdir(path.dirname(configPath), { recursive: true });
		await writeFile(
			configPath,
			JSON.stringify({ url: "http://127.0.0.1:6000", token: "stored-token" }),
			{ mode: 0o600 },
		);
		await expect(
			loadSpeechServiceConfiguration({
				configPath,
				env: {
					COUCHVIEW_SPEECH_TOKEN: "environment-token",
					COUCHVIEW_SPEECH_URL: "http://127.0.0.1:7000/",
				},
			}),
		).resolves.toEqual({ url: "http://127.0.0.1:7000", token: "environment-token" });
	});

	test("loads only a CouchSpeech-owned installed configuration", async () => {
		const directory = await fixtureDirectory();
		const configPath = path.join(directory, "service.json");
		await writeFile(
			configPath,
			JSON.stringify({
				service: SPEECH_SERVICE_NAME,
				serviceVersion: SPEECH_SERVICE_VERSION,
				protocolVersion: SPEECH_PROTOCOL_VERSION,
				url: SPEECH_SERVICE_DEFAULT_URL,
				token: "private-token",
			}),
			{ mode: 0o600 },
		);
		await expect(loadSpeechServiceConfiguration({ configPath, env: {} })).resolves.toEqual({
			url: SPEECH_SERVICE_DEFAULT_URL,
			token: "private-token",
		});

		await writeFile(
			configPath,
			JSON.stringify({
				service: "not-couchspeech",
				serviceVersion: SPEECH_SERVICE_VERSION,
				protocolVersion: SPEECH_PROTOCOL_VERSION,
				url: SPEECH_SERVICE_DEFAULT_URL,
				token: "private-token",
			}),
			{ mode: 0o600 },
		);
		await expect(loadSpeechServiceConfiguration({ configPath, env: {} })).rejects.toThrow(
			"incompatible service metadata",
		);
	});

	test("does not send a stored token to an overridden URL", async () => {
		const directory = await fixtureDirectory();
		const configPath = path.join(directory, "speech-service.json");
		await writeFile(
			configPath,
			JSON.stringify({ url: "http://127.0.0.1:52781", token: "stored-token" }),
			{ mode: 0o600 },
		);
		await expect(
			loadSpeechServiceConfiguration({
				configPath,
				env: { COUCHVIEW_SPEECH_URL: "http://127.0.0.1:6000" },
			}),
		).resolves.toEqual({ url: "http://127.0.0.1:6000", token: undefined });
	});

	test("rejects a config readable by other users", async () => {
		const directory = await fixtureDirectory();
		const configPath = path.join(directory, "speech-service.json");
		await writeFile(configPath, JSON.stringify({ token: "secret" }), { mode: 0o600 });
		await chmod(configPath, 0o644);
		await expect(loadSpeechServiceConfiguration({ configPath, env: {} })).rejects.toThrow(
			"must not be accessible by group or other users",
		);
	});
});
