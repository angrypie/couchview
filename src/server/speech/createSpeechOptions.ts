import { SpeechProcessTranscriber } from "./SpeechProcessTranscriber.ts";
import type { SpeechServiceOptions } from "./SpeechService.ts";
import { resolveSpeechSidecarCommand } from "./speechSidecarCommand.ts";

export async function createSpeechOptions(enabled: boolean): Promise<SpeechServiceOptions> {
	if (!enabled) {
		return {
			enabled: false,
			reason: "Start Couchview with --enable-speech to use host transcription.",
		};
	}
	const resolution = await resolveSpeechSidecarCommand();
	if (!resolution.command) {
		console.warn(`Speech transcription is unavailable: ${resolution.reason}`);
		return { enabled: true, reason: resolution.reason };
	}
	console.log(
		"Preparing the FluidAudio speech model. The first startup may download model files...",
	);
	try {
		const transcriber = await SpeechProcessTranscriber.create({ command: resolution.command });
		console.log("Host speech transcription is ready.");
		return { enabled: true, transcriber };
	} catch (error) {
		const reason = `The speech sidecar could not start: ${(error as Error).message}`;
		console.warn(`Speech transcription is unavailable: ${reason}`);
		return { enabled: true, reason };
	}
}
