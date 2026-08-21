import { useCallback, useEffect, useRef, useState } from "react";

import type {
	BootstrapResponse,
	RepositorySummary,
	TerminalCapability,
} from "../../../shared/contracts.ts";

export type WorkspaceMode = "review" | "history" | "artifacts" | "terminal" | "settings";

interface UseWorkspaceNavigationOptions {
	bootstrap: BootstrapResponse | null;
	initialMode?: WorkspaceMode;
	onNavigate?: (mode: WorkspaceMode, replace?: boolean) => void;
	onSettingsDirtyChange?: (dirty: boolean) => void;
	repository: RepositorySummary | null;
	repositoryId: string | null;
	showToast: (message: string) => void;
	terminalCapability: TerminalCapability;
}

export function useWorkspaceNavigation({
	bootstrap,
	initialMode = "review",
	onNavigate,
	onSettingsDirtyChange,
	repository,
	repositoryId,
	showToast,
	terminalCapability,
}: UseWorkspaceNavigationOptions) {
	const [localMode, setLocalMode] = useState<WorkspaceMode>(initialMode);
	const [settingsDirty, setSettingsDirtyState] = useState(false);
	const [terminalOpened, setTerminalOpened] = useState(initialMode === "terminal");
	const mode = onNavigate ? initialMode : localMode;
	const initialModeRef = useRef(initialMode);
	initialModeRef.current = initialMode;
	const onNavigateRef = useRef(onNavigate);
	onNavigateRef.current = onNavigate;

	useEffect(() => {
		if (!onNavigate) setLocalMode(initialMode);
		if (initialMode === "terminal") setTerminalOpened(true);
	}, [initialMode, onNavigate]);

	const navigate = useCallback(
		(nextMode: WorkspaceMode, replace = false) => {
			if (!onNavigate) setLocalMode(nextMode);
			if (nextMode === "terminal") setTerminalOpened(true);
			onNavigate?.(nextMode, replace);
		},
		[onNavigate],
	);
	const setSettingsDirty = useCallback(
		(dirty: boolean) => {
			onSettingsDirtyChange?.(dirty);
			setSettingsDirtyState(dirty);
		},
		[onSettingsDirtyChange],
	);

	const openSettings = useCallback(() => navigate("settings"), [navigate]);
	const closeSettings = useCallback(() => navigate("review", true), [navigate]);
	const openGitHistory = useCallback(() => navigate("history"), [navigate]);
	const closeGitHistory = useCallback(() => navigate("review", true), [navigate]);
	const openArtifacts = useCallback(() => navigate("artifacts"), [navigate]);
	const closeArtifacts = useCallback(() => navigate("review", true), [navigate]);

	const showReview = useCallback((): boolean => {
		if (mode === "settings" && settingsDirty) {
			showToast("Save or discard the profile changes before leaving settings.");
			return false;
		}
		if (mode !== "review") navigate("review", true);
		return true;
	}, [mode, navigate, settingsDirty, showToast]);

	const openTerminal = useCallback(() => {
		if (!bootstrap || !repositoryId || !repository) return;
		if (!terminalCapability.available) {
			showToast(terminalCapability.reason ?? "The tmux terminal is unavailable.");
			return;
		}
		navigate("terminal");
	}, [bootstrap, navigate, repository, repositoryId, showToast, terminalCapability]);

	const resetForRepository = useCallback(() => {
		if (!onNavigateRef.current) setLocalMode(initialModeRef.current);
		setTerminalOpened(initialModeRef.current === "terminal");
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
		setMode: navigate,
		setSettingsDirty,
		settingsDirty,
		showReview,
		terminalOpened,
	};
}
