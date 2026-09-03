import { describe, expect, test } from "bun:test";

import { absoluteReviewUrl, parseReviewLocation, reviewLocationParams } from "./reviewRoute.ts";

describe("review routes", () => {
	test("parses valid semantic locations and rejects malformed line state", () => {
		expect(parseReviewLocation("src/space name.ts", "42", "old")).toEqual({
			anchor: { line: 42, side: "old" },
			path: "src/space name.ts",
		});
		expect(parseReviewLocation("src/one.ts", "0", "old")).toEqual({
			anchor: null,
			path: "src/one.ts",
		});
		expect(parseReviewLocation(null, "42", "new")).toBeNull();
	});

	test("builds an encoded absolute link for the same Couchview server", () => {
		const location = { anchor: { line: 9, side: "new" as const }, path: "src/über file.ts" };
		expect(reviewLocationParams(location)).toEqual({
			file: "src/über file.ts",
			line: "9",
			side: "new",
		});
		expect(absoluteReviewUrl("https://review.example.test/base", "repo/id", location)).toBe(
			"https://review.example.test/?repo=repo%2Fid&file=src%2F%C3%BCber+file.ts&line=9&side=new",
		);
	});
});
