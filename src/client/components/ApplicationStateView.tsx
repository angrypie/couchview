import { AlertTriangle, LogIn, RefreshCw, RotateCcw } from "lucide-react-native";
import type { ReactNode } from "react";
import { Linking, View } from "react-native";

import { API_ROUTES } from "../../shared/contracts.ts";
import { absoluteApiHttpUrl, withQuery } from "../api.ts";
import type { AppPhase } from "../features/repositories/useRepositoryWorkspace.ts";
import { Button, Heading, Icon, Spinner, Text } from "./ui";

interface ApplicationStateViewProps {
	appCacheResetBusy: boolean;
	commandUi: ReactNode;
	compactLandscape: boolean;
	loadError: string;
	loadErrorCode: string;
	onLoad: () => Promise<void>;
	onManageServers?: () => void;
	onResetAppCache: () => Promise<void>;
	phase: AppPhase;
	repositoryId?: string | null;
}

function openApiPage(path: string): void {
	void Linking.openURL(absoluteApiHttpUrl(path));
}

export function ApplicationStateView({
	appCacheResetBusy,
	commandUi,
	compactLandscape,
	loadError,
	loadErrorCode,
	onLoad,
	onManageServers,
	onResetAppCache,
	phase,
	repositoryId,
}: ApplicationStateViewProps) {
	if (phase === "loading") {
		return (
			<>
				<View
					className={
						compactLandscape
							? "flex-1 items-center justify-center gap-3 bg-background px-4 py-3"
							: "flex-1 items-center justify-center gap-3 bg-background px-6 py-10"
					}
				>
					<Spinner accessibilityLabel="Opening repository" size="large" />
					<Heading className="text-center" level={2}>
						Opening repository…
					</Heading>
					<Text className="text-center text-muted-foreground">
						Reading changed files and restoring settings.
					</Text>
				</View>
				{commandUi}
			</>
		);
	}
	if (phase !== "error") return null;

	const authenticationRequired = loadErrorCode === "authentication_required";
	const authenticationRefreshFailed = loadErrorCode === "authentication_refresh_failed";
	const disconnected = loadErrorCode === "disconnected";
	const accessRefresh = withQuery(API_ROUTES.accessRefresh, { repo: repositoryId });
	const title = authenticationRefreshFailed
		? "Sign-in didn’t complete"
		: authenticationRequired
			? "Sign-in expired"
			: disconnected
				? "Couchview is unavailable"
				: "Couldn’t open Couchview";
	const description = authenticationRefreshFailed
		? "Cloudflare returned to Couchview, but this device still does not have a usable Access session."
		: authenticationRequired
			? "Sign in again to continue using Couchview."
			: loadError;

	return (
		<View
			accessibilityRole="alert"
			className={
				compactLandscape
					? "flex-1 items-center justify-center gap-4 bg-background px-4 py-3"
					: "flex-1 items-center justify-center gap-4 bg-background px-6 py-10"
			}
		>
			<View className="size-14 items-center justify-center rounded-full bg-destructive/10">
				<Icon as={AlertTriangle} size={28} tone="destructive" />
			</View>
			<View className="max-w-lg items-center gap-2">
				<Heading className="text-center" level={2}>
					{title}
				</Heading>
				<Text className="text-center text-muted-foreground" selectable>
					{description}
				</Text>
			</View>
			<View className="flex-row flex-wrap justify-center gap-2">
				{onManageServers ? (
					<>
						<Button leftIcon={RefreshCw} onPress={() => void onLoad()}>
							Retry
						</Button>
						<Button onPress={onManageServers} variant="outline">
							Manage servers
						</Button>
					</>
				) : authenticationRefreshFailed ? (
					<>
						<Button leftIcon={RotateCcw} onPress={() => openApiPage(API_ROUTES.accessLogout)}>
							Reset Cloudflare sign-in
						</Button>
						<Button leftIcon={LogIn} onPress={() => openApiPage(accessRefresh)} variant="outline">
							Try sign-in again
						</Button>
					</>
				) : authenticationRequired ? (
					<>
						<Button leftIcon={LogIn} onPress={() => openApiPage(accessRefresh)}>
							Sign in again
						</Button>
						<Button leftIcon={RefreshCw} onPress={() => void onLoad()} variant="outline">
							Retry
						</Button>
					</>
				) : (
					<>
						<Button leftIcon={RefreshCw} onPress={() => void onLoad()}>
							Retry
						</Button>
						{disconnected ? (
							<Button leftIcon={LogIn} onPress={() => openApiPage(accessRefresh)} variant="outline">
								Sign in again
							</Button>
						) : null}
						{disconnected ? (
							<Button
								leftIcon={RotateCcw}
								loading={appCacheResetBusy}
								onPress={() => void onResetAppCache()}
								variant="outline"
							>
								Reset app cache
							</Button>
						) : null}
					</>
				)}
			</View>
			{authenticationRefreshFailed ? (
				<Text className="max-w-lg text-center text-sm text-muted-foreground">
					Reset signs this device out of every Cloudflare Access app. Return to Couchview and sign
					in again.
				</Text>
			) : null}
		</View>
	);
}
