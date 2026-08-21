import { createMMKV, type MMKV } from "react-native-mmkv";

import type { KvStore } from "./kvStore.ts";

export interface MmkvKvStoreOptions {
	id?: string;
}

export function createMmkvKvStore(storage: MMKV): KvStore {
	return {
		async get(key) {
			return storage.getString(key) ?? null;
		},
		async set(key, value) {
			storage.set(key, value);
		},
		async delete(key) {
			storage.remove(key);
		},
		subscribe(key, listener) {
			const subscription = storage.addOnValueChangedListener((changedKey) => {
				if (changedKey === key) listener();
			});
			return () => subscription.remove();
		},
	};
}

export function createCouchviewMmkvKvStore(options: MmkvKvStoreOptions = {}): KvStore {
	return createMmkvKvStore(createMMKV({ id: options.id ?? "couchview" }));
}
