import type { KvStore, KvStoreListener } from "./kvStore.ts";

export interface MemoryKvStore extends KvStore {
	snapshot(): ReadonlyMap<string, string>;
}

export function createMemoryKvStore(
	initialValues: Readonly<Record<string, string>> = {},
): MemoryKvStore {
	const values = new Map(Object.entries(initialValues));
	const listeners = new Map<string, Set<KvStoreListener>>();

	function notify(key: string): void {
		for (const listener of listeners.get(key) ?? []) listener();
	}

	return {
		async get(key) {
			return values.get(key) ?? null;
		},
		async set(key, value) {
			values.set(key, value);
			notify(key);
		},
		async delete(key) {
			values.delete(key);
			notify(key);
		},
		subscribe(key, listener) {
			const keyListeners = listeners.get(key) ?? new Set<KvStoreListener>();
			keyListeners.add(listener);
			listeners.set(key, keyListeners);
			return () => {
				keyListeners.delete(listener);
				if (keyListeners.size === 0) listeners.delete(key);
			};
		},
		snapshot() {
			return new Map(values);
		},
	};
}
