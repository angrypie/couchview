import { describe, expect, test } from "bun:test";
import { DIFF_THEMES, getDiffHighlighter, loadLanguageFor } from "./highlighter.ts";
import {
	estimateCheckpointBytes,
	LineTokenizer,
	TOKENIZER_CHECKPOINT_INTERVAL,
	type TokenizerSnapshot,
} from "./tokenizer.ts";

function fixtureLines(count: number): string[] {
	const lines: string[] = [];
	for (let i = 0; i < count; i++) {
		lines.push(
			`export function render${i}(props: { id: string; count: number }): JSX.Element {`,
			`  const items = useMemo(() => props.count > 3 ? [1,2,3] : [], [props.count]);`,
			`  // comment ${i} about nothing`,
			"  const label = `item-${props.id}`;",
			`  return <div className="row">{items.map((n) => <span key={n}>{label}{n}</span>)}</div>;`,
			"}",
		);
	}
	return lines;
}

function normalize(lines: unknown[][]): string {
	return lines
		.map((tokens) =>
			tokens
				.map((token) => {
					const t = token as { content: string; color?: string; fontStyle?: number };
					return `${t.content}|${t.color ?? ""}|${t.fontStyle ?? 0}`;
				})
				.join("~"),
		)
		.join("\n");
}

async function tokenizerFor(lines: string[]) {
	const highlighter = await getDiffHighlighter();
	await loadLanguageFor(highlighter, "tsx");
	return new LineTokenizer(
		highlighter,
		{ lang: "tsx", theme: DIFF_THEMES.dark, tokenizeMaxLineLength: 2000 },
		lines.length,
	);
}

describe("LineTokenizer", () => {
	test("counts shared checkpoint graph objects once", () => {
		const sharedState = { label: "state" };
		const snapshot = {
			checkpoints: [{ _stacks: { left: sharedState, right: sharedState } }],
			resumeState: null,
			tokenizedLineCount: TOKENIZER_CHECKPOINT_INTERVAL,
		} as unknown as TokenizerSnapshot;

		expect(estimateCheckpointBytes(snapshot)).toBe(42);
	});

	test("bounds cyclic checkpoint graph accounting", () => {
		const recursiveState: Record<string, unknown> = {};
		recursiveState.self = recursiveState;
		const snapshot = {
			checkpoints: [{ _stacks: { root: recursiveState } }],
			resumeState: null,
			tokenizedLineCount: TOKENIZER_CHECKPOINT_INTERVAL,
		} as unknown as TokenizerSnapshot;

		expect(estimateCheckpointBytes(snapshot)).toBe(16);
	});

	test("produces identical tokens whether tokenized in parts or one pass", async () => {
		const lines = fixtureLines(40);
		const tokenizer = await tokenizerFor(lines);
		const chunks: { lines: unknown[][] }[] = [];
		await tokenizer.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => chunks.push(chunk),
		);
		const all = chunks.flatMap((chunk) => chunk.lines);

		const reference = await tokenizerFor(lines);
		const referenceTokens: unknown[][] = [];
		await reference.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => referenceTokens.push(...chunk.lines),
		);
		expect(normalize(all)).toBe(normalize(referenceTokens));
		expect(all.length).toBe(lines.length);
	});

	test("resumes from an exact mid-interval stop without re-delivering lines", async () => {
		const lines = fixtureLines(50);
		const tokenizer = await tokenizerFor(lines);
		const stopAt = TOKENIZER_CHECKPOINT_INTERVAL + 10;
		const firstPart: unknown[][] = [];
		await tokenizer.tokenize(
			lines,
			stopAt,
			() => false,
			(chunk) => firstPart.push(...chunk.lines),
		);
		expect(tokenizer.progressLineCount).toBe(stopAt);

		const secondPart: unknown[][] = [];
		await tokenizer.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => secondPart.push(...chunk.lines),
		);
		expect(tokenizer.progressLineCount).toBe(lines.length);
		expect(firstPart.length + secondPart.length).toBe(lines.length);

		const reference = await tokenizerFor(lines);
		const referenceTokens: unknown[][] = [];
		await reference.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => referenceTokens.push(...chunk.lines),
		);
		expect(normalize([...firstPart, ...secondPart])).toBe(normalize(referenceTokens));
	});

	test("resumes from a stored checkpoint after an interrupted pass", async () => {
		const lines = fixtureLines(60);
		const tokenizer = await tokenizerFor(lines);
		const interruptedTokens: unknown[][] = [];
		let stops = 0;
		await tokenizer.tokenize(
			lines,
			lines.length,
			() => {
				if (stops === 0 && tokenizer.progressLineCount >= TOKENIZER_CHECKPOINT_INTERVAL) {
					stops += 1;
					return true;
				}
				return false;
			},
			(chunk) => {
				interruptedTokens.push(...chunk.lines);
			},
		);

		const remainingTokens: unknown[][] = [];
		await tokenizer.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => remainingTokens.push(...chunk.lines),
		);
		const combined = [...interruptedTokens, ...remainingTokens];
		expect(combined.length).toBe(lines.length);

		const reference = await tokenizerFor(lines);
		const referenceTokens: unknown[][] = [];
		await reference.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => referenceTokens.push(...chunk.lines),
		);
		expect(normalize(combined)).toBe(normalize(referenceTokens));
	});

	test("restores progress from a snapshot", async () => {
		const lines = fixtureLines(100);
		const tokenizer = await tokenizerFor(lines);
		await tokenizer.tokenize(
			lines,
			40,
			() => false,
			() => {},
		);
		expect(tokenizer.progressLineCount).toBe(40);
		const snapshot = tokenizer.snapshot();
		expect(snapshot.resumeState).not.toBeNull();

		const highlighter = await getDiffHighlighter();
		const restored = LineTokenizer.fromSnapshot(
			highlighter,
			{ lang: "tsx", theme: DIFF_THEMES.dark, tokenizeMaxLineLength: 2000 },
			snapshot,
		);
		expect(restored.progressLineCount).toBe(40);

		const restoredTokens: unknown[][] = [];
		await restored.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => restoredTokens.push(...chunk.lines),
		);

		const reference = await tokenizerFor(lines);
		const referenceTokens: unknown[][] = [];
		await reference.tokenize(
			lines,
			lines.length,
			() => false,
			(chunk) => referenceTokens.push(...chunk.lines),
		);
		expect(normalize(restoredTokens)).toBe(normalize(referenceTokens.slice(40)));
	});
});
