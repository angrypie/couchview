import { type Href, useGlobalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { Platform } from "react-native";

import type { RepositoryHistoryMode } from "../features/repositories/useRepositoryWorkspace.ts";
import type { AppRouteConfiguration } from "../features/shell/appRouteConfiguration.ts";
import { parseReviewLocation, reviewLocationParams } from "../features/shell/reviewRoute.ts";
import { useDirtyRouteGuard } from "../features/shell/useDirtyRouteGuard";
import type { WorkspaceMode } from "../features/shell/useWorkspaceNavigation.ts";
import type { ReviewLocation } from "../features/workspacePosition/index.ts";
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
	reviewLocation: ReviewLocation | null = null,
): Href {
	return {
		pathname: WORKSPACE_PATHS[mode],
		params: {
			...(repositoryId ? { repo: repositoryId } : {}),
			...(mode === "review" ? reviewLocationParams(reviewLocation) : {}),
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
		file?: string | string[];
		line?: string | string[];
		repo?: string | string[];
		side?: string | string[];
		terminalLatency?: string | string[];
	}>();
	const explicitRepositoryId = stringParameter(parameters.repo);
	const repositoryId = explicitRepositoryId ?? fallbackRepositoryId;
	const reviewLocation =
		mode === "review"
			? parseReviewLocation(
					stringParameter(parameters.file),
					stringParameter(parameters.line),
					stringParameter(parameters.side),
				)
			: null;
	const lastReviewLocationRef = useRef<{
		location: ReviewLocation;
		repositoryId: string | null;
	} | null>(null);
	if (mode === "review" && reviewLocation) {
		lastReviewLocationRef.current = { location: reviewLocation, repositoryId };
	}
	const accessRefreshAttempted = stringParameter(parameters.access_refresh) === "1";
	const latencyProfilerRequested = terminalLatencyRequested(parameters.terminalLatency);
	const { onDirtyChange, runNavigation } = useDirtyRouteGuard(mode === "settings");

	const onNavigate = useCallback(
		(nextMode: WorkspaceMode, replace = false) => {
			const retainedReviewLocation =
				lastReviewLocationRef.current?.repositoryId === repositoryId
					? lastReviewLocationRef.current.location
					: null;
			const href = routeHref(
				nextMode,
				repositoryId,
				latencyProfilerRequested,
				nextMode === "review" ? (reviewLocation ?? retainedReviewLocation) : null,
			);
			runNavigation(() => {
				if (replace) router.replace(href);
				else router.push(href);
			});
		},
		[latencyProfilerRequested, repositoryId, reviewLocation, router, runNavigation],
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
		router.replace(routeHref(mode, repositoryId, latencyProfilerRequested, reviewLocation));
	}, [latencyProfilerRequested, mode, repositoryId, reviewLocation, router]);
	const onReviewLocationChange = useCallback(
		(location: ReviewLocation) => {
			if (mode !== "review") return;
			lastReviewLocationRef.current = { location, repositoryId };
			router.replace(routeHref("review", repositoryId, latencyProfilerRequested, location));
		},
		[latencyProfilerRequested, mode, repositoryId, router],
	);
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
			onReviewLocationChange,
			onSettingsDirtyChange: onDirtyChange,
			onTerminalLatencyChange,
			requestedRepositoryId: repositoryId,
			requestedReviewLocation: reviewLocation,
			restoreSavedReviewPosition: explicitRepositoryId === null && reviewLocation === null,
			terminalLatencyEnabled: latencyProfilerRequested,
		}),
		[
			accessRefreshAttempted,
			mode,
			onAccessRefreshHandled,
			onNavigate,
			onDirtyChange,
			onRepositorySelection,
			onReviewLocationChange,
			onTerminalLatencyChange,
			explicitRepositoryId,
			repositoryId,
			reviewLocation,
			latencyProfilerRequested,
		],
	);
}
