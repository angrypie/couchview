import { describe, expect, test } from "bun:test";
import { createStore } from "jotai/vanilla";

import { createMemoryKvStore } from "../../lib/storage/memoryKvStore.ts";
import {
	createPwaInstallDismissalState,
	PWA_INSTALL_DISMISSED_KEY,
} from "./installDismissalState.ts";

describe("PWA install dismissal", () => {
	test("hydrates a previously dismissed install hint through the shared KV seam", async () => {
		const kvStore = createMemoryKvStore({
			[PWA_INSTALL_DISMISSED_KEY]: JSON.stringify(true),
		});
		const dismissalState = createPwaInstallDismissalState(kvStore);
		const store = createStore();

		expect(store.get(dismissalState.valueAtom)).toBe(false);
		expect(store.get(dismissalState.hydratedAtom)).toBe(false);

		await store.set(dismissalState.hydrateAtom);

		expect(store.get(dismissalState.valueAtom)).toBe(true);
		expect(store.get(dismissalState.hydratedAtom)).toBe(true);
	});

	test("persists dismissal writes for the next store instance", async () => {
		const kvStore = createMemoryKvStore();
		const dismissalState = createPwaInstallDismissalState(kvStore);
		const store = createStore();
		await store.set(dismissalState.hydrateAtom);

		await store.set(dismissalState.valueAtom, true);
		expect(await kvStore.get(PWA_INSTALL_DISMISSED_KEY)).toBe(JSON.stringify(true));

		const reloadedState = createPwaInstallDismissalState(kvStore);
		const reloadedStore = createStore();
		await reloadedStore.set(reloadedState.hydrateAtom);
		expect(reloadedStore.get(reloadedState.valueAtom)).toBe(true);
	});
});
