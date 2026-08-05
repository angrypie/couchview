import { createContext, type ReactNode, use } from "react";

import { type NativeProfilesController, useNativeProfiles } from "./useNativeProfiles.ts";
import { type NativeWorkspaceController, useNativeWorkspace } from "./useNativeWorkspace.ts";

export interface NativeServerController {
	profiles: NativeProfilesController;
	workspace: NativeWorkspaceController;
}

const NativeServerContext = createContext<NativeServerController | null>(null);

export function NativeServerProvider({ children }: { children: ReactNode }) {
	const profiles = useNativeProfiles();
	const workspace = useNativeWorkspace(profiles.activeProfile, profiles.update);
	return <NativeServerContext value={{ profiles, workspace }}>{children}</NativeServerContext>;
}

export function useNativeServer(): NativeServerController {
	const controller = use(NativeServerContext);
	if (!controller) throw new Error("useNativeServer must be used inside NativeServerProvider");
	return controller;
}
