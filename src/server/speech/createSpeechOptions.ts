import { SpeechHttpTranscriber } from "./SpeechHttpTranscriber.ts";
import type { SpeechServiceOptions } from "./SpeechService.ts";
import { loadSpeechServiceConfiguration } from "./speechServiceConfig.ts";

export async function createSpeechOptions(enabled: boolean): Promise<SpeechServiceOptions> {
	if (!enabled) {
		return {
			enabled: false,
			reason: "Start Couchview with --enable-speech to use host transcription.",
		};
	}
	try {
		const configuration = await loadSpeechServiceConfiguration();
		const transcriber = await SpeechHttpTranscriber.create(configuration);
		console.log("Shared speech transcription service is ready.");
		return { enabled: true, transcriber };
	} catch (error) {
		const reason = `The shared speech service is unavailable: ${(error as Error).message}`;
		console.warn(`Speech transcription is unavailable: ${reason}`);
		return { enabled: true, reason };
	}
}
