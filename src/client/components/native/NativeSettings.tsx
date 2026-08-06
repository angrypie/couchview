import { Host, Slider, Switch } from "@expo/ui";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useResolveClassNames } from "uniwind";

import type { ThemePreference } from "../../../shared/theme.ts";
import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import { useNativeWorkspace } from "../../features/nativeServers/useNativeWorkspace.ts";
import { Card } from "../ui/card";
import { Text } from "../ui/text";
import { VStack } from "../ui/vstack";

const THEME_OPTIONS = [
	{ description: "Follow this device’s appearance.", label: "System", value: "system" },
	{ description: "Always use the light interface.", label: "Light", value: "light" },
	{ description: "Always use the dark interface.", label: "Dark", value: "dark" },
] as const satisfies ReadonlyArray<{
	description: string;
	label: string;
	value: ThemePreference;
}>;

function ThemePreferenceOption(props: {
	description: string;
	label: string;
	onSelect(): void;
	selected: boolean;
}) {
	return (
		<Pressable
			accessibilityHint={props.description}
			accessibilityRole="radio"
			accessibilityState={{ checked: props.selected }}
			className={
				props.selected
					? "rounded-lg border border-primary bg-accent p-3"
					: "rounded-lg border border-border bg-background p-3 active:bg-muted"
			}
			onPress={props.onSelect}
		>
			<View className="flex-row items-center justify-between gap-3">
				<VStack className="min-w-0 flex-1" space="xs">
					<Text bold>{props.label}</Text>
					<Text className="text-muted-foreground" size="sm">
						{props.description}
					</Text>
				</VStack>
				{props.selected ? (
					<Text className="text-primary" size="xs">
						Selected
					</Text>
				) : null}
			</View>
		</Pressable>
	);
}

export function NativeSettings() {
	const { profiles } = useNativeServer();
	const workspace = useNativeWorkspace(profiles.activeProfile, profiles.update);
	const nativePreferences = useNativePreferences();
	const { preferences, resolvedTheme } = nativePreferences;
	const { color: seedColor } = useResolveClassNames("text-primary");
	const router = useRouter();
	return (
		<ScrollView
			className="bg-background"
			contentContainerClassName="gap-[18px] p-4"
			contentInsetAdjustmentBehavior="automatic"
		>
			<Card size="sm">
				<Text bold selectable size="xl">
					Appearance
				</Text>
				<Text className="text-muted-foreground" selectable size="sm">
					These display choices stay on this device.
				</Text>
				<View accessibilityLabel="Color theme" accessibilityRole="radiogroup" className="gap-2">
					{THEME_OPTIONS.map((option) => (
						<ThemePreferenceOption
							description={option.description}
							key={option.value}
							label={option.label}
							onSelect={() => nativePreferences.update({ themePreference: option.value })}
							selected={preferences.themePreference === option.value}
						/>
					))}
				</View>
				<Host colorScheme={resolvedTheme} matchContents seedColor={seedColor}>
					<Switch
						label="Line numbers"
						onValueChange={(lineNumbersVisible) => nativePreferences.update({ lineNumbersVisible })}
						value={preferences.lineNumbersVisible}
					/>
				</Host>
				<Host colorScheme={resolvedTheme} matchContents seedColor={seedColor}>
					<Switch
						label="Wrap diff lines"
						onValueChange={(lineWrapEnabled) => nativePreferences.update({ lineWrapEnabled })}
						value={preferences.lineWrapEnabled}
					/>
				</Host>
				<Text selectable>Diff text · {preferences.diffFontSize}px</Text>
				<Host colorScheme={resolvedTheme} seedColor={seedColor} style={{ minHeight: 42 }}>
					<Slider
						max={20}
						min={10}
						onValueChange={(diffFontSize) => nativePreferences.update({ diffFontSize })}
						step={1}
						value={preferences.diffFontSize}
					/>
				</Host>
				<Text selectable>Terminal text · {preferences.terminalFontSize}px</Text>
				<Host colorScheme={resolvedTheme} seedColor={seedColor} style={{ minHeight: 42 }}>
					<Slider
						max={20}
						min={10}
						onValueChange={(terminalFontSize) => nativePreferences.update({ terminalFontSize })}
						step={1}
						value={preferences.terminalFontSize}
					/>
				</Host>
				{nativePreferences.error ? (
					<Text accessibilityRole="alert" className="text-destructive" selectable size="sm">
						{nativePreferences.error}
					</Text>
				) : null}
			</Card>
			<Card size="sm">
				<Text bold selectable size="xl">
					Active server
				</Text>
				<Text selectable>{profiles.activeProfile?.name ?? "No paired server"}</Text>
				<Text className="text-muted-foreground" selectable size="sm">
					{profiles.activeProfile?.baseUrl ?? "Pair a server to begin"}
				</Text>
				{workspace.instance ? (
					<Text className="text-muted-foreground" selectable size="sm">
						Server {workspace.instance.serverId} · instance {workspace.instance.instanceId}
					</Text>
				) : null}
				<Pressable
					className="self-start rounded-md py-2 active:opacity-70"
					onPress={() => router.push("/servers")}
				>
					<Text className="text-primary">Manage paired servers</Text>
				</Pressable>
			</Card>
		</ScrollView>
	);
}
