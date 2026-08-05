import { describe, expect, test } from "bun:test";

import { selectWorkbenchLayout } from "./workbenchLayout.ts";

describe("adaptive workbench layout", () => {
	test("keeps phones compact in portrait and landscape", () => {
		expect(selectWorkbenchLayout(390, 844)).toBe("compact");
		expect(selectWorkbenchLayout(844, 390)).toBe("compact");
	});

	test("uses persistent rails on tablets and a context panel only on desktops", () => {
		expect(selectWorkbenchLayout(820, 1180)).toBe("rail");
		expect(selectWorkbenchLayout(1180, 820)).toBe("contextual");
		expect(selectWorkbenchLayout(1440, 900)).toBe("contextual");
	});
});
