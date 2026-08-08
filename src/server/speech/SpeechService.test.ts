import { afterEach, describe, expect, test } from "bun:test";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../errors.ts";
import { SpeechService } from "./SpeechService.ts";
import type { SpeechTranscriber, SpeechTranscriberResult } from "./types.ts";

interface DeferredCall {
	audioPath: string;
	reject(reason: unknown): void;
	resolve(value: SpeechTranscriberResult): void;
	signal?: AbortSignal;
}

class DeferredTranscriber implements SpeechTranscriber {
	readonly model = "test-parakeet";
	ready = true;
	readonly calls: DeferredCall[] = [];
	closed = false;

	transcribe(audioPath: string, signal?: AbortSignal): Promise<SpeechTranscriberResult> {
		return new Promise((resolve, reject) => {
			this.calls.push({ audioPath, reject, resolve, signal });
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

describe("SpeechService", () => {
	test("uses 0600 temporary files and removes them after a successful result", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber);
		const resultPromise = service.transcribe(new Uint8Array([1, 2, 3]), 500);
		await waitForCalls(transcriber, 1);
		const audioPath = transcriber.calls[0]?.audioPath;
		expect(audioPath).toBeString();
		expect((await stat(audioPath as string)).mode & 0o777).toBe(0o600);
		transcriber.calls[0]?.resolve({ text: "  ola mundo  ", language: "pt", inferenceMs: 42 });
		await expect(resultPromise).resolves.toEqual({
			text: "ola mundo",
			language: "pt",
			durationMs: 500,
			inferenceMs: 42,
		});
		await expect(access(path.dirname(audioPath as string))).rejects.toThrow();
	});

	test("allows one active and two queued jobs, then rejects overload", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber);
		const first = service.transcribe(new Uint8Array([1]), 500);
		await waitForCalls(transcriber, 1);
		const second = service.transcribe(new Uint8Array([2]), 500);
		const third = service.transcribe(new Uint8Array([3]), 500);
		expect(() => service.transcribe(new Uint8Array([4]), 500)).toThrow("speech model is busy");

		transcriber.calls[0]?.resolve({ text: "one", language: null, inferenceMs: 1 });
		await expect(first).resolves.toMatchObject({ text: "one" });
		await waitForCalls(transcriber, 2);
		transcriber.calls[1]?.resolve({ text: "two", language: null, inferenceMs: 1 });
		await expect(second).resolves.toMatchObject({ text: "two" });
		await waitForCalls(transcriber, 3);
		transcriber.calls[2]?.resolve({ text: "three", language: null, inferenceMs: 1 });
		await expect(third).resolves.toMatchObject({ text: "three" });
	});

	test("aborts timed out inference and guarantees temporary cleanup", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber, 20);
		const result = service.transcribe(new Uint8Array([1]), 500);
		await waitForCalls(transcriber, 1);
		const audioPath = transcriber.calls[0]?.audioPath as string;
		try {
			await result;
			throw new Error("Expected timeout");
		} catch (error) {
			expect(error).toBeInstanceOf(HttpError);
			expect((error as HttpError).code).toBe("speech_timeout");
		}
		expect(transcriber.calls[0]?.signal?.aborted).toBe(true);
		await expect(access(path.dirname(audioPath))).rejects.toThrow();
	});

	test("cancels queued work without invoking the sidecar", async () => {
		const transcriber = new DeferredTranscriber();
		const service = createService(transcriber);
		const first = service.transcribe(new Uint8Array([1]), 500);
		await waitForCalls(transcriber, 1);
		const controller = new AbortController();
		const queued = service.transcribe(new Uint8Array([2]), 500, controller.signal);
		controller.abort();
		await expect(queued).rejects.toMatchObject({ code: "speech_aborted" });
		transcriber.calls[0]?.resolve({ text: "one", language: null, inferenceMs: 1 });
		await first;
		await Bun.sleep(10);
		expect(transcriber.calls).toHaveLength(1);
	});
});
