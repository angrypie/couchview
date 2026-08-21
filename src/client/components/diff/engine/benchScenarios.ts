import { languageForFileName } from "./languages.ts";
import {
	readCachedTokens,
	type TokenCacheKey,
	tokenCacheKey,
	tokenizeAndCache,
	tokenizeRows,
} from "./tokens.ts";
import { DEFAULT_TOKENIZE_OPTIONS, type DiffRow } from "./types.ts";

/**
 * Shared diff-engine benchmark scenarios.
 *
 * The host runner (`scripts/diffBench.ts`, Bun) executes these scenarios.
 * Keep the scenario order, fixtures, chunking options, and cache keys in sync
 * with `docs/diff/benchmarks.md`.
 */

export function benchFixtureRows(count: number, linesPerFile = 600): DiffRow[] {
	const lines: string[] = [];
	for (let i = 0; i < linesPerFile; i++) {
		lines.push(
			`export function render${i}(props: { id: string; count: number }): JSX.Element {`,
			`  const items = useMemo(() => props.count > 3 ? [1,2,3] : [], [props.count]);`,
			`  // comment ${i} about nothing`,
			"  const label = `item-${props.id}`;",
			`  return <div className="row">{items.map((n) => <span key={n}>{label}{n}</span>)}</div>;`,
			"}",
		);
	}
	const rows: DiffRow[] = [];
	for (let index = 0; index < count; index++) {
		rows.push({
			id: `r${index}`,
			kind: index % 7 === 6 ? "addition" : "context",
			text: lines[index % lines.length] ?? `const line${index} = ${index};`,
			oldLine: index + 1,
			newLine: index + 1,
			hunkIndex: 0,
			hunkSpecs: null,
			collapsedLines: 0,
			noNewline: false,
			decorations: [],
			visualColumns: 40,
		});
	}
	return rows;
}

export function benchTokenizeOptions() {
	return { ...DEFAULT_TOKENIZE_OPTIONS, themeType: "dark" as const, chunkTargetChars: 24_000 };
}

export function benchCacheKeys(): {
	warm: TokenCacheKey;
	resume: TokenCacheKey;
	deepResume: TokenCacheKey;
} {
	const base = { repositoryId: "bench", themeType: "dark" as const };
	return {
		warm: { ...base, fileId: "bench-file", contentRevision: "rev-1" },
		resume: { ...base, fileId: "bench-resume", contentRevision: "rev-1" },
		deepResume: { ...base, fileId: "bench-deep-resume", contentRevision: "rev-1" },
	};
}

function benchNow(): number {
	return Date.now();
}

async function measure(log: (line: string) => void, name: string, fn: () => Promise<number>) {
	const start = benchNow();
	const metric = await fn();
	const elapsed = benchNow() - start;
	log(`${name}\t${elapsed.toFixed(1)}\tms\tmetric=${metric}`);
}

export async function runDiffBenchScenarios(log: (line: string) => void): Promise<void> {
	const language = languageForFileName("src/App.tsx");
	const warmRows = benchFixtureRows(600);
	const largeRows = benchFixtureRows(5000);
	const cacheKeys = benchCacheKeys();

	await measure(log, "cold-init+first-600", async () => {
		const tokens = await tokenizeRows({
			rows: warmRows,
			language,
			themeType: "dark",
			tokenizeOptions: benchTokenizeOptions(),
			controller: { cancelled: () => false },
			onBatch: () => {},
		});
		return tokens.size;
	});

	await measure(log, "warm-600", async () => {
		const tokens = await tokenizeRows({
			rows: warmRows,
			language,
			themeType: "dark",
			tokenizeOptions: benchTokenizeOptions(),
			controller: { cancelled: () => false },
			onBatch: () => {},
		});
		return tokens.size;
	});

	await measure(log, "large-5000-total", async () => {
		const tokens = await tokenizeRows({
			rows: largeRows,
			language,
			themeType: "dark",
			tokenizeOptions: benchTokenizeOptions(),
			controller: { cancelled: () => false },
			onBatch: () => {},
		});
		return tokens.size;
	});

	await tokenizeRows({
		rows: largeRows,
		language,
		themeType: "dark",
		tokenizeOptions: benchTokenizeOptions(),
		controller: { cancelled: () => false },
		onBatch: () => {},
		cacheKey: cacheKeys.resume,
		to: 500,
	});
	await measure(log, "resume-after-500-of-5000", async () => {
		const tokens = await tokenizeRows({
			rows: largeRows,
			language,
			themeType: "dark",
			tokenizeOptions: benchTokenizeOptions(),
			controller: { cancelled: () => false },
			onBatch: () => {},
			cacheKey: cacheKeys.resume,
		});
		return tokens.size;
	});

	await tokenizeRows({
		rows: largeRows,
		language,
		themeType: "dark",
		tokenizeOptions: benchTokenizeOptions(),
		controller: { cancelled: () => false },
		onBatch: () => {},
		cacheKey: cacheKeys.deepResume,
		to: 4500,
	});
	await measure(log, "resume-after-4500-of-5000", async () => {
		const tokens = await tokenizeRows({
			rows: largeRows,
			language,
			themeType: "dark",
			tokenizeOptions: benchTokenizeOptions(),
			controller: { cancelled: () => false },
			onBatch: () => {},
			cacheKey: cacheKeys.deepResume,
		});
		return tokens.size;
	});

	await measure(log, "re-walk-5000-no-resume", async () => {
		const tokens = await tokenizeRows({
			rows: largeRows,
			language,
			themeType: "dark",
			tokenizeOptions: benchTokenizeOptions(),
			controller: { cancelled: () => false },
			onBatch: () => {},
		});
		return tokens.size;
	});

	await measure(log, "cache-store", async () => {
		await tokenizeAndCache({
			cacheKey: cacheKeys.warm,
			rows: warmRows,
			language,
			themeType: "dark",
			tokenizeOptions: benchTokenizeOptions(),
		});
		const cached = readCachedTokens(cacheKeys.warm);
		return cached?.tokens.size ?? 0;
	});

	await measure(log, "cache-hit", async () => {
		const cached = readCachedTokens(cacheKeys.warm);
		return cached?.tokens.size ?? 0;
	});
}

export function benchTokenCacheKeySample(): string {
	return tokenCacheKey(benchCacheKeys().warm);
}
