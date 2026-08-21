import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView } from "react-native";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import { Card } from "../ui/card";
import { Input, InputField } from "../ui/input";
import { NativeHostedButton, NativeHostedList, NativeHostedListItem } from "../ui/native-control";
import { Text } from "../ui/text";
import { VStack } from "../ui/vstack";

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
			className="bg-background"
			contentInsetAdjustmentBehavior="automatic"
			contentContainerClassName="gap-[18px] p-4"
		>
			<VStack space="xs">
				<Text bold selectable size="xl">
					Pair a Couchview server
				</Text>
				<Text className="leading-5 text-muted-foreground" selectable size="sm">
					Create a pairing link in Couchview on your computer, then paste it here. No camera
					permission is needed.
				</Text>
			</VStack>
			<Input>
				<InputField
					accessibilityLabel="Device label"
					autoCapitalize="words"
					onChangeText={setDeviceLabel}
					placeholder="Device label"
					value={deviceLabel}
				/>
			</Input>
			<Input className="min-h-[86px] items-start">
				<InputField
					accessibilityLabel="Pairing link"
					autoCapitalize="none"
					autoCorrect={false}
					className="min-h-[84px] py-3"
					multiline
					onChangeText={setPairingLink}
					placeholder="couchview://pair?…"
					textAlignVertical="top"
					value={pairingLink}
				/>
			</Input>
			<NativeHostedButton
				disabled={profiles.claiming || !pairingLink.trim() || !deviceLabel.trim()}
				label={profiles.claiming ? "Pairing…" : "Pair server"}
				onPress={pair}
			/>
			{profiles.error ? (
				<Text accessibilityRole="alert" className="text-destructive" selectable size="sm">
					{profiles.error}
				</Text>
			) : null}
			{profiles.profiles.length ? (
				<Card size="sm">
					<Text bold selectable size="lg">
						Paired servers
					</Text>
					<NativeHostedList minimumHeight={profiles.profiles.length * 64}>
						{profiles.profiles.map((profile) => (
							<NativeHostedListItem
								key={profile.id}
								onPress={() => void profiles.activate(profile.id).then(() => router.replace("/"))}
								supportingText={profile.baseUrl}
							>
								{profile.name}
							</NativeHostedListItem>
						))}
					</NativeHostedList>
					{profiles.profiles.map((profile) => (
						<Pressable
							accessibilityLabel={`Remove ${profile.name}`}
							className="self-start rounded-md py-1.5 active:opacity-70"
							key={`remove-${profile.id}`}
							onPress={() => void profiles.remove(profile.id)}
						>
							<Text className="text-destructive" size="sm">
								Remove {profile.name}
							</Text>
						</Pressable>
					))}
				</Card>
			) : null}
		</ScrollView>
	);
}
