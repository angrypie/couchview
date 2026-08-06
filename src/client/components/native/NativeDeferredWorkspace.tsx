import { Link } from "expo-router";
import { Pressable, View } from "react-native";

import { Text } from "../ui/text";
import { VStack } from "../ui/vstack";

export function NativeDeferredWorkspace({ title }: { title: string }) {
	return (
		<View className="flex-1 justify-center bg-background p-6">
			<VStack space="md">
				<Text bold selectable size="2xl">
					{title}
				</Text>
				<Text className="leading-5 text-muted-foreground" selectable size="sm">
					This secondary workspace remains web-only in native v1 while repository review and
					terminal workflows are validated on iPhone and iPad.
				</Text>
				<Link href="/" asChild>
					<Pressable className="self-start rounded-md py-2 active:opacity-70">
						<Text className="text-primary">Return to review</Text>
					</Pressable>
				</Link>
			</VStack>
		</View>
	);
}
