import { describe, expect, test } from "bun:test";
import { buildRowMetrics, SEPARATOR_ROW_HEIGHT } from "./metrics.ts";
import { buildDiffRows } from "./rows.ts";
import type { DiffRow } from "./types.ts";

function rows(): DiffRow[] {
	return [
		{
			id: "r0",
			kind: "context",
			text: "line one",
			oldLine: 1,
			newLine: 1,
			hunkIndex: 0,
			hunkSpecs: null,
			collapsedLines: 0,
			noNewline: false,
			decorations: [],
			visualColumns: 8,
		},
		{
			id: "r1",
			kind: "separator",
			text: "@@ -2 +2 @@",
			oldLine: null,
			newLine: null,
			hunkIndex: 1,
			hunkSpecs: "@@ -2 +2 @@",
			collapsedLines: 3,
			noNewline: false,
			decorations: [],
			visualColumns: 11,
		},
		{
			id: "r2",
			kind: "addition",
			text: "added",
			oldLine: null,
			newLine: 2,
			hunkIndex: 1,
			hunkSpecs: null,
			collapsedLines: 0,
			noNewline: false,
			decorations: [],
			visualColumns: 5,
		},
	];
}

describe("buildRowMetrics", () => {
	test("computes fixed heights, offsets, and lookups", () => {
		const metrics = buildRowMetrics(rows(), 20);
		expect(metrics.heights).toEqual([20, SEPARATOR_ROW_HEIGHT, 20]);
		expect(metrics.prefixOffsets).toEqual([0, 20, 52]);
		expect(metrics.totalHeight).toBe(72);
		expect(metrics.maxColumns).toBe(8);
		expect(metrics.maxNumberDigits).toBe(1);
		expect(metrics.firstRowByLineNumber.get("new:1")).toBe(0);
		expect(metrics.firstRowByLineNumber.get("new:2")).toBe(2);
		expect(metrics.firstRowByHunkIndex.get(1)).toBe(1);
	});

	test("tracks digits of the widest line number", () => {
		const withBigNumbers = rows().map((row) =>
			row.kind === "context" ? { ...row, oldLine: 1234, newLine: 1234 } : row,
		);
		expect(buildRowMetrics(withBigNumbers, 20).maxNumberDigits).toBe(4);
	});

	test("buildDiffRows metrics cover every row", () => {
		const built = buildDiffRows({
			name: "f.ts",
			type: "change",
			isPartial: true,
			unifiedLineCount: 2,
			splitLineCount: 2,
			hunks: [],
			deletionLines: [],
			additionLines: [],
		});
		expect(built).toEqual([]);
	});
});
