import { describe, expect, test } from "bun:test";
import type { DiffRow } from "../engine/types.ts";
import { DiffTokenLayer } from "../paint/DiffTokenLayer.ts";
import type { DiffScene } from "../scene/types.ts";
import { DiffRenderSessionStore } from "./DiffRenderSession.ts";

const rows: DiffRow[] = [
	{
		collapsedLines: 0,
		decorations: [],
		hunkIndex: 0,
		hunkSpecs: null,
		id: "row-1",
		kind: "context",
		newLine: 1,
		noNewline: false,
		oldLine: 1,
		text: "line",
		visualColumns: 4,
	},
];

function scene(generation: string): DiffScene {
	return {
		generation,
		layout: {},
		queries: {},
		rows: [],
		viewport: { height: 600, scale: 1, width: 900 },
	} as unknown as DiffScene;
}

describe("DiffRenderSession", () => {
	test("forwards incremental token changes without replacing the scene", () => {
		const tokens = new DiffTokenLayer(rows);
		const currentScene = scene("generation-1");
		const session = new DiffRenderSessionStore({ interactive: true, scene: currentScene, tokens });
		const cursor = session.read().cursor;
		tokens.apply(
			new Map([
				[
					0,
					[
						{
							backgroundColor: null,
							bold: false,
							color: "#fff",
							identifier: false,
							italic: false,
							text: "line",
							underline: false,
						},
					],
				],
			]),
		);
		expect(session.changesSince(cursor)).toMatchObject({
			changedTokenRows: [{ end: 1, start: 0 }],
			generation: "generation-1",
			sceneReplaced: false,
		});
		expect(session.read().scene).toBe(currentScene);
	});

	test("rejects stale generations and reports same-generation scene replacement", () => {
		const tokens = new DiffTokenLayer(rows);
		const first = scene("generation-1");
		const session = new DiffRenderSessionStore({ interactive: true, scene: first, tokens });
		const cursor = session.read().cursor;
		const replacement = scene("generation-1");
		session.update({ interactive: true, scene: replacement, tokens });
		expect(session.changesSince(cursor)).toMatchObject({ sceneReplaced: true });

		const oldCursor = session.read().cursor;
		session.update({ interactive: true, scene: scene("generation-2"), tokens });
		expect(session.changesSince(oldCursor)).toBe("reset");
	});
});
