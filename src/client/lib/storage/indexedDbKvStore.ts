import { type DBSchema, type IDBPDatabase, openDB } from "idb";

import type { DisposableKvStore, KvStoreListener } from "./kvStore.ts";

interface CouchviewStorageSchema extends DBSchema {
	values: {
		key: string;
		value: string;
	};
}

export interface IndexedDbKvStoreOptions {
	databaseName?: string;
	channelName?: string;
}

const DEFAULT_DATABASE_NAME = "couchview";
const DATABASE_VERSION = 1;

export function createIndexedDbKvStore(options: IndexedDbKvStoreOptions = {}): DisposableKvStore {
	const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
	const channelName = options.channelName ?? `${databaseName}.kv-changes`;
	const listeners = new Map<string, Set<KvStoreListener>>();
	let databasePromise: Promise<IDBPDatabase<CouchviewStorageSchema>> | null = null;
	let channel: BroadcastChannel | null = null;

	function database(): Promise<IDBPDatabase<CouchviewStorageSchema>> {
		databasePromise ??= openDB<CouchviewStorageSchema>(databaseName, DATABASE_VERSION, {
			upgrade(target) {
				if (!target.objectStoreNames.contains("values")) target.createObjectStore("values");
			},
		});
		return databasePromise;
	}

	function notify(key: string): void {
		for (const listener of listeners.get(key) ?? []) listener();
	}

	function broadcastChannel(): BroadcastChannel | null {
		if (channel || typeof BroadcastChannel === "undefined") return channel;
		channel = new BroadcastChannel(channelName);
		channel.addEventListener("message", (event: MessageEvent<unknown>) => {
			if (typeof event.data === "string") notify(event.data);
		});
		return channel;
	}

	function publish(key: string): void {
		notify(key);
		broadcastChannel()?.postMessage(key);
	}

	return {
		async get(key) {
			return (await database()).get("values", key).then((value) => value ?? null);
		},
		async set(key, value) {
			await (await database()).put("values", value, key);
			publish(key);
		},
		async delete(key) {
			await (await database()).delete("values", key);
			publish(key);
		},
		subscribe(key, listener) {
			const keyListeners = listeners.get(key) ?? new Set<KvStoreListener>();
			keyListeners.add(listener);
			listeners.set(key, keyListeners);
			broadcastChannel();
			return () => {
				keyListeners.delete(listener);
				if (keyListeners.size === 0) listeners.delete(key);
			};
		},
		async close() {
			channel?.close();
			channel = null;
			if (databasePromise) (await databasePromise).close();
			databasePromise = null;
			listeners.clear();
		},
	};
}
