import { useWorkerPool } from "@pierre/diffs/react";
import {
	type SetStateAction,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ChangeFile, DiffSide, FileDiff } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { preloadFileDiffRendering } from "../../diffAdapter.ts";
import type { FailureState } from "../../lib/failures.ts";
import { diffCacheKey, readCachedDiff, rememberDiff } from "./diffCache.ts";
import {
	type LineRow,
	type LineSelection,
	navigationAtHunk,
	navigationAtVisibleLine,
	navigationBeforeFirstHunk,
	rowsForDiff,
	type SelectableSide,
	sideLine,
} from "./diffModel.ts";
import { commentSelectionForRows, viewerSelectionForRows } from "./diffSelection.ts";
import type { DiffViewerHandle } from "./types.ts";

interface UseDiffReviewOptions {
	files: ChangeFile[];
	onFileSelected: () => void;
	reportFailure: (error: unknown, context: string, toastMessage?: boolean) => FailureState;
	repositoryId: string | null;
}

export function useDiffReview({
	files,
	onFileSelected,
	reportFailure,
	repositoryId,
}: UseDiffReviewOptions) {
	const workerPool = useWorkerPool();
	const [currentFileId, setCurrentFileIdState] = useState<string | null>(null);
	const [diff, setDiff] = useState<FileDiff | null>(null);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [hunkNavigation, setHunkNavigation] = useState(navigationBeforeFirstHunk);
	const [selection, setSelection] = useState<LineSelection | null>(null);
	const viewerRef = useRef<DiffViewerHandle>(null);
	const currentFileIdRef = useRef(currentFileId);
	const repositoryIdRef = useRef(repositoryId);
	const filesRef = useRef(files);
	const diffRef = useRef(diff);
	const cacheRef = useRef(new Map<string, FileDiff>());
	const prefetchRef = useRef(new Map<string, Promise<FileDiff | null>>());
	const requestRef = useRef<{
		generation: number;
		controller: AbortController;
	} | null>(null);
	const repositoryRequestRef = useRef<AbortController | null>(null);
	const visibleLineRef = useRef<{ lineNumber: number; side: SelectableSide } | null>(null);
	const navigationLockUntilRef = useRef(0);
	currentFileIdRef.current = currentFileId;
	repositoryIdRef.current = repositoryId;
	filesRef.current = files;
	diffRef.current = diff;

	const setCurrentFileId = useCallback((value: SetStateAction<string | null>) => {
		setCurrentFileIdState((current) => {
			const next = typeof value === "function" ? value(current) : value;
			currentFileIdRef.current = next;
			return next;
		});
	}, []);

	useEffect(() => {
		requestRef.current?.controller.abort();
		repositoryRequestRef.current?.abort();
		repositoryRequestRef.current = repositoryId ? new AbortController() : null;
		currentFileIdRef.current = null;
		diffRef.current = null;
		setCurrentFileId(null);
		setDiff(null);
		setError("");
		setLoading(false);
		setSelection(null);
		setHunkNavigation(navigationBeforeFirstHunk());
		return () => {
			requestRef.current?.controller.abort();
			repositoryRequestRef.current?.abort();
		};
	}, [repositoryId, setCurrentFileId]);

	const rows = useMemo(() => rowsForDiff(diff), [diff]);
	const activeFile = useMemo(
		() => files.find((file) => file.id === currentFileId) ?? null,
		[currentFileId, files],
	);
	const activeFileIndex = activeFile ? files.findIndex((file) => file.id === activeFile.id) : -1;

	useEffect(() => {
		setCurrentFileId((current) => {
			if (current && files.some((file) => file.id === current)) return current;
			return files.find((file) => !file.reviewed)?.id ?? files[0]?.id ?? null;
		});
	}, [files, setCurrentFileId]);
	const commentSelection = useMemo(
		() => commentSelectionForRows(rows, selection),
		[rows, selection],
	);
	const viewerSelection = useMemo(() => viewerSelectionForRows(rows, selection), [rows, selection]);
	const hunkCount = diff?.hunks.length ?? 0;
	const canNavigatePreviousHunk =
		hunkNavigation.previous !== null && hunkNavigation.previous < hunkCount;
	const canNavigateNextHunk = hunkNavigation.next !== null && hunkNavigation.next < hunkCount;

	const setDiffState = useCallback((nextDiff: FileDiff | null) => {
		diffRef.current = nextDiff;
		setDiff(nextDiff);
	}, []);

	const primeRendering = useCallback(
		(nextDiff: FileDiff) => {
			try {
				preloadFileDiffRendering(nextDiff, workerPool);
			} catch {
				// Background preloading is best-effort; the visible viewer reports its own errors.
			}
		},
		[workerPool],
	);

	const prefetchDiff = useCallback(
		(activeRepositoryId: string, file: ChangeFile): Promise<FileDiff | null> => {
			const cached = readCachedDiff(cacheRef.current, activeRepositoryId, file);
			if (cached) {
				primeRendering(cached);
				return Promise.resolve(cached);
			}
			const key = diffCacheKey(activeRepositoryId, file.id, file.contentRevision);
			const existing = prefetchRef.current.get(key);
			if (existing) return existing;

			let pending: Promise<FileDiff | null>;
			pending = api
				.diff(activeRepositoryId, file.id, repositoryRequestRef.current?.signal)
				.then((response) => {
					if (
						repositoryIdRef.current !== activeRepositoryId ||
						response.diff.fileId !== file.id ||
						response.diff.contentRevision !== file.contentRevision
					) {
						return null;
					}
					rememberDiff(cacheRef.current, activeRepositoryId, response.diff);
					primeRendering(response.diff);
					return response.diff;
				})
				.catch(() => null)
				.finally(() => {
					if (prefetchRef.current.get(key) === pending) prefetchRef.current.delete(key);
				});
			prefetchRef.current.set(key, pending);
			return pending;
		},
		[primeRendering],
	);

	const loadDiff = useCallback(
		async (fileId: string, resetPosition = false, fileOverride?: ChangeFile) => {
			const activeRepositoryId = repositoryIdRef.current;
			if (!activeRepositoryId) return;
			const file =
				fileOverride?.id === fileId
					? fileOverride
					: filesRef.current.find((candidate) => candidate.id === fileId);
			if (!file) return;
			requestRef.current?.controller.abort();
			const generation = (requestRef.current?.generation ?? 0) + 1;
			const controller = new AbortController();
			requestRef.current = { generation, controller };
			setError("");
			const cached = readCachedDiff(cacheRef.current, activeRepositoryId, file);
			if (cached) {
				if (resetPosition) {
					setSelection(null);
					setHunkNavigation(navigationBeforeFirstHunk());
				}
				primeRendering(cached);
				setDiffState(cached);
				setLoading(false);
				return;
			}

			setLoading(true);
			try {
				const key = diffCacheKey(activeRepositoryId, file.id, file.contentRevision);
				const prefetched = await prefetchRef.current.get(key);
				const nextDiff =
					prefetched ?? (await api.diff(activeRepositoryId, fileId, controller.signal)).diff;
				if (
					requestRef.current?.generation !== generation ||
					repositoryIdRef.current !== activeRepositoryId ||
					currentFileIdRef.current !== fileId ||
					nextDiff.fileId !== fileId
				) {
					return;
				}
				rememberDiff(cacheRef.current, activeRepositoryId, nextDiff);
				primeRendering(nextDiff);
				if (resetPosition) {
					setSelection(null);
					setHunkNavigation(navigationBeforeFirstHunk());
				}
				setDiffState(nextDiff);
			} catch (loadError) {
				if (loadError instanceof DOMException && loadError.name === "AbortError") return;
				if (requestRef.current?.generation === generation) {
					setError(reportFailure(loadError, "Load diff", false).message);
				}
			} finally {
				if (requestRef.current?.generation === generation) setLoading(false);
			}
		},
		[primeRendering, reportFailure, setDiffState],
	);

	useLayoutEffect(() => {
		setSelection(null);
		visibleLineRef.current = null;
		navigationLockUntilRef.current = 0;
		setHunkNavigation(navigationBeforeFirstHunk());
		setError("");
		if (!currentFileId) {
			requestRef.current?.controller.abort();
			setDiffState(null);
			setLoading(false);
			return;
		}
		const activeRepositoryId = repositoryIdRef.current;
		const file = filesRef.current.find((candidate) => candidate.id === currentFileId);
		const cached =
			activeRepositoryId && file
				? readCachedDiff(cacheRef.current, activeRepositoryId, file)
				: null;
		if (cached) {
			requestRef.current?.controller.abort();
			primeRendering(cached);
			setDiffState(cached);
			setLoading(false);
			return;
		}
		setDiffState(null);
		void loadDiff(currentFileId);
		return () => {
			if (currentFileIdRef.current !== currentFileId) {
				requestRef.current?.controller.abort();
			}
		};
	}, [currentFileId, loadDiff, primeRendering, setDiffState]);

	useEffect(() => {
		if (!repositoryId || !currentFileId) return;
		const index = files.findIndex((file) => file.id === currentFileId);
		if (index < 0) return;
		const neighbors = [files[index + 1], files[index - 1]].filter((file): file is ChangeFile =>
			Boolean(file),
		);
		const timeout = window.setTimeout(() => {
			if (repositoryIdRef.current !== repositoryId) return;
			for (const file of neighbors) void prefetchDiff(repositoryId, file);
		}, 0);
		return () => window.clearTimeout(timeout);
	}, [currentFileId, files, prefetchDiff, repositoryId]);

	const selectFile = useCallback(
		(fileId: string) => {
			setCurrentFileId(fileId);
			onFileSelected();
			viewerRef.current?.scrollToTop();
		},
		[onFileSelected],
	);

	const navigateFile = useCallback(
		(direction: -1 | 1) => {
			if (activeFileIndex < 0) return;
			const next = files[activeFileIndex + direction];
			if (next) selectFile(next.id);
		},
		[activeFileIndex, files, selectFile],
	);

	const navigateHunk = useCallback(
		(direction: -1 | 1) => {
			const targetHunk = direction === -1 ? hunkNavigation.previous : hunkNavigation.next;
			if (targetHunk === null || targetHunk < 0 || targetHunk >= hunkCount) return;
			if (hunkCount > 1) navigationLockUntilRef.current = Date.now() + 250;
			setHunkNavigation(navigationAtHunk(targetHunk, hunkCount));
			viewerRef.current?.scrollToHunk(targetHunk);
		},
		[hunkCount, hunkNavigation],
	);

	const handleGutterClick = useCallback((rowIndex: number, row: LineRow, side: SelectableSide) => {
		if (sideLine(row.line, side) === null || row.line.kind === "metadata") return;
		setSelection((current) => {
			if (!current || current.hunkId !== row.hunk.id) {
				return {
					side,
					hunkId: row.hunk.id,
					anchorIndex: rowIndex,
					focusIndex: rowIndex,
					anchorSide: side,
					focusSide: side,
				};
			}
			const nextSide: DiffSide = current.side === "mixed" || current.side !== side ? "mixed" : side;
			return { ...current, side: nextSide, focusIndex: rowIndex, focusSide: side };
		});
	}, []);

	const handleVisibleLineChange = useCallback(
		(lineNumber: number, side: SelectableSide) => {
			visibleLineRef.current = { lineNumber, side };
			if (Date.now() < navigationLockUntilRef.current) return;
			setHunkNavigation(navigationAtVisibleLine(diff?.hunks ?? [], lineNumber, side));
		},
		[diff],
	);

	const handleViewerLineNumberClick = useCallback(
		(lineNumber: number, side: SelectableSide) => {
			const rowIndex = rows.findIndex(
				(candidate) =>
					candidate.type === "line" &&
					candidate.line.kind !== "metadata" &&
					sideLine(candidate.line, side) === lineNumber,
			);
			const row = rows[rowIndex];
			if (rowIndex >= 0 && row?.type === "line") {
				handleGutterClick(rowIndex, row, side);
			}
		},
		[handleGutterClick, rows],
	);

	const getCurrentFileId = useCallback(() => currentFileIdRef.current, []);
	const getDiff = useCallback(() => diffRef.current, []);

	return {
		activeFile,
		activeFileIndex,
		canNavigateNextHunk,
		canNavigatePreviousHunk,
		commentSelection,
		currentFileId,
		diff,
		error,
		getCurrentFileId,
		getDiff,
		handleViewerLineNumberClick,
		handleVisibleLineChange,
		loadDiff,
		loading,
		navigateFile,
		navigateHunk,
		rows,
		selectFile,
		selection,
		setCurrentFileId,
		setDiff: setDiffState,
		setSelection,
		viewerRef,
		viewerSelection,
	};
}
