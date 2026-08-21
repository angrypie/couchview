/**
 * Nitro Oniguruma parity: the shared C++ core (built as a dylib and driven
 * through bun:ffi) must be byte-exact with the WASM engine on the same
 * fixtures, at both the raw scanner level and the full tokenization pipeline
 * level. This is the host-side proof that the native engine is semantically
 * identical to the web engine before it ever runs on a device.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

import { GOLDEN_FIXTURES } from "../src/client/components/diff/engine/goldenFixture.ts";
import { DIFF_THEMES } from "../src/client/components/diff/engine/highlighter.ts";
import { grammarLoaderFor } from "../src/client/components/diff/engine/languages.ts";
import { createOnigRegexEngine } from "../src/client/components/diff/engine/onigEngineAdapter.ts";
import { tokenizeRowsWithHighlighter } from "../src/client/components/diff/engine/tokens.ts";
import {
	DEFAULT_TOKENIZE_OPTIONS,
	type DiffRow,
} from "../src/client/components/diff/engine/types.ts";
import { buildNitroOnigCore } from "./buildNitroOnigCore.ts";
import { createFfiOnigBridge } from "./ffiOnigBridge.ts";

const DYLIB = `${import.meta.dir}/../build/nitro-onig-core.dylib`;

interface GrammarRule {
	match?: string | { source: string };
	begin?: string | { source: string };
	end?: string | { source: string };
	while?: string | { source: string };
	patterns?: GrammarRule[];
	repository?: Record<string, GrammarRule>;
}

function patternText(pattern: string | { source: string } | undefined): string | null {
	if (typeof pattern === "string") return pattern;
	if (pattern !== null && typeof pattern === "object" && typeof pattern.source === "string") {
		return pattern.source;
	}
	return null;
}

/**
 * Collect the patterns the real pipeline compiles RAW: `match` and `begin`
 * fields. `end`/`while` fields are excluded because vscode-textmate
 * substitutes their begin-rule backreferences (`\N`, `\k<name>`) in JS before
 * compiling, so their raw source never reaches the engine.
 */
function collectRawPatterns(rules: GrammarRule[] | undefined, out: string[]): void {
	for (const rule of rules ?? []) {
		for (const field of [rule.match, rule.begin]) {
			const text = patternText(field);
			if (text !== null) out.push(text);
		}
		collectRawPatterns(rule.patterns, out);
		if (rule.repository) {
			collectRawPatterns(Object.values(rule.repository), out);
		}
	}
}

async function grammarPatterns(language: string): Promise<string[]> {
	const loader = grammarLoaderFor(language);
	if (loader === null) throw new Error(`no grammar loader for ${language}`);
	const registration = (await loader()) as unknown;
	// @shikijs/langs modules export `{ default: [LanguageRegistration] }`.
	const unwrapped = (registration as { default?: unknown }).default ?? registration;
	const grammar = (Array.isArray(unwrapped) ? unwrapped[0] : unwrapped) as {
		patterns?: GrammarRule[];
		repository?: Record<string, GrammarRule>;
	};
	const out: string[] = [];
	collectRawPatterns(grammar.patterns, out);
	collectRawPatterns(Object.values(grammar.repository ?? {}), out);
	expect(out.length).toBeGreaterThan(100);
	return out;
}

function row(index: number, text: string): DiffRow {
	return {
		id: `r${index}`,
		kind: "context",
		text,
		oldLine: index + 1,
		newLine: index + 1,
		hunkIndex: 0,
		hunkSpecs: null,
		collapsedLines: 0,
		noNewline: false,
		decorations: [],
		visualColumns: 60,
	};
}

// Lines that stress offset maps, lookbehind, captures, anchors, and both the
// RegSet path (<1000 bytes) and the per-pattern loop path (>=1000 bytes).
const ADVERSARIAL_LINES = [
	"const emoji = '🦀🎉'; // 😀",
	"const cjk = '日本語のテキスト';",
	"const mixed = 'a😀b🎉c';",
	"const lookbehind = /(?<=prefix)suffix/;",
	"const lookahead = /suffix(?=postfix)/;",
	"const backref = /(ab)\\1/;",
	"const empty = /(?=)/;",
	"foo\\Gbar",
	"const extended = /(?x) a \\s+ b # comment/;",
	"#pragma once",
	"const a = 1; const b = 2; const c = 3;".repeat(25) + " // long-line comment",
	"",
	"end",
];

async function wasmEngine() {
	return createOnigurumaEngine(() => import("shiki/wasm"));
}

function ffiEngine() {
	return createOnigRegexEngine(createFfiOnigBridge(DYLIB));
}

beforeAll(async () => {
	await buildNitroOnigCore();
});

describe("nitro oniguruma scanner parity", () => {
	for (const [fixtureName, fixture] of Object.entries(GOLDEN_FIXTURES)) {
		test(`${fixtureName} raw scanner matches the WASM engine`, async () => {
			const patterns = await grammarPatterns(fixture.lang);
			const wasm = await wasmEngine();
			const ffi = ffiEngine();
			const wasmScanner = wasm.createScanner(patterns);
			const ffiScanner = ffi.createScanner(patterns);
			const lines = [...fixture.lines, ...ADVERSARIAL_LINES];

			for (const line of lines) {
				const wasmString = wasm.createString(line + "\n");
				const ffiString = ffi.createString(line + "\n");
				// Tokenizer-style walk: advance through all matches.
				let position = 0;
				for (let step = 0; step < 500; step++) {
					const wasmResult = wasmScanner.findNextMatchSync(wasmString, position, 0);
					const ffiResult = ffiScanner.findNextMatchSync(ffiString, position, 0);
					if (wasmResult === null || ffiResult === null) {
						expect(ffiResult, `step ${step} of ${JSON.stringify(line)}`).toBe(wasmResult);
						break;
					}
					expect(JSON.stringify(ffiResult), `step ${step} of ${JSON.stringify(line)}`).toBe(
						JSON.stringify(wasmResult),
					);
					const advance = wasmResult.captureIndices[0]?.end ?? position;
					if (advance <= position) break;
					position = advance;
				}
				// The plain-string path must behave identically.
				const wasmPlain = wasmScanner.findNextMatchSync(line, 0, 0);
				const ffiPlain = ffiScanner.findNextMatchSync(line, 0, 0);
				if (wasmPlain === null) {
					expect(ffiPlain).toBeNull();
				} else {
					expect(JSON.stringify(ffiPlain)).toBe(JSON.stringify(wasmPlain));
				}
				wasmString.dispose?.();
				ffiString.dispose?.();
			}
			wasmScanner.dispose?.();
			ffiScanner.dispose?.();
		});
	}

	test("finder option bits map like the WASM engine", async () => {
		const wasm = await wasmEngine();
		const ffi = ffiEngine();
		const patterns = ["\\Astart", "^middle$", "\\Ganchor"];
		const wasmScanner = wasm.createScanner(patterns);
		const ffiScanner = ffi.createScanner(patterns);
		for (const options of [0, 1, 2, 4, 7]) {
			for (const line of ["start", "middle", "anchor", "xstartx"]) {
				const wasmResult = wasmScanner.findNextMatchSync(line, 0, options);
				const ffiResult = ffiScanner.findNextMatchSync(line, 0, options);
				if (wasmResult === null) {
					expect(ffiResult).toBeNull();
				} else {
					expect(JSON.stringify(ffiResult)).toBe(JSON.stringify(wasmResult));
				}
			}
		}
	});
});

describe("nitro oniguruma tokenization parity", () => {
	test("full pipeline tokens are byte-exact across the fixture gauntlet", async () => {
		const wasmHighlighter = await createHighlighterCore({
			themes: [DIFF_THEMES.dark, DIFF_THEMES.light],
			langs: [],
			engine: await wasmEngine(),
		});
		const ffiHighlighter = await createHighlighterCore({
			themes: [DIFF_THEMES.dark, DIFF_THEMES.light],
			langs: [],
			engine: ffiEngine(),
		});
		for (const fixture of Object.values(GOLDEN_FIXTURES)) {
			const loader = grammarLoaderFor(fixture.lang);
			expect(loader).not.toBeNull();
			await wasmHighlighter.loadLanguage(await loader!());
			await ffiHighlighter.loadLanguage(await loader!());
		}
		for (const [name, fixture] of Object.entries(GOLDEN_FIXTURES)) {
			const rows = fixture.lines.map((text, index) => row(index, text));
			const options = {
				rows,
				language: fixture.lang,
				resolvedLanguage: fixture.lang,
				themeType: "dark" as const,
				tokenizeOptions: { ...DEFAULT_TOKENIZE_OPTIONS, themeType: "dark" as const },
				controller: { cancelled: () => false },
				onBatch: () => {},
			};
			const wasmTokens = await tokenizeRowsWithHighlighter({
				...options,
				highlighter: wasmHighlighter,
			});
			const ffiTokens = await tokenizeRowsWithHighlighter({
				...options,
				highlighter: ffiHighlighter,
			});
			for (const fixtureRow of rows) {
				expect(
					JSON.stringify(ffiTokens.get(fixtureRow.id) ?? null),
					`${name}:${JSON.stringify(fixtureRow.text)}`,
				).toBe(JSON.stringify(wasmTokens.get(fixtureRow.id) ?? null));
			}
		}
	});
});
