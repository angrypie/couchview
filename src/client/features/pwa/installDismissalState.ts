import type { KvStore } from "../../lib/storage/kvStore.ts";
import { platformKvStore } from "../../lib/storage/platformKvStore";
import { createPersistedAtom } from "../../lib/store/persistedAtom.ts";

export const PWA_INSTALL_DISMISSED_KEY = "couchview:install-hint-dismissed";

export function createPwaInstallDismissalState(kvStore: KvStore) {
	return createPersistedAtom({
		key: PWA_INSTALL_DISMISSED_KEY,
		initialValue: false,
		kvStore,
		normalize: (value) => value === true,
	});
}

export const pwaInstallDismissalState = createPwaInstallDismissalState(platformKvStore);
