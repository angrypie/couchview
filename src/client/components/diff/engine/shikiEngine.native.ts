import { type HybridObject, NitroModules } from "react-native-nitro-modules";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { createOnigRegexEngine, type OnigBridge } from "./onigEngineAdapter";

/**
 * Native engine: Oniguruma 6.9.8 compiled to native code behind a Nitro
 * hybrid object, byte-compatible with the WASM build the web engine uses.
 * Falls back to the pure-JavaScript regex engine when the native module is
 * unavailable (for example during development before the pods are built).
 */

interface NitroOnigString extends HybridObject<{ ios: "c++" }> {
	dispose(): void;
}

interface NitroOnigScanner extends HybridObject<{ ios: "c++" }> {
	findNextMatchSync(
		text: NitroOnigString,
		startPosition: number,
		options: number,
	): ArrayBuffer | undefined;
	dispose(): void;
}

interface NitroOniguruma extends HybridObject<{ ios: "c++" }> {
	createScanner(patterns: string[]): NitroOnigScanner;
	createString(text: string, utf16Length: number): NitroOnigString;
}

let nativeModuleMissingWarned = false;

function createNitroOnigBridge(): OnigBridge | null {
	try {
		const onig = NitroModules.createHybridObject<NitroOniguruma>("Oniguruma");
		return {
			createScanner(patterns) {
				const scanner = onig.createScanner(patterns);
				return {
					findNextMatchSync(text, startPosition, options) {
						const buffer = scanner.findNextMatchSync(
							text as NitroOnigString,
							startPosition,
							options,
						);
						return buffer === undefined ? null : new Uint32Array(buffer);
					},
					dispose() {
						scanner.dispose();
					},
				};
			},
			createString(text) {
				return onig.createString(text, text.length);
			},
		};
	} catch (error) {
		if (!nativeModuleMissingWarned) {
			nativeModuleMissingWarned = true;
			console.warn("[diff] Nitro Oniguruma engine unavailable; using the JS regex engine.", error);
		}
		return null;
	}
}

export function createDiffShikiEngine() {
	const bridge = createNitroOnigBridge();
	return bridge === null ? createJavaScriptRegexEngine() : createOnigRegexEngine(bridge);
}
