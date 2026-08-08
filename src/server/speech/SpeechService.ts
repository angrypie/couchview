import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SpeechCapability, SpeechTranscriptionResponse } from "../../shared/contracts.ts";
import { HttpError } from "../errors.ts";
import {
	SPEECH_MAX_DURATION_MS,
	SPEECH_MAX_UPLOAD_BYTES,
	SPEECH_MODEL,
	type SpeechTranscriber,
} from "./types.ts";

interface SpeechJob {
	bytes: Uint8Array;
	durationMs: number;
	signal?: AbortSignal;
	resolve(value: SpeechTranscriptionResponse): void;
	reject(reason: unknown): void;
}

export interface SpeechServiceOptions {
	enabled: boolean;
	reason?: string;
	transcriber?: SpeechTranscriber;
	timeoutMs?: number;
}

export class SpeechService {
	readonly enabled: boolean;
	private readonly transcriber?: SpeechTranscriber;
	private readonly unavailableReason: string;
	private readonly timeoutMs: number;
	private readonly queue: SpeechJob[] = [];
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
		this.timeoutMs = options.timeoutMs ?? 120_000;
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
		durationMs: number,
		signal?: AbortSignal,
	): Promise<SpeechTranscriptionResponse> {
		if (!this.capability.ready || !this.transcriber) {
			throw new HttpError(
				503,
				"speech_unavailable",
				this.capability.reason ?? "Speech is unavailable.",
			);
		}
		if (this.active && this.queue.length >= 2) {
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
				job.reject(new HttpError(499, "speech_aborted", "Speech transcription was cancelled."));
			};
			const cleanup = () => signal?.removeEventListener("abort", abortQueued);
			job = {
				bytes,
				durationMs,
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
			this.queue.push(job);
			void this.pump();
		});
	}

	private async pump(): Promise<void> {
		if (this.active || this.closed) return;
		const job = this.queue.shift();
		if (!job) return;
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
		const directory = await mkdtemp(path.join(tmpdir(), "couchview-speech-"));
		const audioPath = path.join(directory, "recording.wav");
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
			await writeFile(audioPath, job.bytes, { flag: "wx", mode: 0o600 });
			const result = await this.transcriber.transcribe(audioPath, controller.signal);
			return {
				text: result.text.trim(),
				language: result.language,
				durationMs: job.durationMs,
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
				"speech_sidecar_failed",
				"The host speech model could not transcribe this recording.",
			);
		} finally {
			clearTimeout(timeout);
			job.signal?.removeEventListener("abort", relayAbort);
			await rm(directory, { recursive: true, force: true });
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.activeController?.abort();
		for (const job of this.queue.splice(0)) {
			job.reject(new HttpError(503, "speech_unavailable", "Speech transcription stopped."));
		}
		this.transcriber?.close();
	}
}
