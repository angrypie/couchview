import type { NeedleResolution, NeedleResolver } from "./needleRuntime.ts";
import type { NeedleWorkerRequest, NeedleWorkerResponse } from "./needleWorkerProtocol.ts";

export interface NeedleWorkerLike {
	onmessage: ((event: MessageEvent<NeedleWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(request: NeedleWorkerRequest): void;
	terminate(): void;
}

type NeedleWorkerFactory = (url: string) => NeedleWorkerLike;

interface PendingResolution {
	resolve(resolution: NeedleResolution): void;
	reject(error: Error): void;
}

function defaultWorkerFactory(url: string): NeedleWorkerLike {
	return new Worker(url) as NeedleWorkerLike;
}

export function openNeedleResolver(
	libraryPath: string,
	createWorker: NeedleWorkerFactory = defaultWorkerFactory,
): Promise<NeedleResolver> {
	return new Promise((resolveReady, rejectReady) => {
		const worker = createWorker(new URL("./needleWorker.ts", import.meta.url).href);
		const pending = new Map<number, PendingResolution>();
		let nextId = 1;
		let ready = false;
		let closed = false;

		const rejectPending = (error: Error) => {
			for (const request of pending.values()) request.reject(error);
			pending.clear();
		};
		const fail = (error: Error) => {
			if (closed) return;
			closed = true;
			rejectPending(error);
			worker.terminate();
			if (!ready) rejectReady(error);
		};
		const resolver: NeedleResolver = {
			resolve(transcript) {
				if (closed) return Promise.reject(new Error("Needle runtime is closed"));
				const id = nextId;
				nextId += 1;
				return new Promise<NeedleResolution>((resolve, reject) => {
					pending.set(id, { resolve, reject });
					worker.postMessage({ type: "resolve", id, transcript });
				});
			},
			close() {
				if (closed) return;
				closed = true;
				rejectPending(new Error("Needle runtime is closed"));
				worker.onmessage = null;
				worker.onerror = null;
				worker.terminate();
			},
		};

		worker.onmessage = (event) => {
			const response = event.data;
			if (response.type === "ready") {
				if (closed) return;
				ready = true;
				resolveReady(resolver);
				return;
			}
			if (response.type === "resolved") {
				const request = pending.get(response.id);
				if (!request) return;
				pending.delete(response.id);
				request.resolve(response.resolution);
				return;
			}
			if (response.type === "error") {
				if (response.id === null) {
					fail(new Error(response.message));
					return;
				}
				const request = pending.get(response.id);
				if (!request) return;
				pending.delete(response.id);
				request.reject(new Error(response.message));
				return;
			}
			worker.terminate();
		};
		worker.onerror = (event) => fail(new Error(event.message || "Needle worker failed"));
		worker.postMessage({ type: "initialize", libraryPath });
	});
}
