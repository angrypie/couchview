import type { HighlighterCore, ThemeInput, ThemeRegistrationAny } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import type { ResolvedTheme } from "../../../../shared/theme.ts";
import { grammarLoaderFor, PLAIN_LANGUAGES } from "./languages.ts";
import { createDiffShikiEngine } from "./shikiEngine";
import themeDarkJson from "./themes/pierre-dark.json";
import themeLightJson from "./themes/pierre-light.json";

export interface DiffThemes {
	dark: ThemeInput;
	light: ThemeInput;
}

/**
 * Vendored Pierre diff themes (Apache-2.0, @pierre/theme 1.1.0). Kept as
 * static JSON so the viewer palette and the shiki token colors stay in lock
 * step without depending on the theme package.
 */
const themeDark = themeDarkJson as unknown as ThemeInput;
const themeLight = themeLightJson as unknown as ThemeInput;

export const DIFF_THEMES: DiffThemes = { dark: themeDark, light: themeLight };

export function diffTheme(themeType: ResolvedTheme): ThemeInput[] {
	return [themeType === "dark" ? themeDark : themeLight];
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();

const WARMUP_SNIPPET = "const warmup = 1\nfunction f() {\n\treturn warmup\n}\n";

/**
 * Shared shiki core highlighter singleton. Both vendored themes are attached
 * up front; grammars load lazily per language through `loadLanguageFor`.
 */
export function getDiffHighlighter(): Promise<HighlighterCore> {
	if (highlighterPromise === null) {
		highlighterPromise = createHighlighterCore({
			themes: [themeDark, themeLight],
			langs: [],
			engine: createDiffShikiEngine(),
		});
	}
	return highlighterPromise;
}

/**
 * Loads a grammar into the shared highlighter once and runs a short warmup
 * tokenization. The warmup compiles the grammar's regexes, which avoids the
 * shiki time-limit truncation a cold first call would otherwise produce.
 */
export async function loadLanguageFor(
	highlighter: HighlighterCore,
	language: string,
): Promise<void> {
	if (PLAIN_LANGUAGES.has(language) || loadedLanguages.has(language)) return;
	const loader = grammarLoaderFor(language);
	if (loader === null) return;
	const module = await loader();
	await highlighter.loadLanguage(module);
	loadedLanguages.add(language);
	const resolvedDark = themeDark as unknown as ThemeRegistrationAny;
	const resolvedLight = themeLight as unknown as ThemeRegistrationAny;
	highlighter.codeToTokens(WARMUP_SNIPPET, { lang: language, theme: resolvedDark });
	highlighter.codeToTokens(WARMUP_SNIPPET, { lang: language, theme: resolvedLight });
}
