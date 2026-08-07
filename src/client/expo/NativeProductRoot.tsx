import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { App } from "../App.tsx";
import { configureApiRuntime, resetApiRuntime } from "../api.ts";
import { Text } from "../components/ui/text";
import { useNativeServer } from "../features/nativeServers/NativeServerProvider.tsx";
import { useNativeServerConnection } from "../features/nativeServers/useNativeServerConnection.ts";
import type { ProductRouteMode } from "./productRouteMode.ts";
import { useProductRouteNavigation } from "./useProductRouteNavigation.ts";

function ConnectionState(props: {
	busy?: boolean;
	message: string;
	onManageServers?: () => void;
	onRetry?: () => void;
	title: string;
}) {
	return (
		<View className="flex-1 items-center justify-center gap-4 bg-background p-6">
			{props.busy ? <ActivityIndicator colorClassName="accent-primary" size="large" /> : null}
			<Text bold className="text-center" size="xl">
				{props.title}
			</Text>
			<Text className="max-w-md text-center leading-5 text-muted-foreground" selectable size="sm">
				{props.message}
			</Text>
			<View className="flex-row flex-wrap justify-center gap-3">
				{props.onRetry ? (
					<Pressable
						accessibilityRole="button"
						className="rounded-lg bg-primary px-4 py-2.5 active:opacity-75"
						onPress={props.onRetry}
					>
						<Text className="text-primary-foreground">Retry</Text>
					</Pressable>
				) : null}
				{props.onManageServers ? (
					<Pressable
						accessibilityRole="button"
						className="rounded-lg border border-border bg-card px-4 py-2.5 active:opacity-75"
						onPress={props.onManageServers}
					>
						<Text>Manage servers</Text>
					</Pressable>
				) : null}
			</View>
		</View>
	);
}

export function NativeProductRoot({ mode }: { mode: Exclude<ProductRouteMode, "servers"> }) {
	const router = useRouter();
	const { profiles } = useNativeServer();
	const activeProfile = profiles.activeProfile;
	const activeProfileBaseUrl = activeProfile?.baseUrl ?? null;
	const activeProfileId = activeProfile?.id ?? null;
	const connection = useNativeServerConnection(activeProfile, profiles.update);
	const navigation = useProductRouteNavigation(mode, activeProfile?.lastRepositoryId ?? null);
	const [configuredProfileId, setConfiguredProfileId] = useState<string | null>(null);

	useEffect(() => {
		setConfiguredProfileId(null);
		if (
			!activeProfileBaseUrl ||
			!activeProfileId ||
			connection.phase !== "ready" ||
			!connection.nativeClientToken
		) {
			resetApiRuntime();
			return;
		}
		configureApiRuntime({
			baseUrl: activeProfileBaseUrl,
			nativeClientToken: connection.nativeClientToken,
		});
		setConfiguredProfileId(activeProfileId);
		return () => resetApiRuntime();
	}, [activeProfileBaseUrl, activeProfileId, connection.nativeClientToken, connection.phase]);

	const appNavigation = useMemo(
		() => ({
			...navigation,
			nativeServerManagerUrl: Linking.createURL("/servers"),
			onManageServers: () => router.push("/servers"),
			onRepositorySelection: (repositoryId: string | null, historyMode: "push" | "replace") => {
				navigation.onRepositorySelection?.(repositoryId, historyMode);
				if (!activeProfile || activeProfile.lastRepositoryId === repositoryId) return;
				void profiles.update({
					...activeProfile,
					lastRepositoryId: repositoryId,
					updatedAt: new Date().toISOString(),
				});
			},
		}),
		[activeProfile, navigation, profiles, router],
	);

	if (!profiles.hydrated) {
		return <ConnectionState busy message="Reading paired servers…" title="Opening Couchview" />;
	}
	if (!activeProfile) {
		return (
			<ConnectionState
				message="Pair this device with the Couchview server running on your computer."
				onManageServers={() => router.push("/servers")}
				title="No paired server"
			/>
		);
	}
	if (connection.phase === "idle" || connection.phase === "loading") {
		return <ConnectionState busy message={`Verifying ${activeProfile.name}…`} title="Connecting" />;
	}
	if (connection.phase === "error") {
		return (
			<ConnectionState
				message={connection.error ?? "The paired Couchview server could not be opened."}
				onManageServers={() => router.push("/servers")}
				onRetry={connection.retry}
				title="Couldn’t connect"
			/>
		);
	}
	if (configuredProfileId !== activeProfile.id) {
		return <ConnectionState busy message={`Opening ${activeProfile.name}…`} title="Connecting" />;
	}

	return <App {...appNavigation} />;
}
