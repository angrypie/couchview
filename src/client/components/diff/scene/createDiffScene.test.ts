import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../../../../shared/contracts.ts";
import type { DiffRow, TokenRun } from "../engine/types.ts";
import { createDiffScene } from "./createDiffScene.ts";
import type { DiffSceneLayout } from "./types.ts";

const layout: DiffSceneLayout = {
	additionIndicatorColor: "#52d091",
	charWidth: 8,
	contentPadding: 6,
	deletionIndicatorBackground: "#321a1e",
	deletionIndicatorColor: "#ff7f85",
	fontFamily: "Iosevka",
	fontSize: 14,
	gutterBorderWidth: 2,
	gutterPadding: 4,
	gutterWidth: 40,
	letterSpacing: 0,
	lineBackgroundByKind: {
		addition: "#112b22",
		context: "#131820",
		deletion: "#321a1e",
	},
	lineHeight: 20,
	lineNumbersVisible: true,
	lineWrapEnabled: true,
	numberCellByKind: {
		addition: "#10261f",
		context: "#11161e",
		deletion: "#2b181c",
	},
	numberTextByKind: {
		addition: "#52d091",
		context: "#718096",
		deletion: "#ff7f85",
	},
	rowBackground: "#0d1014",
	separatorBackground: "#17243a",
	separatorHeight: 32,
	separatorTextColor: "#9ab8ef",
	textColor: "#e7edf5",
};

const diff: FileDiff = {
	additions: 1,
	binary: false,
	contentRevision: "content-1",
	deletions: 1,
	fileId: "file-1",
	header: [],
	hunks: [
		{
			header: "@@ -7,1 +7,2 @@",
			id: "hunk-1",
			lines: [
				{
					id: "old-7",
					kind: "deletion",
					newLine: null,
					noNewline: false,
					oldLine: 7,
					text: "oldName",
				},
				{
					id: "new-7",
					kind: "addition",
					newLine: 7,
					noNewline: false,
					oldLine: null,
					text: "012345678901name",
				},
			],
			newLines: 2,
			newStart: 7,
			oldLines: 1,
			oldStart: 7,
		},
	],
	kind: "modified",
	operationRevision: "operation-1",
	path: "src/file.ts",
	previousPath: null,
	tooLarge: false,
};

const rows: DiffRow[] = [
	{
		collapsedLines: 0,
		decorations: [],
		hunkIndex: 0,
		hunkSpecs: null,
		id: "old-7",
		kind: "deletion",
		newLine: null,
		noNewline: false,
		oldLine: 7,
		text: "oldName",
		visualColumns: 7,
	},
	{
		collapsedLines: 0,
		decorations: [],
		hunkIndex: 0,
		hunkSpecs: null,
		id: "new-7",
		kind: "addition",
		newLine: 7,
		noNewline: false,
		oldLine: null,
		text: "012345678901name",
		visualColumns: 16,
	},
];

function scene() {
	return createDiffScene({
		diff,
		generation: "generation-1",
		geometry: {
			availableColumns: 10,
			contentWidth: 126,
			layout,
			rowHeights: [20, 40],
			rowOffsets: [0, 20],
		},
		layoutRevision: "layout-1",
		repositoryId: "repo-1",
		rows,
		stage: "full",
		themeType: "dark",
		viewport: { height: 60, scale: 3, width: 126 },
	});
}

describe("diff semantic scene", () => {
	test("resolves row geometry and visual roles once", () => {
		const result = scene();
		expect(result.contentSize).toEqual({ height: 60, width: 126 });
		expect(result.rows[0]).toMatchObject({
			backgroundColor: "#321a1e",
			height: 20,
			indicator: "deletion",
			lineNumber: 7,
			top: 0,
		});
		expect(result.rows[1]).toMatchObject({
			backgroundColor: "#112b22",
			height: 40,
			indicator: "addition",
			lineNumber: 7,
			top: 20,
		});
	});

	test("owns visible-line and navigation decisions", () => {
		const result = scene();
		expect(result.queries.visibleLineAt(0)).toEqual({ lineNumber: 7, side: "old" });
		expect(result.queries.visibleLineAt(20)).toEqual({ lineNumber: 7, side: "new" });
		expect(result.queries.offsetForLine({ align: "center", lineNumber: 7, side: "new" }, 40)).toBe(
			20,
		);
		expect(result.queries.offsetForHunk(0, 40)).toBe(0);
	});

	test("resolves wrapped identifier coordinates through shared token geometry", () => {
		const result = scene();
		const tokenRuns: readonly TokenRun[] = [
			{
				backgroundColor: null,
				bold: false,
				color: "#e7edf5",
				identifier: false,
				italic: false,
				text: "012345678901",
				underline: false,
			},
			{
				backgroundColor: null,
				bold: false,
				color: "#e7edf5",
				identifier: true,
				italic: false,
				text: "name",
				underline: false,
			},
		];
		const tokens = { runsAt: (index: number) => (index === 1 ? tokenRuns : null) };
		const point = result.queries.pointForColumn(1, 13);
		expect(point).not.toBeNull();
		expect(result.queries.identifierAt(point ?? { x: 0, y: 0 }, tokens)).toBe("name");
		expect(result.queries.identifierAt({ x: 50, y: 5 }, tokens)).toBeNull();
		expect(result.queries.identifierAt({ x: 45, y: 30 }, tokens)).toBeNull();
		expect(result.queries.identifierAt({ x: 200, y: 25 }, tokens)).toBeNull();
		expect(result.queries.identifierAt({ x: 60, y: -1 }, tokens)).toBeNull();
		expect(result.queries.identifierAt({ x: 60, y: 61 }, tokens)).toBeNull();
	});

	test("uses the same UTF-16 columns for Unicode token activation", () => {
		const unicodeRows = [{ ...rows[0]!, text: "const café", visualColumns: 10 }];
		const result = createDiffScene({
			diff,
			generation: "unicode",
			geometry: {
				availableColumns: 20,
				contentWidth: 206,
				layout: { ...layout, lineWrapEnabled: false },
				rowHeights: [20],
				rowOffsets: [0],
			},
			layoutRevision: "unicode-layout",
			repositoryId: "repo-1",
			rows: unicodeRows,
			stage: "full",
			themeType: "dark",
			viewport: { height: 20, scale: 3, width: 206 },
		});
		const point = result.queries.pointForColumn(0, 7);
		expect(
			result.queries.identifierAt(point ?? { x: 0, y: 0 }, {
				runsAt: () => [
					{
						backgroundColor: null,
						bold: false,
						color: "#e7edf5",
						identifier: false,
						italic: false,
						text: "const ",
						underline: false,
					},
					{
						backgroundColor: null,
						bold: false,
						color: "#e7edf5",
						identifier: true,
						italic: false,
						text: "café",
						underline: false,
					},
				],
			}),
		).toBe("café");
	});

	test("never activates tokens through separator rows", () => {
		const result = createDiffScene({
			diff,
			generation: "separator",
			geometry: {
				availableColumns: 20,
				contentWidth: 206,
				layout,
				rowHeights: [32],
				rowOffsets: [0],
			},
			layoutRevision: "separator-layout",
			repositoryId: "repo-1",
			rows: [
				{
					...rows[0]!,
					hunkSpecs: "@@ -7 +7 @@",
					kind: "separator",
					newLine: null,
					oldLine: null,
					text: "@@ -7 +7 @@",
				},
			],
			stage: "full",
			themeType: "dark",
			viewport: { height: 32, scale: 3, width: 206 },
		});
		expect(result.queries.identifierAt({ x: 80, y: 10 }, { runsAt: () => [] })).toBeNull();
	});

	test("rejects non-contiguous scene geometry before an Adapter receives it", () => {
		expect(() =>
			createDiffScene({
				diff,
				generation: "invalid",
				geometry: {
					availableColumns: 10,
					contentWidth: 126,
					layout,
					rowHeights: [20, 40],
					rowOffsets: [0, 21],
				},
				layoutRevision: "invalid-layout",
				repositoryId: "repo-1",
				rows,
				stage: "full",
				themeType: "dark",
				viewport: { height: 60, scale: 3, width: 126 },
			}),
		).toThrow("Diff scene row 1 is not contiguous.");
	});
});
