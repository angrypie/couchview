import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";

import { GluestackUIProvider } from "../src/client/components/ui/gluestack-ui-provider";
import {
	NativePreferencesProvider,
	useNativePreferences,
} from "../src/client/features/nativePreferences/NativePreferencesProvider.tsx";
import { NativeServerProvider } from "../src/client/features/nativeServers/NativeServerProvider.tsx";
import "../native.css";

function NativeNavigation() {
	const { hydrated, resolvedTheme } = useNativePreferences();
	const contentStyle = useResolveClassNames("bg-background");
	const headerStyle = useResolveClassNames("bg-card");
	const headerTitleStyle = useResolveClassNames("text-foreground");
	const headerTintColor =
		typeof headerTitleStyle.color === "string" ? headerTitleStyle.color : undefined;
	if (!hydrated) {
		return (
			<GluestackUIProvider>
				<StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
				<View
					accessibilityLabel="Loading Couchview"
					accessibilityRole="progressbar"
					className="flex-1 items-center justify-center bg-background"
				>
					<ActivityIndicator color={headerTintColor} />
				</View>
			</GluestackUIProvider>
		);
	}

	return (
		<GluestackUIProvider>
			<NativeServerProvider>
				<StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
				<Stack
					screenOptions={{
						contentStyle,
						headerBackButtonDisplayMode: "minimal",
						headerShadowVisible: false,
						headerStyle,
						headerTintColor,
					}}
				>
					<Stack.Screen name="index" options={{ headerShown: false, title: "Couchview" }} />
					<Stack.Screen name="history" options={{ headerShown: false, title: "History" }} />
					<Stack.Screen name="artifacts" options={{ headerShown: false, title: "Artifacts" }} />
					<Stack.Screen name="settings" options={{ headerShown: false, title: "Settings" }} />
					<Stack.Screen name="servers" options={{ presentation: "formSheet", title: "Servers" }} />
					<Stack.Screen name="pair" options={{ presentation: "formSheet", title: "Pair server" }} />
					<Stack.Screen name="terminal" options={{ headerShown: false, title: "Terminal" }} />
				</Stack>
			</NativeServerProvider>
		</GluestackUIProvider>
	);
}

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<NativePreferencesProvider>
				<NativeNavigation />
			</NativePreferencesProvider>
		</SafeAreaProvider>
	);
}
