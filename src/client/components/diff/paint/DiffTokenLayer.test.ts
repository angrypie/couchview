import { describe, expect, test } from "bun:test";
import type { DiffRow, TokenRun } from "../engine/types.ts";
import { DiffTokenLayer } from "./DiffTokenLayer.ts";

function row(id: string): DiffRow {
	return {
		collapsedLines: 0,
		decorations: [],
		hunkIndex: 0,
		hunkSpecs: null,
		id,
		kind: "context",
		newLine: 1,
		noNewline: false,
		oldLine: 1,
		text: id,
		visualColumns: id.length,
	};
}

function runs(text: string): readonly TokenRun[] {
	return [
		{
			backgroundColor: null,
			bold: false,
			color: "#fff",
			identifier: false,
			italic: false,
			text,
			underline: false,
		},
	];
}

describe("DiffTokenLayer", () => {
	test("publishes only changed row ranges with stable row token identities", () => {
		const layer = new DiffTokenLayer([row("a"), row("b"), row("c")]);
		const firstRuns = runs("a");
		layer.apply(
			new Map([
				[0, firstRuns],
				[2, runs("c")],
			]),
		);
		const first = layer.read();
		expect(first.runsAt(0)).toBe(firstRuns);
		expect(layer.changesSince(0)).toEqual({
			changedRows: [
				{ end: 1, start: 0 },
				{ end: 3, start: 2 },
			],
			complete: false,
			fromRevision: 0,
			toRevision: 1,
		});

		layer.apply(new Map([[0, firstRuns]]));
		expect(layer.read()).toBe(first);
	});

	test("merges missed deltas and publishes completion once", () => {
		const layer = new DiffTokenLayer([row("a"), row("b"), row("c")]);
		layer.apply(new Map([[0, runs("a")]]));
		layer.apply(new Map([[1, runs("b")]]));
		layer.finish();
		const changes = layer.changesSince(0);
		expect(changes).not.toBe("reset");
		expect(changes).toMatchObject({
			changedRows: [{ end: 2, start: 0 }],
			complete: true,
			fromRevision: 0,
			toRevision: 3,
		});
		const completed = layer.read();
		layer.finish();
		expect(layer.read()).toBe(completed);
	});

	test("resets consumers that fall behind the bounded delta history", () => {
		const layer = new DiffTokenLayer([row("a")]);
		for (let index = 0; index < 40; index += 1) {
			layer.apply(new Map([[0, runs("a")]]));
		}
		expect(layer.changesSince(0)).toBe("reset");
	});

	test("rejects token runs that cannot reproduce their authoritative row", () => {
		const layer = new DiffTokenLayer([row("authoritative")]);
		expect(() => layer.apply(new Map([[0, runs("different")]]))).toThrow(
			"Token runs do not match diff row authoritative.",
		);
		expect(layer.read().revision).toBe(0);
	});
});
