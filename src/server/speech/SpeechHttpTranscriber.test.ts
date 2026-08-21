import { afterEach, describe, expect, test } from "bun:test";

import { HttpError } from "../errors.ts";
import { SpeechHttpTranscriber } from "./SpeechHttpTranscriber.ts";

const NativeResponse = (await Bun.fetch("data:text/plain,")).constructor as typeof Response;
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

function startServer(fetch: (request: Request) => Response | Promise<Response>): string {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
	servers.push(server);
	return `http://127.0.0.1:${server.port}`;
}

function health(workerState = "stopped"): Response {
	return NativeResponse.json({
		status: "ok",
		service: "couchspeech",
		serviceVersion: 1,
		protocolVersion: 1,
		model: "parakeet-tdt-0.6b-v3-int8",
		workerState,
	});
}

function models(): Response {
	return NativeResponse.json({
		object: "list",
		data: [{ id: "parakeet-tdt-0.6b-v3-int8", object: "model" }],
	});
}

describe("SpeechHttpTranscriber", () => {
	test("treats a compatible cold daemon as ready and sends raw audio over loopback", async () => {
		let healthAuthorization: string | null | undefined;
		const requests: Array<{
			authorization: string | null;
			body: Uint8Array;
			contentType: string | null;
			url: URL;
		}> = [];
		const baseUrl = startServer(async (request) => {
			const url = new URL(request.url);
			if (url.pathname === "/health") {
				healthAuthorization = request.headers.get("authorization");
				return health("stopped");
			}
			if (url.pathname === "/v1/models") return models();
			requests.push({
				authorization: request.headers.get("authorization"),
				body: new Uint8Array(await request.arrayBuffer()),
				contentType: request.headers.get("content-type"),
				url,
			});
			return NativeResponse.json(
				{ text: "hello couchview", language: "en", inferenceMs: 9 },
				{ headers: { "Server-Timing": "queue;dur=0.2, decode;dur=1.1, model;dur=8.6" } },
			);
		});
		const transcriber = await SpeechHttpTranscriber.create({
			url: baseUrl,
			token: "local-secret",
		});
		expect(transcriber.ready).toBe(true);
		expect(healthAuthorization).toBeNull();
		const bytes = new Uint8Array(128 * 1024);
		bytes.set([1, 2, 3, 4]);
		await expect(
			transcriber.transcribe(bytes, { durationMs: 500, sampleRate: 16_000 }),
		).resolves.toEqual({ text: "hello couchview", language: "en", inferenceMs: 9 });
		expect(requests).toHaveLength(1);
		expect(requests[0]?.authorization).toBe("Bearer local-secret");
		expect(requests[0]?.contentType).toBe("audio/wav");
		expect(requests[0]?.body).toEqual(bytes);
		expect(requests[0]?.url.pathname).toBe("/v1/audio/transcriptions");
		expect(requests[0]?.url.searchParams.get("model")).toBe("parakeet-tdt-0.6b-v3-int8");
		expect(requests[0]?.url.searchParams.get("response_format")).toBe("json");
		expect(requests[0]?.url.searchParams.get("language")).toBeNull();
		transcriber.close();
		expect(transcriber.ready).toBe(false);
	});

	test("forwards a scoped English language hint to the local daemon", async () => {
		const transcriptionUrls: URL[] = [];
		const baseUrl = startServer((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/health") return health("ready");
			if (url.pathname === "/v1/models") return models();
			transcriptionUrls.push(url);
			return NativeResponse.json({ text: "Review current file.", language: "en", inferenceMs: 7 });
		});
		const transcriber = await SpeechHttpTranscriber.create({ url: baseUrl });
		const metadata = { durationMs: 500, sampleRate: 16_000, language: "en" as const };
		await transcriber.transcribe(new Uint8Array([1]), metadata);
		expect(transcriptionUrls[0]?.searchParams.get("language")).toBe("en");
	});

	test("uses model Server-Timing when the compatible response omits inferenceMs", async () => {
		const baseUrl = startServer((request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === "/health") return health("ready");
			if (pathname === "/v1/models") return models();
			return NativeResponse.json(
				{ text: "olá", language: "pt" },
				{ headers: { "Server-Timing": "queue;dur=1, model;dur=12.6" } },
			);
		});
		const transcriber = await SpeechHttpTranscriber.create({ url: baseUrl });
		await expect(
			transcriber.transcribe(new Uint8Array([1]), {
				durationMs: 500,
				sampleRate: 16_000,
			}),
		).resolves.toEqual({ text: "olá", language: "pt", inferenceMs: 13 });
	});

	test("maps daemon overload to Couchview's stable structured error", async () => {
		const baseUrl = startServer((request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === "/health") return health();
			if (pathname === "/v1/models") return models();
			return NativeResponse.json(
				{
					error: {
						message: "queue full",
						type: "rate_limit_error",
						param: null,
						code: "queue_full",
					},
				},
				{ status: 429 },
			);
		});
		const transcriber = await SpeechHttpTranscriber.create({ url: baseUrl });
		try {
			await transcriber.transcribe(new Uint8Array([1]), {
				durationMs: 500,
				sampleRate: 16_000,
			});
			throw new Error("Expected overload");
		} catch (error) {
			expect(error).toBeInstanceOf(HttpError);
			expect(error).toMatchObject({ code: "speech_busy", status: 429 });
		}
	});

	test("rejects an incompatible daemon before advertising readiness", async () => {
		const baseUrl = startServer(() =>
			NativeResponse.json({
				status: "ok",
				service: "couchspeech",
				serviceVersion: 2,
				protocolVersion: 1,
				model: "parakeet-tdt-0.6b-v3-int8",
				workerState: "stopped",
			}),
		);
		await expect(SpeechHttpTranscriber.create({ url: baseUrl })).rejects.toThrow(
			"health response is incompatible",
		);
	});

	test("requires the configured bearer token before advertising readiness", async () => {
		const baseUrl = startServer((request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === "/health") return health();
			if (request.headers.get("authorization") !== "Bearer current-token") {
				return NativeResponse.json({ error: { message: "unauthorized" } }, { status: 401 });
			}
			return models();
		});
		await expect(
			SpeechHttpTranscriber.create({ url: baseUrl, token: "stale-token" }),
		).rejects.toThrow("authentication or model response is incompatible");
		await expect(
			SpeechHttpTranscriber.create({ url: baseUrl, token: "current-token" }),
		).resolves.toMatchObject({ ready: true });
	});
});
