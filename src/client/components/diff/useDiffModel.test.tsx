import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "../../appTestEnvironment.tsx";
import type { DiffRow } from "./engine/types.ts";
import { useDiffGeometry } from "./useDiffModel.ts";

afterEach(cleanup);

const row: DiffRow = {
	collapsedLines: 0,
	decorations: [],
	hunkIndex: 0,
	hunkSpecs: null,
	id: "line-1",
	kind: "context",
	newLine: 1,
	noNewline: false,
	oldLine: 1,
	text: "x".repeat(120),
	visualColumns: 120,
};

function GeometryProbe({ viewportWidth }: { viewportWidth: number }) {
	const geometry = useDiffGeometry({
		fontFamily: "monospace",
		fontSize: 14,
		lineHeightAdjustment: 0,
		lineNumbersVisible: true,
		lineWrapEnabled: true,
		maxColumns: row.visualColumns,
		maxNumberDigits: 3,
		rows: [row],
		viewportWidth,
		widthAdjustment: 0,
	});
	return (
		<div
			data-available-columns={geometry.availableColumns}
			data-row-height={geometry.rowHeights[0]}
			data-testid="geometry"
		/>
	);
}

describe("diff geometry", () => {
	test("keeps wrapped rows compact until the viewport width is measured", () => {
		const { getByTestId, rerender } = render(<GeometryProbe viewportWidth={0} />);
		const probe = getByTestId("geometry");
		const initialHeight = Number(probe.dataset.rowHeight);

		expect(probe.dataset.availableColumns).toBe("120");
		expect(initialHeight).toBeGreaterThan(0);

		rerender(<GeometryProbe viewportWidth={120} />);
		expect(Number(probe.dataset.availableColumns)).toBeGreaterThan(1);
		expect(Number(probe.dataset.availableColumns)).toBeLessThan(120);
		expect(Number(probe.dataset.rowHeight)).toBeGreaterThan(initialHeight);
	});
});
