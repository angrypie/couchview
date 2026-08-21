import type { HighlighterCore } from "shiki/core";
import { DIFF_THEMES, diffTheme, getDiffHighlighter, loadLanguageFor } from "./highlighter.ts";
import { resolveLanguage } from "./languages.ts";
import { DIFF_PALETTE, themeForeground } from "./palette.ts";
import { estimateCheckpointBytes, LineTokenizer, type TokenizerSnapshot } from "./tokenizer.ts";
import type {
	DiffRow,
	HighlightToken,
	TokenizeController,
	TokenizeOptions,
	TokenRun,
} from "./types.ts";

export type { TokenRun };

export interface TokenCacheKey {
	repositoryId: string;
	fileId: string;
	contentRevision: string;
	themeType: "dark" | "light";
}

export interface CachedTokens {
	tokens: Map<string, readonly TokenRun[]>;
	/** False while a background fill is still in flight. */
	complete: boolean;
}

interface DiffTokenCache {
	key: TokenCacheKey;
	tokens: Map<string, readonly TokenRun[]>;
	complete: boolean;
	textBytes: number;
	checkpointBytes: number;
	tokenizer: LineTokenizer | null;
	snapshot: TokenizerSnapshot | null;
}

const MAX_CACHE_ENTRIES = 12;
const MAX_CACHE_BYTES = 4_000_000;

const tokenCache = new Map<string, DiffTokenCache>();

export function tokenCacheKey(key: TokenCacheKey): string {
	return `${key.repositoryId}\0${key.fileId}\0${key.contentRevision}\0${key.themeType}`;
}

export function readCachedTokens(key: TokenCacheKey): CachedTokens | null {
	const cacheKey = tokenCacheKey(key);
	const entry = tokenCache.get(cacheKey);
	if (!entry) return null;
	tokenCache.delete(cacheKey);
	tokenCache.set(cacheKey, entry);
	return { tokens: entry.tokens, complete: entry.complete };
}

function cacheEntry(key: TokenCacheKey): DiffTokenCache {
	const cacheKey = tokenCacheKey(key);
	const existing = tokenCache.get(cacheKey);
	if (existing) {
		tokenCache.delete(cacheKey);
		tokenCache.set(cacheKey, existing);
		return existing;
	}
	const entry: DiffTokenCache = {
		key,
		tokens: new Map(),
		complete: false,
		textBytes: 0,
		checkpointBytes: 0,
		tokenizer: null,
		snapshot: null,
	};
	tokenCache.set(cacheKey, entry);
	evictCache();
	return entry;
}

export function storeCachedTokens(
	key: TokenCacheKey,
	tokens: Map<string, readonly TokenRun[]>,
	tokenizer: LineTokenizer | null = null,
	complete = true,
): void {
	const cacheKey = tokenCacheKey(key);
	const existing = tokenCache.get(cacheKey);
	if (existing) tokenCache.delete(cacheKey);
	let textBytes = 0;
	for (const runs of tokens.values()) {
		for (const run of runs) textBytes += run.text.length;
	}
	const liveTokenizer = tokenizer ?? existing?.tokenizer ?? null;
	const snapshot = liveTokenizer?.snapshot() ?? null;
	tokenCache.set(cacheKey, {
		key,
		tokens,
		complete,
		textBytes,
		checkpointBytes: snapshot === null ? 0 : estimateCheckpointBytes(snapshot),
		tokenizer: liveTokenizer,
		snapshot,
	});
	evictCache();
}

function updateEntrySize(entry: DiffTokenCache): void {
	let textBytes = 0;
	for (const runs of entry.tokens.values()) {
		for (const run of runs) textBytes += run.text.length;
	}
	entry.textBytes = textBytes;
	entry.checkpointBytes = entry.snapshot === null ? 0 : estimateCheckpointBytes(entry.snapshot);
	evictCache();
}

function evictCache(): void {
	while (tokenCache.size > MAX_CACHE_ENTRIES) {
		const oldest = tokenCache.keys().next();
		if (oldest.done) break;
		tokenCache.delete(oldest.value);
	}
	let total = 0;
	for (const entry of tokenCache.values()) total += entry.textBytes + entry.checkpointBytes;
	while (total > MAX_CACHE_BYTES && tokenCache.size > 1) {
		const oldest = tokenCache.keys().next();
		if (oldest.done) break;
		const entry = tokenCache.get(oldest.value);
		if (!entry) break;
		total -= entry.textBytes + entry.checkpointBytes;
		tokenCache.delete(oldest.value);
	}
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$-]*$/;

interface PendingRun {
	text: string;
	color: string;
	backgroundColor: string | null;
	fontStyle: number;
	identifier: boolean;
}

function fontStyleBits(fontStyle: number): { bold: boolean; italic: boolean; underline: boolean } {
	return {
		bold: (fontStyle & 2) !== 0,
		italic: (fontStyle & 1) !== 0,
		underline: (fontStyle & 4) !== 0,
	};
}

function finalizeRun(run: PendingRun): TokenRun {
	const { bold, italic, underline } = fontStyleBits(run.fontStyle);
	return {
		text: run.text,
		color: run.color,
		backgroundColor: run.backgroundColor,
		bold,
		italic,
		underline,
		identifier: run.identifier,
	};
}

function sameStyle(first: PendingRun, second: PendingRun): boolean {
	return (
		first.color === second.color &&
		first.backgroundColor === second.backgroundColor &&
		first.fontStyle === second.fontStyle
	);
}

/**
 * Convert a line's Shiki tokens plus intra-line diff decorations into merged
 * render runs. Tokens carrying the theme foreground color are remapped to the
 * viewer text color; decorated spans receive the emphasis background of their
 * line kind. Identifier detection runs on the final runs, so decorated
 * fragments stay individually clickable.
 */
export function tokensToRuns(
	tokens: readonly HighlightToken[],
	lineText: string,
	themeType: "dark" | "light",
	kind: "context" | "addition" | "deletion",
	decorations: readonly { start: number; end: number }[],
): TokenRun[] {
	const foreground = themeForeground(themeType);
	const emphasis =
		kind === "addition"
			? DIFF_PALETTE.additionEmphasis
			: kind === "deletion"
				? DIFF_PALETTE.deletionEmphasis
				: null;
	const runs: PendingRun[] = [];
	const push = (text: string, color: string, fontStyle: number, decorated: boolean) => {
		if (text.length === 0) return;
		const pending: PendingRun = {
			text,
			color,
			backgroundColor: decorated ? emphasis : null,
			fontStyle,
			identifier: IDENTIFIER_PATTERN.test(text),
		};
		const last = runs.at(-1);
		if (last && sameStyle(last, pending) && !last.identifier && !pending.identifier) {
			last.text += text;
		} else {
			runs.push(pending);
		}
	};
	let covered = 0;
	for (const token of tokens) {
		const color =
			token.color && token.color.toLowerCase() !== foreground ? token.color : DIFF_PALETTE.text;
		const fontStyle = token.fontStyle ?? 0;
		const spans = decorations.length === 0 ? null : spansForToken(token, decorations);
		if (spans === null || spans.length === 0) {
			push(token.content, color, fontStyle, false);
		} else {
			let cursor = 0;
			for (const span of spans) {
				if (span.start > cursor)
					push(token.content.slice(cursor, span.start), color, fontStyle, false);
				push(token.content.slice(span.start, span.end), color, fontStyle, true);
				cursor = span.end;
			}
			if (cursor < token.content.length) push(token.content.slice(cursor), color, fontStyle, false);
		}
		covered = Math.max(covered, token.offset + token.content.length);
	}
	if (covered < lineText.length) {
		push(lineText.slice(covered), DIFF_PALETTE.text, 0, false);
	}
	return runs.map(finalizeRun);
}

function spansForToken(
	token: HighlightToken,
	decorations: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
	const tokenStart = token.offset;
	const tokenEnd = tokenStart + token.content.length;
	const spans: { start: number; end: number }[] = [];
	for (const decoration of decorations) {
		if (decoration.end <= tokenStart || decoration.start >= tokenEnd) continue;
		spans.push({
			start: Math.max(decoration.start - tokenStart, 0),
			end: Math.min(decoration.end - tokenStart, tokenEnd - tokenStart),
		});
	}
	return spans;
}

function isTokenizableRow(row: DiffRow): boolean {
	return row.kind !== "separator" && !row.noNewline;
}

interface TokenizableEntry {
	row: DiffRow;
	index: number;
}

function plainRun(text: string): readonly TokenRun[] {
	return [
		{
			text,
			color: DIFF_PALETTE.text,
			backgroundColor: null,
			bold: false,
			italic: false,
			underline: false,
			identifier: false,
		},
	];
}

export interface TokenizeInput {
	rows: readonly DiffRow[];
	language: string;
	themeType: "dark" | "light";
	tokenizeOptions: TokenizeOptions;
	controller: TokenizeController;
	onBatch: (batch: ReadonlyMap<number, readonly TokenRun[]>) => void;
	/**
	 * When set, the tokenizer session (checkpoints, partial results) is
	 * stored on the bounded cache entry so a later call resumes instead of
	 * re-walking the file from line 0.
	 */
	cacheKey?: TokenCacheKey;
	/** Tokenize only up to this many tokenizable lines; the rest resumes later. */
	to?: number;
}

/**
 * Tokenize line rows through the checkpointed streaming tokenizer. Batches
 * are delivered through `onBatch` as they complete; the controller cancels
 * remaining work between chunks. Returns the completed per-row token map.
 */
export async function tokenizeRows(
	options: TokenizeInput,
): Promise<Map<string, readonly TokenRun[]>> {
	const resolvedLanguage = resolveLanguage(options.language);
	if (resolvedLanguage === "text" || resolvedLanguage === "ansi") {
		return tokenizeRowsWithHighlighter({ ...options, resolvedLanguage, highlighter: null });
	}
	const highlighter = await getDiffHighlighter();
	await loadLanguageFor(highlighter, resolvedLanguage);
	return tokenizeRowsWithHighlighter({ ...options, resolvedLanguage, highlighter });
}

export interface TokenizeWithHighlighterInput extends TokenizeInput {
	resolvedLanguage: string;
	/** Null for plain languages; a grammar-loaded shiki core otherwise. */
	highlighter: HighlighterCore | null;
}

/**
 * The highlighter-agnostic core of `tokenizeRows`. Exposed so host-side
 * tests can run the pipeline against an explicitly constructed engine (for
 * example the native JS engine) instead of the platform-resolved singleton.
 */
export async function tokenizeRowsWithHighlighter(
	options: TokenizeWithHighlighterInput,
): Promise<Map<string, readonly TokenRun[]>> {
	const {
		rows,
		resolvedLanguage,
		themeType,
		tokenizeOptions,
		controller,
		onBatch,
		cacheKey,
		highlighter,
	} = options;
	const entry = cacheKey !== undefined ? cacheEntry(cacheKey) : null;
	const result = entry?.tokens ?? new Map<string, readonly TokenRun[]>();
	const tokenizable: TokenizableEntry[] = [];
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index];
		if (row !== undefined && isTokenizableRow(row)) tokenizable.push({ row, index });
	}
	const limit = Math.min(options.to ?? tokenizable.length, tokenizable.length);
	if (tokenizable.length === 0 || tokenizable.length > tokenizeOptions.tokenizeMaxLength) {
		return result;
	}
	if (resolvedLanguage === "text" || resolvedLanguage === "ansi") {
		const batch = new Map<number, readonly TokenRun[]>();
		for (const entryRow of tokenizable) {
			const runs = plainRun(entryRow.row.text);
			result.set(entryRow.row.id, runs);
			batch.set(entryRow.index, runs);
		}
		if (batch.size > 0) onBatch(batch);
		return result;
	}
	if (highlighter === null) throw new Error("tokenizeRowsWithHighlighter: missing highlighter");
	if (controller.cancelled()) return result;
	const lines = tokenizable.map((entryRow) => entryRow.row.text);
	const [theme] = diffTheme(themeType);
	const callOptions = {
		lang: resolvedLanguage,
		theme: theme ?? DIFF_THEMES[themeType],
		tokenizeMaxLineLength: tokenizeOptions.tokenizeMaxLineLength,
	};
	const tokenizer =
		entry?.tokenizer ??
		(entry !== null && entry.snapshot !== null
			? LineTokenizer.fromSnapshot(highlighter, callOptions, entry.snapshot)
			: new LineTokenizer(highlighter, callOptions, lines.length));
	if (entry !== null && entry.tokenizer === null) entry.tokenizer = tokenizer;
	const plainContext =
		tokenizeOptions.plainContextThreshold > 0 &&
		tokenizable.length > tokenizeOptions.plainContextThreshold;
	const deliverChunk = (chunk: { start: number; end: number; lines: HighlightToken[][] }) => {
		const batch = new Map<number, readonly TokenRun[]>();
		for (let lineIndex = 0; lineIndex < chunk.lines.length; lineIndex++) {
			const entryRow = tokenizable[chunk.start + lineIndex];
			if (entryRow === undefined) continue;
			if (plainContext && entryRow.row.kind === "context") continue;
			const runs = tokensToRuns(
				chunk.lines[lineIndex] ?? [],
				entryRow.row.text,
				themeType,
				entryRow.row.kind as "addition" | "deletion",
				entryRow.row.decorations,
			);
			result.set(entryRow.row.id, runs);
			batch.set(entryRow.index, runs);
		}
		if (batch.size > 0) onBatch(batch);
	};
	const nextLine = await tokenizer.tokenize(
		lines,
		limit,
		() => controller.cancelled(),
		deliverChunk,
	);
	if (entry !== null) {
		entry.snapshot = tokenizer.snapshot();
		entry.complete = nextLine >= lines.length;
		updateEntrySize(entry);
	}
	return result;
}

/**
 * Tokenize and store tokens in the bounded cache without progressive
 * callbacks. Used for prefetching adjacent files and cache misses.
 */
export async function tokenizeAndCache(options: {
	cacheKey: TokenCacheKey;
	rows: readonly DiffRow[];
	language: string;
	themeType: "dark" | "light";
	tokenizeOptions: TokenizeOptions;
}): Promise<void> {
	const { cacheKey, rows, language, themeType, tokenizeOptions } = options;
	const cached = readCachedTokens(cacheKey);
	if (cached?.complete) return;
	const entry = cacheEntry(cacheKey);
	const tokens = await tokenizeRows({
		rows,
		language,
		themeType,
		tokenizeOptions,
		controller: { cancelled: () => false },
		onBatch: () => {},
		cacheKey,
	});
	storeCachedTokens(cacheKey, tokens, entry.tokenizer);
}

export function prewarmTokenCache(options: {
	cacheKey: TokenCacheKey;
	rows: readonly DiffRow[];
	language: string;
	themeType: "dark" | "light";
	tokenizeOptions: TokenizeOptions;
}): void {
	void tokenizeAndCache(options);
}

export type { TokenizerSnapshot };
