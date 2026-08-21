import { describe, expect, test } from "bun:test";
import { buildDiffRows, expandTabs, visualColumns, wordDiffDecorations } from "./rows.ts";
import type { ParsedFileDiff } from "./types.ts";

function fullPatchDiff(): ParsedFileDiff {
	return {
		name: "src/example.ts",
		type: "change",
		isPartial: false,
		unifiedLineCount: 8,
		splitLineCount: 8,
		hunks: [
			{
				collapsedBefore: 0,
				additionStart: 1,
				additionCount: 8,
				additionLines: 8,
				additionLineIndex: 0,
				deletionStart: 1,
				deletionCount: 8,
				deletionLines: 8,
				deletionLineIndex: 0,
				unifiedLineStart: 0,
				unifiedLineCount: 8,
				splitLineStart: 0,
				splitLineCount: 8,
				hunkSpecs: "@@ -1,8 +1,8 @@",
				noEOFCRDeletions: false,
				noEOFCRAdditions: false,
				hunkContent: [
					{ type: "context", lines: 1, additionLineIndex: 0, deletionLineIndex: 0 },
					{
						type: "change",
						deletions: 1,
						additions: 1,
						additionLineIndex: 0,
						deletionLineIndex: 0,
					},
					{ type: "context", lines: 1, additionLineIndex: 0, deletionLineIndex: 0 },
					{
						type: "change",
						deletions: 1,
						additions: 1,
						additionLineIndex: 0,
						deletionLineIndex: 0,
					},
					{ type: "context", lines: 4, additionLineIndex: 0, deletionLineIndex: 0 },
				],
			},
		],
		deletionLines: [
			"const value = 1;\n",
			"const oldName = true;\n",
			"const middle = true;\n",
			"const last = false;\n",
			"const tail1 = true;\n",
			"const tail2 = true;\n",
			"const tail3 = true;\n",
			"const tail4 = true;",
		],
		additionLines: [
			"const value = 1;\n",
			"const newName = true;\n",
			"const middle = true;\n",
			"const last = true;\n",
			"const tail1 = true;\n",
			"const tail2 = true;\n",
			"const tail3 = true;\n",
			"const tail4 = true;",
		],
	};
}

function partialPatchDiff(): ParsedFileDiff {
	const diff = fullPatchDiff();
	diff.isPartial = true;
	diff.hunks[0]!.collapsedBefore = 5;
	diff.hunks[0]!.deletionStart = 6;
	diff.hunks[0]!.additionStart = 6;
	diff.hunks[0]!.deletionLineIndex = 0;
	diff.hunks[0]!.additionLineIndex = 0;
	return diff;
}

describe("buildDiffRows", () => {
	test("builds context, deletion, and addition rows with unified line numbers", () => {
		const rows = buildDiffRows(fullPatchDiff());
		expect(rows.map((row) => row.kind)).toEqual([
			"context",
			"deletion",
			"addition",
			"context",
			"deletion",
			"addition",
			"context",
			"context",
			"context",
			"context",
		]);
		const deletion = rows[1];
		expect(deletion?.oldLine).toBe(2);
		expect(deletion?.newLine).toBeNull();
		expect(deletion?.text).toBe("const oldName = true;");
		const addition = rows[2];
		expect(addition?.newLine).toBe(2);
		expect(addition?.oldLine).toBeNull();
		const context = rows[6];
		expect(context?.oldLine).toBe(5);
		expect(context?.newLine).toBe(5);
	});

	test("adds a metadata separator between hunks of a partial patch", () => {
		const rows = buildDiffRows(partialPatchDiff());
		expect(rows[0]?.kind).toBe("separator");
		expect(rows[0]?.hunkSpecs).toBe("@@ -1,8 +1,8 @@");
		expect(rows[0]?.collapsedLines).toBe(5);
		expect(rows[1]?.kind).toBe("context");
		expect(rows[1]?.oldLine).toBe(6);
	});

	test("emits no-newline metadata rows after the affected line", () => {
		const diff = fullPatchDiff();
		const hunk = diff.hunks[0];
		if (!hunk) throw new Error("missing hunk");
		hunk.noEOFCRDeletions = true;
		hunk.noEOFCRAdditions = true;
		const rows = buildDiffRows(diff);
		const tail = rows.at(-2);
		const last = rows.at(-1);
		expect(tail?.noNewline).toBe(true);
		expect(tail?.kind).toBe("context");
		expect(last?.noNewline).toBe(true);
		expect(last?.kind).toBe("context");
	});

	test("keeps stable row ids per index", () => {
		const first = buildDiffRows(fullPatchDiff());
		const second = buildDiffRows(fullPatchDiff());
		expect(first.map((row) => row.id)).toEqual(second.map((row) => row.id));
	});

	test("expands tabs at two-column stops", () => {
		expect(expandTabs("a\tb")).toBe("a b");
		expect(expandTabs("ab\tc")).toBe("ab  c");
		expect(visualColumns("ab\tc")).toBe(5);
	});

	test("computes word-level decorations for paired change lines", () => {
		const { deletion, addition } = wordDiffDecorations(
			"const value = oldName;",
			"const value = newName;",
		);
		expect(deletion).toEqual([{ start: 14, end: 21 }]);
		expect(addition).toEqual([{ start: 14, end: 21 }]);
	});

	test("skips word decorations beyond the line length budget", () => {
		const { deletion, addition } = wordDiffDecorations("a".repeat(1001), "b".repeat(1001));
		expect(deletion).toEqual([]);
		expect(addition).toEqual([]);
	});
});
