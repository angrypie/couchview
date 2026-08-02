import { describe, expect, test } from "bun:test";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { FileDiff, ReviewComment } from "../shared/contracts.ts";
import {
	adaptFileDiff,
	annotationsForFile,
	commentAnnotation,
	commentAnnotationsVersion,
	fromPierreSide,
	preloadFileDiffRendering,
	reconstructUnifiedPatch,
	selectedRangeFromEndpoints,
	toPierreSide,
} from "./diffAdapter.ts";

function fixtureDiff(overrides: Partial<FileDiff> = {}): FileDiff {
	return {
		fileId: "file-1",
		path: "src/example.ts",
		previousPath: null,
		kind: "modified",
		contentRevision: "revision-1",
		operationRevision: "operation-1",
		binary: false,
		tooLarge: false,
		header: [],
		additions: 1,
		deletions: 1,
		hunks: [
			{
				id: "hunk-1",
				header: "@@ -1,2 +1,2 @@",
				oldStart: 1,
				oldLines: 2,
				newStart: 1,
				newLines: 2,
				lines: [
					{
						id: "old-1",
						kind: "deletion",
						text: "const value = oldValue;",
						oldLine: 1,
						newLine: null,
						noNewline: false,
					},
					{
						id: "new-1",
						kind: "addition",
						text: "const value = newValue;",
						oldLine: null,
						newLine: 1,
						noNewline: false,
					},
					{
						id: "context-2",
						kind: "context",
						text: "return value;",
						oldLine: 2,
						newLine: 2,
						noNewline: false,
					},
				],
			},
		],
		...overrides,
	};
}

function fixtureComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
	return {
		id: "comment-1",
		fileId: "file-1",
		path: "src/example.ts",
		side: "mixed",
		startLine: 1,
		endLine: 2,
		oldStartLine: 1,
		oldEndLine: 2,
		newStartLine: 1,
		newEndLine: 2,
		hunkHeader: "@@ -1,2 +1,2 @@",
		excerpt: ["-old", "+new"],
		body: "Keep this safe.",
		contentRevision: "revision-1",
		stale: false,
		createdAt: "2026-07-21T10:00:00.000Z",
		updatedAt: "2026-07-21T10:00:00.000Z",
		...overrides,
	};
}

describe("Pierre diff adapter", () => {
	test("reconstructs and parses a structured unified diff with a revision cache key", () => {
		const diff = fixtureDiff();
		const patch = reconstructUnifiedPatch(diff);
		expect(patch).toContain("diff --git a/src/example.ts b/src/example.ts");
		expect(patch).toContain("-const value = oldValue;");
		expect(patch).toContain("+const value = newValue;");

		const adapted = adaptFileDiff(diff).fileDiff;
		expect(adapted.name).toBe("src/example.ts");
		expect(adapted.cacheKey).toBe("revision-1");
		expect(adapted.type).toBe("change");
		expect(adapted.hunks).toHaveLength(1);
		expect(adapted.deletionLines[0]).toBe("const value = oldValue;\n");
		expect(adapted.additionLines[0]).toBe("const value = newValue;\n");
	});

	test("reuses parsed diffs and primes Pierre highlighting by content revision", () => {
		const diff = fixtureDiff();
		const primed: FileDiffMetadata[] = [];

		expect(
			preloadFileDiffRendering(diff, {
				primeDiffHighlightCache(fileDiff) {
					primed.push(fileDiff);
				},
			}),
		).toBe(true);
		expect(primed[0]?.cacheKey).toBe(diff.contentRevision);
		expect(adaptFileDiff(diff)).toBe(adaptFileDiff(diff));
	});

	test("renders a full-context patch without replacing compact navigation hunks", () => {
		const secondHunk = {
			id: "hunk-2",
			header: "@@ -8 +8 @@",
			oldStart: 8,
			oldLines: 1,
			newStart: 8,
			newLines: 1,
			lines: [
				{
					id: "old-8",
					kind: "deletion" as const,
					text: "const last = false;",
					oldLine: 8,
					newLine: null,
					noNewline: false,
				},
				{
					id: "new-8",
					kind: "addition" as const,
					text: "const last = true;",
					oldLine: null,
					newLine: 8,
					noNewline: false,
				},
			],
		};
		const fullFilePatch = [
			"diff --git a/src/example.ts b/src/example.ts",
			"--- a/src/example.ts",
			"+++ b/src/example.ts",
			"@@ -1,8 +1,8 @@",
			"-const value = oldValue;",
			"+const value = newValue;",
			" return value;",
			" const middle3 = true;",
			" const middle4 = true;",
			" const middle5 = true;",
			" const middle6 = true;",
			" const middle7 = true;",
			"-const last = false;",
			"+const last = true;",
			"",
		].join("\n");
		const diff = fixtureDiff({
			fullFilePatch,
			hunks: [...fixtureDiff().hunks, secondHunk],
		});

		const adapted = adaptFileDiff(diff);
		expect(adapted.patch).toBe(fullFilePatch);
		expect(adapted.fileDiff.hunks).toHaveLength(1);
		expect(adapted.fileDiff.additionLines).toContain("const middle5 = true;\n");
		expect(diff.hunks).toHaveLength(2);
	});

	test("keeps no-newline metadata exactly once", () => {
		const diff = fixtureDiff({
			hunks: [
				{
					id: "hunk-1",
					header: "@@ -1 +1 @@",
					oldStart: 1,
					oldLines: 1,
					newStart: 1,
					newLines: 1,
					lines: [
						{
							id: "old",
							kind: "deletion",
							text: "old",
							oldLine: 1,
							newLine: null,
							noNewline: true,
						},
						{
							id: "old-marker",
							kind: "metadata",
							text: "\\ No newline at end of file",
							oldLine: null,
							newLine: null,
							noNewline: false,
						},
						{
							id: "new",
							kind: "addition",
							text: "new",
							oldLine: null,
							newLine: 1,
							noNewline: true,
						},
					],
				},
			],
		});
		const patch = reconstructUnifiedPatch(diff);
		expect(patch.match(/No newline at end of file/g)).toHaveLength(2);
		const adapted = adaptFileDiff(diff).fileDiff;
		expect(adapted.hunks[0]?.noEOFCRDeletions).toBe(true);
		expect(adapted.hunks[0]?.noEOFCRAdditions).toBe(true);
	});

	test("handles additions, deletions, renames, and unusual paths", () => {
		const cases: Array<{
			diff: FileDiff;
			expectedType: FileDiffMetadata["type"];
		}> = [
			{
				expectedType: "new",
				diff: fixtureDiff({
					kind: "added",
					path: "src/new file.ts",
					additions: 1,
					deletions: 0,
					hunks: [
						{
							id: "new",
							header: "@@ -0,0 +1 @@",
							oldStart: 0,
							oldLines: 0,
							newStart: 1,
							newLines: 1,
							lines: [
								{
									id: "line",
									kind: "addition",
									text: "export const value = true;",
									oldLine: null,
									newLine: 1,
									noNewline: false,
								},
							],
						},
					],
				}),
			},
			{
				expectedType: "deleted",
				diff: fixtureDiff({ kind: "deleted" }),
			},
			{
				expectedType: "rename-changed",
				diff: fixtureDiff({
					kind: "renamed",
					previousPath: "src/old name.ts",
					path: "src/new name.ts",
				}),
			},
		];

		for (const { diff, expectedType } of cases) {
			const adapted = adaptFileDiff(diff).fileDiff;
			expect(adapted.name).toBe(diff.path);
			expect(adapted.prevName).toBe(diff.previousPath ?? undefined);
			expect(adapted.type).toBe(expectedType);
		}
	});

	test("parses an incomplete truncated hunk and removes the synthetic banner", () => {
		const diff = fixtureDiff({
			tooLarge: true,
			header: [
				"Diff preview truncated at 2 MiB or 20,000 rendered rows.",
				"diff --git a/src/example.ts b/src/example.ts",
				"--- a/src/example.ts",
				"+++ b/src/example.ts",
			],
			hunks: [
				{
					...fixtureDiff().hunks[0]!,
					header: "@@ -1,20 +1,20 @@",
					lines: fixtureDiff().hunks[0]!.lines.slice(0, 2),
				},
			],
		});
		const adapted = adaptFileDiff(diff);
		expect(adapted.patch).not.toContain("Diff preview truncated");
		expect(adapted.fileDiff.hunks).toHaveLength(1);
		expect(adapted.fileDiff.unifiedLineCount).toBe(2);
	});

	test("anchors current comments after their range and prefers the new side for mixed ranges", () => {
		const mixed = fixtureComment();
		expect(commentAnnotation(mixed)).toMatchObject({
			side: "additions",
			lineNumber: 2,
		});
		expect(
			commentAnnotation(fixtureComment({ side: "old", oldEndLine: 7, endLine: 7 })),
		).toMatchObject({ side: "deletions", lineNumber: 7 });
		expect(commentAnnotation(fixtureComment({ stale: true }))).toBeNull();
		expect(
			annotationsForFile([mixed, fixtureComment({ id: "other", fileId: "other-file" })], "file-1"),
		).toHaveLength(1);
		expect(commentAnnotationsVersion([mixed], "file-1", "revision-1")).not.toBe(
			commentAnnotationsVersion([mixed], "file-1", "revision-2"),
		);
	});

	test("round-trips sides and orders mixed selection endpoints by rendered row", () => {
		expect(fromPierreSide(toPierreSide("old"))).toBe("old");
		expect(fromPierreSide(toPierreSide("new"))).toBe("new");
		expect(
			selectedRangeFromEndpoints(
				{ lineNumber: 12, rowIndex: 9, side: "new" },
				{ lineNumber: 8, rowIndex: 3, side: "old" },
			),
		).toEqual({
			start: 8,
			side: "deletions",
			end: 12,
			endSide: "additions",
		});
	});
});
