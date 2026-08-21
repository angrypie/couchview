export {};

const baseURL = Bun.env.COUCHVIEW_TEST_SPEECH_URL;
const token = Bun.env.COUCHVIEW_TEST_SPEECH_TOKEN;
const startAt = Number(Bun.env.COUCHVIEW_TEST_SPEECH_START_AT);
if (!baseURL || !token || !Number.isFinite(startAt)) {
	throw new Error("Speech test client configuration is missing");
}

const audio = await new Response(Bun.stdin.stream()).arrayBuffer();
if (startAt > Date.now()) await Bun.sleep(startAt - Date.now());
const requestStartedAt = Date.now();
const response = await fetch(
	`${baseURL}/v1/audio/transcriptions?model=parakeet-tdt-0.6b-v3-int8&response_format=json`,
	{
		body: audio,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "audio/wav",
		},
		method: "POST",
	},
);
await response.arrayBuffer();
process.stdout.write(JSON.stringify({ startedAt: requestStartedAt, status: response.status }));
