import { expect, test } from "bun:test";
import { createStore } from "jotai/vanilla";

import { createMemoryKvStore } from "../../lib/storage/memoryKvStore.ts";
import { createNativeProfilesState, type NativeProfilesMetadata } from "./profileState.ts";

const PROFILE = {
	id: "server-1",
	name: "Local Couchview",
	baseUrl: "http://192.168.1.10:4173",
	serverId: "server-1",
	lastInstanceId: null,
	lastRepositoryId: "repo-1",
	createdAt: "2026-08-07T10:00:00.000Z",
	updatedAt: "2026-08-07T10:00:00.000Z",
} as const;

test("server profile metadata round-trips through the shared KV seam", async () => {
	const kvStore = createMemoryKvStore();
	const profileState = createNativeProfilesState(kvStore);
	const store = createStore();
	await store.set(profileState.hydrateAtom);

	const metadata: NativeProfilesMetadata = {
		profiles: [PROFILE],
		activeProfileId: PROFILE.id,
	};
	await store.set(profileState.valueAtom, metadata);

	const reloadedState = createNativeProfilesState(kvStore);
	const reloadedStore = createStore();
	await reloadedStore.set(reloadedState.hydrateAtom);
	expect(reloadedStore.get(reloadedState.valueAtom)).toEqual(metadata);
});
