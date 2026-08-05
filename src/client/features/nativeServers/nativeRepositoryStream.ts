import { API_ROUTES, type ServerEvent } from "../../../shared/contracts.ts";

export interface NativeRepositoryStreamApi {
	openEventStream(path: string, signal: AbortSignal): Promise<Response>;
}

const MAX_BACKOFF_MS = 15_000;

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

async function readEvents(
	response: Response,
	signal: AbortSignal,
	onEvent: (event: ServerEvent) => void,
): Promise<void> {
	if (!response.body) throw new Error("Couchview event stream has no response body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	try {
		while (!signal.aborted) {
			const result = await reader.read();
			if (result.done) throw new Error("Couchview event stream ended");
			pending += decoder.decode(result.value, { stream: true });
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				onEvent(JSON.parse(line.slice(6)) as ServerEvent);
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

export async function runNativeRepositoryStream(options: {
	api: NativeRepositoryStreamApi;
	repositoryId: string;
	signal: AbortSignal;
	onConnected(): void;
	onReconnecting(): void;
	onEvent(event: ServerEvent): void;
	onAuthoritativeRefetch(): Promise<void>;
}): Promise<void> {
	let attempt = 0;
	let interrupted = false;
	while (!options.signal.aborted) {
		try {
			const response = await options.api.openEventStream(
				API_ROUTES.events(options.repositoryId),
				options.signal,
			);
			options.onConnected();
			if (interrupted) await options.onAuthoritativeRefetch();
			interrupted = false;
			attempt = 0;
			await readEvents(response, options.signal, options.onEvent);
		} catch (error) {
			if (options.signal.aborted) return;
			interrupted = true;
			options.onReconnecting();
			const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
			attempt = Math.min(attempt + 1, 8);
			await wait(delay, options.signal).catch(() => undefined);
			if (options.signal.aborted) return;
			if (error instanceof SyntaxError) attempt = Math.max(attempt, 2);
		}
	}
}
