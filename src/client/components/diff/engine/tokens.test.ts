import { describe, expect, test } from "bun:test";

import { buildDiffRows } from "./rows.ts";
import { type TokenRun, tokenizeRows, tokensToRuns } from "./tokens.ts";
import type { DiffRow } from "./types.ts";

describe("tokensToRuns", () => {
	test("remaps theme foreground tokens to the viewer text color", () => {
		const runs = tokensToRuns(
			[
				{ content: "const", offset: 0, color: "#D568EA", fontStyle: 0 },
				{ content: " ", offset: 5, color: "#FAFAFA", fontStyle: 0 },
			],
			"const ",
			"dark",
			"context",
			[],
		);
		expect(runs[0]?.color).toBe("#D568EA");
		expect(runs[1]?.color).toBe("#e7edf5");
	});

	test("splits decorated spans and merges identical neighbors", () => {
		const runs = tokensToRuns(
			[{ content: "const oldName;", offset: 0, color: "#FAFAFA", fontStyle: 0 }],
			"const oldName;",
			"dark",
			"deletion",
			[{ start: 6, end: 13 }],
		);
		expect(runs.map((run) => run.text)).toEqual(["const ", "oldName", ";"]);
		expect(runs[1]?.backgroundColor).not.toBeNull();
		expect(runs[0]?.backgroundColor).toBeNull();
	});

	test("marks identifier runs and keeps style flags", () => {
		const runs = tokensToRuns(
			[
				{ content: "load", offset: 0, color: "#08C0EF", fontStyle: 0 },
				{ content: "(", offset: 4, color: "#FAFAFA", fontStyle: 0 },
				{ content: "Value", offset: 5, color: "#FAFAFA", fontStyle: 2 },
			],
			"load(Value",
			"dark",
			"context",
			[],
		);
		expect(runs[0]?.identifier).toBe(true);
		expect(runs[1]?.identifier).toBe(false);
		expect(runs[2]?.identifier).toBe(true);
		expect(runs[2]?.bold).toBe(true);
	});

	test("appends unterminated line tails as default-color runs", () => {
		const runs = tokensToRuns(
			[{ content: "a", offset: 0, color: "#FAFAFA", fontStyle: 0 }],
			"abc",
			"dark",
			"context",
			[],
		);
		expect(runs.at(-1)?.text).toBe("bc");
		expect(runs.at(-1)?.color).toBe("#e7edf5");
	});
});

describe("tokenizeRows", () => {
	test("tokenizes a small diff progressively and returns per-row runs", async () => {
		const rows: DiffRow[] = [
			{
				id: "r0",
				kind: "context",
				text: "const value = 1;",
				oldLine: 1,
				newLine: 1,
				hunkIndex: 0,
				hunkSpecs: null,
				collapsedLines: 0,
				noNewline: false,
				decorations: [],
				visualColumns: 16,
			},
			{
				id: "r1",
				kind: "deletion",
				text: "const oldName = true;",
				oldLine: 2,
				newLine: null,
				hunkIndex: 0,
				hunkSpecs: null,
				collapsedLines: 0,
				noNewline: false,
				decorations: [{ start: 6, end: 13 }],
				visualColumns: 22,
			},
			{
				id: "r2",
				kind: "separator",
				text: "@@ -3 +3 @@",
				oldLine: null,
				newLine: null,
				hunkIndex: 0,
				hunkSpecs: "@@ -3 +3 @@",
				collapsedLines: 2,
				noNewline: false,
				decorations: [],
				visualColumns: 11,
			},
		];
		const batches: ReadonlyMap<number, readonly TokenRun[]>[] = [];
		const tokens = await tokenizeRows({
			rows,
			language: "ts",
			themeType: "dark",
			tokenizeOptions: {
				themeType: "dark",
				tokenizeMaxLength: 100_000,
				tokenizeMaxLineLength: 2_000,
				lineDiffType: "word-alt",
				maxLineDiffLength: 1_000,
				chunkTargetChars: 24_000,
				plainContextThreshold: 3_000,
			},
			controller: { cancelled: () => false },
			onBatch: (batch) => batches.push(batch),
		});
		expect(batches.length).toBeGreaterThan(0);
		expect(tokens.get("r0")).toBeDefined();
		expect(tokens.get("r1")?.some((run) => run.backgroundColor !== null)).toBe(true);
		expect(tokens.get("r2")).toBeUndefined();
	});

	test("stops after cancellation before further chunks", async () => {
		const many = Array.from({ length: 500 }, (_, index) => ({
			id: `r${index}`,
			kind: "context" as const,
			text: `const line${index} = ${index};`,
			oldLine: index + 1,
			newLine: index + 1,
			hunkIndex: 0,
			hunkSpecs: null,
			collapsedLines: 0,
			noNewline: false,
			decorations: [],
			visualColumns: 24,
		}));
		let cancelled = false;
		let batches = 0;
		await tokenizeRows({
			rows: many,
			language: "ts",
			themeType: "dark",
			tokenizeOptions: {
				themeType: "dark",
				tokenizeMaxLength: 100_000,
				tokenizeMaxLineLength: 2_000,
				lineDiffType: "word-alt",
				maxLineDiffLength: 1_000,
				chunkTargetChars: 100,
				plainContextThreshold: 3_000,
			},
			controller: {
				cancelled: () => cancelled,
			},
			onBatch: () => {
				batches += 1;
				cancelled = true;
			},
		});
		expect(batches).toBe(1);
	});

	test("walks large-file context for grammar state without retaining redundant plain runs", async () => {
		const rows: DiffRow[] = [
			{
				collapsedLines: 0,
				decorations: [],
				hunkIndex: 0,
				hunkSpecs: null,
				id: "context",
				kind: "context",
				newLine: 1,
				noNewline: false,
				oldLine: 1,
				text: "const context = true;",
				visualColumns: 21,
			},
			{
				collapsedLines: 0,
				decorations: [],
				hunkIndex: 0,
				hunkSpecs: null,
				id: "addition",
				kind: "addition",
				newLine: 2,
				noNewline: false,
				oldLine: null,
				text: "const changed = true;",
				visualColumns: 21,
			},
		];
		const tokens = await tokenizeRows({
			rows,
			language: "ts",
			themeType: "dark",
			tokenizeOptions: {
				themeType: "dark",
				tokenizeMaxLength: 100_000,
				tokenizeMaxLineLength: 2_000,
				lineDiffType: "word-alt",
				maxLineDiffLength: 1_000,
				chunkTargetChars: 24_000,
				plainContextThreshold: 1,
			},
			controller: { cancelled: () => false },
			onBatch: () => {},
		});
		expect(tokens.get("context")).toBeUndefined();
		expect(tokens.get("addition")).toBeDefined();
	});

	test("builds tokenizable rows for a full parsed diff", async () => {
		const rows = buildDiffRows({
			name: "src/example.ts",
			type: "change",
			isPartial: true,
			unifiedLineCount: 2,
			splitLineCount: 2,
			hunks: [
				{
					collapsedBefore: 0,
					additionStart: 1,
					additionCount: 2,
					additionLines: 2,
					additionLineIndex: 0,
					deletionStart: 1,
					deletionCount: 2,
					deletionLines: 2,
					deletionLineIndex: 0,
					unifiedLineStart: 0,
					unifiedLineCount: 2,
					splitLineStart: 0,
					splitLineCount: 2,
					hunkSpecs: "@@ -1,2 +1,2 @@",
					noEOFCRDeletions: false,
					noEOFCRAdditions: false,
					hunkContent: [
						{
							type: "change",
							deletions: 1,
							additions: 1,
							additionLineIndex: 0,
							deletionLineIndex: 0,
						},
					],
				},
			],
			deletionLines: ["const a = 1;"],
			additionLines: ["const a = 2;"],
		});
		const tokens = await tokenizeRows({
			rows,
			language: "ts",
			themeType: "dark",
			tokenizeOptions: {
				themeType: "dark",
				tokenizeMaxLength: 100_000,
				tokenizeMaxLineLength: 2_000,
				lineDiffType: "word-alt",
				maxLineDiffLength: 1_000,
				chunkTargetChars: 24_000,
				plainContextThreshold: 3_000,
			},
			controller: { cancelled: () => false },
			onBatch: () => {},
		});
		expect(tokens.size).toBe(2);
	});
});
