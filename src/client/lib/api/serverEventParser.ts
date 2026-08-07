import type { ServerEventMessage } from "./serverEventTypes.ts";

interface ServerEventParserOptions {
	onMessage: (message: ServerEventMessage) => void;
	onRetry?: (milliseconds: number) => void;
}

export interface ServerEventParser {
	finish(): void;
	lastEventId(): string;
	push(value: string): void;
}

export function createServerEventParser({
	onMessage,
	onRetry,
}: ServerEventParserOptions): ServerEventParser {
	let buffer = "";
	let dataLines: string[] = [];
	let eventType = "";
	let eventId = "";

	const dispatch = () => {
		if (dataLines.length === 0) {
			eventType = "";
			return;
		}
		onMessage({
			data: dataLines.join("\n"),
			event: eventType || "message",
			lastEventId: eventId,
		});
		dataLines = [];
		eventType = "";
	};

	const processLine = (line: string) => {
		if (line === "") {
			dispatch();
			return;
		}
		if (line.startsWith(":")) return;
		const separator = line.indexOf(":");
		const field = separator === -1 ? line : line.slice(0, separator);
		let value = separator === -1 ? "" : line.slice(separator + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "data") {
			dataLines.push(value);
			return;
		}
		if (field === "event") {
			eventType = value;
			return;
		}
		if (field === "id" && !value.includes("\0")) {
			eventId = value;
			return;
		}
		if (field === "retry" && /^\d+$/.test(value)) {
			const milliseconds = Number(value);
			if (Number.isSafeInteger(milliseconds)) onRetry?.(milliseconds);
		}
	};

	const drain = (finishing: boolean) => {
		while (buffer) {
			const lf = buffer.indexOf("\n");
			const cr = buffer.indexOf("\r");
			const indexes = [lf, cr].filter((index) => index >= 0);
			if (indexes.length === 0) break;
			const lineEnd = Math.min(...indexes);
			if (!finishing && buffer[lineEnd] === "\r" && lineEnd === buffer.length - 1) break;
			const terminatorLength = buffer[lineEnd] === "\r" && buffer[lineEnd + 1] === "\n" ? 2 : 1;
			processLine(buffer.slice(0, lineEnd));
			buffer = buffer.slice(lineEnd + terminatorLength);
		}
		if (finishing && buffer) {
			processLine(buffer);
			buffer = "";
		}
	};

	return {
		finish() {
			drain(true);
		},
		lastEventId: () => eventId,
		push(value) {
			buffer += value;
			drain(false);
		},
	};
}
