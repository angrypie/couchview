import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import {
	type NativeTerminalDescriptor,
	useNativeWorkspace,
} from "../../features/nativeServers/useNativeWorkspace.ts";
import NativeTerminalSurface from "./NativeTerminalSurface.tsx";
import { nativeTheme } from "./nativeTheme.ts";

export function NativeTerminalScreen() {
	const { profiles } = useNativeServer();
	const workspace = useNativeWorkspace(profiles.activeProfile, profiles.update);
	const { preferences } = useNativePreferences();
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
			<View style={{ backgroundColor: nativeTheme.background, flex: 1 }}>
				<View
					style={{
						alignItems: "center",
						borderBottomColor: nativeTheme.border,
						borderBottomWidth: 1,
						flexDirection: "row",
						justifyContent: "flex-end",
						paddingHorizontal: 10,
						paddingVertical: 4,
					}}
				>
					<Pressable
						accessibilityLabel="End tmux session"
						onPress={confirmEnd}
						style={{ padding: 8 }}
					>
						<Text style={{ color: nativeTheme.red }}>End tmux</Text>
					</Pressable>
				</View>
				<NativeTerminalSurface
					dom={{
						contentInsetAdjustmentBehavior: "never",
						scrollEnabled: false,
						style: { flex: 1 },
					}}
					fontSize={preferences.terminalFontSize}
					onDisconnected={async (message) => {
						setDescriptor(null);
						setError(message);
					}}
					protocol={descriptor.protocol}
					socketUrl={descriptor.socketUrl}
					ticket={descriptor.ticket}
				/>
			</View>
		);
	}
	return (
		<View
			style={{
				alignItems: "center",
				backgroundColor: nativeTheme.background,
				flex: 1,
				gap: 12,
				justifyContent: "center",
				padding: 24,
			}}
		>
			{error ? (
				<>
					<Text accessibilityRole="alert" selectable style={{ color: nativeTheme.red }}>
						{error}
					</Text>
					<Pressable onPress={connect} style={{ padding: 10 }}>
						<Text style={{ color: nativeTheme.accent }}>Reconnect</Text>
					</Pressable>
				</>
			) : (
				<>
					<ActivityIndicator color={nativeTheme.accent} />
					<Text selectable style={{ color: nativeTheme.muted }}>
						Attaching terminal…
					</Text>
				</>
			)}
		</View>
	);
}
