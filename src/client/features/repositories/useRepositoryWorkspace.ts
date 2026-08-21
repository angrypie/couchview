import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BootstrapResponse,
	ChangesResponse,
	FileChange,
	RepositoryCatalogEntry,
	RepositorySummary,
} from "../../../shared/contracts.ts";
import { ApiError, api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";
import { clearPwaStorage } from "../../offlineApp";
import type { RepositoryConnectionState } from "./types.ts";

export type AppPhase = "loading" | "ready" | "error";
export type RepositoryHistoryMode = "none" | "push" | "replace";

interface RepositoryWorkspaceOptions {
	accessRefreshAttempted?: boolean;
	onAccessRefreshHandled?: () => void;
	onReload?: () => void;
	onRepositorySelection?: (
		repositoryId: string | null,
		historyMode: Exclude<RepositoryHistoryMode, "none">,
	) => void;
	requestedRepositoryId?: string | null;
}

export function useRepositoryWorkspace({
	accessRefreshAttempted = false,
	onAccessRefreshHandled,
	onReload,
	onRepositorySelection,
	requestedRepositoryId = null,
}: RepositoryWorkspaceOptions = {}) {
	const [phase, setPhase] = useState<AppPhase>("loading");
	const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
	const [repositoryId, setRepositoryId] = useState<string | null>(null);
	const [repository, setRepository] = useState<RepositorySummary | null>(null);
	const [repositoryLoading, setRepositoryLoading] = useState(false);
	const [files, setFiles] = useState<FileChange[]>([]);
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
	const requestedRepositoryIdRef = useRef(requestedRepositoryId);
	const accessRefreshAttemptedRef = useRef(accessRefreshAttempted);
	const previousAccessRefreshAttemptedRef = useRef(accessRefreshAttempted);
	const routeCallbacksRef = useRef({
		onAccessRefreshHandled,
		onReload,
		onRepositorySelection,
	});

	repositoryIdRef.current = repositoryId;
	operationRevisionRef.current = operationRevision;
	requestedRepositoryIdRef.current = requestedRepositoryId;
	routeCallbacksRef.current = { onAccessRefreshHandled, onReload, onRepositorySelection };

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
			if (
				historyMode !== "none" &&
				routeCallbacksRef.current.onRepositorySelection &&
				requestedRepositoryIdRef.current !== nextRepositoryId
			) {
				routeCallbacksRef.current.onRepositorySelection(nextRepositoryId, historyMode);
				return;
			}
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
		routeCallbacksRef.current.onRepositorySelection?.(null, "replace");
		setPhase("ready");
	}, [applyOperationRevision]);

	const loadApp = useCallback(async () => {
		const refreshAttempted = accessRefreshAttemptedRef.current;
		setPhase("loading");
		setLoadError("");
		setLoadErrorCode("");
		const clearAccessRefreshMarker = () => {
			if (!refreshAttempted) return;
			accessRefreshAttemptedRef.current = false;
			routeCallbacksRef.current.onAccessRefreshHandled?.();
		};
		try {
			const nextBootstrap = await api.bootstrap();
			clearAccessRefreshMarker();
			catalogRef.current = nextBootstrap.repositories;
			setBootstrap(nextBootstrap);
			const requestedId = requestedRepositoryIdRef.current;
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
				errorCode === "authentication_required" && refreshAttempted
					? "authentication_refresh_failed"
					: errorCode,
			);
			clearAccessRefreshMarker();
			markConnectionFailure(error);
			setPhase("error");
		}
	}, [clearRepositorySelection, loadRepository, markConnectionFailure]);

	useEffect(() => {
		const previouslyAttempted = previousAccessRefreshAttemptedRef.current;
		previousAccessRefreshAttemptedRef.current = accessRefreshAttempted;
		if (previouslyAttempted || !accessRefreshAttempted) return;
		accessRefreshAttemptedRef.current = true;
		void loadApp();
	}, [accessRefreshAttempted, loadApp]);

	useEffect(() => {
		if (!bootstrap) return;
		if (!requestedRepositoryId || requestedRepositoryId === repositoryIdRef.current) return;
		const selected = bootstrap.repositories.find(
			(item) => item.id === requestedRepositoryId && item.available,
		);
		if (selected) void loadRepository(selected.id, "none");
	}, [bootstrap, loadRepository, requestedRepositoryId]);

	const resetAppCache = useCallback(async () => {
		if (appCacheResetBusy) return;
		setAppCacheResetBusy(true);
		try {
			await clearPwaStorage();
			if (routeCallbacksRef.current.onReload) routeCallbacksRef.current.onReload();
			else await loadApp();
		} catch {
			setLoadError(
				"Couchview could not reset its app cache. Remove its website data in browser settings, then reload.",
			);
			setAppCacheResetBusy(false);
		}
	}, [appCacheResetBusy, loadApp]);

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
