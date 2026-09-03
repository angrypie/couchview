import { useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { App } from "../App.tsx";
import { configureApiRuntime } from "../api.ts";
import { NativeServerManager } from "../components/native/NativeServerManager.tsx";
import { useWorkspacePosition } from "../features/workspacePosition/index.ts";

import type { ProductRouteMode } from "./productRouteMode.ts";
import { useProductRouteNavigation } from "./useProductRouteNavigation.ts";

export function ProductRoot({ mode }: { mode: ProductRouteMode }) {
	const [runtime] = useState(() => {
		const developmentApiOrigin = process.env.EXPO_PUBLIC_COUCHVIEW_API_ORIGIN;
		if (developmentApiOrigin) configureApiRuntime({ baseUrl: developmentApiOrigin });
		const appOrigin = window.location.origin;
		const apiOrigin = developmentApiOrigin
			? new URL(developmentApiOrigin, appOrigin).origin
			: appOrigin;
		return { scope: `web:${apiOrigin}`, shareBaseUrl: appOrigin };
	});
	const workspacePosition = useWorkspacePosition({ scope: runtime.scope });
	const workspaceMode = mode === "servers" ? "review" : mode;
	const navigation = useProductRouteNavigation(workspaceMode, workspacePosition.lastRepositoryId);
	if (mode === "servers") return <NativeServerManager />;
	if (!workspacePosition.hydrated) {
		return (
			<View
				accessibilityLabel="Reading saved workspace"
				accessibilityRole="progressbar"
				className="flex-1 items-center justify-center bg-background"
			>
				<ActivityIndicator />
			</View>
		);
	}
	return (
		<App
			{...navigation}
			shareBaseUrl={runtime.shareBaseUrl}
			workspacePosition={workspacePosition}
		/>
	);
}
