import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { nativeTheme } from "./nativeTheme.ts";

export function NativeDeferredWorkspace({ title }: { title: string }) {
	return (
		<View
			style={{
				backgroundColor: nativeTheme.background,
				flex: 1,
				gap: 12,
				justifyContent: "center",
				padding: 24,
			}}
		>
			<Text selectable style={{ color: nativeTheme.text, fontSize: 24, fontWeight: "700" }}>
				{title}
			</Text>
			<Text selectable style={{ color: nativeTheme.muted, lineHeight: 20 }}>
				This secondary workspace remains web-only in native v1 while repository review and terminal
				workflows are validated on iPhone and iPad.
			</Text>
			<Link href="/" asChild>
				<Pressable>
					<Text style={{ color: nativeTheme.accent }}>Return to review</Text>
				</Pressable>
			</Link>
		</View>
	);
}
