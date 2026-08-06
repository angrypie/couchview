import { Stack } from "expo-router/stack";
import "../native.css";
import "../src/client/styles.css";

export default function WebRootLayout() {
	return <Stack screenOptions={{ headerShown: false }} />;
}
