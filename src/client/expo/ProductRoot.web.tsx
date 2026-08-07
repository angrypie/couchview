import { useState } from "react";

import { App } from "../App.tsx";
import { configureApiRuntime } from "../api.ts";
import { NativeServerManager } from "../components/native/NativeServerManager.tsx";

import type { ProductRouteMode } from "./productRouteMode.ts";
import { useProductRouteNavigation } from "./useProductRouteNavigation.ts";

export function ProductRoot({ mode }: { mode: ProductRouteMode }) {
	useState(() => {
		const developmentApiOrigin = process.env.EXPO_PUBLIC_COUCHVIEW_API_ORIGIN;
		if (developmentApiOrigin) configureApiRuntime({ baseUrl: developmentApiOrigin });
	});
	const workspaceMode = mode === "servers" ? "review" : mode;
	const navigation = useProductRouteNavigation(workspaceMode);
	if (mode === "servers") return <NativeServerManager />;
	return <App {...navigation} />;
}
