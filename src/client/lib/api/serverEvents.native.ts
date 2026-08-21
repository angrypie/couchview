import { fetchApi } from "./runtime.ts";
import { createServerEventParser } from "./serverEventParser.ts";
import type { ServerEventHandlers, ServerEventSubscription } from "./serverEventTypes.ts";

const DEFAULT_RETRY_MILLISECONDS = 3_000;

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		let settled = false;
		let timeout: ReturnType<typeof setTimeout>;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		timeout = setTimeout(finish, milliseconds);
		signal.addEventListener("abort", finish, { once: true });
	});
}

async function consumeServerEvents(
	path: string,
	handlers: ServerEventHandlers,
	signal: AbortSignal,
): Promise<void> {
	let lastEventId = "";
	let retryMilliseconds = DEFAULT_RETRY_MILLISECONDS;
	while (!signal.aborted) {
		try {
			const headers = new Headers({
				Accept: "text/event-stream",
				"Cache-Control": "no-cache",
			});
			if (lastEventId) headers.set("Last-Event-ID", lastEventId);
			const response = await fetchApi(path, {
				headers,
				redirect: "manual",
				signal,
			});
			if (!response.ok) throw new Error(`Server event request failed (${response.status})`);
			if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
				throw new Error("Server event response had an invalid content type");
			}
			if (!response.body) throw new Error("Server event response did not include a stream");
			handlers.onOpen?.();
			const parser = createServerEventParser({
				onMessage: handlers.onMessage,
				onRetry: (milliseconds) => {
					retryMilliseconds = Math.min(Math.max(milliseconds, 250), 30_000);
				},
			});
			const decoder = new TextDecoder();
			const reader = response.body.getReader();
			try {
				while (!signal.aborted) {
					const { done, value } = await reader.read();
					if (done) break;
					parser.push(decoder.decode(value, { stream: true }));
					lastEventId = parser.lastEventId();
				}
				parser.push(decoder.decode());
				parser.finish();
				lastEventId = parser.lastEventId();
			} finally {
				reader.releaseLock();
			}
			if (signal.aborted) return;
			throw new Error("Server event stream ended");
		} catch (error) {
			if (signal.aborted) return;
			handlers.onError?.(error);
		}
		await waitForRetry(retryMilliseconds, signal);
	}
}

export function subscribeServerEvents(
	path: string,
	handlers: ServerEventHandlers,
): ServerEventSubscription {
	const controller = new AbortController();
	void consumeServerEvents(path, handlers, controller.signal);
	return { close: () => controller.abort() };
}

export type {
	ServerEventHandlers,
	ServerEventMessage,
	ServerEventSubscription,
} from "./serverEventTypes.ts";
