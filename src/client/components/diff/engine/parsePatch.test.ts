import { describe, expect, test } from "bun:test";

import { parseContractHunks, parseFullPatch } from "./parsePatch.ts";

describe("parseFullPatch", () => {
	test("parses a git full-context patch into hunks, lines, and counts", () => {
		const patch = [
			"diff --git a/src/review.ts b/src/review.ts",
			"index 111..222 100644",
			"--- a/src/review.ts",
			"+++ b/src/review.ts",
			"@@ -1,6 +1,6 @@",
			" const keep1 = true;",
			"-const oldValue = 1;",
			"+const newValue = 2;",
			" const keep2 = true;",
			" const keep3 = true;",
			" const keep4 = true;",
			"@@ -10,2 +10,2 @@",
			" const tail1 = true;",
			"-const last = false;",
			"+const last = true;",
			"",
		].join("\n");
		const parsed = parseFullPatch(patch);
		expect(parsed.type).toBe("change");
		expect(parsed.hunks).toHaveLength(2);
		const [first, second] = parsed.hunks;
		expect(first?.deletionStart).toBe(1);
		expect(first?.deletionCount).toBe(6);
		expect(first?.additionStart).toBe(1);
		expect(first?.additionCount).toBe(6);
		expect(first?.hunkContent).toEqual([
			{ type: "context", lines: 1, additionLineIndex: 0, deletionLineIndex: 0 },
			{
				type: "change",
				deletions: 1,
				additions: 1,
				additionLineIndex: 1,
				deletionLineIndex: 1,
			},
			{ type: "context", lines: 3, additionLineIndex: 2, deletionLineIndex: 2 },
		]);
		expect(first?.unifiedLineCount).toBe(6);
		expect(second?.collapsedBefore).toBe(3);
		expect(second?.deletionStart).toBe(10);
		expect(parsed.deletionLines[0]).toBe("const keep1 = true;\n");
		expect(parsed.deletionLines[1]).toBe("const oldValue = 1;\n");
		expect(parsed.additionLines[1]).toBe("const newValue = 2;\n");
		expect(parsed.additionLines[2]).toBe("const keep2 = true;\n");
	});

	test("handles hunk headers without counts and no-newline markers", () => {
		const patch = [
			"diff --git a/f.ts b/f.ts",
			"--- a/f.ts",
			"+++ b/f.ts",
			"@@ -1 +1 @@",
			"-old",
			"\\ No newline at end of file",
			"+new",
			"\\ No newline at end of file",
			"",
		].join("\n");
		const parsed = parseFullPatch(patch);
		const hunk = parsed.hunks[0];
		expect(hunk?.deletionCount).toBe(1);
		expect(hunk?.additionCount).toBe(1);
		expect(hunk?.noEOFCRDeletions).toBe(true);
		expect(hunk?.noEOFCRAdditions).toBe(true);
		expect(parsed.deletionLines[0]).toBe("old");
		expect(parsed.additionLines[0]).toBe("new");
	});

	test("returns empty hunks for header-only patches", () => {
		const parsed = parseFullPatch("diff --git a/f b/f\n--- a/f\n+++ b/f\n");
		expect(parsed.hunks).toEqual([]);
		expect(parsed.deletionLines).toEqual([]);
	});

	test("computes collapsedBefore between separated hunks", () => {
		const patch = [
			"--- a/f.ts",
			"+++ b/f.ts",
			"@@ -2,1 +2,1 @@",
			"-a",
			"+b",
			"@@ -9,1 +9,1 @@",
			"-c",
			"+d",
			"",
		].join("\n");
		const parsed = parseFullPatch(patch);
		const second = parsed.hunks[1];
		expect(second?.collapsedBefore).toBe(6);
	});
});

describe("parseContractHunks", () => {
	test("builds the parsed model directly from compact contract hunks", () => {
		const parsed = parseContractHunks([
			{
				header: "@@ -1,2 +1,2 @@",
				oldStart: 1,
				oldLines: 2,
				newStart: 1,
				newLines: 2,
				lines: [
					{ kind: "deletion", text: "const value = oldValue;", noNewline: false },
					{ kind: "addition", text: "const value = newValue;", noNewline: false },
					{ kind: "context", text: "return value;", noNewline: false },
				],
			},
			{
				header: "@@ -8 +8 @@",
				oldStart: 8,
				oldLines: 1,
				newStart: 8,
				newLines: 1,
				lines: [
					{ kind: "deletion", text: "const last = false;", noNewline: false },
					{ kind: "addition", text: "const last = true;", noNewline: false },
				],
			},
		]);
		expect(parsed.hunks).toHaveLength(2);
		const second = parsed.hunks[1];
		expect(second?.collapsedBefore).toBe(5);
		expect(second?.deletionStart).toBe(8);
		expect(parsed.deletionLines[0]).toBe("const value = oldValue;\n");
		expect(parsed.additionLines[0]).toBe("const value = newValue;\n");
		expect(parsed.additionLines[1]).toBe("return value;\n");
	});

	test("applies no-newline markers and metadata lines", () => {
		const parsed = parseContractHunks([
			{
				header: "@@ -1 +1 @@",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 1,
				lines: [
					{ kind: "deletion", text: "old", noNewline: true },
					{ kind: "metadata", text: "\\ No newline at end of file", noNewline: false },
					{ kind: "addition", text: "new", noNewline: true },
				],
			},
		]);
		const hunk = parsed.hunks[0];
		expect(hunk?.noEOFCRDeletions).toBe(true);
		expect(hunk?.noEOFCRAdditions).toBe(true);
		expect(parsed.deletionLines[0]).toBe("old");
		expect(parsed.additionLines[0]).toBe("new");
	});
});
