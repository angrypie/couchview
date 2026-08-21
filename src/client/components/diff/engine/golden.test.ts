/**
 * Golden snapshot test for the tokenization pipeline.
 *
 * The fixture exercises the grammar constructs that stress the tokenizer:
 * multiline comments, multiline template literals with interpolation, JSX,
 * nested scopes, Python docstrings, and shell heredocs. The snapshot in
 * `golden-snapshots.json` captures the rendered runs produced by the
 * platform engine (WASM on web/Bun, JS engine on native) and was reviewed
 * against the pierre-dark theme palette. It guards our pipeline — offset
 * rebasing, run merging, decoration overlays, foreground remapping — not
 * shiki's grammar internals.
 */
import { describe, expect, test } from "bun:test";
import type { ThemeRegistrationAny } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import goldenSnapshots from "./golden-snapshots.json";
import { charFingerprint, GOLDEN_FIXTURES } from "./goldenFixture.ts";
import { DIFF_THEMES } from "./highlighter.ts";
import { grammarLoaderFor } from "./languages.ts";
import { tokenizeRows, tokenizeRowsWithHighlighter } from "./tokens.ts";
import { DEFAULT_TOKENIZE_OPTIONS, type DiffRow, type TokenRun } from "./types.ts";

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

const FIXTURES = GOLDEN_FIXTURES;

describe("golden token snapshots", () => {
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		test(`${name} fixture matches the reviewed snapshot`, async () => {
			const rows = fixture.lines.map((text, index) => row(index, text));
			const tokens = await tokenizeRows({
				rows,
				language: fixture.lang,
				themeType: "dark",
				tokenizeOptions: { ...DEFAULT_TOKENIZE_OPTIONS, themeType: "dark" },
				controller: { cancelled: () => false },
				onBatch: () => {},
			});
			const snapshot = rows.map((fixtureRow) => tokens.get(fixtureRow.id) ?? null);
			const golden = (
				goldenSnapshots as Record<string, (readonly TokenRun[] | null)[] | undefined>
			)[name];
			expect(snapshot).toEqual(golden ?? []);
		});
	}
});

/**
 * Char-level fingerprint of a row: each character gets its resolved color
 * and font-style bits. Token *boundaries* are ignored — the JS and WASM
 * engines may split spans at slightly different offsets, but the rendered
 * colors must be identical.
 */

describe("JS engine (native path) golden snapshots", () => {
	test("matches the reviewed snapshot colors across the fixture gauntlet", async () => {
		// The native engine path, constructed explicitly because `bun test`
		// resolves the web platform file and therefore runs the WASM engine.
		const highlighter = await createHighlighterCore({
			themes: [DIFF_THEMES.dark, DIFF_THEMES.light],
			langs: [],
			engine: createJavaScriptRegexEngine(),
		});
		const warmup = "const warmup = 1\nfunction f() {\n\treturn warmup\n}\n";

		for (const [name, fixture] of Object.entries(FIXTURES)) {
			const loader = grammarLoaderFor(fixture.lang);
			expect(loader, `${fixture.lang} must have a grammar loader`).not.toBeNull();
			await highlighter.loadLanguage(await loader!());
			highlighter.codeToTokens(warmup, {
				lang: fixture.lang,
				theme: DIFF_THEMES.dark as unknown as ThemeRegistrationAny,
			});

			const rows = fixture.lines.map((text, index) => row(index, text));
			const tokens = await tokenizeRowsWithHighlighter({
				rows,
				language: fixture.lang,
				resolvedLanguage: fixture.lang,
				highlighter,
				themeType: "dark",
				tokenizeOptions: { ...DEFAULT_TOKENIZE_OPTIONS, themeType: "dark" },
				controller: { cancelled: () => false },
				onBatch: () => {},
			});
			const golden = (
				goldenSnapshots as Record<string, (readonly TokenRun[] | null)[] | undefined>
			)[name];
			expect(golden, `${name} golden missing`).toBeDefined();
			for (let index = 0; index < rows.length; index++) {
				const fixtureRow = rows[index];
				if (fixtureRow === undefined) continue;
				const goldenRow = golden?.[index] ?? null;
				expect(charFingerprint(tokens.get(fixtureRow.id) ?? null, fixtureRow.text)).toBe(
					charFingerprint(goldenRow, fixtureRow.text),
				);
			}
		}
	});
});
