import { describe, expect, test } from "bun:test";

import { createFuzzyQuickPick, fuzzyQuickPick } from "./fuzzyQuickPick.ts";

interface Item {
	id: string;
	searchText: string;
}

const searchText = (item: Item) => item.searchText;

describe("fuzzyQuickPick", () => {
	test("ranks generic items by their supplied searchable text", () => {
		const items: Item[] = [
			{ id: "prefixed", searchText: "x alpha docs" },
			{ id: "exact", searchText: "alpha" },
			{ id: "longer", searchText: "alphabet soup" },
			{ id: "unmatched", searchText: "miscellaneous" },
		];

		expect(fuzzyQuickPick(items, "alpha", searchText).map((item) => item.id)).toEqual([
			"exact",
			"prefixed",
			"longer",
		]);
	});

	test("preserves original order for empty and non-searchable queries", () => {
		const items: Item[] = [
			{ id: "first", searchText: "zulu" },
			{ id: "second", searchText: "alpha" },
			{ id: "third", searchText: "bravo" },
		];

		const empty = fuzzyQuickPick(items, "   ", searchText);
		const punctuation = fuzzyQuickPick(items, "!!!", searchText);
		const unmatched = fuzzyQuickPick(items, "qux", searchText);

		expect(empty).toEqual(items);
		expect(punctuation).toEqual(items);
		expect(empty).not.toBe(items);
		expect(punctuation).not.toBe(items);
		expect(unmatched).toEqual([]);
	});

	test("fuzzily matches Unicode names and paths", () => {
		const items: Item[] = [
			{ id: "latin", searchText: "Café tools / dépôt" },
			{ id: "cyrillic", searchText: "Проект Альфа / исходники" },
			{ id: "cjk", searchText: "項目/設定" },
		];

		expect(fuzzyQuickPick(items, "cafe", searchText).map((item) => item.id)).toEqual(["latin"]);
		expect(fuzzyQuickPick(items, "прк", searchText).map((item) => item.id)).toEqual(["cyrillic"]);
		expect(fuzzyQuickPick(items, "項設", searchText).map((item) => item.id)).toEqual(["cjk"]);
	});

	test("prefers dense filename matches over characters scattered across directories", () => {
		const items: Item[] = [
			{
				id: "scattered",
				searchText: "apps/native/src/app/conversations/[id].tsx",
			},
			{
				id: "filename",
				searchText: "apps/native/src/features/audio/transcription.ios.ts",
			},
		];
		const index = createFuzzyQuickPick(items, searchText, { scheme: "path" });

		expect(index.search("trans ios").map((item) => item.id)).toEqual(["filename", "scattered"]);
		expect(index.search("ios trans")[0]?.id).toBe("filename");
	});

	test("ranks every matching path instead of falling back to catalogue order above 1,000 matches", () => {
		const decoys: Item[] = Array.from({ length: 1_001 }, (_, index) => ({
			id: `decoy-${index}`,
			searchText: `src/transitions/${index}/icons.ts`,
		}));
		const target: Item = {
			id: "target",
			searchText: "apps/native/src/features/audio/transcription.ios.ts",
		};
		const index = createFuzzyQuickPick([...decoys, target], searchText, { scheme: "path" });

		expect(index.search("trans ios", 1)).toEqual([target]);
	});

	test("uses directory terms without sacrificing a dense Unicode filename match", () => {
		const items: Item[] = [
			{ id: "other", searchText: "src/項目/設定/画面.ts" },
			{ id: "target", searchText: "src/項目/設定画面.ts" },
		];
		const index = createFuzzyQuickPick(items, searchText, { scheme: "path" });

		expect(index.search("項 設画", 1).map((item) => item.id)).toEqual(["target"]);
	});

	test("caps results without mutating the input", () => {
		const items = Object.freeze([
			Object.freeze({ id: "first", searchText: "alpha" }),
			Object.freeze({ id: "second", searchText: "alphabet" }),
			Object.freeze({ id: "third", searchText: "alphanumeric" }),
		]);
		const before = structuredClone(items);

		const result = fuzzyQuickPick(items, "alp", searchText, 2);

		expect(result).toHaveLength(2);
		expect(items).toEqual(before);
		expect(result).not.toBe(items);
	});

	test("normalizes a large catalog once across repeated searches", () => {
		const items = Array.from({ length: 50_000 }, (_, index) => ({
			id: String(index),
			searchText: `src/components/item-${index}.tsx`,
		}));
		let reads = 0;
		const index = createFuzzyQuickPick(items, (item) => {
			reads += 1;
			return item.searchText;
		});

		expect(index.search("s", 200)).toHaveLength(200);
		expect(index.search("cmp", 200)).toHaveLength(200);
		expect(reads).toBe(items.length);
	});
});
