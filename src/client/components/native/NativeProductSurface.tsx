import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ProductRouteMode } from "../../expo/productRouteMode.ts";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import { nativeProductUrl } from "../../features/nativeServers/nativeProductUrl.ts";
import { useNativeServerConnection } from "../../features/nativeServers/useNativeServerConnection.ts";
import { NativeHostedButton } from "./NativeControlHost.tsx";
import { nativeTheme } from "./nativeTheme.ts";
import SharedProductSurface from "./SharedProductSurface.tsx";

const NATIVE_SURFACE_SCRIPT = `
(function () {
	function invoke(actionId) {
		window.ReactNativeWebView?.postMessage(JSON.stringify({
			type: "$$native_action",
			data: { uid: Math.random().toString(36).slice(2), actionId: actionId, args: [] }
		}));
	}
	function ready() { invoke("onSurfaceReady"); }
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", ready, { once: true });
	} else {
		ready();
	}
	document.addEventListener("click", function (event) {
		var target = event.target;
		var anchor = target && target.closest ? target.closest("a") : null;
		if (!anchor || anchor.getAttribute("href") !== "couchview://servers") return;
		event.preventDefault();
		invoke("onManageServers");
	}, true);
})();
true;
`;

function NativeSurfaceState(props: {
	busy?: boolean;
	message: string;
	onManageServers?: () => void;
	onRetry?: () => void;
	title: string;
}) {
	return (
		<SafeAreaView
			edges={["top", "right", "bottom", "left"]}
			style={{ backgroundColor: nativeTheme.background, flex: 1 }}
		>
			<View
				style={{
					alignItems: "center",
					flex: 1,
					gap: 12,
					justifyContent: "center",
					padding: 24,
				}}
			>
				{props.busy ? <ActivityIndicator color={nativeTheme.accent} size="large" /> : null}
				<Text style={{ color: nativeTheme.text, fontSize: 20, fontWeight: "700" }}>
					{props.title}
				</Text>
				<Text selectable style={{ color: nativeTheme.muted, lineHeight: 21, textAlign: "center" }}>
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
			</View>
		</SafeAreaView>
	);
}

export function NativeProductSurface({ mode }: { mode: ProductRouteMode }) {
	const router = useRouter();
	const { repo } = useLocalSearchParams<{ repo?: string }>();
	const { profiles } = useNativeServer();
	const connection = useNativeServerConnection(profiles.activeProfile, profiles.update);
	const [loading, setLoading] = useState(true);
	const [surfaceError, setSurfaceError] = useState<string | null>(null);
	const [reloadRevision, setReloadRevision] = useState(0);
	const manageServers = () => router.push("/servers");
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
		<View style={{ backgroundColor: nativeTheme.background, flex: 1 }}>
			<SharedProductSurface
				key={`${uri}:${reloadRevision}`}
				dom={{
					allowsBackForwardNavigationGestures: true,
					automaticallyAdjustContentInsets: false,
					automaticallyAdjustsScrollIndicatorInsets: false,
					contentInsetAdjustmentBehavior: "never",
					injectedJavaScript: NATIVE_SURFACE_SCRIPT,
					overrideUri: uri,
					style: { flex: 1 },
				}}
				onManageServers={async () => manageServers()}
				onSurfaceReady={async () => setLoading(false)}
			/>
			{loading ? (
				<View
					pointerEvents="none"
					style={{
						alignItems: "center",
						backgroundColor: nativeTheme.background,
						inset: 0,
						justifyContent: "center",
						position: "absolute",
					}}
				>
					<ActivityIndicator color={nativeTheme.accent} size="large" />
				</View>
			) : null}
		</View>
	);
}
