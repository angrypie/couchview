import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import OpenAI, { toFile } from "openai";
import { type CouchviewApp, createCouchviewApp } from "../../src/server/server.ts";
import { SpeechHttpTranscriber } from "../../src/server/speech/SpeechHttpTranscriber.ts";
import { validatePcmWav } from "../../src/server/speech/wav.ts";
import {
	API_ROUTES,
	CSRF_HEADER,
	type SpeechTranscriptionResponse,
} from "../../src/shared/contracts.ts";
import { paddedPcmWav, SpeechDaemonHarness, spokenFixture } from "./speechServiceTestHarness.ts";

const MODEL = "parakeet-tdt-0.6b-v3-int8";
const ENGLISH_TEXT =
	"Hello from the speech testing service. This recording checks the local transcription system.";
const PORTUGUESE_TEXT =
	"Olá, esta é uma gravação em português. Este teste verifica o serviço local de transcrição.";
const RUN_MODEL_TEST =
	Bun.env.COUCHVIEW_RUN_SPEECH_MODEL_TEST === "1" &&
	process.platform === "darwin" &&
	process.arch === "arm64";
const realModelDescribe = RUN_MODEL_TEST ? describe : describe.skip;

interface FixtureAudio {
	bytes: Uint8Array;
	name: string;
}

interface AttemptResult {
	elapsedMilliseconds: number;
	startedAt: number | undefined;
	status: number | undefined;
}

let harness: SpeechDaemonHarness;
let english: FixtureAudio;
let portuguese: FixtureAudio;

function client(): OpenAI {
	return new OpenAI({
		apiKey: harness.token,
		baseURL: `${harness.baseURL}/v1`,
		maxRetries: 0,
		timeout: 15 * 60_000,
	});
}

function expectTiming(response: Response): void {
	expect(response.headers.get("server-timing")).toMatch(
		/^queue;dur=\d+(?:\.\d+)?, decode;dur=\d+(?:\.\d+)?, model;dur=\d+(?:\.\d+)?$/,
	);
}

function normalizedWords(value: string): string[] {
	const normalized = value
		.normalize("NFKD")
		.replace(/\p{Mark}/gu, "")
		.toLocaleLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, " ")
		.trim();
	return normalized ? normalized.split(/\s+/) : [];
}

function normalizedWordErrorRate(reference: string, transcript: string): number {
	const expected = normalizedWords(reference);
	const actual = normalizedWords(transcript);
	if (expected.length === 0) throw new Error("A WER reference must contain at least one word");
	let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
	for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
		const current = [expectedIndex];
		for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
			const substitutionCost = expected[expectedIndex - 1] === actual[actualIndex - 1] ? 0 : 1;
			current[actualIndex] = Math.min(
				(previous[actualIndex] as number) + 1,
				(current[actualIndex - 1] as number) + 1,
				(previous[actualIndex - 1] as number) + substitutionCost,
			);
		}
		previous = current;
	}
	return (previous[actual.length] as number) / expected.length;
}

async function transcribeWithSdk(audio: FixtureAudio, language?: string) {
	return client()
		.audio.transcriptions.create({
			file: await toFile(audio.bytes, audio.name, { type: "audio/wav" }),
			language,
			model: MODEL,
			response_format: "verbose_json",
		})
		.withResponse();
}

async function attemptTranscription(audio: FixtureAudio, startAt: number): Promise<AttemptResult> {
	const child = Bun.spawn(
		[process.execPath, path.resolve("tests/integration/speechHttpTestClient.ts")],
		{
			env: {
				...process.env,
				COUCHVIEW_TEST_SPEECH_START_AT: String(startAt),
				COUCHVIEW_TEST_SPEECH_TOKEN: harness.token,
				COUCHVIEW_TEST_SPEECH_URL: harness.baseURL,
			},
			stderr: "pipe",
			stdin: "pipe",
			stdout: "pipe",
		},
	);
	child.stdin.write(audio.bytes);
	child.stdin.end();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const exitCode = await Promise.race([
		child.exited,
		new Promise<null>((resolve) => {
			timeout = setTimeout(() => resolve(null), 60_000);
		}),
	]);
	if (timeout) clearTimeout(timeout);
	if (exitCode === null) {
		child.kill("SIGKILL");
		await child.exited;
	}
	const output = await new Response(child.stdout).text();
	await new Response(child.stderr).arrayBuffer();
	let result: { startedAt?: unknown; status?: unknown } = {};
	try {
		result = JSON.parse(output) as typeof result;
	} catch {
		// A missing/malformed child result is surfaced through the assertions below.
	}
	return {
		elapsedMilliseconds: Date.now() - startAt,
		startedAt:
			exitCode === 0 && typeof result.startedAt === "number" ? result.startedAt : undefined,
		status: exitCode === 0 && typeof result.status === "number" ? result.status : undefined,
	};
}

async function requestThroughCouchview(audio: FixtureAudio): Promise<SpeechTranscriptionResponse> {
	const repository = path.join(harness.rootDirectory, "couchview-repository");
	const state = path.join(harness.rootDirectory, "couchview-state");
	await Promise.all([mkdir(repository), mkdir(state)]);
	const git = Bun.spawnSync(["git", "init", "-q", repository]);
	if (git.exitCode !== 0) throw new Error("Could not initialize the Couchview test repository");
	await writeFile(path.join(repository, "speech.ts"), "export const speech = true;\n");
	const transcriber = await SpeechHttpTranscriber.create({
		token: harness.token,
		url: harness.baseURL,
	});
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
		const origin = `http://127.0.0.1:${server.port}`;
		const response = await fetch(`${origin}${API_ROUTES.speechTranscriptions}`, {
			body: audio.bytes as BodyInit,
			headers: {
				[CSRF_HEADER]: app.csrfToken,
				"Content-Type": "audio/wav",
				Origin: origin,
			},
			method: "POST",
		});
		if (!response.ok) throw new Error(`Couchview speech route returned ${response.status}`);
		return (await response.json()) as SpeechTranscriptionResponse;
	} finally {
		app?.close();
		if (!app) transcriber.close();
		server.stop(true);
	}
}

realModelDescribe("shared Swift speech service", () => {
	beforeAll(async () => {
		harness = await SpeechDaemonHarness.start();
		[english, portuguese] = await Promise.all([
			spokenFixture(harness.fixtureDirectory, "english", "Samantha", ENGLISH_TEXT),
			spokenFixture(harness.fixtureDirectory, "portuguese", "Joana", PORTUGUESE_TEXT),
		]);
	}, 30_000);

	afterAll(async () => {
		await harness?.stop();
	}, 15_000);

	test(
		"serves deterministic English and Portuguese through the official OpenAI SDK",
		async () => {
			const models = await client().models.list();
			expect(models.data.map((model) => model.id)).toContain(MODEL);

			const englishResult = await transcribeWithSdk(english);
			expect(englishResult.data.text.toLocaleLowerCase()).toContain("hello");
			expect(englishResult.data.language).toBe("en");
			expect(normalizedWordErrorRate(ENGLISH_TEXT, englishResult.data.text)).toBeLessThanOrEqual(
				0.15,
			);
			expect(englishResult.data.duration).toBeGreaterThan(0);
			expect((englishResult.data as { task?: string }).task).toBe("transcribe");
			expectTiming(englishResult.response);

			const portugueseResult = await transcribeWithSdk(portuguese);
			expect(portugueseResult.data.text.toLocaleLowerCase()).toMatch(/ol[aá]/);
			expect(portugueseResult.data.language).toBe("pt");
			expect(
				normalizedWordErrorRate(PORTUGUESE_TEXT, portugueseResult.data.text),
			).toBeLessThanOrEqual(0.2);
			expect(portugueseResult.data.duration).toBeGreaterThan(0);
			expectTiming(portugueseResult.response);
			expect(await harness.waitForWorkerCount(1)).toHaveLength(1);
		},
		20 * 60_000,
	);

	test(
		"forwards in-memory WAV bytes through the real Couchview HTTP route",
		async () => {
			const result = await requestThroughCouchview(english);
			const wav = validatePcmWav(english.bytes);
			expect(result.text.toLocaleLowerCase()).toContain("hello");
			expect(result.language).toBe("en");
			expect(result.durationMs).toBe(wav.durationMs);
			expect(result.inferenceMs).toBeGreaterThanOrEqual(0);
		},
		5 * 60_000,
	);

	test(
		"admits a bounded subset of ten simultaneous clients with one worker",
		async () => {
			const preload = await fetch(`${harness.baseURL}/api/ps/${MODEL}`, {
				headers: harness.authorizedHeaders(),
				method: "POST",
			});
			expect(preload.status).toBe(200);
			const [initialWorker] = await harness.waitForWorkerCount(1);
			expect(initialWorker).toBeDefined();
			const concurrentAudio = { ...english, name: "concurrent.wav" };
			let sampling = true;
			const samples: number[][] = [];
			const startAt = Date.now() + 2_000;
			const sampler = (async () => {
				while (sampling) {
					samples.push(await harness.workerPids());
					await Bun.sleep(100);
				}
			})();
			const attempts = await Promise.all(
				Array.from({ length: 10 }, () => attemptTranscription(concurrentAudio, startAt)),
			).finally(() => {
				sampling = false;
			});
			await sampler;

			const accepted = attempts.filter((attempt) => attempt.status === 200);
			const rejected = attempts.filter((attempt) => attempt.status !== 200);
			const synchronizedStarts = attempts
				.map((attempt) => attempt.startedAt)
				.filter((value): value is number => value !== undefined);
			expect(synchronizedStarts).toHaveLength(10);
			expect(Math.max(...synchronizedStarts) - Math.min(...synchronizedStarts)).toBeLessThanOrEqual(
				250,
			);
			expect(accepted.length).toBeGreaterThan(0);
			expect(accepted.length).toBeLessThanOrEqual(3);
			expect(rejected.length).toBeGreaterThan(0);
			expect(rejected.every((attempt) => attempt.status === 429)).toBe(true);
			expect(Math.max(...rejected.map((attempt) => attempt.elapsedMilliseconds))).toBeLessThan(
				10_000,
			);
			expect(samples.length).toBeGreaterThan(0);
			expect(samples.every((pids) => pids.length <= 1)).toBe(true);
			expect(new Set(samples.flat())).toEqual(new Set([initialWorker as number]));
			expect(await harness.workerPids()).toEqual([initialWorker as number]);
		},
		10 * 60_000,
	);

	test(
		"keeps request audio out of files and terminates the worker on HTTP abort",
		async () => {
			const preload = await fetch(`${harness.baseURL}/api/ps/${MODEL}`, {
				headers: harness.authorizedHeaders(),
				method: "POST",
			});
			expect(preload.status).toBe(200);
			const [workerPid] = await harness.waitForWorkerCount(1);
			expect(workerPid).toBeDefined();
			const before = await harness.temporaryTree();
			const monitor = harness.monitorTemporaryFiles();
			const controller = new AbortController();
			let settled = false;
			const valid = await transcribeWithSdk(english, "en");
			expect(valid.data.text.toLocaleLowerCase()).toContain("hello");
			const invalid = await fetch(
				`${harness.baseURL}/v1/audio/transcriptions?model=${MODEL}&response_format=json`,
				{
					body: new Uint8Array([1, 2, 3]) as BodyInit,
					headers: harness.authorizedHeaders({ "Content-Type": "audio/wav" }),
					method: "POST",
				},
			);
			expect(invalid.status).toBe(422);
			const request = fetch(
				`${harness.baseURL}/v1/audio/transcriptions?model=${MODEL}&response_format=json`,
				{
					body: paddedPcmWav(english.bytes, 300_000) as BodyInit,
					headers: harness.authorizedHeaders({ "Content-Type": "audio/wav" }),
					method: "POST",
					signal: controller.signal,
				},
			).then(
				(response) => ({ error: null, response }),
				(error: Error) => ({ error, response: null }),
			);
			void request.then(() => {
				settled = true;
			});
			try {
				await Bun.sleep(250);
				expect(settled).toBe(false);
				expect(await harness.workerPids()).toEqual([workerPid as number]);
				const openFiles = await harness.openFiles(workerPid as number);
				const requestArtifacts = openFiles.filter(
					(filename) =>
						filename.startsWith(harness.monitoredTmpDirectory) ||
						/\.(?:aiff|m4a|mp3|wav|webm)$/i.test(filename),
				);
				expect(requestArtifacts).toEqual([]);
				controller.abort();
				const outcome = await request;
				expect(outcome.error?.name === "AbortError" || outcome.response?.status === 499).toBe(true);
				await harness.waitForWorkerCount(0);
			} finally {
				controller.abort();
				monitor.close();
			}
			await Bun.sleep(100);
			expect(await harness.temporaryTree()).toEqual(before);
			expect(monitor.changes).toEqual([]);
		},
		10 * 60_000,
	);

	test(
		"restarts lazily after the real worker is killed",
		async () => {
			const beforeCrash = await transcribeWithSdk(english, "en");
			expect(beforeCrash.data.text.toLocaleLowerCase()).toContain("hello");
			const [firstWorker] = await harness.waitForWorkerCount(1);
			expect(firstWorker).toBeDefined();
			await harness.killWorker(firstWorker as number);

			const recovered = await transcribeWithSdk(portuguese, "pt");
			expect(recovered.data.text.toLocaleLowerCase()).toMatch(/ol[aá]/);
			expect(recovered.data.language).toBe("pt");
			const [replacementWorker] = await harness.waitForWorkerCount(1);
			expect(replacementWorker).toBeDefined();
			expect(replacementWorker).not.toBe(firstWorker);
		},
		20 * 60_000,
	);
});
