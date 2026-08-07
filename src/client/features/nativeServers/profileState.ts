import type { KvStore } from "../../lib/storage/kvStore.ts";
import { platformKvStore } from "../../lib/storage/platformKvStore";
import { createPersistedAtom } from "../../lib/store/persistedAtom.ts";
import type { NativeServerProfile } from "./types.ts";

export interface NativeProfilesMetadata {
	profiles: NativeServerProfile[];
	activeProfileId: string | null;
}

const NATIVE_PROFILES_KEY = "couchview.native.profiles.v2";
const EMPTY_NATIVE_PROFILES: NativeProfilesMetadata = {
	profiles: [],
	activeProfileId: null,
};

function nativeServerProfile(value: unknown): NativeServerProfile | null {
	if (!value || typeof value !== "object") return null;
	const profile = value as Partial<NativeServerProfile>;
	if (
		typeof profile.id !== "string" ||
		typeof profile.name !== "string" ||
		typeof profile.baseUrl !== "string" ||
		typeof profile.serverId !== "string" ||
		(profile.lastInstanceId !== null && typeof profile.lastInstanceId !== "string") ||
		(profile.lastRepositoryId !== null && typeof profile.lastRepositoryId !== "string") ||
		typeof profile.createdAt !== "string" ||
		typeof profile.updatedAt !== "string"
	) {
		return null;
	}
	return profile as NativeServerProfile;
}

export function normalizeNativeProfilesMetadata(value: unknown): NativeProfilesMetadata {
	if (!value || typeof value !== "object") return EMPTY_NATIVE_PROFILES;
	const candidate = value as Partial<NativeProfilesMetadata>;
	const profiles = Array.isArray(candidate.profiles)
		? candidate.profiles
				.map(nativeServerProfile)
				.filter((profile): profile is NativeServerProfile => profile !== null)
		: [];
	const requestedActiveProfileId =
		typeof candidate.activeProfileId === "string" ? candidate.activeProfileId : null;
	return {
		profiles,
		activeProfileId: profiles.some(({ id }) => id === requestedActiveProfileId)
			? requestedActiveProfileId
			: (profiles[0]?.id ?? null),
	};
}

export function createNativeProfilesState(kvStore: KvStore) {
	return createPersistedAtom({
		key: NATIVE_PROFILES_KEY,
		initialValue: EMPTY_NATIVE_PROFILES,
		kvStore,
		normalize: normalizeNativeProfilesMetadata,
	});
}

export const nativeProfilesState = createNativeProfilesState(platformKvStore);
