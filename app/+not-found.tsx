import { Link, Stack } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function NotFoundRoute() {
	return (
		<>
			<Stack.Screen options={{ title: "Not found" }} />
			<View className="flex-1 justify-center gap-3 bg-background p-6">
				<Text className="text-[22px] font-bold text-foreground" selectable>
					Page not found
				</Text>
				<Link href="/" asChild>
					<Pressable className="self-start rounded-md py-2 active:opacity-70">
						<Text className="text-primary">Return to Couchview</Text>
					</Pressable>
				</Link>
			</View>
		</>
	);
}
