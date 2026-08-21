import type { NeedleResolution } from "./needleRuntime.ts";

export type NeedleWorkerRequest =
	| { type: "initialize"; libraryPath: string }
	| { type: "resolve"; id: number; transcript: string }
	| { type: "close" };

export type NeedleWorkerResponse =
	| { type: "ready" }
	| { type: "resolved"; id: number; resolution: NeedleResolution }
	| { type: "error"; id: number | null; message: string }
	| { type: "closed" };
