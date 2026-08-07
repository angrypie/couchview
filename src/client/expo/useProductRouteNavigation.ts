import { type Href, useGlobalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Platform } from "react-native";

import type { AppRouteConfiguration } from "../App.tsx";
import type { RepositoryHistoryMode } from "../features/repositories/useRepositoryWorkspace.ts";
import { useDirtyRouteGuard } from "../features/shell/useDirtyRouteGuard";
import type { WorkspaceMode } from "../features/shell/useWorkspaceNavigation.ts";
import { reloadApp } from "../lib/reloadApp.ts";

const WORKSPACE_PATHS: Record<WorkspaceMode, string> = {
	artifacts: "/artifacts",
	history: "/history",
	review: "/",
	settings: "/settings",
	terminal: "/terminal",
};

function stringParameter(value: string | string[] | undefined): string | null {
	return typeof value === "string" && value ? value : null;
}

function terminalLatencyRequested(value: string | string[] | undefined): boolean {
	if (stringParameter(value) === "1") return true;
	return (
		Platform.OS === "web" &&
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get("terminalLatency") === "1"
	);
}

function routeHref(
	mode: WorkspaceMode,
	repositoryId: string | null,
	terminalLatencyEnabled = false,
): Href {
	return {
		pathname: WORKSPACE_PATHS[mode],
		params: {
			...(repositoryId ? { repo: repositoryId } : {}),
			...(mode === "terminal" && terminalLatencyEnabled ? { terminalLatency: "1" } : {}),
		},
	} as Href;
}

export function useProductRouteNavigation(
	mode: WorkspaceMode,
	fallbackRepositoryId: string | null = null,
): AppRouteConfiguration {
	const router = useRouter();
	const parameters = useGlobalSearchParams<{
		access_refresh?: string | string[];
		repo?: string | string[];
		terminalLatency?: string | string[];
	}>();
	const repositoryId = stringParameter(parameters.repo) ?? fallbackRepositoryId;
	const accessRefreshAttempted = stringParameter(parameters.access_refresh) === "1";
	const latencyProfilerRequested = terminalLatencyRequested(parameters.terminalLatency);
	const { onDirtyChange, runNavigation } = useDirtyRouteGuard(mode === "settings");

	const onNavigate = useCallback(
		(nextMode: WorkspaceMode, replace = false) => {
			const href = routeHref(nextMode, repositoryId, latencyProfilerRequested);
			runNavigation(() => {
				if (replace) router.replace(href);
				else router.push(href);
			});
		},
		[latencyProfilerRequested, repositoryId, router, runNavigation],
	);
	const onRepositorySelection = useCallback(
		(nextRepositoryId: string | null, historyMode: Exclude<RepositoryHistoryMode, "none">) => {
			if (nextRepositoryId === repositoryId) return;
			const href = routeHref(mode, nextRepositoryId, latencyProfilerRequested);
			if (historyMode === "push") router.push(href);
			else router.replace(href);
		},
		[latencyProfilerRequested, mode, repositoryId, router],
	);
	const onAccessRefreshHandled = useCallback(() => {
		router.replace(routeHref(mode, repositoryId, latencyProfilerRequested));
	}, [latencyProfilerRequested, mode, repositoryId, router]);
	const onTerminalLatencyChange = useCallback(
		async (enabled: boolean) => {
			router.replace(routeHref(mode, repositoryId, enabled));
		},
		[mode, repositoryId, router],
	);

	return useMemo(
		() => ({
			accessRefreshAttempted,
			initialMode: mode,
			onAccessRefreshHandled,
			onNavigate,
			onReload: Platform.OS === "web" ? reloadApp : undefined,
			onRepositorySelection,
			onSettingsDirtyChange: onDirtyChange,
			onTerminalLatencyChange,
			requestedRepositoryId: repositoryId,
			terminalLatencyEnabled: latencyProfilerRequested,
		}),
		[
			accessRefreshAttempted,
			mode,
			onAccessRefreshHandled,
			onNavigate,
			onDirtyChange,
			onRepositorySelection,
			onTerminalLatencyChange,
			repositoryId,
			latencyProfilerRequested,
		],
	);
}
