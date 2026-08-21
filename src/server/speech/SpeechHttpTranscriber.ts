import { HttpError } from "../errors.ts";
import {
	SPEECH_PROTOCOL_VERSION,
	SPEECH_SERVICE_NAME,
	SPEECH_SERVICE_VERSION,
	type SpeechServiceConfiguration,
} from "./speechServiceConfig.ts";
import {
	SPEECH_MODEL,
	type SpeechAudioMetadata,
	type SpeechTranscriber,
	type SpeechTranscriberResult,
} from "./types.ts";

const MAX_RESPONSE_BYTES = 64 * 1024;

interface SpeechHealthResponse {
	status?: unknown;
	service?: unknown;
	serviceVersion?: unknown;
	protocolVersion?: unknown;
	model?: unknown;
}

interface OpenAiModelListResponse {
	object?: unknown;
	data?: Array<{ id?: unknown; object?: unknown }>;
}

interface OpenAiTranscriptionResponse {
	text?: unknown;
	language?: unknown;
	inferenceMs?: unknown;
}

interface OpenAiErrorResponse {
	error?: {
		code?: unknown;
		message?: unknown;
	};
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SpeechHttpTranscriberOptions extends SpeechServiceConfiguration {
	fetcher?: Fetcher;
	healthTimeoutMs?: number;
	model?: string;
}

async function readBoundedJson(response: Response): Promise<unknown> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw new Error("Speech service response is too large");
	}
	if (!response.body) throw new Error("Speech service returned an empty response");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			total += result.value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new Error("Speech service response is too large");
			}
			chunks.push(result.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new Error("Speech service returned invalid JSON");
	}
}

function modelTiming(response: Response): number | null {
	const header = response.headers.get("server-timing");
	if (!header) return null;
	for (const metric of header.split(",")) {
		const [name, ...parameters] = metric.trim().split(";");
		if (name?.trim().toLowerCase() !== "model") continue;
		for (const parameter of parameters) {
			const match = /^\s*dur\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*$/i.exec(parameter);
			if (!match) continue;
			const duration = Number(match[1]);
			if (Number.isFinite(duration)) return Math.round(duration);
		}
	}
	return null;
}

function daemonError(status: number, value: unknown): HttpError {
	const body = value as OpenAiErrorResponse;
	const daemonCode = typeof body?.error?.code === "string" ? body.error.code : "";
	if (status === 429) {
		return new HttpError(429, "speech_busy", "The speech model is busy; try again shortly.");
	}
	if (status === 504 || daemonCode === "worker_timeout") {
		return new HttpError(504, "speech_timeout", "Speech transcription timed out.");
	}
	if (status === 413 && /duration|too_long/.test(daemonCode)) {
		return new HttpError(
			413,
			"speech_audio_too_long",
			"Speech recordings are limited to five minutes.",
		);
	}
	if (status === 413) {
		return new HttpError(413, "speech_audio_too_large", "Speech uploads are limited to 32 MiB.");
	}
	if (status === 400 || status === 415 || status === 422) {
		return new HttpError(
			400,
			"speech_audio_invalid",
			"The speech service rejected this WAV recording.",
		);
	}
	if (status === 401 || status === 403 || status === 503) {
		return new HttpError(503, "speech_unavailable", "The shared speech service is unavailable.");
	}
	return new HttpError(
		502,
		"speech_service_failed",
		"The host speech model could not transcribe this recording.",
	);
}

function compatibleHealth(value: unknown, model: string): boolean {
	const health = value as SpeechHealthResponse;
	return (
		health?.status === "ok" &&
		health.service === SPEECH_SERVICE_NAME &&
		health.serviceVersion === SPEECH_SERVICE_VERSION &&
		health.protocolVersion === SPEECH_PROTOCOL_VERSION &&
		health.model === model
	);
}

function compatibleModels(value: unknown, model: string): boolean {
	const models = value as OpenAiModelListResponse;
	return (
		models?.object === "list" &&
		Array.isArray(models.data) &&
		models.data.some((candidate) => candidate?.id === model && candidate.object === "model")
	);
}

export class SpeechHttpTranscriber implements SpeechTranscriber {
	readonly model: string;
	private readonly baseUrl: string;
	private readonly token?: string;
	private readonly fetcher: Fetcher;
	private readyState = false;
	private closed = false;

	private constructor(options: SpeechHttpTranscriberOptions) {
		this.baseUrl = options.url;
		this.token = options.token;
		this.fetcher = options.fetcher ?? globalThis.fetch;
		this.model = options.model ?? SPEECH_MODEL;
	}

	static async create(options: SpeechHttpTranscriberOptions): Promise<SpeechHttpTranscriber> {
		const transcriber = new SpeechHttpTranscriber(options);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), options.healthTimeoutMs ?? 3_000);
		try {
			const healthResponse = await transcriber.fetcher(new URL("/health", `${options.url}/`), {
				headers: { Accept: "application/json" },
				redirect: "error",
				signal: controller.signal,
			});
			if (
				!healthResponse.ok ||
				!compatibleHealth(await readBoundedJson(healthResponse), transcriber.model)
			) {
				throw new Error("Speech service health response is incompatible");
			}
			const modelsResponse = await transcriber.fetcher(new URL("/v1/models", `${options.url}/`), {
				headers: transcriber.headers(),
				redirect: "error",
				signal: controller.signal,
			});
			if (
				!modelsResponse.ok ||
				!compatibleModels(await readBoundedJson(modelsResponse), transcriber.model)
			) {
				throw new Error("Speech service authentication or model response is incompatible");
			}
			transcriber.readyState = true;
			return transcriber;
		} finally {
			clearTimeout(timeout);
		}
	}

	get ready(): boolean {
		return this.readyState && !this.closed;
	}

	async transcribe(
		bytes: Uint8Array,
		metadata: SpeechAudioMetadata,
		signal?: AbortSignal,
	): Promise<SpeechTranscriberResult> {
		if (this.closed || !this.ready) throw new Error("Speech service client is closed");
		if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
		const url = new URL("/v1/audio/transcriptions", `${this.baseUrl}/`);
		url.searchParams.set("model", this.model);
		url.searchParams.set("response_format", "json");
		if (metadata.language) url.searchParams.set("language", metadata.language);
		const response = await this.fetcher(url, {
			body: bytes as BodyInit,
			headers: this.headers({ "Content-Type": "audio/wav" }),
			method: "POST",
			redirect: "error",
			signal,
		});
		const value = await readBoundedJson(response);
		if (!response.ok) throw daemonError(response.status, value);
		const result = value as OpenAiTranscriptionResponse;
		const inferenceMs =
			typeof result.inferenceMs === "number" && Number.isFinite(result.inferenceMs)
				? Math.round(result.inferenceMs)
				: modelTiming(response);
		if (
			typeof result.text !== "string" ||
			(result.language !== undefined &&
				result.language !== null &&
				typeof result.language !== "string") ||
			inferenceMs === null ||
			inferenceMs < 0
		) {
			throw new Error("Speech service returned an invalid transcription response");
		}
		return {
			text: result.text,
			language: typeof result.language === "string" ? result.language : null,
			inferenceMs,
		};
	}

	close(): void {
		this.closed = true;
		this.readyState = false;
	}

	private headers(extra?: HeadersInit): Headers {
		const headers = new Headers(extra);
		headers.set("Accept", "application/json");
		if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
		return headers;
	}
}
