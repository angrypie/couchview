import { Link, Stack } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function NotFoundRoute() {
	return (
		<>
			<Stack.Screen options={{ title: "Not found" }} />
			<View
				style={{
					backgroundColor: "#0b0d10",
					flex: 1,
					gap: 12,
					justifyContent: "center",
					padding: 24,
				}}
			>
				<Text selectable style={{ color: "#e7edf5", fontSize: 22, fontWeight: "700" }}>
					Page not found
				</Text>
				<Link href="/" asChild>
					<Pressable>
						<Text style={{ color: "#7da6ff" }}>Return to Couchview</Text>
					</Pressable>
				</Link>
			</View>
		</>
	);
}
