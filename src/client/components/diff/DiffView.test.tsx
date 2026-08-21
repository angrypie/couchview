import { afterEach, describe, expect, mock, test } from "bun:test";
import { createRef } from "react";
import type { FileDiff } from "../../../shared/contracts.ts";
import { act, cleanup, render, waitFor } from "../../appTestEnvironment.tsx";
import type { DiffViewerHandle } from "../../features/review/types.ts";

mock.module("./fonts", () => ({
	diffFontFamily: (fontFamily: string) => fontFamily,
	useDiffFontsLoaded: () => true,
}));

const { DiffView } = await import("./DiffView.tsx");

afterEach(cleanup);

function largeFileChange(lineCount: number): FileDiff {
	return {
		fileId: "large-file",
		path: "src/large.txt",
		previousPath: null,
		kind: "modified",
		contentRevision: "large-v1",
		operationRevision: "operation-1",
		binary: false,
		tooLarge: false,
		header: [],
		additions: 0,
		deletions: 0,
		hunks: [
			{
				id: "large-hunk",
				header: `@@ -1,${lineCount} +1,${lineCount} @@`,
				oldStart: 1,
				oldLines: lineCount,
				newStart: 1,
				newLines: lineCount,
				lines: Array.from({ length: lineCount }, (_, index) => ({
					id: `line-${index + 1}`,
					kind: "context" as const,
					text: `line ${index + 1}`,
					oldLine: index + 1,
					newLine: index + 1,
					noNewline: false,
				})),
			},
		],
	};
}

describe("DiffView row surface", () => {
	test("renders the complete scene through a bounded shared Legend List surface", async () => {
		const { container } = render(
			<DiffView
				diff={largeFileChange(150)}
				fontFamily="monospace"
				fontSize={14}
				lineHeightAdjustment={0}
				lineNumbersVisible
				lineWrapEnabled={false}
				onIdentifierClick={() => undefined}
				onVisibleLineChange={() => undefined}
				repositoryId="repo"
				widthAdjustment={0}
			/>,
		);

		await waitFor(() => {
			const mountedRows = container.querySelectorAll('[data-testid^="new-line-"]').length;
			expect(mountedRows).toBeGreaterThan(0);
			expect(mountedRows).toBeLessThan(150);
		});
		expect(container.querySelector('[data-renderer="legend-list"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="diff-full-row-scroll"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="new-line-1"]')).not.toBeNull();
	});

	test("keeps the same virtualized surface mounted while row tokens arrive", async () => {
		const { container } = render(
			<DiffView
				diff={largeFileChange(150)}
				fontFamily="monospace"
				fontSize={14}
				lineHeightAdjustment={0}
				lineNumbersVisible
				lineWrapEnabled={false}
				onIdentifierClick={() => undefined}
				onVisibleLineChange={() => undefined}
				repositoryId="repo"
				widthAdjustment={0}
			/>,
		);

		await waitFor(() =>
			expect(container.querySelector('[data-testid="new-line-1"]')).not.toBeNull(),
		);
		const fullScroll = container.querySelector('[data-testid="diff-full-row-scroll"]');
		const surface = container.querySelector('[data-renderer="legend-list"]');
		await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
		expect(container.querySelector('[data-testid="diff-full-row-scroll"]')).toBe(fullScroll);
		expect(container.querySelector('[data-renderer="legend-list"]')).toBe(surface);
		expect(container.querySelectorAll('[data-testid^="new-line-"]').length).toBeLessThan(150);
	});

	test("jumps to a distant line without materializing intervening rows", async () => {
		const viewerRef = createRef<DiffViewerHandle>();
		const { container } = render(
			<DiffView
				diff={largeFileChange(150)}
				fontFamily="monospace"
				fontSize={14}
				lineHeightAdjustment={0}
				lineNumbersVisible
				lineWrapEnabled={false}
				onIdentifierClick={() => undefined}
				onVisibleLineChange={() => undefined}
				ref={viewerRef}
				repositoryId="repo"
				widthAdjustment={0}
			/>,
		);

		await waitFor(() =>
			expect(container.querySelector('[data-testid="new-line-1"]')).not.toBeNull(),
		);
		act(() =>
			viewerRef.current?.scrollToLine({ behavior: "instant", lineNumber: 150, side: "new" }),
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="new-line-150"]')).not.toBeNull(),
		);
		expect(container.querySelector('[data-testid="new-line-1"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid^="new-line-"]').length).toBeLessThan(150);
	});
});
