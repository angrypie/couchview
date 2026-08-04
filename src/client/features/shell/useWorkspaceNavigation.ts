import { useCallback, useEffect, useState } from "react";
import type {
	BootstrapResponse,
	RepositorySummary,
	TerminalCapability,
} from "../../../shared/contracts.ts";
import { ARTIFACTS_PATH, isArtifactsPath } from "../artifacts/navigation.ts";
import { GIT_HISTORY_PATH, isGitHistoryPath } from "../git/index.ts";
import type { RepositoryHistoryMode } from "../repositories/useRepositoryWorkspace.ts";
import { isSettingsPath, SETTINGS_PATH } from "../settings/profileState.ts";

export type WorkspaceMode = "review" | "history" | "artifacts" | "terminal" | "settings";

function modeForPath(pathname = window.location.pathname): Exclude<WorkspaceMode, "terminal"> {
	if (isSettingsPath(pathname)) return "settings";
	if (isGitHistoryPath(pathname)) return "history";
	if (isArtifactsPath(pathname)) return "artifacts";
	return "review";
}

interface UseWorkspaceNavigationOptions {
	bootstrap: BootstrapResponse | null;
	clearRepositorySelection: () => void;
	getRepositoryId: () => string | null;
	loadRepository: (repositoryId: string, historyMode: RepositoryHistoryMode) => Promise<void>;
	repository: RepositorySummary | null;
	repositoryId: string | null;
	showToast: (message: string) => void;
	terminalCapability: TerminalCapability;
}

export function useWorkspaceNavigation({
	bootstrap,
	clearRepositorySelection,
	getRepositoryId,
	loadRepository,
	repository,
	repositoryId,
	showToast,
	terminalCapability,
}: UseWorkspaceNavigationOptions) {
	const [mode, setMode] = useState<WorkspaceMode>(() => modeForPath());
	const [settingsDirty, setSettingsDirty] = useState(false);
	const [terminalOpened, setTerminalOpened] = useState(false);

	const openSettings = useCallback(() => {
		const url = new URL(window.location.href);
		if (!isSettingsPath(url.pathname)) {
			url.pathname = SETTINGS_PATH;
			window.history.pushState({ couchviewPage: "settings" }, "", url);
		}
		setMode("settings");
	}, []);

	const closeSettings = useCallback(() => {
		const url = new URL(window.location.href);
		url.pathname = "/";
		window.history.replaceState(null, "", url);
		setMode("review");
	}, []);

	const openGitHistory = useCallback(() => {
		const url = new URL(window.location.href);
		if (!isGitHistoryPath(url.pathname)) {
			url.pathname = GIT_HISTORY_PATH;
			window.history.pushState({ couchviewPage: "history" }, "", url);
		}
		setMode("history");
	}, []);

	const closeGitHistory = useCallback(() => {
		const url = new URL(window.location.href);
		url.pathname = "/";
		window.history.replaceState(null, "", url);
		setMode("review");
	}, []);

	const openArtifacts = useCallback(() => {
		const url = new URL(window.location.href);
		if (!isArtifactsPath(url.pathname)) {
			url.pathname = ARTIFACTS_PATH;
			window.history.pushState({ couchviewPage: "artifacts" }, "", url);
		}
		setMode("artifacts");
	}, []);

	const closeArtifacts = useCallback(() => {
		const url = new URL(window.location.href);
		url.pathname = "/";
		window.history.replaceState(null, "", url);
		setMode("review");
	}, []);

	const showReview = useCallback((): boolean => {
		if (
			mode === "settings" &&
			settingsDirty &&
			!window.confirm("Discard unsaved profile changes?")
		) {
			return false;
		}
		const url = new URL(window.location.href);
		if (
			isSettingsPath(url.pathname) ||
			isGitHistoryPath(url.pathname) ||
			isArtifactsPath(url.pathname)
		) {
			url.pathname = "/";
			window.history.replaceState(null, "", url);
		}
		setMode("review");
		return true;
	}, [mode, settingsDirty]);

	const openTerminal = useCallback(() => {
		if (!bootstrap || !repositoryId || !repository) return;
		if (!terminalCapability.available) {
			showToast(terminalCapability.reason ?? "The browser tmux terminal is unavailable.");
			return;
		}
		setTerminalOpened(true);
		setMode("terminal");
	}, [bootstrap, repository, repositoryId, showToast, terminalCapability]);

	useEffect(() => {
		const onPopState = () => {
			const currentUrl = new URL(window.location.href);
			if (
				mode === "settings" &&
				settingsDirty &&
				!isSettingsPath(currentUrl.pathname) &&
				!window.confirm("Discard unsaved profile changes?")
			) {
				currentUrl.pathname = SETTINGS_PATH;
				window.history.pushState({ couchviewPage: "settings" }, "", currentUrl);
				return;
			}
			setMode(modeForPath(currentUrl.pathname));
			const requestedId = currentUrl.searchParams.get("repo");
			const selected = bootstrap?.repositories.find(
				(item) => item.id === requestedId && item.available,
			);
			if (selected) {
				if (selected.id !== getRepositoryId()) {
					void loadRepository(selected.id, "none");
				}
				return;
			}
			const fallback = bootstrap?.repositories.find((item) => item.available);
			if (fallback) void loadRepository(fallback.id, "replace");
			else clearRepositorySelection();
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [
		bootstrap?.repositories,
		clearRepositorySelection,
		getRepositoryId,
		loadRepository,
		mode,
		settingsDirty,
	]);

	useEffect(() => {
		if (!settingsDirty) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [settingsDirty]);

	const resetForRepository = useCallback(() => {
		setMode(modeForPath());
		setTerminalOpened(false);
	}, []);

	return {
		closeArtifacts,
		closeGitHistory,
		closeSettings,
		mode,
		openArtifacts,
		openGitHistory,
		openSettings,
		openTerminal,
		resetForRepository,
		setMode,
		setSettingsDirty,
		settingsDirty,
		showReview,
		terminalOpened,
	};
}
