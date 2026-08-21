import type { SettingsProfile } from "../../../shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	SETTINGS_PROFILE_SELECTION_KEY,
} from "../../../shared/settings.ts";
import type { KvStore } from "../../lib/storage/kvStore.ts";
import { platformKvStore } from "../../lib/storage/platformKvStore";
import { createPersistedAtom } from "../../lib/store/persistedAtom.ts";

export const SETTINGS_PATH = "/settings";

export function fallbackSettingsProfile(): SettingsProfile {
	return {
		id: DEFAULT_SETTINGS_PROFILE_ID,
		name: "Default",
		data: createDefaultSettingsProfileData(),
		revision: 1,
		createdAt: "",
		updatedAt: "",
	};
}

export function createSettingsProfileSelectionState(kvStore: KvStore) {
	return createPersistedAtom({
		key: SETTINGS_PROFILE_SELECTION_KEY,
		initialValue: DEFAULT_SETTINGS_PROFILE_ID,
		kvStore,
		normalize: (value) => (typeof value === "string" ? value : DEFAULT_SETTINGS_PROFILE_ID),
	});
}

export const settingsProfileSelectionState = createSettingsProfileSelectionState(platformKvStore);

export function isSettingsPath(pathname: string): boolean {
	return pathname.replace(/\/+$/, "") === SETTINGS_PATH;
}
