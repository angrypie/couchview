import type { ArtifactRunEvent } from "../shared/artifacts.ts";
import type { ArtifactService } from "./artifactService.ts";

const encoder = new TextEncoder();

export function openArtifactRunEvents(
	request: Request,
	artifacts: ArtifactService,
	repositoryId: string,
	artifactId: string,
	runId: string,
): Response {
	let cleanup: () => void = () => undefined;
	let keepAlive: ReturnType<typeof setInterval> | null = null;
	let closed = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: ArtifactRunEvent): void => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					closed = true;
					cleanup();
					if (keepAlive) clearInterval(keepAlive);
				}
			};
			const subscription = artifacts.subscribe(repositoryId, artifactId, runId, send);
			cleanup = subscription.unsubscribe;
			send({ type: "snapshot", snapshot: subscription.snapshot });
			keepAlive = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(": keep-alive\n\n"));
				} catch {
					closed = true;
					cleanup();
					if (keepAlive) clearInterval(keepAlive);
				}
			}, 5_000);
		},
		cancel() {
			closed = true;
			cleanup();
			if (keepAlive) clearInterval(keepAlive);
		},
	});
	request.signal.addEventListener(
		"abort",
		() => {
			closed = true;
			cleanup();
			if (keepAlive) clearInterval(keepAlive);
		},
		{ once: true },
	);
	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
