import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { normalizeThemePreference } from "../../../shared/theme.ts";
import type { ProductRouteMode } from "../../expo/productRouteMode.ts";
import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import { nativeProductUrl } from "../../features/nativeServers/nativeProductUrl.ts";
import { useNativeServerConnection } from "../../features/nativeServers/useNativeServerConnection.ts";
import { Text } from "../ui/text";
import { VStack } from "../ui/vstack";
import { NativeHostedButton } from "./NativeControlHost.tsx";
import { createNativeSurfaceScript } from "./nativeSurfaceBridge.ts";
import SharedProductSurface from "./SharedProductSurface.tsx";

function NativeSurfaceState(props: {
	busy?: boolean;
	message: string;
	onManageServers?: () => void;
	onRetry?: () => void;
	title: string;
}) {
	return (
		<View className="flex-1 bg-background p-safe">
			<VStack className="flex-1 items-center justify-center p-6" space="md">
				{props.busy ? <ActivityIndicator colorClassName="accent-primary" size="large" /> : null}
				<Text bold className="text-center" size="xl">
					{props.title}
				</Text>
				<Text className="text-center leading-[21px] text-muted-foreground" selectable size="sm">
					{props.message}
				</Text>
				{props.onRetry ? <NativeHostedButton label="Retry" onPress={props.onRetry} /> : null}
				{props.onManageServers ? (
					<NativeHostedButton
						label="Manage servers"
						onPress={props.onManageServers}
						variant="outlined"
					/>
				) : null}
			</VStack>
		</View>
	);
}

export function NativeProductSurface({ mode }: { mode: ProductRouteMode }) {
	const router = useRouter();
	const { repo } = useLocalSearchParams<{ repo?: string }>();
	const { profiles } = useNativeServer();
	const nativePreferences = useNativePreferences();
	const { preferences } = nativePreferences;
	const connection = useNativeServerConnection(profiles.activeProfile, profiles.update);
	const [loading, setLoading] = useState(true);
	const [surfaceError, setSurfaceError] = useState<string | null>(null);
	const [reloadRevision, setReloadRevision] = useState(0);
	const manageServers = () => router.push("/servers");
	const surfaceScript = useMemo(
		() => createNativeSurfaceScript(preferences.themePreference),
		[preferences.themePreference],
	);
	const uri = useMemo(
		() =>
			profiles.activeProfile
				? nativeProductUrl(
						profiles.activeProfile.baseUrl,
						mode,
						typeof repo === "string" ? repo : profiles.activeProfile.lastRepositoryId,
					)
				: null,
		[mode, profiles.activeProfile, repo],
	);
	useEffect(() => {
		setLoading(true);
		setSurfaceError(null);
	}, [uri]);
	useEffect(() => {
		if (!loading || connection.phase !== "ready" || surfaceError) return;
		const timeout = setTimeout(() => {
			setSurfaceError("The paired server did not finish loading.");
		}, 15_000);
		return () => clearTimeout(timeout);
	}, [connection.phase, loading, surfaceError]);

	if (!profiles.hydrated) {
		return <NativeSurfaceState busy message="Reading paired servers…" title="Opening Couchview" />;
	}
	if (!profiles.activeProfile) {
		return (
			<NativeSurfaceState
				message="Pair this device with the Couchview server running on your computer."
				onManageServers={manageServers}
				title="No paired server"
			/>
		);
	}
	if (connection.phase === "idle" || connection.phase === "loading") {
		return (
			<NativeSurfaceState
				busy
				message={`Verifying ${profiles.activeProfile.name}…`}
				title="Connecting"
			/>
		);
	}
	if (connection.phase === "error" || !uri) {
		return (
			<NativeSurfaceState
				message={connection.error ?? "The paired Couchview server could not be opened."}
				onManageServers={manageServers}
				onRetry={connection.retry}
				title="Couldn’t connect"
			/>
		);
	}
	if (surfaceError) {
		return (
			<NativeSurfaceState
				message={surfaceError}
				onManageServers={manageServers}
				onRetry={() => {
					setSurfaceError(null);
					setLoading(true);
					setReloadRevision((current) => current + 1);
				}}
				title="Couldn’t open Couchview"
			/>
		);
	}

	return (
		<View className="flex-1 bg-background">
			<SharedProductSurface
				key={`${uri}:${reloadRevision}`}
				dom={{
					allowsBackForwardNavigationGestures: true,
					automaticallyAdjustContentInsets: false,
					automaticallyAdjustsScrollIndicatorInsets: false,
					contentInsetAdjustmentBehavior: "never",
					injectedJavaScript: surfaceScript,
					overrideUri: uri,
					style: { flex: 1 },
				}}
				onManageServers={async () => manageServers()}
				onSurfaceReady={async () => setLoading(false)}
				onThemePreferenceChange={async (nextPreference) => {
					const normalized = normalizeThemePreference(nextPreference);
					if (normalized !== preferences.themePreference) {
						nativePreferences.update({ themePreference: normalized });
					}
				}}
				themePreference={preferences.themePreference}
			/>
			{loading ? (
				<View
					className="absolute inset-0 items-center justify-center bg-background uw-entering-fade-in uw-entering-duration-150 uw-exiting-fade-out uw-exiting-duration-150"
					pointerEvents="none"
				>
					<ActivityIndicator colorClassName="accent-primary" size="large" />
				</View>
			) : null}
		</View>
	);
}
