import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SpeechProcessTranscriber } from "./SpeechProcessTranscriber.ts";

const directories: string[] = [];
const transcribers: SpeechProcessTranscriber[] = [];

afterEach(async () => {
	for (const transcriber of transcribers.splice(0)) transcriber.close();
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

const sidecarScript = String.raw`
const readline = require("node:readline");
const counterPath = process.env.SPEECH_TEST_COUNTER;
let startup = 1;
if (counterPath) {
	startup = Number(await Bun.file(counterPath).text().catch(() => "0")) + 1;
	await Bun.write(counterPath, String(startup));
}
process.stdout.write(JSON.stringify({ type: "ready", model: "test" }) + "\n");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
	const request = JSON.parse(line);
	if (startup === 1 && counterPath) process.exit(17);
	process.stdout.write(JSON.stringify({
		type: "result",
		id: request.id,
		ok: true,
		text: "bonjour mundo",
		language: null,
		inferenceMs: 7,
	}) + "\n");
});
`;

async function waitUntilReady(transcriber: SpeechProcessTranscriber): Promise<void> {
	const deadline = Date.now() + 4_000;
	while (!transcriber.ready && Date.now() < deadline) await Bun.sleep(20);
	expect(transcriber.ready).toBe(true);
}

describe("SpeechProcessTranscriber", () => {
	test("exchanges NDJSON with a long-lived subprocess", async () => {
		const transcriber = await SpeechProcessTranscriber.create({
			command: [process.execPath, "-e", sidecarScript],
			startupTimeoutMs: 2_000,
		});
		transcribers.push(transcriber);
		await expect(transcriber.transcribe("/tmp/fixture.wav")).resolves.toEqual({
			text: "bonjour mundo",
			language: null,
			inferenceMs: 7,
		});
	});

	test("rejects a crashed request and restarts the sidecar", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "couchview-speech-process-"));
		directories.push(directory);
		const transcriber = await SpeechProcessTranscriber.create({
			command: [process.execPath, "-e", sidecarScript],
			env: { ...process.env, SPEECH_TEST_COUNTER: path.join(directory, "counter") },
			startupTimeoutMs: 2_000,
		});
		transcribers.push(transcriber);
		await expect(transcriber.transcribe("/tmp/crash.wav")).rejects.toThrow("exited with code 17");
		await waitUntilReady(transcriber);
		await expect(transcriber.transcribe("/tmp/retry.wav")).resolves.toMatchObject({
			text: "bonjour mundo",
		});
	});
});
