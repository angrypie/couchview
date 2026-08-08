import { API_ROUTES } from "../../shared/contracts.ts";
import { HttpError } from "../errors.ts";
import { json } from "../serverHttp.ts";
import type { SpeechService } from "./SpeechService.ts";
import { SPEECH_MAX_UPLOAD_BYTES } from "./types.ts";
import { validatePcmWav } from "./wav.ts";

const WAV_CONTENT_TYPES = new Set(["audio/wav", "audio/wave", "audio/x-wav"]);

async function readBoundedBody(request: Request): Promise<Uint8Array> {
	const declaredLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > SPEECH_MAX_UPLOAD_BYTES) {
		throw new HttpError(413, "speech_audio_too_large", "Speech uploads are limited to 32 MiB.");
	}
	if (!request.body) {
		throw new HttpError(400, "speech_audio_invalid", "A WAV recording is required.");
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = request.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > SPEECH_MAX_UPLOAD_BYTES) {
			await reader.cancel();
			throw new HttpError(413, "speech_audio_too_large", "Speech uploads are limited to 32 MiB.");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function handleSpeechApi(
	speech: SpeechService,
	request: Request,
	url: URL,
): Promise<Response | null> {
	if (url.pathname !== API_ROUTES.speechTranscriptions || request.method !== "POST") return null;
	const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
	if (!contentType || !WAV_CONTENT_TYPES.has(contentType)) {
		throw new HttpError(
			415,
			"speech_content_type_invalid",
			"Speech transcription requires Content-Type: audio/wav.",
		);
	}
	const bytes = await readBoundedBody(request);
	const wav = validatePcmWav(bytes);
	return json(await speech.transcribe(bytes, wav.durationMs, request.signal));
}
