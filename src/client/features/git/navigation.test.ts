import { describe, expect, test } from "bun:test";

import { GIT_HISTORY_PATH, isGitHistoryPath } from "./navigation.ts";

describe("Git history navigation", () => {
	test("classifies an explicit pathname without browser state", () => {
		const requiresExplicitPathname: Parameters<typeof isGitHistoryPath> extends [string]
			? true
			: false = true;

		expect(requiresExplicitPathname).toBe(true);
		expect(isGitHistoryPath(GIT_HISTORY_PATH)).toBe(true);
		expect(isGitHistoryPath(`${GIT_HISTORY_PATH}/`)).toBe(true);
		expect(isGitHistoryPath("/")).toBe(false);
		expect(isGitHistoryPath("/history/commit-id")).toBe(false);
	});
});
