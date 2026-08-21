import { describe, expect, test } from "bun:test";

import { createMemoryKvStore } from "./memoryKvStore.ts";

describe("memory KV store", () => {
	test("implements the shared persistence and subscription contract", async () => {
		const store = createMemoryKvStore({ existing: "one" });
		const changes: string[] = [];
		const unsubscribe = store.subscribe("existing", () => changes.push("existing"));

		expect(await store.get("existing")).toBe("one");
		expect(await store.get("missing")).toBeNull();

		await store.set("existing", "two");
		await store.set("other", "ignored");
		expect(changes).toEqual(["existing"]);
		expect(store.snapshot()).toEqual(
			new Map([
				["existing", "two"],
				["other", "ignored"],
			]),
		);

		await store.delete("existing");
		expect(await store.get("existing")).toBeNull();
		expect(changes).toEqual(["existing", "existing"]);

		unsubscribe();
		await store.set("existing", "three");
		expect(changes).toEqual(["existing", "existing"]);
	});
});
