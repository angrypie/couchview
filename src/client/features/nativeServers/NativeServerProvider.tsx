import { createContext, type ReactNode, use } from "react";

import { type NativeProfilesController, useNativeProfiles } from "./useNativeProfiles.ts";

export interface NativeServerController {
	profiles: NativeProfilesController;
}

const NativeServerContext = createContext<NativeServerController | null>(null);

export function NativeServerProvider({ children }: { children: ReactNode }) {
	const profiles = useNativeProfiles();
	return <NativeServerContext value={{ profiles }}>{children}</NativeServerContext>;
}

export function useNativeServer(): NativeServerController {
	const controller = use(NativeServerContext);
	if (!controller) throw new Error("useNativeServer must be used inside NativeServerProvider");
	return controller;
}
