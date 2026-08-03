import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BootstrapResponse,
	ChangeFile,
	ChangesResponse,
	RepositoryCatalogEntry,
	RepositorySummary,
} from "../../../shared/contracts.ts";
import { ApiError, api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";
import { clearPwaStorage } from "../../offlineApp.ts";
import type { RepositoryConnectionState } from "./types.ts";

export type AppPhase = "loading" | "ready" | "error";
export type RepositoryHistoryMode = "none" | "push" | "replace";

export function useRepositoryWorkspace() {
	const [phase, setPhase] = useState<AppPhase>("loading");
	const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
	const [repositoryId, setRepositoryId] = useState<string | null>(null);
	const [repository, setRepository] = useState<RepositorySummary | null>(null);
	const [repositoryLoading, setRepositoryLoading] = useState(false);
	const [files, setFiles] = useState<ChangeFile[]>([]);
	const [operationRevision, setOperationRevision] = useState("");
	const [loadError, setLoadError] = useState("");
	const [loadErrorCode, setLoadErrorCode] = useState("");
	const [appCacheResetBusy, setAppCacheResetBusy] = useState(false);
	const [connectionState, setConnectionState] = useState<RepositoryConnectionState>("connected");
	const repositoryIdRef = useRef<string | null>(null);
	const operationRevisionRef = useRef("");
	const catalogRef = useRef<RepositoryCatalogEntry[]>([]);
	const loadGenerationRef = useRef(0);
	const requestRef = useRef<AbortController | null>(null);

	repositoryIdRef.current = repositoryId;
	operationRevisionRef.current = operationRevision;

	const applyOperationRevision = useCallback((nextRevision: string) => {
		operationRevisionRef.current = nextRevision;
		setOperationRevision(nextRevision);
	}, []);

	const markConnectionFailure = useCallback((error: unknown) => {
		if (error instanceof ApiError && error.status === 0) setConnectionState("offline");
	}, []);

	const applyRepositoryState = useCallback(
		(response: ChangesResponse) => {
			if (repositoryIdRef.current !== response.repository.id) return;
			applyOperationRevision(response.operationRevision);
			setFiles(response.files);
			setRepository(response.repository);
		},
		[applyOperationRevision],
	);

	const refreshChanges = useCallback(async (): Promise<ChangesResponse> => {
		const activeRepositoryId = repositoryIdRef.current;
		if (!activeRepositoryId) throw new Error("No repository is selected");
		const response = await api.changes(activeRepositoryId, requestRef.current?.signal);
		if (repositoryIdRef.current !== activeRepositoryId) return response;
		applyRepositoryState(response);
		return response;
	}, [applyRepositoryState]);

	const refreshRepositories = useCallback(async () => {
		const response = await api.repositories();
		catalogRef.current = response.repositories;
		setBootstrap((current) =>
			current
				? {
						...current,
						repositories: response.repositories,
						catalogRevision: response.catalogRevision,
					}
				: current,
		);
		return response;
	}, []);

	const loadRepository = useCallback(
		async (nextRepositoryId: string, historyMode: RepositoryHistoryMode) => {
			const generation = loadGenerationRef.current + 1;
			const showLoadingState = repositoryIdRef.current === null;
			loadGenerationRef.current = generation;
			requestRef.current?.abort();
			const controller = new AbortController();
			requestRef.current = controller;
			repositoryIdRef.current = nextRepositoryId;
			setRepositoryId(nextRepositoryId);
			setRepository(null);
			setFiles([]);
			applyOperationRevision("");
			setLoadError("");
			setRepositoryLoading(true);
			setPhase(showLoadingState ? "loading" : "ready");
			try {
				const changes = await api.changes(nextRepositoryId, controller.signal);
				if (
					loadGenerationRef.current !== generation ||
					repositoryIdRef.current !== nextRepositoryId
				) {
					return;
				}
				setRepository(changes.repository);
				setFiles(changes.files);
				applyOperationRevision(changes.operationRevision);
				if (historyMode !== "none") {
					const url = new URL(window.location.href);
					if (url.searchParams.get("repo") !== nextRepositoryId) {
						url.searchParams.set("repo", nextRepositoryId);
						window.history[historyMode === "push" ? "pushState" : "replaceState"](null, "", url);
					}
				}
				setConnectionState("connected");
				setPhase("ready");
			} catch (error) {
				if (loadGenerationRef.current !== generation) return;
				if (error instanceof DOMException && error.name === "AbortError") return;
				setLoadError(messageOf(error));
				markConnectionFailure(error);
				setPhase("error");
			} finally {
				if (loadGenerationRef.current === generation) setRepositoryLoading(false);
			}
		},
		[applyOperationRevision, markConnectionFailure],
	);

	const clearRepositorySelection = useCallback(() => {
		loadGenerationRef.current += 1;
		requestRef.current?.abort();
		requestRef.current = null;
		repositoryIdRef.current = null;
		setRepositoryId(null);
		setRepository(null);
		setRepositoryLoading(false);
		setFiles([]);
		applyOperationRevision("");
		setLoadError("");
		setLoadErrorCode("");
		const url = new URL(window.location.href);
		url.searchParams.delete("repo");
		window.history.replaceState(null, "", url);
		setPhase("ready");
	}, [applyOperationRevision]);

	const loadApp = useCallback(async () => {
		setPhase("loading");
		setLoadError("");
		setLoadErrorCode("");
		const currentUrl = new URL(window.location.href);
		const accessRefreshAttempted = currentUrl.searchParams.get("access_refresh") === "1";
		const clearAccessRefreshMarker = () => {
			if (!accessRefreshAttempted) return;
			currentUrl.searchParams.delete("access_refresh");
			window.history.replaceState(null, "", currentUrl);
		};
		try {
			const nextBootstrap = await api.bootstrap();
			clearAccessRefreshMarker();
			catalogRef.current = nextBootstrap.repositories;
			setBootstrap(nextBootstrap);
			const requestedId = currentUrl.searchParams.get("repo");
			const selected =
				nextBootstrap.repositories.find((item) => item.id === requestedId && item.available) ??
				nextBootstrap.repositories.find(
					(item) => item.id === nextBootstrap.defaultRepositoryId && item.available,
				) ??
				nextBootstrap.repositories.find((item) => item.available);
			if (!selected) {
				clearRepositorySelection();
				setConnectionState("connected");
				return;
			}
			await loadRepository(selected.id, "replace");
		} catch (error) {
			setLoadError(messageOf(error));
			const errorCode = error instanceof ApiError ? error.code : "unknown";
			setLoadErrorCode(
				errorCode === "authentication_required" && accessRefreshAttempted
					? "authentication_refresh_failed"
					: errorCode,
			);
			clearAccessRefreshMarker();
			markConnectionFailure(error);
			setPhase("error");
		}
	}, [clearRepositorySelection, loadRepository, markConnectionFailure]);

	const resetAppCache = useCallback(async () => {
		if (appCacheResetBusy) return;
		setAppCacheResetBusy(true);
		try {
			await clearPwaStorage();
			window.location.reload();
		} catch {
			setLoadError(
				"Couchview could not reset its app cache. Remove its website data in browser settings, then reload.",
			);
			setAppCacheResetBusy(false);
		}
	}, [appCacheResetBusy]);

	useEffect(() => {
		void loadApp();
		return () => requestRef.current?.abort();
	}, [loadApp]);

	const getOperationRevision = useCallback(() => operationRevisionRef.current, []);
	const getRepositoryId = useCallback(() => repositoryIdRef.current, []);

	return {
		appCacheResetBusy,
		applyOperationRevision,
		applyRepositoryState,
		bootstrap,
		clearRepositorySelection,
		connectionState,
		files,
		getOperationRevision,
		getRepositoryId,
		loadApp,
		loadError,
		loadErrorCode,
		loadRepository,
		markConnectionFailure,
		operationRevision,
		phase,
		refreshChanges,
		refreshRepositories,
		repository,
		repositoryId,
		repositoryLoading,
		resetAppCache,
		setBootstrap,
		setConnectionState,
		setFiles,
	};
}
