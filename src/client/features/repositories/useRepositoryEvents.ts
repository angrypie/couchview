import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import {
	API_ROUTES,
	type ChangesResponse,
	type FileDiff,
	type ServerEvent,
} from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { withDiffFileMetadata } from "../staging/changeFiles.ts";
import type { RepositoryConnectionState } from "./types.ts";
import type { RepositoryHistoryMode } from "./useRepositoryWorkspace.ts";

interface UseRepositoryEventsOptions {
	clearRepositorySelection: () => void;
	getCurrentFileId: () => string | null;
	getDiff: () => FileDiff | null;
	getOperationRevision: () => string;
	getRepositoryId: () => string | null;
	loadDiff: (
		fileId: string,
		resetPosition?: boolean,
		fileOverride?: ChangesResponse["files"][number],
	) => Promise<unknown>;
	loadRepository: (repositoryId: string, historyMode: RepositoryHistoryMode) => Promise<void>;
	markConnectionFailure: (error: unknown) => void;
	phase: "loading" | "ready" | "error";
	queueExternalStageChange: (repositoryId: string, operationRevision: string) => boolean;
	refreshChanges: () => Promise<ChangesResponse>;
	refreshPackageScripts: () => Promise<unknown>;
	refreshRepositories: () => Promise<{
		repositories: Array<{ id: string; available: boolean }>;
	}>;
	refreshReviewState: () => Promise<unknown>;
	repositoryId: string | null;
	repositoryLoading: boolean;
	setConnectionState: Dispatch<SetStateAction<RepositoryConnectionState>>;
	setDiff: (diff: FileDiff | null) => void;
}

export function useRepositoryEvents({
	clearRepositorySelection,
	getCurrentFileId,
	getDiff,
	getOperationRevision,
	getRepositoryId,
	loadDiff,
	loadRepository,
	markConnectionFailure,
	phase,
	queueExternalStageChange,
	refreshChanges,
	refreshPackageScripts,
	refreshRepositories,
	refreshReviewState,
	repositoryId,
	repositoryLoading,
	setConnectionState,
	setDiff,
}: UseRepositoryEventsOptions) {
	const eventSourceRef = useRef<EventSource | null>(null);
	const probeRef = useRef<AbortController | null>(null);

	useEffect(() => {
		eventSourceRef.current?.close();
		eventSourceRef.current = null;
		probeRef.current?.abort();
		probeRef.current = null;
		if (phase !== "ready" || repositoryLoading || !repositoryId) return;
		const stream = new EventSource(API_ROUTES.events(repositoryId));
		eventSourceRef.current = stream;
		const markConnected = () => {
			probeRef.current?.abort();
			probeRef.current = null;
			setConnectionState("connected");
		};
		stream.onopen = markConnected;
		stream.onerror = () => {
			setConnectionState((current) => (current === "offline" ? current : "reconnecting"));
			probeRef.current?.abort();
			const controller = new AbortController();
			probeRef.current = controller;
			void api.instance(controller.signal).then(
				() => {
					if (probeRef.current !== controller) return;
					probeRef.current = null;
					setConnectionState((current) => (current === "connected" ? current : "reconnecting"));
				},
				(error) => {
					if (probeRef.current !== controller) return;
					probeRef.current = null;
					markConnectionFailure(error);
				},
			);
		};
		stream.onmessage = (message) => {
			markConnected();
			try {
				const event = JSON.parse(message.data) as ServerEvent;
				if (event.repositoryId !== repositoryId) return;
				if (event.type === "changes" || event.type === "ready") {
					void refreshPackageScripts().catch(() => undefined);
					if (
						event.type === "changes" &&
						queueExternalStageChange(repositoryId, event.operationRevision)
					) {
						return;
					}
					if (event.operationRevision === getOperationRevision()) {
						if (event.type === "ready") {
							void refreshReviewState().catch(markConnectionFailure);
						}
						return;
					}
					const fileId = getCurrentFileId();
					void refreshChanges()
						.then(async (response) => {
							await refreshReviewState();
							if (!fileId) return;
							const file = response.files.find((candidate) => candidate.id === fileId);
							if (!file) return;
							const currentDiff = getDiff();
							if (
								currentDiff?.fileId === fileId &&
								currentDiff.contentRevision === file.contentRevision
							) {
								setDiff(withDiffFileMetadata(currentDiff, file, response.operationRevision));
								return;
							}
							await loadDiff(fileId, true, file);
						})
						.catch(markConnectionFailure);
				}
				if (event.type === "state") {
					void refreshReviewState().catch(markConnectionFailure);
				}
				if (event.type === "repositories") {
					void refreshRepositories()
						.then((catalog) => {
							const current = catalog.repositories.find((item) => item.id === getRepositoryId());
							if (current?.available) return;
							const next = catalog.repositories.find((item) => item.available);
							if (next) void loadRepository(next.id, "replace");
							else clearRepositorySelection();
						})
						.catch(markConnectionFailure);
				}
			} catch {
				// Ignore malformed keep-alives while leaving the stream connected.
			}
		};
		return () => {
			probeRef.current?.abort();
			probeRef.current = null;
			stream.close();
			if (eventSourceRef.current === stream) eventSourceRef.current = null;
		};
	}, [
		clearRepositorySelection,
		getCurrentFileId,
		getDiff,
		getOperationRevision,
		getRepositoryId,
		loadDiff,
		loadRepository,
		markConnectionFailure,
		phase,
		queueExternalStageChange,
		refreshChanges,
		refreshPackageScripts,
		refreshRepositories,
		refreshReviewState,
		repositoryId,
		repositoryLoading,
		setConnectionState,
		setDiff,
	]);
}
