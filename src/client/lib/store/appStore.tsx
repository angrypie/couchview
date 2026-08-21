import { Provider } from "jotai/react";
import { createStore } from "jotai/vanilla";
import type { ReactNode } from "react";

export type AppStore = ReturnType<typeof createStore>;

export function createAppStore(): AppStore {
	return createStore();
}

export const defaultAppStore = createAppStore();

export function AppStoreProvider({
	children,
	store = defaultAppStore,
}: {
	children: ReactNode;
	store?: AppStore;
}) {
	return <Provider store={store}>{children}</Provider>;
}
