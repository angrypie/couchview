import { afterEach, describe, expect, test } from "bun:test";
import type { FileDiff } from "../../../../shared/contracts.ts";
import { act, cleanup, fireEvent, render, waitFor } from "../../../appTestEnvironment.tsx";
import type { DiffRow, TokenRun } from "../engine/types.ts";
import { DiffTokenLayer } from "../paint/DiffTokenLayer.ts";
import { createDiffScene } from "../scene/createDiffScene.ts";
import type { DiffSceneLayout } from "../scene/types.ts";
import { DiffRenderSessionStore } from "./DiffRenderSession.ts";

const { LegendDiffSurface } = await import("./LegendDiffSurface.tsx");

afterEach(cleanup);

const layout: DiffSceneLayout = {
	additionIndicatorColor: "#52d091",
	charWidth: 8,
	contentPadding: 6,
	deletionIndicatorBackground: "#321a1e",
	deletionIndicatorColor: "#ff7f85",
	fontFamily: "monospace",
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
	lineWrapEnabled: false,
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

const rows: DiffRow[] = [
	{
		collapsedLines: 0,
		decorations: [],
		hunkIndex: 0,
		hunkSpecs: null,
		id: "line-1",
		kind: "context",
		newLine: 1,
		noNewline: false,
		oldLine: 1,
		text: "const name = value;",
		visualColumns: 19,
	},
	{
		collapsedLines: 0,
		decorations: [],
		hunkIndex: 0,
		hunkSpecs: null,
		id: "line-2",
		kind: "addition",
		newLine: 2,
		noNewline: false,
		oldLine: null,
		text: "return name;",
		visualColumns: 12,
	},
];

const diff: FileDiff = {
	additions: 1,
	binary: false,
	contentRevision: "content-1",
	deletions: 0,
	fileId: "file-1",
	header: [],
	hunks: [
		{
			header: "@@ -1,1 +1,2 @@",
			id: "hunk-1",
			lines: [
				{
					id: "line-1",
					kind: "context",
					newLine: 1,
					noNewline: false,
					oldLine: 1,
					text: "const name = value;",
				},
				{
					id: "line-2",
					kind: "addition",
					newLine: 2,
					noNewline: false,
					oldLine: null,
					text: "return name;",
				},
			],
			newLines: 2,
			newStart: 1,
			oldLines: 1,
			oldStart: 1,
		},
	],
	kind: "modified",
	operationRevision: "operation-1",
	path: "src/file.ts",
	previousPath: null,
	tooLarge: false,
};

function scene(sceneRows: readonly DiffRow[] = rows) {
	return createDiffScene({
		diff,
		generation: "generation-1",
		geometry: {
			availableColumns: 30,
			contentWidth: 300,
			layout,
			rowHeights: sceneRows.map(() => 20),
			rowOffsets: sceneRows.map((_, index) => index * 20),
		},
		layoutRevision: "layout-1",
		repositoryId: "repo-1",
		rows: sceneRows,
		stage: "full",
		themeType: "dark",
		viewport: { height: 20, scale: 2, width: 300 },
	});
}

function identifierRuns(): readonly TokenRun[] {
	return [
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
			color: "#9ab8ef",
			identifier: true,
			italic: false,
			text: "name",
			underline: false,
		},
		{
			backgroundColor: null,
			bold: false,
			color: "#e7edf5",
			identifier: false,
			italic: false,
			text: " = value;",
			underline: false,
		},
	];
}

describe("LegendDiffSurface", () => {
	test("updates one semantic row incrementally and reports its shared coordinates", async () => {
		const tokens = new DiffTokenLayer(rows);
		const session = new DiffRenderSessionStore({ interactive: true, scene: scene(), tokens });
		const activations: Array<{ generation: string; x: number; y: number }> = [];
		const { container, getByRole, getByTestId } = render(
			<LegendDiffSurface
				events={{
					activateAt: (generation, x, y) => activations.push({ generation, x, y }),
					failure: () => undefined,
					ready: () => undefined,
					scrollSettled: () => undefined,
					viewportChanged: () => undefined,
				}}
				session={session}
			/>,
		);

		await waitFor(() => expect(getByTestId("new-line-1")).toBeTruthy());
		const surface = container.querySelector('[data-renderer="legend-list"]');
		const firstRow = getByTestId("new-line-1").closest("[data-line]");
		expect(container.querySelector("[data-identifier]")).toBeNull();

		act(() => tokens.apply(new Map([[0, identifierRuns()]])));
		const identifier = await waitFor(() =>
			expect(getByRole("button", { name: "Find “name” in project" })).toBeTruthy(),
		).then(() => getByRole("button", { name: "Find “name” in project" }));
		expect(container.querySelector('[data-renderer="legend-list"]')).toBe(surface);
		expect(getByTestId("new-line-1").closest("[data-line]")).toBe(firstRow);
		fireEvent.click(identifier);
		expect(activations).toHaveLength(1);
		expect(activations[0]).toMatchObject({ generation: "generation-1", y: 10 });
		expect(activations[0]?.x).toBeGreaterThan(layout.gutterWidth);

		act(() => tokens.finish());
		await waitFor(() =>
			expect(getByTestId("diff-surface-status").dataset.tokenComplete).toBe("true"),
		);
	});
});
