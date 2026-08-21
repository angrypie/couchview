import { apiRequestUrl } from "./runtime.ts";
import type { ServerEventHandlers, ServerEventSubscription } from "./serverEventTypes.ts";

export function subscribeServerEvents(
	path: string,
	handlers: ServerEventHandlers,
): ServerEventSubscription {
	const source = new EventSource(apiRequestUrl(path));
	source.onopen = () => handlers.onOpen?.();
	source.onmessage = (message) => {
		handlers.onMessage({
			data: message.data,
			event: message.type,
			lastEventId: message.lastEventId,
		});
	};
	source.onerror = (error) => handlers.onError?.(error);
	return { close: () => source.close() };
}
