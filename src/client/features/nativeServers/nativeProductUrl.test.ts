import { describe, expect, test } from "bun:test";

import { nativeProductUrl } from "./nativeProductUrl.ts";

describe("native product URL", () => {
	test("opens the shared review surface at the paired origin", () => {
		expect(nativeProductUrl("http://192.168.1.60:4173", "review", "repo/a b")).toBe(
			"http://192.168.1.60:4173/?couchviewNative=1&repo=repo%2Fa+b",
		);
	});

	test("deep-links shared product pages without inventing a second API origin", () => {
		expect(nativeProductUrl("https://couchview.example", "history", null)).toBe(
			"https://couchview.example/history?couchviewNative=1",
		);
		expect(nativeProductUrl("https://couchview.example", "artifacts", "repo-1")).toBe(
			"https://couchview.example/artifacts?couchviewNative=1&repo=repo-1",
		);
	});
});
