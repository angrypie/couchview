import { Slot, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { GluestackUIProvider } from "../src/client/components/ui/gluestack-ui-provider";
import { ProductRoot } from "../src/client/expo/ProductRoot";
import type { ProductRouteMode } from "../src/client/expo/productRouteMode.ts";
import { NativeServerProvider } from "../src/client/features/nativeServers/NativeServerProvider.tsx";
import { ThemeProvider, useAppTheme } from "../src/client/features/settings/ThemeProvider.tsx";
import { AppStoreProvider } from "../src/client/lib/store";
import "../native.css";

const WORKSPACE_MODE_BY_PATH: Readonly<Record<string, ProductRouteMode>> = {
	"/": "review",
	"/artifacts": "artifacts",
	"/history": "history",
	"/settings": "settings",
	"/terminal": "terminal",
};

function AppNavigation() {
	const { hydrated, resolvedTheme } = useAppTheme();
	const pathname = usePathname();
	const workspaceMode = WORKSPACE_MODE_BY_PATH[pathname];
	if (!hydrated) {
		return (
			<GluestackUIProvider>
				<StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
				<View
					accessibilityLabel="Loading Couchview"
					accessibilityRole="progressbar"
					className="flex-1 items-center justify-center bg-background"
				>
					<ActivityIndicator />
				</View>
			</GluestackUIProvider>
		);
	}

	return (
		<GluestackUIProvider>
			<NativeServerProvider>
				<StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
				<View className="min-h-0 flex-1 bg-background">
					{workspaceMode ? <ProductRoot mode={workspaceMode} /> : null}
					<Slot />
				</View>
			</NativeServerProvider>
		</GluestackUIProvider>
	);
}

export default function RootLayout() {
	return (
		<AppStoreProvider>
			<SafeAreaProvider>
				<ThemeProvider>
					<AppNavigation />
				</ThemeProvider>
			</SafeAreaProvider>
		</AppStoreProvider>
	);
}
