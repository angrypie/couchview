import { afterEach, describe, expect, test } from "bun:test";

import type { FileDiff } from "../../../shared/contracts.ts";
import { cleanup, render, screen } from "../../appTestEnvironment.tsx";

const { default: NativeDiffSurface } = await import("./NativeDiffSurface.tsx");

const diff: FileDiff = {
	fileId: "src/theme.ts",
	path: "src/theme.ts",
	previousPath: null,
	kind: "modified",
	contentRevision: "theme-v2",
	operationRevision: "operation-v2",
	binary: false,
	tooLarge: false,
	header: [],
	hunks: [
		{
			id: "theme-hunk",
			header: "@@ -1 +1 @@",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [
				{
					id: "theme-line",
					kind: "addition",
					text: 'export const theme = "light";',
					oldLine: null,
					newLine: 1,
					noNewline: false,
				},
			],
		},
	],
	additions: 1,
	deletions: 1,
};

afterEach(() => {
	cleanup();
	document.documentElement.removeAttribute("data-resolved-theme");
	document.documentElement.style.removeProperty("color-scheme");
});

describe("native diff theme", () => {
	test("forwards light mode to the diff renderer and document palette", () => {
		render(
			<NativeDiffSurface
				comments={[]}
				diff={diff}
				fontSize={13}
				lineNumbersVisible
				lineWrapEnabled={false}
				onCommentOpen={async () => undefined}
				onLinePress={async () => undefined}
				scrollTarget={null}
				theme="light"
			/>,
		);

		expect(screen.getByTestId("pierre-code-view").getAttribute("data-theme-type")).toBe("light");
		expect(document.documentElement.dataset.resolvedTheme).toBe("light");
		expect(document.documentElement.style.colorScheme).toBe("light");
	});
});
