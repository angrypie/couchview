import type { RegexEngine } from "shiki/core";

/** Structural mirror of @shikijs/vscode-textmate's scanner/string contracts. */
interface OnigCaptureIndex {
	start: number;
	end: number;
	length: number;
}

interface OnigMatch {
	index: number;
	captureIndices: OnigCaptureIndex[];
}

/** Carries the native bridge string on the JS-side OnigString wrapper. */
const NATIVE_STRING = Symbol("nativeOnigString");

type EngineString = {
	readonly content: string;
	dispose(): void;
} & {
	[NATIVE_STRING]: OnigBridgeString;
};

interface EngineScanner {
	findNextMatchSync(
		text: string | EngineString,
		startPosition: number,
		options: number,
	): OnigMatch | null;
	dispose?(): void;
}

/**
 * Platform-neutral adapter that turns a minimal Oniguruma bridge (a Nitro
 * hybrid object on native, a bun:ffi dylib on the host) into the shiki
 * `RegexEngine` the diff highlighter consumes.
 *
 * Semantics mirror `@shikijs/engine-oniguruma`'s WASM engine exactly:
 * - patterns arrive as strings (RegExp `.source` unwrapped);
 * - `findNextMatchSync` returns `{ index, captureIndices }` where `index` is
 *   the pattern index and capture 0 is the whole match, in UTF-16 code units;
 * - unmatched groups have `length === 0`;
 * - plain-string searches build an ephemeral native string, search, and
 *   dispose it (same as the WASM engine's string wrapper).
 */

export interface OnigBridgeString {
	dispose(): void;
}

export interface OnigBridgeScanner {
	findNextMatchSync(
		text: OnigBridgeString,
		startPosition: number,
		options: number,
	): Uint32Array | null;
	dispose(): void;
}

export interface OnigBridge {
	createScanner(patterns: string[]): OnigBridgeScanner;
	createString(text: string): OnigBridgeString;
}

export function createOnigRegexEngine(bridge: OnigBridge): RegexEngine {
	return {
		createScanner(patterns: (string | RegExp)[]) {
			const nativeScanner = bridge.createScanner(
				patterns.map((pattern) => (typeof pattern === "string" ? pattern : pattern.source)),
			);
			const scanner: EngineScanner = {
				findNextMatchSync(
					text: string | EngineString,
					startPosition: number,
					options: number,
				): OnigMatch | null {
					const ephemeral = typeof text === "string";
					const line: OnigBridgeString = ephemeral
						? bridge.createString(text)
						: (text as EngineString)[NATIVE_STRING];
					try {
						const view = nativeScanner.findNextMatchSync(line, startPosition, options);
						if (view === null) return null;
						const index = view[0] ?? 0;
						const count = view[1] ?? 0;
						const captureIndices: OnigCaptureIndex[] = new Array(count);
						for (let i = 0; i < count; i++) {
							const start = view[2 + 2 * i] ?? 0;
							const end = view[3 + 2 * i] ?? 0;
							captureIndices[i] = { start, end, length: end - start };
						}
						return { index, captureIndices };
					} finally {
						if (ephemeral) line.dispose();
					}
				},
				dispose() {
					nativeScanner.dispose();
				},
			};
			return scanner;
		},
		createString(s: string) {
			const native = bridge.createString(s);
			const string: EngineString = {
				content: s,
				[NATIVE_STRING]: native,
				dispose: () => native.dispose(),
			};
			return string;
		},
	};
}
