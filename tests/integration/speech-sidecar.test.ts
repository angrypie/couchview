import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SpeechProcessTranscriber } from "../../src/server/speech/SpeechProcessTranscriber.ts";

const directories: string[] = [];
const transcribers: SpeechProcessTranscriber[] = [];

afterEach(async () => {
	for (const transcriber of transcribers.splice(0)) transcriber.close();
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function run(command: string[]): Promise<void> {
	const processHandle = Bun.spawn(command, { stderr: "inherit", stdout: "inherit" });
	const exitCode = await processHandle.exited;
	if (exitCode !== 0) throw new Error(`${command[0]} exited with code ${exitCode}`);
}

async function spokenFixture(
	directory: string,
	name: string,
	voice: string,
	text: string,
): Promise<string> {
	const aiff = path.join(directory, `${name}.aiff`);
	const wav = path.join(directory, `${name}.wav`);
	await run(["say", "-v", voice, "-o", aiff, text]);
	await run(["afconvert", aiff, wav, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"]);
	return wav;
}

const realModelTest = Bun.env.COUCHVIEW_RUN_SPEECH_MODEL_TEST === "1" ? test : test.skip;

realModelTest(
	"transcribes deterministic English and Portuguese fixtures with FluidAudio",
	async () => {
		if (process.platform !== "darwin" || process.arch !== "arm64") return;
		const directory = await mkdtemp(path.join(tmpdir(), "couchview-speech-integration-"));
		directories.push(directory);
		const [english, portuguese] = await Promise.all([
			spokenFixture(directory, "english", "Samantha", "Hello from Couchview speech testing."),
			spokenFixture(directory, "portuguese", "Joana", "Olá, esta é uma gravação em português."),
		]);
		const packagedSidecar = path.resolve("dist/couchview-speech-sidecar");
		const sidecar = existsSync(packagedSidecar)
			? packagedSidecar
			: path.resolve("swift/SpeechSidecar/.build/debug/couchview-speech-sidecar");
		const transcriber = await SpeechProcessTranscriber.create({
			command: [sidecar],
			startupTimeoutMs: 15 * 60_000,
		});
		transcribers.push(transcriber);
		const englishResult = await transcriber.transcribe(english);
		const portugueseResult = await transcriber.transcribe(portuguese);
		expect(englishResult.text.toLocaleLowerCase()).toContain("hello");
		expect(englishResult.language).toBe("en");
		expect(portugueseResult.text.toLocaleLowerCase()).toMatch(/ol[aá]/);
		expect(portugueseResult.language).toBe("pt");
	},
	20 * 60_000,
);
