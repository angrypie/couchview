import {
	DEFAULT_THEME_PREFERENCE,
	normalizeThemePreference,
	THEME_PREFERENCE_STORAGE_KEY,
} from "../../../shared/theme.ts";
import type { KvStore } from "../../lib/storage/kvStore.ts";
import { platformKvStore } from "../../lib/storage/platformKvStore";
import { createPersistedAtom } from "../../lib/store/persistedAtom.ts";

export function createThemePreferenceState(kvStore: KvStore) {
	return createPersistedAtom({
		key: THEME_PREFERENCE_STORAGE_KEY,
		initialValue: DEFAULT_THEME_PREFERENCE,
		kvStore,
		normalize: normalizeThemePreference,
	});
}

export const themePreferenceState = createThemePreferenceState(platformKvStore);
