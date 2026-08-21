import { useSetAtom } from "jotai/react";
import { type Atom, atom, type WritableAtom } from "jotai/vanilla";
import { useEffect } from "react";

import type { KvStore } from "../storage/kvStore.ts";

export type PersistedAtomUpdate<Value> = Value | ((current: Value) => Value);

interface PersistedState<Value> {
	value: Value;
	hydrated: boolean;
	hydrating: boolean;
	revision: number;
	pendingWrites: number;
	pendingUpdates: PersistedAtomUpdate<Value>[];
	error: Error | null;
}

export interface PersistedAtom<Value> {
	valueAtom: WritableAtom<Value, [PersistedAtomUpdate<Value>], Promise<void>>;
	hydratedAtom: Atom<boolean>;
	errorAtom: Atom<Error | null>;
	hydrateAtom: WritableAtom<null, [], Promise<void>>;
	refreshAtom: WritableAtom<null, [], Promise<void>>;
	subscribe(listener: () => void): () => void;
}

export interface PersistedAtomOptions<Value> {
	key: string;
	initialValue: Value;
	kvStore: KvStore;
	normalize(value: unknown): Value;
}

function errorFrom(error: unknown): Error {
	return error instanceof Error ? error : new Error("The persisted value could not be stored");
}

function resolveUpdate<Value>(update: PersistedAtomUpdate<Value>, current: Value): Value {
	return typeof update === "function" ? (update as (value: Value) => Value)(current) : update;
}

function decodeValue<Value>(
	serialized: string | null,
	initialValue: Value,
	normalize: (value: unknown) => Value,
): Value {
	if (serialized === null) return initialValue;
	try {
		return normalize(JSON.parse(serialized));
	} catch {
		return initialValue;
	}
}

export function createPersistedAtom<Value>(
	options: PersistedAtomOptions<Value>,
): PersistedAtom<Value> {
	const { initialValue, key, kvStore, normalize } = options;
	const stateAtom = atom<PersistedState<Value>>({
		value: initialValue,
		hydrated: false,
		hydrating: false,
		revision: 0,
		pendingWrites: 0,
		pendingUpdates: [],
		error: null,
	});
	const writeQueueAtom = atom<Promise<void>>(Promise.resolve());

	const persistAtom = atom(null, async (get, set, value: Value) => {
		set(stateAtom, (current) => ({ ...current, pendingWrites: current.pendingWrites + 1 }));
		const write = get(writeQueueAtom)
			.catch(() => undefined)
			.then(() => kvStore.set(key, JSON.stringify(value)));
		set(
			writeQueueAtom,
			write.catch(() => undefined),
		);
		try {
			await write;
			set(stateAtom, (current) => ({
				...current,
				pendingWrites: current.pendingWrites - 1,
				error: null,
			}));
		} catch (error) {
			const persistenceError = errorFrom(error);
			set(stateAtom, (current) => ({
				...current,
				pendingWrites: current.pendingWrites - 1,
				error: persistenceError,
			}));
			throw persistenceError;
		}
	});

	const valueAtom = atom(
		(get) => get(stateAtom).value,
		async (get, set, update: PersistedAtomUpdate<Value>) => {
			const current = get(stateAtom);
			const value = resolveUpdate(update, current.value);
			set(stateAtom, {
				...current,
				value,
				revision: current.revision + 1,
				error: null,
				pendingUpdates: current.hydrated
					? current.pendingUpdates
					: [...current.pendingUpdates, update],
			});
			if (current.hydrated) await set(persistAtom, value);
		},
	);

	const hydrateAtom = atom(null, async (get, set) => {
		const startingState = get(stateAtom);
		if (startingState.hydrated || startingState.hydrating) return;
		set(stateAtom, { ...startingState, hydrating: true, error: null });

		let storedValue: Value;
		try {
			storedValue = decodeValue(await kvStore.get(key), initialValue, normalize);
		} catch (error) {
			const latest = get(stateAtom);
			const readError = errorFrom(error);
			set(stateAtom, {
				...latest,
				hydrated: true,
				hydrating: false,
				pendingUpdates: [],
				error: readError,
			});
			if (latest.pendingUpdates.length > 0) await set(persistAtom, latest.value);
			return;
		}

		const latest = get(stateAtom);
		if (latest.hydrated) return;
		const value = latest.pendingUpdates.reduce<Value>(
			(current, update) => resolveUpdate(update, current),
			storedValue,
		);
		const shouldPersist = latest.pendingUpdates.length > 0;
		set(stateAtom, {
			...latest,
			value,
			hydrated: true,
			hydrating: false,
			pendingUpdates: [],
			error: null,
		});
		if (shouldPersist) await set(persistAtom, value);
	});

	const refreshAtom = atom(null, async (get, set) => {
		const startingState = get(stateAtom);
		if (!startingState.hydrated || startingState.pendingWrites > 0) return;
		const refreshRevision = startingState.revision + 1;
		set(stateAtom, { ...startingState, revision: refreshRevision });
		let value: Value;
		try {
			value = decodeValue(await kvStore.get(key), initialValue, normalize);
		} catch (error) {
			const refreshError = errorFrom(error);
			set(stateAtom, (current) => ({ ...current, error: refreshError }));
			throw refreshError;
		}
		const current = get(stateAtom);
		if (!current.hydrated || current.pendingWrites > 0 || current.revision !== refreshRevision) {
			return;
		}
		set(stateAtom, { ...current, value, error: null });
	});

	return {
		valueAtom,
		hydratedAtom: atom((get) => get(stateAtom).hydrated),
		errorAtom: atom((get) => get(stateAtom).error),
		hydrateAtom,
		refreshAtom,
		subscribe(listener) {
			return kvStore.subscribe(key, listener);
		},
	};
}

export function useHydratePersistedAtom<Value>(persistedAtom: PersistedAtom<Value>): void {
	const hydrate = useSetAtom(persistedAtom.hydrateAtom);
	const refresh = useSetAtom(persistedAtom.refreshAtom);

	useEffect(() => {
		let active = true;
		const unsubscribe = persistedAtom.subscribe(() => {
			if (active) void refresh().catch(() => undefined);
		});
		void hydrate().catch(() => undefined);
		return () => {
			active = false;
			unsubscribe();
		};
	}, [hydrate, persistedAtom, refresh]);
}
