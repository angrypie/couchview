import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ChangesResponse, FileChange, FileDiff } from "../../../shared/contracts.ts";
import { ApiError, api } from "../../api.ts";
import type { FailureState } from "../../lib/failures.ts";
import { applyChangeFileDelta, withDiffFileMetadata } from "./changeFiles.ts";
import type { BulkStageScope } from "./types.ts";

interface PendingStageMutation {
	repositoryId: string;
	queuedOperationRevision: string | null;
}

interface UseStagingWorkflowOptions {
	activeFile: FileChange | null;
	activeFileIndex: number;
	csrfToken?: string;
	currentFileId: string | null;
	diff: FileDiff | null;
	files: FileChange[];
	loadDiff: (fileId: string, resetPosition?: boolean) => Promise<unknown>;
	onOperationRevision: (operationRevision: string) => void;
	operationRevision: string;
	refreshChanges: () => Promise<ChangesResponse>;
	reportFailure: (error: unknown, context: string) => FailureState;
	repositoryId: string | null;
	setCurrentFileId: Dispatch<SetStateAction<string | null>>;
	setDiff: (diff: FileDiff | null) => void;
	setFiles: Dispatch<SetStateAction<FileChange[]>>;
	showToast: (message: string) => void;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useStagingWorkflow({
	activeFile,
	activeFileIndex,
	csrfToken,
	currentFileId,
	diff,
	files,
	loadDiff,
	onOperationRevision,
	operationRevision,
	refreshChanges,
	reportFailure,
	repositoryId,
	setCurrentFileId,
	setDiff,
	setFiles,
	showToast,
}: UseStagingWorkflowOptions) {
	const [busy, setBusy] = useState(false);
	const [bulkBusy, setBulkBusy] = useState<BulkStageScope | null>(null);
	const pendingMutationRef = useRef<PendingStageMutation | null>(null);
	const requestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	const currentFileIdRef = useRef(currentFileId);
	const diffRef = useRef(diff);
	repositoryIdRef.current = repositoryId;
	currentFileIdRef.current = currentFileId;
	diffRef.current = diff;

	useEffect(() => {
		requestRef.current?.abort();
		requestRef.current = repositoryId ? new AbortController() : null;
		pendingMutationRef.current = null;
		setBusy(false);
		setBulkBusy(null);
		return () => requestRef.current?.abort();
	}, [repositoryId]);

	const updateDiff = useCallback(
		(nextDiff: FileDiff) => {
			diffRef.current = nextDiff;
			setDiff(nextDiff);
		},
		[setDiff],
	);

	const reconcileChangedFile = useCallback(
		async (fileId: string, resetPosition = false) => {
			const response = await refreshChanges();
			const file = response.files.find((candidate) => candidate.id === fileId);
			if (!file || currentFileIdRef.current !== fileId) return;
			const currentDiff = diffRef.current;
			if (currentDiff?.fileId === fileId && currentDiff.contentRevision === file.contentRevision) {
				updateDiff(withDiffFileMetadata(currentDiff, file, response.operationRevision));
				return;
			}
			await loadDiff(fileId, resetPosition);
		},
		[loadDiff, refreshChanges, updateDiff],
	);

	const queueExternalChange = useCallback(
		(eventRepositoryId: string, eventOperationRevision: string) => {
			const pending = pendingMutationRef.current;
			if (pending?.repositoryId !== eventRepositoryId) return false;
			pending.queuedOperationRevision = eventOperationRevision;
			return true;
		},
		[],
	);

	const toggleActiveFile = useCallback(async () => {
		if (!activeFile || !csrfToken || !repositoryId || busy || bulkBusy) return;
		const activeRepositoryId = repositoryId;
		const signal = requestRef.current?.signal;
		const shouldStage = !activeFile.staged || activeFile.unstaged;
		const mutation: PendingStageMutation = {
			repositoryId: activeRepositoryId,
			queuedOperationRevision: null,
		};
		pendingMutationRef.current = mutation;
		setBusy(true);
		setFiles((current) =>
			current.map((file) =>
				file.id === activeFile.id ? { ...file, staged: shouldStage, unstaged: !shouldStage } : file,
			),
		);
		try {
			const response = await api.stage(
				activeRepositoryId,
				{
					fileId: activeFile.id,
					operationRevision,
					contentRevision: activeFile.contentRevision,
					staged: shouldStage,
				},
				csrfToken,
				signal,
			);
			if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
			const queuedOperationRevision = mutation.queuedOperationRevision;
			if (pendingMutationRef.current === mutation) pendingMutationRef.current = null;
			onOperationRevision(response.operationRevision);
			setFiles((current) => applyChangeFileDelta(current, response.changes));
			if (!response.file && response.changes.removedFileIds.includes(activeFile.id)) {
				const remainingFiles = applyChangeFileDelta(files, response.changes);
				const nextFileId =
					remainingFiles[Math.min(activeFileIndex, remainingFiles.length - 1)]?.id ?? null;
				currentFileIdRef.current = nextFileId;
				setCurrentFileId(nextFileId);
			}
			const currentDiff = diffRef.current;
			if (
				response.file &&
				currentDiff?.fileId === activeFile.id &&
				currentDiff.contentRevision === response.file.contentRevision
			) {
				updateDiff(withDiffFileMetadata(currentDiff, response.file, response.operationRevision));
			} else if (response.file && currentFileIdRef.current === activeFile.id) {
				await loadDiff(activeFile.id);
			}
			if (queuedOperationRevision && queuedOperationRevision !== response.operationRevision) {
				await reconcileChangedFile(activeFile.id, true);
			}
			showToast(shouldStage ? "File staged" : "File unstaged");
		} catch (error) {
			const queuedOperationRevision = mutation.queuedOperationRevision;
			if (pendingMutationRef.current === mutation) pendingMutationRef.current = null;
			setFiles((current) =>
				current.map((file) =>
					file.id === activeFile.id
						? { ...file, staged: activeFile.staged, unstaged: activeFile.unstaged }
						: file,
				),
			);
			if (
				signal?.aborted ||
				repositoryIdRef.current !== activeRepositoryId ||
				isAbortError(error)
			) {
				return;
			}
			reportFailure(error, shouldStage ? "Stage file" : "Unstage file");
			if (queuedOperationRevision || (error instanceof ApiError && error.status === 409)) {
				void reconcileChangedFile(activeFile.id, true);
			}
		} finally {
			if (pendingMutationRef.current === mutation) pendingMutationRef.current = null;
			if (repositoryIdRef.current === activeRepositoryId) setBusy(false);
		}
	}, [
		activeFile,
		activeFileIndex,
		bulkBusy,
		busy,
		csrfToken,
		files,
		loadDiff,
		onOperationRevision,
		operationRevision,
		reconcileChangedFile,
		reportFailure,
		repositoryId,
		setCurrentFileId,
		setFiles,
		showToast,
		updateDiff,
	]);

	const stageMultiple = useCallback(
		async (scope: BulkStageScope) => {
			if (!csrfToken || !repositoryId || busy || bulkBusy) return;
			const targets = files.filter(
				(file) => (!file.staged || file.unstaged) && (scope === "all" || file.reviewed),
			);
			if (targets.length === 0) return;

			const activeRepositoryId = repositoryId;
			const signal = requestRef.current?.signal;
			const targetIds = new Set(targets.map((file) => file.id));
			const previousById = new Map(
				targets.map((file) => [file.id, { staged: file.staged, unstaged: file.unstaged }]),
			);
			const mutation: PendingStageMutation = {
				repositoryId: activeRepositoryId,
				queuedOperationRevision: null,
			};
			pendingMutationRef.current = mutation;
			setBulkBusy(scope);
			setFiles((current) =>
				current.map((file) =>
					targetIds.has(file.id) ? { ...file, staged: true, unstaged: false } : file,
				),
			);

			try {
				const response = await api.stageFiles(
					activeRepositoryId,
					{
						files: targets.map((file) => ({
							fileId: file.id,
							contentRevision: file.contentRevision,
						})),
						operationRevision,
					},
					csrfToken,
					signal,
				);
				if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;

				const queuedOperationRevision = mutation.queuedOperationRevision;
				if (pendingMutationRef.current === mutation) pendingMutationRef.current = null;
				onOperationRevision(response.operationRevision);
				setFiles((current) => applyChangeFileDelta(current, response.changes));

				const previousActiveFileId = currentFileIdRef.current;
				if (
					previousActiveFileId &&
					response.changes.removedFileIds.includes(previousActiveFileId)
				) {
					const remainingFiles = applyChangeFileDelta(files, response.changes);
					const previousIndex = files.findIndex((file) => file.id === previousActiveFileId);
					const nextFileId =
						remainingFiles[Math.min(Math.max(previousIndex, 0), remainingFiles.length - 1)]?.id ??
						null;
					currentFileIdRef.current = nextFileId;
					setCurrentFileId(nextFileId);
				} else if (previousActiveFileId) {
					const currentDiff = diffRef.current;
					const updatedActiveFile = response.files.find((file) => file.id === previousActiveFileId);
					if (
						updatedActiveFile &&
						currentDiff?.fileId === previousActiveFileId &&
						currentDiff.contentRevision === updatedActiveFile.contentRevision
					) {
						updateDiff(
							withDiffFileMetadata(currentDiff, updatedActiveFile, response.operationRevision),
						);
					} else if (updatedActiveFile && currentFileIdRef.current === previousActiveFileId) {
						await loadDiff(previousActiveFileId);
					} else if (currentDiff?.fileId === previousActiveFileId) {
						updateDiff({
							...currentDiff,
							operationRevision: response.operationRevision,
						});
					}
				}

				if (queuedOperationRevision && queuedOperationRevision !== response.operationRevision) {
					const fileId = currentFileIdRef.current;
					if (fileId) await reconcileChangedFile(fileId, true);
				}
				const noun = targets.length === 1 ? "file" : "files";
				showToast(
					scope === "reviewed"
						? `${targets.length} reviewed ${noun} staged`
						: `${targets.length} ${noun} staged`,
				);
			} catch (error) {
				const queuedOperationRevision = mutation.queuedOperationRevision;
				if (pendingMutationRef.current === mutation) pendingMutationRef.current = null;
				setFiles((current) =>
					current.map((file) => {
						const previous = previousById.get(file.id);
						return previous ? { ...file, ...previous } : file;
					}),
				);
				if (
					signal?.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				reportFailure(error, scope === "reviewed" ? "Stage reviewed files" : "Stage all files");
				if (queuedOperationRevision || (error instanceof ApiError && error.status === 409)) {
					const fileId = currentFileIdRef.current;
					if (fileId) void reconcileChangedFile(fileId, true);
				}
			} finally {
				if (pendingMutationRef.current === mutation) pendingMutationRef.current = null;
				if (repositoryIdRef.current === activeRepositoryId) setBulkBusy(null);
			}
		},
		[
			bulkBusy,
			busy,
			csrfToken,
			files,
			loadDiff,
			onOperationRevision,
			operationRevision,
			reconcileChangedFile,
			reportFailure,
			repositoryId,
			setCurrentFileId,
			setFiles,
			showToast,
			updateDiff,
		],
	);

	return {
		bulkBusy,
		busy,
		queueExternalChange,
		stageMultiple,
		toggleActiveFile,
	};
}
