import { describe, expect, test } from "bun:test";

await import("../appTestNativeRuntime.tsx");

const { workspaceLayout } = await import("./mediaQuery.ts");

describe("workspace layout", () => {
	test("keeps portrait phones and tablets in a single workspace pane", () => {
		expect(workspaceLayout(390, 844)).toEqual({
			compactLandscape: false,
			splitView: false,
		});
		expect(workspaceLayout(820, 1180)).toEqual({
			compactLandscape: false,
			splitView: false,
		});
	});

	test("uses compact chrome for short landscape screens", () => {
		expect(workspaceLayout(844, 390)).toEqual({
			compactLandscape: true,
			splitView: false,
		});
	});

	test("uses the persistent split view only when enough width is available", () => {
		expect(workspaceLayout(1024, 768)).toEqual({
			compactLandscape: false,
			splitView: true,
		});
		expect(workspaceLayout(1180, 1300)).toEqual({
			compactLandscape: false,
			splitView: true,
		});
	});
});
