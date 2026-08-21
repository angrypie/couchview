import type { NeedleResolver } from "./needleRuntime.ts";
import { openNeedleNativeResolver } from "./needleRuntime.ts";
import type { NeedleWorkerRequest, NeedleWorkerResponse } from "./needleWorkerProtocol.ts";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let resolver: NeedleResolver | null = null;

function post(response: NeedleWorkerResponse): void {
	workerScope.postMessage(response);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Needle worker failed";
}

workerScope.onmessage = async (event: MessageEvent<NeedleWorkerRequest>) => {
	const request = event.data;
	if (request.type === "initialize") {
		try {
			resolver?.close();
			resolver = openNeedleNativeResolver(request.libraryPath);
			post({ type: "ready" });
		} catch (error) {
			post({ type: "error", id: null, message: errorMessage(error) });
		}
		return;
	}
	if (request.type === "resolve") {
		try {
			if (!resolver) throw new Error("Needle worker is not initialized");
			post({
				type: "resolved",
				id: request.id,
				resolution: await resolver.resolve(request.transcript),
			});
		} catch (error) {
			post({ type: "error", id: request.id, message: errorMessage(error) });
		}
		return;
	}
	resolver?.close();
	resolver = null;
	post({ type: "closed" });
	workerScope.close();
};
