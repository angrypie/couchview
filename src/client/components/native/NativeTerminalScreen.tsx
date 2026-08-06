import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";

import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import {
	type NativeTerminalDescriptor,
	useNativeWorkspace,
} from "../../features/nativeServers/useNativeWorkspace.ts";
import { Text } from "../ui/text";
import { VStack } from "../ui/vstack";
import NativeTerminalSurface from "./NativeTerminalSurface.tsx";

export function NativeTerminalScreen() {
	const { profiles } = useNativeServer();
	const workspace = useNativeWorkspace(profiles.activeProfile, profiles.update);
	const { preferences, resolvedTheme } = useNativePreferences();
	const { issueTerminal, endTerminal } = workspace;
	const [descriptor, setDescriptor] = useState<NativeTerminalDescriptor | null>(null);
	const [error, setError] = useState<string | null>(null);
	const connect = useCallback(() => {
		setError(null);
		setDescriptor(null);
		void issueTerminal().then(setDescriptor, (connectError) => {
			setError(connectError instanceof Error ? connectError.message : "Terminal connection failed");
		});
	}, [issueTerminal]);
	useEffect(() => {
		connect();
	}, [connect]);
	const handleDisconnected = useCallback(async (message: string) => {
		setDescriptor(null);
		setError(message);
	}, []);
	const confirmEnd = () => {
		Alert.alert(
			"End tmux session?",
			"This terminates running programs and discards unsaved terminal work.",
			[
				{ style: "cancel", text: "Cancel" },
				{
					style: "destructive",
					text: "End session",
					onPress: () => {
						void endTerminal().then(
							() => {
								setDescriptor(null);
								setError("tmux session ended");
							},
							(endError) =>
								setError(
									endError instanceof Error ? endError.message : "Could not end tmux session",
								),
						);
					},
				},
			],
		);
	};
	if (descriptor) {
		return (
			<View className="flex-1 bg-background">
				<View className="flex-row items-center justify-end border-b border-border px-2.5 py-1">
					<Pressable
						accessibilityLabel="End tmux session"
						className="rounded-md p-2 active:bg-destructive/10"
						onPress={confirmEnd}
					>
						<Text className="text-destructive" size="sm">
							End tmux
						</Text>
					</Pressable>
				</View>
				<NativeTerminalSurface
					dom={{
						contentInsetAdjustmentBehavior: "never",
						scrollEnabled: false,
						style: { flex: 1 },
					}}
					fontSize={preferences.terminalFontSize}
					onDisconnected={handleDisconnected}
					protocol={descriptor.protocol}
					socketUrl={descriptor.socketUrl}
					ticket={descriptor.ticket}
					theme={resolvedTheme}
				/>
			</View>
		);
	}
	return (
		<View className="flex-1 items-center justify-center bg-background p-6">
			<VStack className="items-center" space="md">
				{error ? (
					<>
						<Text accessibilityRole="alert" className="text-center text-destructive" selectable>
							{error}
						</Text>
						<Pressable className="rounded-md p-2.5 active:bg-accent" onPress={connect}>
							<Text className="text-primary">Reconnect</Text>
						</Pressable>
					</>
				) : (
					<>
						<ActivityIndicator colorClassName="accent-primary" />
						<Text className="text-muted-foreground" selectable size="sm">
							Attaching terminal…
						</Text>
					</>
				)}
			</VStack>
		</View>
	);
}
