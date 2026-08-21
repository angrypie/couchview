import { describe, expect, test } from "bun:test";

import { waitForDelay } from "./waitForDelay.ts";

describe("waitForDelay", () => {
	test("resolves with the platform timer globals", async () => {
		await expect(waitForDelay(0, new AbortController().signal)).resolves.toBeUndefined();
	});

	test("cancels a pending delay when aborted", async () => {
		const controller = new AbortController();
		const pending = waitForDelay(10_000, controller.signal);

		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});
});
