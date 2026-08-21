import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

/**
 * Web engine: native Oniguruma compiled to WebAssembly, several times faster
 * per line than the JavaScript regex engine. The wasm binary is inlined as
 * base64 by `@shikijs/engine-oniguruma/wasm-inlined` (single 466 KB module).
 * `DIFF_BENCH_ENGINE=js` swaps in the JavaScript engine so the benchmark can
 * compare both engines on one host.
 */
export function createDiffShikiEngine() {
	if (process.env.DIFF_BENCH_ENGINE === "js") return createJavaScriptRegexEngine();
	return createOnigurumaEngine(() => import("shiki/wasm"));
}
