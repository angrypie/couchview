import { Host, Slider, Switch } from "@expo/ui";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import { useNativeWorkspace } from "../../features/nativeServers/useNativeWorkspace.ts";
import { nativeTheme } from "./nativeTheme.ts";

export function NativeSettings() {
	const { profiles } = useNativeServer();
	const workspace = useNativeWorkspace(profiles.activeProfile, profiles.update);
	const nativePreferences = useNativePreferences();
	const { preferences } = nativePreferences;
	const router = useRouter();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={{ gap: 18, padding: 16 }}
			style={{ backgroundColor: nativeTheme.background }}
		>
			<View style={{ gap: 6 }}>
				<Text selectable style={{ color: nativeTheme.text, fontSize: 20, fontWeight: "700" }}>
					Appearance
				</Text>
				<Host colorScheme="dark" matchContents seedColor={nativeTheme.accent}>
					<Switch disabled label="Dark interface" onValueChange={() => undefined} value />
				</Host>
				<Text selectable style={{ color: nativeTheme.muted }}>
					Native v1 is dark-first. These display choices stay on this device.
				</Text>
				<Host colorScheme="dark" matchContents seedColor={nativeTheme.accent}>
					<Switch
						label="Line numbers"
						onValueChange={(lineNumbersVisible) => nativePreferences.update({ lineNumbersVisible })}
						value={preferences.lineNumbersVisible}
					/>
				</Host>
				<Host colorScheme="dark" matchContents seedColor={nativeTheme.accent}>
					<Switch
						label="Wrap diff lines"
						onValueChange={(lineWrapEnabled) => nativePreferences.update({ lineWrapEnabled })}
						value={preferences.lineWrapEnabled}
					/>
				</Host>
				<Text selectable style={{ color: nativeTheme.text }}>
					Diff text · {preferences.diffFontSize}px
				</Text>
				<Host colorScheme="dark" seedColor={nativeTheme.accent} style={{ minHeight: 42 }}>
					<Slider
						max={20}
						min={10}
						onValueChange={(diffFontSize) => nativePreferences.update({ diffFontSize })}
						step={1}
						value={preferences.diffFontSize}
					/>
				</Host>
				<Text selectable style={{ color: nativeTheme.text }}>
					Terminal text · {preferences.terminalFontSize}px
				</Text>
				<Host colorScheme="dark" seedColor={nativeTheme.accent} style={{ minHeight: 42 }}>
					<Slider
						max={20}
						min={10}
						onValueChange={(terminalFontSize) => nativePreferences.update({ terminalFontSize })}
						step={1}
						value={preferences.terminalFontSize}
					/>
				</Host>
				{nativePreferences.error ? (
					<Text accessibilityRole="alert" selectable style={{ color: nativeTheme.red }}>
						{nativePreferences.error}
					</Text>
				) : null}
			</View>
			<View style={{ gap: 8 }}>
				<Text selectable style={{ color: nativeTheme.text, fontSize: 20, fontWeight: "700" }}>
					Active server
				</Text>
				<Text selectable style={{ color: nativeTheme.text }}>
					{profiles.activeProfile?.name ?? "No paired server"}
				</Text>
				<Text selectable style={{ color: nativeTheme.muted }}>
					{profiles.activeProfile?.baseUrl ?? "Pair a server to begin"}
				</Text>
				{workspace.instance ? (
					<Text selectable style={{ color: nativeTheme.muted }}>
						Server {workspace.instance.serverId} · instance {workspace.instance.instanceId}
					</Text>
				) : null}
				<Pressable onPress={() => router.push("/servers")} style={{ paddingVertical: 8 }}>
					<Text style={{ color: nativeTheme.accent }}>Manage paired servers</Text>
				</Pressable>
			</View>
		</ScrollView>
	);
}
