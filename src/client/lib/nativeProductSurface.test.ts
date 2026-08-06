import { describe, expect, test } from "bun:test";

import { isNativeProductSurface } from "./nativeProductSurface.ts";

describe("native product surface marker", () => {
	test("recognizes only the explicit native shell marker", () => {
		expect(isNativeProductSurface("?couchviewNative=1")).toBe(true);
		expect(isNativeProductSurface("?repo=one&couchviewNative=1")).toBe(true);
		expect(isNativeProductSurface("?couchviewNative=0")).toBe(false);
		expect(isNativeProductSurface("")).toBe(false);
	});
});
