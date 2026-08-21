import type { GrammarState } from "@shikijs/primitive";
import type { HighlighterCore, ThemeInput, ThemeRegistrationAny } from "shiki/core";
import type { HighlightToken } from "./types.ts";

/**
 * Number of lines between grammar-state checkpoints. Tokenizing a window
 * replays at most this many lines before reaching the requested range.
 */
export const TOKENIZER_CHECKPOINT_INTERVAL = 64;

/** Opaque shiki grammar state; instances are immutable stack snapshots. */
export type TokenizerState = GrammarState;

export interface TokenizeChunk {
	start: number;
	end: number;
	lines: HighlightToken[][];
}

export interface TokenizerSnapshot {
	checkpoints: (TokenizerState | null)[];
	tokenizedLineCount: number;
	resumeState: { position: number; state: TokenizerState } | null;
}

interface TokenizeCallOptions {
	lang: string;
	theme: ThemeInput;
	tokenizeMaxLineLength: number;
}

interface BackgroundScheduler {
	postTask(callback: () => void, options: { priority: "background" }): Promise<void>;
}

function yieldToHost(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(() => {
			if (typeof requestIdleCallback === "function") {
				requestIdleCallback(() => resolve());
				return;
			}
			const scheduler = (globalThis as typeof globalThis & { scheduler?: BackgroundScheduler })
				.scheduler;
			if (scheduler) void scheduler.postTask(resolve, { priority: "background" });
			else resolve();
		}, 16);
	});
}

/**
 * Streaming tokenizer with grammar-state checkpoints.
 *
 * TextMate tokenization is sequential: tokens for line N depend on the state
 * stack produced by line N-1. This tokenizer walks lines in order and stores
 * the grammar state at every `TOKENIZER_CHECKPOINT_INTERVAL` boundary, so a
 * later request can resume from the nearest checkpoint behind its target
 * instead of re-walking the file from line 0.
 */
export class LineTokenizer {
	private readonly highlighter: HighlighterCore;
	private readonly options: TokenizeCallOptions;
	/** Grammar state after `index * TOKENIZER_CHECKPOINT_INTERVAL` lines. */
	private readonly checkpoints: (TokenizerState | null)[];
	/** Exact resume state when tokenization stopped mid-interval. */
	private resumeState: { position: number; state: TokenizerState } | null = null;
	/** First line index that has not been tokenized yet. */
	private tokenizedLineCount = 0;

	constructor(highlighter: HighlighterCore, options: TokenizeCallOptions, expectedLineCount = 0) {
		this.highlighter = highlighter;
		this.options = options;
		this.checkpoints = new Array(
			Math.max(Math.ceil(expectedLineCount / TOKENIZER_CHECKPOINT_INTERVAL) + 1, 1),
		).fill(null);
	}

	get progressLineCount(): number {
		return this.tokenizedLineCount;
	}

	/**
	 * Tokenize lines until `to` is covered or `stop` returns true, delivering
	 * completed chunks in order. Resumes from an exact mid-interval state when
	 * available, otherwise from the nearest checkpoint behind the cursor.
	 * Returns the next un-tokenized line index.
	 */
	async tokenize(
		lines: readonly string[],
		to: number,
		stop: () => boolean,
		onChunk: (chunk: TokenizeChunk) => void,
	): Promise<number> {
		let position = this.tokenizedLineCount;
		while (position < to && !stop()) {
			const end = Math.min(position + TOKENIZER_CHECKPOINT_INTERVAL, to);
			const chunkLines = lines.slice(position, end);
			const state =
				this.resumeState !== null && this.resumeState.position === position
					? this.resumeState.state
					: this.checkpointBehind(position);
			const tokens = this.tokenizeChunk(chunkLines, state);
			onChunk({ start: position, end, lines: tokens.tokens });
			position = end;
			this.tokenizedLineCount = end;
			if (end % TOKENIZER_CHECKPOINT_INTERVAL === 0) {
				this.storeCheckpoint(Math.floor(end / TOKENIZER_CHECKPOINT_INTERVAL), tokens.state);
			} else {
				this.resumeState = { position: end, state: tokens.state };
			}
			if (position < to && !stop()) await yieldToHost();
		}
		return position;
	}

	/** Grammar state behind `lineIndex` from the nearest stored checkpoint. */
	private checkpointBehind(lineIndex: number): TokenizerState | undefined {
		const checkpointIndex = Math.floor(lineIndex / TOKENIZER_CHECKPOINT_INTERVAL);
		return this.checkpoints[checkpointIndex] ?? undefined;
	}

	private storeCheckpoint(index: number, state: TokenizerState): void {
		while (this.checkpoints.length <= index) this.checkpoints.push(null);
		this.checkpoints[index] = state;
		this.resumeState = null;
	}

	private tokenizeChunk(
		lines: readonly string[],
		grammarState: TokenizerState | undefined,
	): { tokens: HighlightToken[][]; state: TokenizerState } {
		const text = lines.join("\n");
		const result = this.highlighter.codeToTokens(text, {
			lang: this.options.lang,
			theme: this.options.theme as unknown as ThemeRegistrationAny,
			tokenizeMaxLineLength: this.options.tokenizeMaxLineLength,
			...(grammarState !== undefined ? { grammarState } : {}),
		});
		const rawTokens = result.tokens;
		const rebased: HighlightToken[][] = new Array(rawTokens.length);
		let lineStart = 0;
		for (let index = 0; index < rawTokens.length; index++) {
			const raw = rawTokens[index];
			if (raw === undefined) {
				rebased[index] = [];
				continue;
			}
			const tokens: HighlightToken[] = new Array(raw.length);
			for (let tokenIndex = 0; tokenIndex < raw.length; tokenIndex++) {
				const token = raw[tokenIndex];
				if (token === undefined) continue;
				tokens[tokenIndex] = {
					content: token.content,
					offset: token.offset - lineStart,
					...(token.color !== undefined ? { color: token.color } : {}),
					...(token.fontStyle !== undefined ? { fontStyle: token.fontStyle } : {}),
				};
			}
			rebased[index] = tokens;
			const line = lines[index];
			lineStart += (line?.length ?? 0) + 1;
		}
		return { tokens: rebased, state: result.grammarState as TokenizerState };
	}

	snapshot(): TokenizerSnapshot {
		return {
			checkpoints: this.checkpoints.slice(),
			tokenizedLineCount: this.tokenizedLineCount,
			resumeState: this.resumeState,
		};
	}

	/**
	 * Rehydrate a tokenizer from a cached snapshot. Checkpoints must come
	 * from a tokenizer for the same language and theme; the caller is
	 * responsible for the cache key.
	 */
	static fromSnapshot(
		highlighter: HighlighterCore,
		options: TokenizeCallOptions,
		snapshot: TokenizerSnapshot,
	): LineTokenizer {
		const tokenizer = new LineTokenizer(highlighter, options, 0);
		tokenizer.checkpoints.length = 0;
		tokenizer.checkpoints.push(...snapshot.checkpoints);
		tokenizer.tokenizedLineCount = snapshot.tokenizedLineCount;
		tokenizer.resumeState = snapshot.resumeState;
		return tokenizer;
	}
}

interface StateLike {
	_stacks?: Record<string, unknown>;
}

/** Estimate serialized checkpoint memory for cache accounting. */
export function estimateCheckpointBytes(snapshot: TokenizerSnapshot): number {
	let total = 0;
	const seen = new WeakSet<object>();
	for (const checkpoint of snapshot.checkpoints) {
		if (checkpoint === null) continue;
		const stacks = (checkpoint as unknown as StateLike)._stacks;
		if (stacks === undefined) continue;
		for (const stack of Object.values(stacks)) {
			total += estimateStackBytes(stack, seen);
		}
	}
	if (snapshot.resumeState !== null) {
		const stacks = (snapshot.resumeState.state as unknown as StateLike)._stacks;
		if (stacks !== undefined) {
			for (const stack of Object.values(stacks)) {
				total += estimateStackBytes(stack, seen);
			}
		}
	}
	return total;
}

function estimateStackBytes(value: unknown, seen: WeakSet<object>): number {
	if (typeof value === "string") return value.length * 2 + 16;
	if (typeof value !== "object" || value === null) return 16;
	if (seen.has(value)) return 0;
	seen.add(value);
	let total = 16;
	for (const entry of Object.values(value)) total += estimateStackBytes(entry, seen);
	return total;
}
