import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	API_ROUTES,
	type BootstrapResponse,
	CSRF_HEADER,
	type SpeechTranscriptionResponse,
} from "../../shared/contracts.ts";
import { type CouchviewApp, createCouchviewApp } from "../server.ts";
import type { SpeechTranscriber } from "./types.ts";
import { pcmWav } from "./wavTestFixture.ts";

const directories: string[] = [];
const applications: Array<{
	app: CouchviewApp;
	server: ReturnType<typeof Bun.serve>;
}> = [];

afterEach(async () => {
	for (const fixture of applications.splice(0)) {
		fixture.app.close();
		fixture.server.stop(true);
	}
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

class DeterministicTranscriber implements SpeechTranscriber {
	readonly model = "deterministic-parakeet";
	readonly ready = true;
	lastAudioPath: string | null = null;
	closed = false;

	async transcribe(audioPath: string) {
		await access(audioPath);
		this.lastAudioPath = audioPath;
		return { text: "olá world", language: null, inferenceMs: 12 };
	}

	close(): void {
		this.closed = true;
	}
}

async function fixture() {
	const repository = await mkdtemp(path.join(tmpdir(), "couchview-speech-server-"));
	const state = await mkdtemp(path.join(tmpdir(), "couchview-speech-state-"));
	directories.push(repository, state);
	expect(Bun.spawnSync(["git", "init", "-q", repository]).exitCode).toBe(0);
	await writeFile(path.join(repository, "sample.ts"), "export const speech = true;\n");
	const transcriber = new DeterministicTranscriber();
	const NativeResponse = (await Bun.fetch("data:text/plain,")).constructor as typeof Response;
	let app: CouchviewApp | null = null;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			if (!app) return new NativeResponse("Starting", { status: 503 });
			const response = await app.fetch(request);
			return new NativeResponse(response.body ? await response.arrayBuffer() : null, {
				headers: [...response.headers.entries()],
				status: response.status,
				statusText: response.statusText,
			});
		},
	});
	try {
		app = await createCouchviewApp({
			host: "127.0.0.1",
			port: server.port,
			root: repository,
			speech: { enabled: true, transcriber },
			stateDatabasePath: path.join(state, "state.sqlite"),
		});
	} catch (error) {
		server.stop(true);
		throw error;
	}
	applications.push({ app, server });
	return { app, origin: `http://127.0.0.1:${server.port}`, transcriber };
}

function apiRequest(origin: string, pathname: string, init: RequestInit = {}): Promise<Response> {
	return Bun.fetch(`${origin}${pathname}`, init);
}

describe("speech HTTP API", () => {
	test("advertises readiness only for an initialized transcriber", async () => {
		const { origin } = await fixture();
		const response = await apiRequest(origin, API_ROUTES.bootstrap);
		const body = (await response.json()) as BootstrapResponse;
		expect(body.speech).toEqual({
			enabled: true,
			ready: true,
			model: "deterministic-parakeet",
			maxDurationMs: 300_000,
			maxUploadBytes: 32 * 1024 * 1024,
			reason: null,
		});
	});

	test("requires browser origin and CSRF authorization", async () => {
		const { origin } = await fixture();
		const body = pcmWav();
		const withoutOrigin = await apiRequest(origin, API_ROUTES.speechTranscriptions, {
			body: body.buffer as ArrayBuffer,
			headers: { "Content-Type": "audio/wav" },
			method: "POST",
		});
		expect(withoutOrigin.status).toBe(403);
		const withoutCsrf = await apiRequest(origin, API_ROUTES.speechTranscriptions, {
			body: body.buffer as ArrayBuffer,
			headers: { "Content-Type": "audio/wav", Origin: origin },
			method: "POST",
		});
		expect(withoutCsrf.status).toBe(403);
	});

	test("validates content type, transcribes, and removes the upload", async () => {
		const { app, origin, transcriber } = await fixture();
		const headers = {
			[CSRF_HEADER]: app.csrfToken,
			"Content-Type": "application/octet-stream",
			Origin: origin,
		};
		const invalid = await apiRequest(origin, API_ROUTES.speechTranscriptions, {
			body: pcmWav().buffer as ArrayBuffer,
			headers,
			method: "POST",
		});
		expect(invalid.status).toBe(415);

		headers["Content-Type"] = "audio/wav";
		const response = await apiRequest(origin, API_ROUTES.speechTranscriptions, {
			body: pcmWav(750).buffer as ArrayBuffer,
			headers,
			method: "POST",
		});
		expect(response.status).toBe(200);
		expect((await response.json()) as SpeechTranscriptionResponse).toEqual({
			text: "olá world",
			language: null,
			durationMs: 750,
			inferenceMs: 12,
		});
		expect(transcriber.lastAudioPath).not.toBeNull();
		await expect(access(path.dirname(transcriber.lastAudioPath as string))).rejects.toThrow();
	});
});
