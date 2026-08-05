import { Host, List, ListItem } from "@expo/ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import { NativeHostedButton } from "./NativeControlHost.tsx";
import { nativeTheme } from "./nativeTheme.ts";

export function NativeServerManager() {
	const { profiles } = useNativeServer();
	const router = useRouter();
	const directPairing = useLocalSearchParams<{
		protocol?: string;
		baseUrl?: string;
		serverId?: string;
		code?: string;
		expiresAt?: string;
	}>();
	const [pairingLink, setPairingLink] = useState("");
	const [deviceLabel, setDeviceLabel] = useState("My iPhone");
	useEffect(() => {
		const values = [
			directPairing.protocol,
			directPairing.baseUrl,
			directPairing.serverId,
			directPairing.code,
			directPairing.expiresAt,
		];
		if (values.some((value) => typeof value !== "string" || !value)) return;
		const link = new URL("couchview://pair");
		for (const [key, value] of Object.entries(directPairing)) {
			if (typeof value === "string") link.searchParams.set(key, value);
		}
		setPairingLink(link.toString());
	}, [
		directPairing.baseUrl,
		directPairing.code,
		directPairing.expiresAt,
		directPairing.protocol,
		directPairing.serverId,
	]);
	const pair = () => {
		void profiles.claim(pairingLink, deviceLabel).then(() => router.replace("/"));
	};
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={{ gap: 18, padding: 16 }}
			style={{ backgroundColor: nativeTheme.background }}
		>
			<View style={{ gap: 6 }}>
				<Text selectable style={{ color: nativeTheme.text, fontSize: 22, fontWeight: "700" }}>
					Pair a Couchview server
				</Text>
				<Text selectable style={{ color: nativeTheme.muted, lineHeight: 20 }}>
					Create a pairing link in Couchview on your computer, then paste it here. No camera
					permission is needed.
				</Text>
			</View>
			<TextInput
				accessibilityLabel="Device label"
				autoCapitalize="words"
				onChangeText={setDeviceLabel}
				placeholder="Device label"
				placeholderTextColor={nativeTheme.muted}
				style={{
					backgroundColor: nativeTheme.panelRaised,
					borderColor: nativeTheme.border,
					borderRadius: 12,
					borderWidth: 1,
					color: nativeTheme.text,
					padding: 12,
				}}
				value={deviceLabel}
			/>
			<TextInput
				accessibilityLabel="Pairing link"
				autoCapitalize="none"
				autoCorrect={false}
				multiline
				onChangeText={setPairingLink}
				placeholder="couchview://pair?…"
				placeholderTextColor={nativeTheme.muted}
				style={{
					backgroundColor: nativeTheme.panelRaised,
					borderColor: nativeTheme.border,
					borderRadius: 12,
					borderWidth: 1,
					color: nativeTheme.text,
					minHeight: 86,
					padding: 12,
				}}
				value={pairingLink}
			/>
			<NativeHostedButton
				disabled={profiles.claiming || !pairingLink.trim() || !deviceLabel.trim()}
				label={profiles.claiming ? "Pairing…" : "Pair server"}
				onPress={pair}
			/>
			{profiles.error ? (
				<Text accessibilityRole="alert" selectable style={{ color: nativeTheme.red }}>
					{profiles.error}
				</Text>
			) : null}
			{profiles.profiles.length ? (
				<View style={{ gap: 8 }}>
					<Text selectable style={{ color: nativeTheme.text, fontSize: 17, fontWeight: "600" }}>
						Paired servers
					</Text>
					<Host
						colorScheme="dark"
						seedColor={nativeTheme.accent}
						style={{ minHeight: profiles.profiles.length * 64 }}
						useViewportSizeMeasurement
					>
						<List>
							{profiles.profiles.map((profile) => (
								<ListItem
									key={profile.id}
									onPress={() => void profiles.activate(profile.id).then(() => router.replace("/"))}
									supportingText={profile.baseUrl}
								>
									{profile.name}
								</ListItem>
							))}
						</List>
					</Host>
					{profiles.profiles.map((profile) => (
						<Pressable
							accessibilityLabel={`Remove ${profile.name}`}
							key={`remove-${profile.id}`}
							onPress={() => void profiles.remove(profile.id)}
							style={{ alignSelf: "flex-start", paddingVertical: 6 }}
						>
							<Text style={{ color: nativeTheme.red }}>Remove {profile.name}</Text>
						</Pressable>
					))}
				</View>
			) : null}
		</ScrollView>
	);
}
