import { dlopen, ptr } from "bun:ffi";

import type {
	OnigBridge,
	OnigBridgeScanner,
	OnigBridgeString,
} from "../src/client/components/diff/engine/onigEngineAdapter";

/**
 * bun:ffi bridge over the shared OnigCore dylib, exposing the same minimal
 * interface the Nitro module implements. Used by the host parity test and
 * the FFI performance preview; dev-host only.
 */

interface FfiOnigString extends OnigBridgeString {
	handle: number;
	stringId: number;
}

interface FfiApi {
	onigabi_scanner_create(
		patterns: unknown,
		lengths: unknown,
		count: number,
		errorOut: unknown,
		errorOutLen: number,
	): unknown;
	onigabi_scanner_free(scanner: unknown): void;
	onigabi_string_create(utf8: unknown, utf8Len: number, utf16Len: number): unknown;
	onigabi_string_free(line: unknown): void;
	onigabi_scanner_find(
		scanner: unknown,
		line: unknown,
		startPosition: number,
		options: number,
		stringId: number,
		outBuffer: unknown,
		outBufferLen: number,
	): number;
}

const MAX_ENCODED = 2 * (1 + 1000);

function utf8Buffer(text: string): Buffer {
	return Buffer.from(new TextEncoder().encode(text));
}

export function createFfiOnigBridge(dylibPath: string): OnigBridge {
	const lib = dlopen(dylibPath, {
		onigabi_scanner_create: {
			args: ["ptr", "ptr", "i32", "ptr", "i32"],
			returns: "ptr",
		},
		onigabi_scanner_free: { args: ["ptr"], returns: "void" },
		onigabi_string_create: { args: ["ptr", "i32", "i32"], returns: "ptr" },
		onigabi_string_free: { args: ["ptr"], returns: "void" },
		onigabi_scanner_find: {
			args: ["ptr", "ptr", "i32", "i32", "i32", "ptr", "i32"],
			returns: "i32",
		},
	} as unknown as Parameters<typeof dlopen>[1]);
	const ffi = lib.symbols as unknown as FfiApi;

	function createScanner(patterns: string[]): OnigBridgeScanner {
		const patternBuffers = patterns.map((pattern) => utf8Buffer(pattern));
		const pointerSlots = Buffer.alloc(patterns.length * 8);
		const pointerView = new BigInt64Array(
			pointerSlots.buffer,
			pointerSlots.byteOffset,
			patterns.length,
		);
		const lengths = new Int32Array(patterns.length);
		for (const [i, patternBuffer] of patternBuffers.entries()) {
			pointerView[i] = BigInt(ptr(patternBuffer));
			lengths[i] = patternBuffer.length;
		}
		const errorBuffer = Buffer.alloc(512);
		const handle = ffi.onigabi_scanner_create(
			pointerSlots,
			lengths,
			patterns.length,
			errorBuffer,
			errorBuffer.length,
		) as number;
		if (handle === 0 || handle === null) {
			const zero = errorBuffer.indexOf(0);
			const message = errorBuffer
				.subarray(0, zero >= 0 ? zero : errorBuffer.length)
				.toString("utf8");
			throw new Error(message || "Oniguruma pattern compilation failed");
		}
		const outBuffer = new Int32Array(MAX_ENCODED);
		const outView = new Uint32Array(outBuffer.buffer);
		return {
			findNextMatchSync(text, startPosition, options) {
				const line = text as FfiOnigString;
				const written = ffi.onigabi_scanner_find(
					handle,
					line.handle,
					startPosition,
					options,
					line.stringId,
					outBuffer,
					outBuffer.length,
				);
				if (written <= 0) return null;
				return outView.slice(0, written);
			},
			dispose() {
				ffi.onigabi_scanner_free(handle);
			},
		};
	}

	let nextStringId = 1;

	function createString(text: string): FfiOnigString {
		const buffer = utf8Buffer(text);
		const handle = ffi.onigabi_string_create(buffer, buffer.length, text.length) as number;
		const stringId = nextStringId++;
		return {
			handle,
			stringId,
			dispose() {
				ffi.onigabi_string_free(handle);
			},
		};
	}

	return { createScanner, createString };
}
