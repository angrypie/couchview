import { describe, expect, test } from "bun:test";

import { createServerEventParser } from "./serverEventParser.ts";
import type { ServerEventMessage } from "./serverEventTypes.ts";

describe("server event parser", () => {
	test("parses chunked CRLF events, comments, ids, retry hints, and multiline data", () => {
		const messages: ServerEventMessage[] = [];
		const retries: number[] = [];
		const parser = createServerEventParser({
			onMessage: (message) => messages.push(message),
			onRetry: (milliseconds) => retries.push(milliseconds),
		});

		parser.push(": keep-alive\r\nid: event-7\r\nevent: update\r\ndata: first");
		parser.push(" line\r\ndata: second\r\nretry: 1250\r");
		parser.push("\n\r\ndata: next\n\n");

		expect(messages).toEqual([
			{
				data: "first line\nsecond",
				event: "update",
				lastEventId: "event-7",
			},
			{
				data: "next",
				event: "message",
				lastEventId: "event-7",
			},
		]);
		expect(retries).toEqual([1_250]);
		expect(parser.lastEventId()).toBe("event-7");
	});

	test("does not dispatch incomplete events or accept invalid retry values", () => {
		const messages: ServerEventMessage[] = [];
		const retries: number[] = [];
		const parser = createServerEventParser({
			onMessage: (message) => messages.push(message),
			onRetry: (milliseconds) => retries.push(milliseconds),
		});

		parser.push("retry: later\ndata: incomplete");
		parser.finish();

		expect(messages).toEqual([]);
		expect(retries).toEqual([]);
	});
});
