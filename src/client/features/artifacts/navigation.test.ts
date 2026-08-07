import { describe, expect, test } from "bun:test";

import { ARTIFACTS_PATH, isArtifactsPath } from "./navigation.ts";

describe("artifact navigation", () => {
	test("classifies an explicit pathname without browser state", () => {
		const requiresExplicitPathname: Parameters<typeof isArtifactsPath> extends [string]
			? true
			: false = true;

		expect(requiresExplicitPathname).toBe(true);
		expect(isArtifactsPath(ARTIFACTS_PATH)).toBe(true);
		expect(isArtifactsPath(`${ARTIFACTS_PATH}/`)).toBe(true);
		expect(isArtifactsPath("/")).toBe(false);
		expect(isArtifactsPath("/artifacts/build-1")).toBe(false);
	});
});
