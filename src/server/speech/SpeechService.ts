import type { SpeechCapability, SpeechTranscriptionResponse } from "../../shared/contracts.ts";
import { HttpError } from "../errors.ts";
import {
	SPEECH_MAX_DURATION_MS,
	SPEECH_MAX_UPLOAD_BYTES,
	SPEECH_MODEL,
	type SpeechAudioMetadata,
	type SpeechTranscriber,
} from "./types.ts";

interface SpeechJob {
	bytes: Uint8Array;
	metadata: SpeechAudioMetadata;
	signal?: AbortSignal;
	resolve(value: SpeechTranscriptionResponse): void;
	reject(reason: unknown): void;
}

export interface SpeechUploadAdmission {
	transcribe(
		bytes: Uint8Array,
		metadata: SpeechAudioMetadata,
		signal?: AbortSignal,
	): Promise<SpeechTranscriptionResponse>;
	release(): void;
}

export interface SpeechServiceOptions {
	enabled: boolean;
	reason?: string;
	transcriber?: SpeechTranscriber;
	timeoutMs?: number;
}

// The daemon permits up to 15 minutes to download/warm the model and then up to
// 10 minutes for inference. Leave one minute for queueing and HTTP teardown so
// the Couchview proxy never preempts a timeout owned by the shared service.
const DEFAULT_SPEECH_REQUEST_TIMEOUT_MS = 26 * 60_000;

export class SpeechService {
	readonly enabled: boolean;
	private readonly transcriber?: SpeechTranscriber;
	private readonly unavailableReason: string;
	private readonly timeoutMs: number;
	private readonly queue: SpeechJob[] = [];
	private readonly reservations = new Map<symbol, number>();
	private queuedBytes = 0;
	private reservedBytes = 0;
	private active = false;
	private activeController: AbortController | null = null;
	private closed = false;

	constructor(options: SpeechServiceOptions) {
		this.enabled = options.enabled;
		this.transcriber = options.transcriber;
		this.unavailableReason =
			options.reason ??
			(options.enabled
				? "The speech model is still preparing or could not start."
				: "Host speech transcription is disabled.");
		this.timeoutMs = options.timeoutMs ?? DEFAULT_SPEECH_REQUEST_TIMEOUT_MS;
	}

	get capability(): SpeechCapability {
		const ready = this.enabled && !this.closed && this.transcriber?.ready === true;
		return {
			enabled: this.enabled,
			ready,
			model: this.transcriber?.model ?? SPEECH_MODEL,
			maxDurationMs: SPEECH_MAX_DURATION_MS,
			maxUploadBytes: SPEECH_MAX_UPLOAD_BYTES,
			reason: ready ? null : this.unavailableReason,
		};
	}

	transcribe(
		bytes: Uint8Array,
		metadata: SpeechAudioMetadata,
		signal?: AbortSignal,
	): Promise<SpeechTranscriptionResponse> {
		return this.admitUpload(bytes.byteLength).transcribe(bytes, metadata, signal);
	}

	admitUpload(expectedBytes: number | null): SpeechUploadAdmission {
		if (!this.capability.ready || !this.transcriber) {
			throw new HttpError(
				503,
				"speech_unavailable",
				this.capability.reason ?? "Speech is unavailable.",
			);
		}
		const reservationBytes =
			expectedBytes === null || !Number.isFinite(expectedBytes)
				? SPEECH_MAX_UPLOAD_BYTES
				: Math.min(SPEECH_MAX_UPLOAD_BYTES, Math.max(0, Math.floor(expectedBytes)));
		const admittedCount = (this.active ? 1 : 0) + this.queue.length + this.reservations.size;
		if (
			admittedCount >= 3 ||
			this.queuedBytes + this.reservedBytes + reservationBytes > 2 * SPEECH_MAX_UPLOAD_BYTES
		) {
			throw new HttpError(429, "speech_busy", "The speech model is busy; try again shortly.");
		}
		const token = Symbol("speech-upload");
		this.reservations.set(token, reservationBytes);
		this.reservedBytes += reservationBytes;
		let available = true;
		return {
			transcribe: (bytes, metadata, signal) => {
				if (!available) throw new Error("Speech upload admission was already consumed");
				available = false;
				return this.enqueueReserved(token, bytes, metadata, signal);
			},
			release: () => {
				if (!available) return;
				available = false;
				this.releaseReservation(token);
			},
		};
	}

	private enqueueReserved(
		token: symbol,
		bytes: Uint8Array,
		metadata: SpeechAudioMetadata,
		signal?: AbortSignal,
	): Promise<SpeechTranscriptionResponse> {
		const reservationBytes = this.reservations.get(token);
		if (reservationBytes === undefined) {
			throw new HttpError(503, "speech_unavailable", "Speech transcription stopped.");
		}
		this.reservations.delete(token);
		this.reservedBytes -= reservationBytes;
		if (!this.capability.ready || !this.transcriber) {
			throw new HttpError(503, "speech_unavailable", this.unavailableReason);
		}
		if (bytes.byteLength > SPEECH_MAX_UPLOAD_BYTES) {
			throw new HttpError(413, "speech_audio_too_large", "Speech uploads are limited to 32 MiB.");
		}
		if (this.queuedBytes + bytes.byteLength > 2 * SPEECH_MAX_UPLOAD_BYTES) {
			throw new HttpError(429, "speech_busy", "The speech model is busy; try again shortly.");
		}
		if (signal?.aborted) {
			throw new HttpError(499, "speech_aborted", "Speech transcription was cancelled.");
		}
		return new Promise((resolve, reject) => {
			let job: SpeechJob;
			const abortQueued = () => {
				const index = this.queue.indexOf(job);
				if (index < 0) return;
				this.queue.splice(index, 1);
				this.queuedBytes -= job.bytes.byteLength;
				job.reject(new HttpError(499, "speech_aborted", "Speech transcription was cancelled."));
			};
			const cleanup = () => signal?.removeEventListener("abort", abortQueued);
			job = {
				bytes,
				metadata,
				signal,
				resolve(value) {
					cleanup();
					resolve(value);
				},
				reject(reason) {
					cleanup();
					reject(reason);
				},
			};
			signal?.addEventListener("abort", abortQueued, { once: true });
			this.queuedBytes += bytes.byteLength;
			this.queue.push(job);
			void this.pump();
		});
	}

	private releaseReservation(token: symbol): void {
		const bytes = this.reservations.get(token);
		if (bytes === undefined) return;
		this.reservations.delete(token);
		this.reservedBytes -= bytes;
	}

	private async pump(): Promise<void> {
		if (this.active || this.closed) return;
		const job = this.queue.shift();
		if (!job) return;
		this.queuedBytes -= job.bytes.byteLength;
		this.active = true;
		try {
			job.resolve(await this.run(job));
		} catch (error) {
			job.reject(error);
		} finally {
			this.active = false;
			this.activeController = null;
			void this.pump();
		}
	}

	private async run(job: SpeechJob): Promise<SpeechTranscriptionResponse> {
		if (!this.transcriber) {
			throw new HttpError(503, "speech_unavailable", this.unavailableReason);
		}
		const controller = new AbortController();
		this.activeController = controller;
		let timedOut = false;
		const relayAbort = () => controller.abort(job.signal?.reason);
		job.signal?.addEventListener("abort", relayAbort, { once: true });
		if (job.signal?.aborted) relayAbort();
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.timeoutMs);
		try {
			const result = await this.transcriber.transcribe(job.bytes, job.metadata, controller.signal);
			return {
				text: result.text.trim(),
				language: result.language,
				durationMs: job.metadata.durationMs,
				inferenceMs: result.inferenceMs,
			};
		} catch (error) {
			if (timedOut) {
				throw new HttpError(504, "speech_timeout", "Speech transcription timed out.");
			}
			if (controller.signal.aborted) {
				throw new HttpError(499, "speech_aborted", "Speech transcription was cancelled.");
			}
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				502,
				"speech_service_failed",
				"The host speech model could not transcribe this recording.",
			);
		} finally {
			clearTimeout(timeout);
			job.signal?.removeEventListener("abort", relayAbort);
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.activeController?.abort();
		for (const job of this.queue.splice(0)) {
			job.reject(new HttpError(503, "speech_unavailable", "Speech transcription stopped."));
		}
		this.queuedBytes = 0;
		this.reservations.clear();
		this.reservedBytes = 0;
		this.transcriber?.close();
	}
}
