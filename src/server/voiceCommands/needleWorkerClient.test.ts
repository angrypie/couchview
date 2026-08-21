import { describe, expect, test } from "bun:test";
import { type NeedleWorkerLike, openNeedleResolver } from "./needleWorkerClient.ts";
import type { NeedleWorkerRequest, NeedleWorkerResponse } from "./needleWorkerProtocol.ts";

class FakeNeedleWorker implements NeedleWorkerLike {
	onmessage: ((event: MessageEvent<NeedleWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly requests: NeedleWorkerRequest[] = [];
	terminated = false;

	postMessage(request: NeedleWorkerRequest): void {
		this.requests.push(request);
		queueMicrotask(() => {
			if (request.type === "initialize") {
				this.onmessage?.({ data: { type: "ready" } } as MessageEvent<NeedleWorkerResponse>);
			} else if (request.type === "resolve") {
				this.onmessage?.({
					data: {
						type: "resolved",
						id: request.id,
						resolution: {
							actionIds: ["navigate.settings"],
							confidence: 0.88,
							reasoning: "settings -> open_settings",
						},
					},
				} as MessageEvent<NeedleWorkerResponse>);
			} else {
				this.onmessage?.({ data: { type: "closed" } } as MessageEvent<NeedleWorkerResponse>);
			}
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("Needle worker client", () => {
	test("resolves inference through an asynchronous worker message boundary", async () => {
		const worker = new FakeNeedleWorker();
		const resolver = await openNeedleResolver("/fake/libneedle.dylib", () => worker);
		expect(await resolver.resolve("open settings")).toEqual({
			actionIds: ["navigate.settings"],
			confidence: 0.88,
			reasoning: "settings -> open_settings",
		});
		expect(worker.requests.map((request) => request.type)).toEqual(["initialize", "resolve"]);
		resolver.close();
		expect(worker.terminated).toBe(true);
		expect(worker.requests.map((request) => request.type)).toEqual(["initialize", "resolve"]);
	});
});
