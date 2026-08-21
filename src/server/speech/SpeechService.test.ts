import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { HttpError } from "../errors.ts";
import { SpeechService } from "./SpeechService.ts";
import type { SpeechAudioMetadata, SpeechTranscriber, SpeechTranscriberResult } from "./types.ts";

interface DeferredCall {
	bytes: Uint8Array;
	metadata: SpeechAudioMetadata;
	reject(reason: unknown): void;
	resolve(value: SpeechTranscriberResult): void;
	signal?: AbortSignal;
}

class DeferredTranscriber implements SpeechTranscriber {
	readonly model = "test-parakeet";
	ready = true;
	readonly calls: DeferredCall[] = [];
	closed = false;

	transcribe(
		bytes: Uint8Array,
		metadata: SpeechAudioMetadata,
		signal?: AbortSignal,
	): Promise<SpeechTranscriberResult> {
		return new Promise((resolve, reject) => {
			this.calls.push({ bytes, metadata, reject, resolve, signal });
			signal?.addEventListener(
				"abort",
				() => reject(new DOMException("The request was aborted.", "AbortError")),
				{ once: true },
			);
		});
	}

	close(): void {
		this.closed = true;
	}
}

const services: SpeechService[] = [];

afterEach(() => {
	for (const service of services.splice(0)) service.close();
});

async function waitForCalls(transcriber: DeferredTranscriber, count: number): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (transcriber.calls.length < count && Date.now() < deadline) await Bun.sleep(5);
	expect(transcriber.calls).toHaveLength(count);
}

function createService(transcriber: DeferredTranscriber, timeoutMs = 1_000): SpeechService {
	const service = new SpeechService({ enabled: true, timeoutMs, transcriber });
	services.push(service);
	return service;
}

function metadata(durationMs = 500): SpeechAudioMetadata {
	return { durationMs, sampleRate: 16_000 };
}

describe("SpeechService", () => {
	test("forwards the original bytes without creating an audio file", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber);
		const monitoredTmp = await mkdtemp(path.join(tmpdir(), "couchspeech-no-disk-"));
		const previousTmpdir = process.env.TMPDIR;
		process.env.TMPDIR = monitoredTmp;
		try {
			const bytes = new Uint8Array([1, 2, 3]);
			const resultPromise = service.transcribe(bytes, metadata());
			await waitForCalls(transcriber, 1);
			expect(transcriber.calls[0]?.bytes).toBe(bytes);
			expect(transcriber.calls[0]?.metadata).toEqual(metadata());
			transcriber.calls[0]?.resolve({ text: "  ola mundo  ", language: "pt", inferenceMs: 42 });
			await expect(resultPromise).resolves.toEqual({
				text: "ola mundo",
				language: "pt",
				durationMs: 500,
				inferenceMs: 42,
			});
			expect(await readdir(monitoredTmp)).toEqual([]);
		} finally {
			if (previousTmpdir === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = previousTmpdir;
			await rm(monitoredTmp, { force: true, recursive: true });
		}
	});

	test("allows one active and two queued jobs, then rejects overload", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber);
		const first = service.transcribe(new Uint8Array([1]), metadata());
		await waitForCalls(transcriber, 1);
		const second = service.transcribe(new Uint8Array([2]), metadata());
		const third = service.transcribe(new Uint8Array([3]), metadata());
		expect(() => service.transcribe(new Uint8Array([4]), metadata())).toThrow(
			"speech model is busy",
		);

		transcriber.calls[0]?.resolve({ text: "one", language: null, inferenceMs: 1 });
		await expect(first).resolves.toMatchObject({ text: "one" });
		await waitForCalls(transcriber, 2);
		transcriber.calls[1]?.resolve({ text: "two", language: null, inferenceMs: 1 });
		await expect(second).resolves.toMatchObject({ text: "two" });
		await waitForCalls(transcriber, 3);
		transcriber.calls[2]?.resolve({ text: "three", language: null, inferenceMs: 1 });
		await expect(third).resolves.toMatchObject({ text: "three" });
	});

	test("reserves unknown upload bytes before request-body collation", () => {
		const service = createService(new DeferredTranscriber());
		const first = service.admitUpload(null);
		const second = service.admitUpload(null);
		expect(() => service.admitUpload(1)).toThrow("speech model is busy");

		first.release();
		const replacement = service.admitUpload(1);
		replacement.release();
		second.release();
	});

	test("aborts timed out inference", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber, 20);
		const result = service.transcribe(new Uint8Array([1]), metadata());
		await waitForCalls(transcriber, 1);
		try {
			await result;
			throw new Error("Expected timeout");
		} catch (error) {
			expect(error).toBeInstanceOf(HttpError);
			expect((error as HttpError).code).toBe("speech_timeout");
		}
		expect(transcriber.calls[0]?.signal?.aborted).toBe(true);
	});

	test("relays active request cancellation and reports the stable abort code", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber);
		const controller = new AbortController();
		const result = service.transcribe(new Uint8Array([1]), metadata(), controller.signal);
		await waitForCalls(transcriber, 1);
		controller.abort();
		await expect(result).rejects.toMatchObject({ code: "speech_aborted", status: 499 });
		expect(transcriber.calls[0]?.signal?.aborted).toBe(true);
	});

	test("cancels queued work without invoking the shared service", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber);
		const first = service.transcribe(new Uint8Array([1]), metadata());
		await waitForCalls(transcriber, 1);
		const controller = new AbortController();
		const queued = service.transcribe(new Uint8Array([2]), metadata(), controller.signal);
		controller.abort();
		await expect(queued).rejects.toMatchObject({ code: "speech_aborted" });
		transcriber.calls[0]?.resolve({ text: "one", language: null, inferenceMs: 1 });
		await first;
		await Bun.sleep(10);
		expect(transcriber.calls).toHaveLength(1);
	});
});
