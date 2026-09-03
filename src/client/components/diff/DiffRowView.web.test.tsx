import { afterEach, describe, expect, mock, test } from "bun:test";

import { cleanup, fireEvent, render } from "../../appTestEnvironment.tsx";
import type { TokenRun } from "./engine/types.ts";
import type { DiffSceneLayout, DiffSceneRow } from "./scene/types.ts";

const { DiffRowView } = await import("./DiffRowView.web.tsx");

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
	letterSpacing: 0.25,
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

function sceneRow(overrides: Partial<DiffSceneRow> = {}): DiffSceneRow {
	return {
		backgroundColor: layout.lineBackgroundByKind.deletion,
		collapsedLines: 0,
		decorations: [],
		height: layout.lineHeight,
		hunkIndex: 0,
		hunkSpecs: null,
		id: "line-8",
		indicator: "deletion",
		kind: "deletion",
		lineNumber: 8,
		newLine: null,
		noNewline: false,
		numberBackgroundColor: layout.numberCellByKind.deletion,
		numberColor: layout.numberTextByKind.deletion,
		oldLine: 8,
		text: "const name = value;",
		top: 140,
		visualColumns: 19,
		...overrides,
	};
}

function tokenRuns(identifier = "name"): readonly TokenRun[] {
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
			backgroundColor: "#223344",
			bold: true,
			color: "#9ab8ef",
			identifier: true,
			italic: true,
			text: identifier,
			underline: true,
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

describe("DiffRowView web DOM", () => {
	test("preserves colored semantic line geometry and identifier activation", () => {
		const onIdentifierPress = mock((_rowIndex: number, _column: number) => undefined);
		const firstTokens = tokenRuns();
		const { container, getByRole, getByTestId, rerender } = render(
			<DiffRowView
				interactive
				layout={layout}
				onIdentifierPress={onIdentifierPress}
				row={sceneRow()}
				rowIndex={7}
				tokens={firstTokens}
			/>,
		);

		const root = container.firstElementChild as HTMLElement;
		expect(root.tagName).toBe("DIV");
		expect(root.dataset.line).toBe("");
		expect(root.dataset.lineKind).toBe("deletion");
		expect(root.style.height).toBe("20px");
		expect(root.style.width).toBe("100%");
		expect(root.style.backgroundColor).toBe(layout.lineBackgroundByKind.deletion);

		const gutter = root.querySelector<HTMLElement>("[data-column-number]");
		expect(gutter?.style.width).toBe("40px");
		expect(gutter?.style.borderRightWidth).toBe("2px");
		expect(gutter?.style.backgroundColor).toBe(layout.numberCellByKind.deletion);
		expect(getByTestId("old-line-8").textContent).toBe("8");
		expect(getByTestId("old-line-8").style.color).toBe(layout.numberTextByKind.deletion);

		const indicator = gutter?.querySelector("svg");
		const stripes = indicator?.querySelectorAll("rect") ?? [];
		expect(indicator?.getAttribute("height")).toBe("20");
		expect(stripes).toHaveLength(6);
		expect(stripes[0]?.getAttribute("fill")).toBe(layout.deletionIndicatorBackground);
		expect(stripes[1]?.getAttribute("fill")).toBe(layout.deletionIndicatorColor);

		const lineText = root.querySelector<HTMLElement>("[data-line-text]");
		expect(lineText?.tagName).toBe("DIV");
		expect(lineText?.style.whiteSpace).toBe("pre");
		expect(lineText?.style.userSelect).toBe("text");
		expect(lineText?.textContent).toBe(sceneRow().text);
		const tokenElements = lineText?.querySelectorAll(":scope > span") ?? [];
		expect(tokenElements).toHaveLength(3);

		const identifier = getByRole("button", { name: "Find “name” in project" });
		expect(identifier.tagName).toBe("SPAN");
		expect(identifier.dataset.identifier).toBe("");
		expect(identifier.tabIndex).toBe(0);
		expect(identifier.style.color).toBe("#9ab8ef");
		expect(identifier.style.backgroundColor).toBe("#223344");
		expect(identifier.style.fontStyle).toBe("italic");
		expect(identifier.style.fontWeight).toBe("700");
		expect(identifier.style.textDecorationLine).toBe("underline");

		fireEvent.click(identifier);
		fireEvent.keyDown(identifier, { key: "Enter" });
		fireEvent.keyDown(identifier, { key: " " });
		expect(onIdentifierPress.mock.calls).toEqual([
			[7, 6],
			[7, 6],
			[7, 6],
		]);

		const firstTokenElement = tokenElements[0] as HTMLElement;
		const identifierElement = tokenElements[1] as HTMLElement;
		const nextTokens = tokenRuns("item");
		rerender(
			<DiffRowView
				interactive
				layout={layout}
				onIdentifierPress={onIdentifierPress}
				row={sceneRow()}
				rowIndex={7}
				tokens={nextTokens}
			/>,
		);
		const nextElements = container.querySelectorAll("[data-line-text] > span");
		expect(nextElements[0]).toBe(firstTokenElement);
		expect(nextElements[1]).toBe(identifierElement);
		expect(getByRole("button", { name: "Find “item” in project" })).toBe(identifierElement);
	});

	test("preserves addition, no-newline, separator, wrapping, and plain-text contracts", () => {
		const onIdentifierPress = mock((_rowIndex: number, _column: number) => undefined);
		const addition = sceneRow({
			backgroundColor: layout.lineBackgroundByKind.addition,
			id: "line-9",
			indicator: "addition",
			kind: "addition",
			lineNumber: 9,
			newLine: 9,
			numberBackgroundColor: layout.numberCellByKind.addition,
			numberColor: layout.numberTextByKind.addition,
			oldLine: null,
		});
		const { container, getByTestId, rerender } = render(
			<DiffRowView
				interactive={false}
				layout={layout}
				onIdentifierPress={onIdentifierPress}
				row={addition}
				rowIndex={8}
				tokens={tokenRuns()}
			/>,
		);
		expect(getByTestId("new-line-9").textContent).toBe("9");
		expect(container.querySelector("[data-identifier]")).toBeNull();
		const additionIndicator = container.querySelector<HTMLElement>("[data-column-number] > div");
		expect(additionIndicator?.style.backgroundColor).toBe(layout.additionIndicatorColor);

		const noNewline = sceneRow({
			backgroundColor: layout.lineBackgroundByKind.context,
			id: "no-newline",
			indicator: "none",
			kind: "context",
			lineNumber: null,
			newLine: null,
			noNewline: true,
			numberBackgroundColor: layout.numberCellByKind.context,
			numberColor: layout.numberTextByKind.context,
			oldLine: null,
			text: "No newline at end of file",
		});
		rerender(
			<DiffRowView
				interactive
				layout={layout}
				onIdentifierPress={onIdentifierPress}
				row={noNewline}
				rowIndex={9}
				tokens={null}
			/>,
		);
		const noNewlineElement = container.querySelector<HTMLElement>("[data-no-newline]");
		expect(noNewlineElement?.dataset.line).toBeUndefined();
		expect(noNewlineElement?.querySelector("[data-line-text]")).toBeNull();
		expect(noNewlineElement?.textContent).toBe(noNewline.text);
		expect(
			(noNewlineElement?.lastElementChild?.firstElementChild as HTMLElement).style.opacity,
		).toBe("0.6");

		const separator = sceneRow({
			backgroundColor: layout.separatorBackground,
			height: layout.separatorHeight,
			id: "separator",
			indicator: "none",
			kind: "separator",
			lineNumber: null,
			newLine: null,
			numberBackgroundColor: layout.numberCellByKind.context,
			numberColor: layout.numberTextByKind.context,
			oldLine: null,
			text: "@@ -8,2 +8,2 @@",
		});
		rerender(
			<DiffRowView
				interactive
				layout={layout}
				onIdentifierPress={onIdentifierPress}
				row={separator}
				rowIndex={10}
				tokens={null}
			/>,
		);
		const separatorElement = container.querySelector<HTMLElement>("[data-separator]");
		expect(separatorElement?.style.height).toBe("32px");
		expect(separatorElement?.style.backgroundColor).toBe(layout.separatorBackground);
		expect(separatorElement?.textContent).toBe(separator.text);
		expect((separatorElement?.lastElementChild as HTMLElement).style.fontFamily).toBe(
			'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
		);

		const wrappedLayout = { ...layout, lineWrapEnabled: true };
		const context = sceneRow({
			backgroundColor: layout.lineBackgroundByKind.context,
			id: "context",
			indicator: "none",
			kind: "context",
			lineNumber: 10,
			newLine: 10,
			numberBackgroundColor: layout.numberCellByKind.context,
			numberColor: layout.numberTextByKind.context,
			oldLine: 10,
		});
		rerender(
			<DiffRowView
				interactive
				layout={wrappedLayout}
				onIdentifierPress={onIdentifierPress}
				row={context}
				rowIndex={11}
				tokens={null}
			/>,
		);
		const wrappedText = container.querySelector<HTMLElement>("[data-line-text]");
		const wrappedLineNumber = getByTestId("new-line-10");
		expect(wrappedLineNumber.parentElement?.style.flexDirection).toBe("column");
		expect(wrappedLineNumber.parentElement?.style.justifyContent).toBe("flex-start");
		expect(wrappedText?.style.whiteSpace).toBe("pre-wrap");
		expect(wrappedText?.style.wordWrap).toBe("break-word");
		expect(wrappedText?.textContent).toBe(context.text);
	});
});
