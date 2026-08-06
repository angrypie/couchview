import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NativePreferencesProvider } from "../src/client/features/nativePreferences/NativePreferencesProvider.tsx";
import { NativeServerProvider } from "../src/client/features/nativeServers/NativeServerProvider.tsx";

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<NativePreferencesProvider>
				<NativeServerProvider>
					<StatusBar style="light" />
					<Stack
						screenOptions={{
							contentStyle: { backgroundColor: "#0b0d10" },
							headerBackButtonDisplayMode: "minimal",
							headerShadowVisible: false,
							headerStyle: { backgroundColor: "#11151a" },
							headerTintColor: "#e7edf5",
						}}
					>
						<Stack.Screen name="index" options={{ headerShown: false, title: "Couchview" }} />
						<Stack.Screen name="history" options={{ headerShown: false, title: "History" }} />
						<Stack.Screen name="artifacts" options={{ headerShown: false, title: "Artifacts" }} />
						<Stack.Screen name="settings" options={{ headerShown: false, title: "Settings" }} />
						<Stack.Screen
							name="servers"
							options={{ presentation: "formSheet", title: "Servers" }}
						/>
						<Stack.Screen
							name="pair"
							options={{ presentation: "formSheet", title: "Pair server" }}
						/>
						<Stack.Screen name="terminal" options={{ headerShown: false, title: "Terminal" }} />
					</Stack>
				</NativeServerProvider>
			</NativePreferencesProvider>
		</SafeAreaProvider>
	);
}
