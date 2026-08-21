import { describe, expect, test } from "bun:test";
import { createStore } from "jotai/vanilla";

import type { KvStore } from "../storage/kvStore.ts";
import { createMemoryKvStore } from "../storage/memoryKvStore.ts";
import { createPersistedAtom } from "./persistedAtom.ts";

interface TestSettings {
	theme: "dark" | "light";
	density: "comfortable" | "compact";
}

const DEFAULT_SETTINGS: TestSettings = {
	theme: "light",
	density: "comfortable",
};

function normalizeSettings(value: unknown): TestSettings {
	if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
	const candidate = value as Partial<TestSettings>;
	return {
		theme: candidate.theme === "dark" ? "dark" : "light",
		density: candidate.density === "compact" ? "compact" : "comfortable",
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("persisted atoms", () => {
	test("hydrates and writes through a backend-independent KV store", async () => {
		const kvStore = createMemoryKvStore({
			settings: JSON.stringify({ theme: "dark", density: "compact" }),
		});
		const persisted = createPersistedAtom({
			key: "settings",
			initialValue: DEFAULT_SETTINGS,
			kvStore,
			normalize: normalizeSettings,
		});
		const store = createStore();

		expect(store.get(persisted.valueAtom)).toEqual(DEFAULT_SETTINGS);
		expect(store.get(persisted.hydratedAtom)).toBe(false);

		await store.set(persisted.hydrateAtom);
		expect(store.get(persisted.valueAtom)).toEqual({ theme: "dark", density: "compact" });
		expect(store.get(persisted.hydratedAtom)).toBe(true);

		await store.set(persisted.valueAtom, (current) => ({ ...current, theme: "light" }));
		expect(JSON.parse((await kvStore.get("settings")) ?? "null")).toEqual({
			theme: "light",
			density: "compact",
		});
	});

	test("replays updates made during hydration instead of overwriting them", async () => {
		const backingStore = createMemoryKvStore();
		let resolveRead!: (value: string | null) => void;
		const delayedRead = new Promise<string | null>((resolve) => {
			resolveRead = resolve;
		});
		const kvStore: KvStore = {
			...backingStore,
			get: () => delayedRead,
		};
		const persisted = createPersistedAtom({
			key: "settings",
			initialValue: DEFAULT_SETTINGS,
			kvStore,
			normalize: normalizeSettings,
		});
		const store = createStore();

		const hydration = store.set(persisted.hydrateAtom);
		await store.set(persisted.valueAtom, (current) => ({ ...current, theme: "light" }));
		resolveRead(JSON.stringify({ theme: "dark", density: "compact" }));
		await hydration;

		expect(store.get(persisted.valueAtom)).toEqual({
			theme: "light",
			density: "compact",
		});
		expect(store.get(persisted.hydratedAtom)).toBe(true);
		expect(JSON.parse(backingStore.snapshot().get("settings") ?? "null")).toEqual({
			theme: "light",
			density: "compact",
		});
	});

	test("serializes queued writes and leaves the newest value in storage", async () => {
		const backingStore = createMemoryKvStore();
		const firstWriteStarted = deferred<void>();
		const releaseFirstWrite = deferred<void>();
		const writes: TestSettings[] = [];
		const kvStore: KvStore = {
			...backingStore,
			async set(key, value) {
				writes.push(JSON.parse(value) as TestSettings);
				if (writes.length === 1) {
					firstWriteStarted.resolve();
					await releaseFirstWrite.promise;
				}
				await backingStore.set(key, value);
			},
		};
		const persisted = createPersistedAtom({
			key: "settings",
			initialValue: DEFAULT_SETTINGS,
			kvStore,
			normalize: normalizeSettings,
		});
		const store = createStore();
		await store.set(persisted.hydrateAtom);

		const firstWrite = store.set(persisted.valueAtom, { theme: "dark", density: "comfortable" });
		const secondWrite = store.set(persisted.valueAtom, { theme: "dark", density: "compact" });
		await firstWriteStarted.promise;
		expect(writes).toEqual([{ theme: "dark", density: "comfortable" }]);

		releaseFirstWrite.resolve();
		await Promise.all([firstWrite, secondWrite]);
		expect(writes).toEqual([
			{ theme: "dark", density: "comfortable" },
			{ theme: "dark", density: "compact" },
		]);
		expect(JSON.parse(backingStore.snapshot().get("settings") ?? "null")).toEqual({
			theme: "dark",
			density: "compact",
		});
	});

	test("surfaces read and write errors while allowing later persistence to recover", async () => {
		const backingStore = createMemoryKvStore();
		const readFailure = new Error("settings read failed");
		const unreadableStore: KvStore = {
			...backingStore,
			get: async () => {
				throw readFailure;
			},
		};
		const unreadable = createPersistedAtom({
			key: "settings",
			initialValue: DEFAULT_SETTINGS,
			kvStore: unreadableStore,
			normalize: normalizeSettings,
		});
		const readStore = createStore();

		await readStore.set(unreadable.hydrateAtom);
		expect(readStore.get(unreadable.hydratedAtom)).toBe(true);
		expect(readStore.get(unreadable.valueAtom)).toEqual(DEFAULT_SETTINGS);
		expect(readStore.get(unreadable.errorAtom)).toBe(readFailure);

		let rejectWrite = true;
		const writeFailure = new Error("settings write failed");
		const writableStore: KvStore = {
			...backingStore,
			async set(key, value) {
				if (rejectWrite) throw writeFailure;
				await backingStore.set(key, value);
			},
		};
		const writable = createPersistedAtom({
			key: "settings",
			initialValue: DEFAULT_SETTINGS,
			kvStore: writableStore,
			normalize: normalizeSettings,
		});
		const writeStore = createStore();
		await writeStore.set(writable.hydrateAtom);

		await expect(
			writeStore.set(writable.valueAtom, { theme: "dark", density: "comfortable" }),
		).rejects.toThrow("settings write failed");
		expect(writeStore.get(writable.valueAtom)).toEqual({
			theme: "dark",
			density: "comfortable",
		});
		expect(writeStore.get(writable.errorAtom)).toBe(writeFailure);

		rejectWrite = false;
		await writeStore.set(writable.valueAtom, { theme: "dark", density: "compact" });
		expect(writeStore.get(writable.errorAtom)).toBeNull();
		expect(JSON.parse(backingStore.snapshot().get("settings") ?? "null")).toEqual({
			theme: "dark",
			density: "compact",
		});
	});

	test("ignores a stale refresh that resolves after a local write", async () => {
		const backingStore = createMemoryKvStore({
			settings: JSON.stringify(DEFAULT_SETTINGS),
		});
		const staleRefresh = deferred<string | null>();
		let readCount = 0;
		const kvStore: KvStore = {
			...backingStore,
			get: async (key) => {
				readCount += 1;
				return readCount === 1 ? backingStore.get(key) : staleRefresh.promise;
			},
		};
		const persisted = createPersistedAtom({
			key: "settings",
			initialValue: DEFAULT_SETTINGS,
			kvStore,
			normalize: normalizeSettings,
		});
		const store = createStore();
		await store.set(persisted.hydrateAtom);

		const refresh = store.set(persisted.refreshAtom);
		await Promise.resolve();
		expect(readCount).toBe(2);
		await store.set(persisted.valueAtom, { theme: "dark", density: "comfortable" });
		staleRefresh.resolve(JSON.stringify({ theme: "light", density: "compact" }));
		await refresh;

		expect(store.get(persisted.valueAtom)).toEqual({
			theme: "dark",
			density: "comfortable",
		});
		expect(store.get(persisted.errorAtom)).toBeNull();
	});
});
