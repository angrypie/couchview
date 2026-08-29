import {
	type SetStateAction,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { FileChange, FileDiff } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import type { FailureState } from "../../lib/failures.ts";
import { diffCacheKey, readCachedDiff, rememberDiff } from "./diffCache.ts";
import {
	navigationAtHunk,
	navigationAtVisibleLine,
	navigationBeforeFirstHunk,
	rowsForDiff,
	type SelectableSide,
} from "./diffModel.ts";
import type { DiffViewerHandle } from "./types.ts";
import { useSourceFileView } from "./useSourceFileView.ts";

interface UseDiffReviewOptions {
	files: FileChange[];
	onFileSelected: () => void;
	onRefreshChanges: () => Promise<unknown>;
	operationRevision: string;
	reportFailure: (error: unknown, context: string, toastMessage?: boolean) => FailureState;
	repositoryId: string | null;
}

const HUNK_NAVIGATION_REPORT_TIMEOUT_MS = 5_000;

function diffContainsNewLine(diff: FileDiff, lineNumber: number): boolean {
	if (diff.hunks.some((hunk) => hunk.lines.some((line) => line.newLine === lineNumber))) {
		return true;
	}
	if (!diff.fullFilePatch) return false;
	for (const match of diff.fullFilePatch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
		const start = Number(match[1]);
		const count = match[2] === undefined ? 1 : Number(match[2]);
		if (lineNumber >= start && lineNumber < start + count) return true;
	}
	return false;
}

export function useDiffReview({
	files,
	onFileSelected,
	onRefreshChanges,
	operationRevision,
	reportFailure,
	repositoryId,
}: UseDiffReviewOptions) {
	const [currentFileId, setCurrentFileIdState] = useState<string | null>(null);
	const [diff, setDiff] = useState<FileDiff | null>(null);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [hunkNavigation, setHunkNavigation] = useState(navigationBeforeFirstHunk);
	const [lineNavigation, setLineNavigation] = useState<{ line: number; path: string } | null>(null);
	const viewerRef = useRef<DiffViewerHandle>(null);
	const source = useSourceFileView({
		onRefreshChanges,
		operationRevision,
		reportFailure,
		repositoryId,
	});
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
	const pendingHunkNavigationRef = useRef<{
		expiresAt: number;
		hunkIndex: number;
	} | null>(null);
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
		pendingHunkNavigationRef.current = null;
		setHunkNavigation(navigationBeforeFirstHunk());
		return () => {
			requestRef.current?.controller.abort();
			repositoryRequestRef.current?.abort();
		};
	}, [repositoryId, setCurrentFileId]);

	const selectedFile = useMemo(
		() => files.find((file) => file.id === currentFileId) ?? null,
		[currentFileId, files],
	);
	const selectedFileIndex = selectedFile
		? files.findIndex((file) => file.id === selectedFile.id)
		: -1;
	const sourceChangedFile = source.changeFileId
		? (files.find((file) => file.id === source.changeFileId) ?? null)
		: null;
	const activeFile = source.path ? sourceChangedFile : selectedFile;
	const activeFileIndex = source.path
		? sourceChangedFile
			? files.findIndex((file) => file.id === sourceChangedFile.id)
			: -1
		: selectedFileIndex;
	const displayDiff = source.path ? source.diff : diff;
	const rows = useMemo(() => rowsForDiff(displayDiff), [displayDiff]);
	const activePath = source.path ?? selectedFile?.path ?? null;

	useEffect(() => {
		setCurrentFileId((current) => {
			if (current && files.some((file) => file.id === current)) return current;
			return files.find((file) => !file.reviewed)?.id ?? files[0]?.id ?? null;
		});
	}, [files, setCurrentFileId]);
	const hunkCount = diff?.hunks.length ?? 0;
	const canNavigatePreviousHunk =
		!source.path && hunkNavigation.previous !== null && hunkNavigation.previous < hunkCount;
	const canNavigateNextHunk =
		!source.path && hunkNavigation.next !== null && hunkNavigation.next < hunkCount;

	const setDiffState = useCallback((nextDiff: FileDiff | null) => {
		diffRef.current = nextDiff;
		setDiff(nextDiff);
	}, []);

	const prefetchDiff = useCallback(
		(activeRepositoryId: string, file: FileChange): Promise<FileDiff | null> => {
			const cached = readCachedDiff(cacheRef.current, activeRepositoryId, file);
			if (cached) {
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
					return response.diff;
				})
				.catch(() => null)
				.finally(() => {
					if (prefetchRef.current.get(key) === pending) prefetchRef.current.delete(key);
				});
			prefetchRef.current.set(key, pending);
			return pending;
		},
		[],
	);

	const loadDiff = useCallback(
		async (fileId: string, resetPosition = false, fileOverride?: FileChange) => {
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
					setHunkNavigation(navigationBeforeFirstHunk());
				}
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
				if (resetPosition) {
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
		[reportFailure, setDiffState],
	);

	useLayoutEffect(() => {
		pendingHunkNavigationRef.current = null;
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
	}, [currentFileId, loadDiff, setDiffState]);

	useEffect(() => {
		if (!repositoryId || !currentFileId) return;
		const index = files.findIndex((file) => file.id === currentFileId);
		if (index < 0) return;
		const neighbors = [files[index + 1], files[index - 1]].filter((file): file is FileChange =>
			Boolean(file),
		);
		const timeout = setTimeout(() => {
			if (repositoryIdRef.current !== repositoryId) return;
			for (const file of neighbors) void prefetchDiff(repositoryId, file);
		}, 0);
		return () => clearTimeout(timeout);
	}, [currentFileId, files, prefetchDiff, repositoryId]);

	const selectFile = useCallback(
		(fileId: string) => {
			source.close();
			setLineNavigation(null);
			setCurrentFileId(fileId);
			onFileSelected();
			viewerRef.current?.scrollToTop();
		},
		[onFileSelected, source.close],
	);
	const openPathAtLine = useCallback(
		(path: string, line = 1) => {
			const safeLine = Number.isSafeInteger(line) && line > 0 ? line : 1;
			const changedFile = filesRef.current.find((file) => file.path === path);
			if (changedFile) {
				selectFile(changedFile.id);
				setLineNavigation({ line: safeLine, path });
				return;
			}
			setLineNavigation({ line: safeLine, path });
			source.open(path, safeLine);
			onFileSelected();
		},
		[onFileSelected, selectFile, source.open],
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
			if (source.path) return;
			const targetHunk = direction === -1 ? hunkNavigation.previous : hunkNavigation.next;
			if (targetHunk === null || targetHunk < 0 || targetHunk >= hunkCount) return;
			pendingHunkNavigationRef.current =
				hunkCount > 1
					? {
							expiresAt: Date.now() + HUNK_NAVIGATION_REPORT_TIMEOUT_MS,
							hunkIndex: targetHunk,
						}
					: null;
			setHunkNavigation(navigationAtHunk(targetHunk, hunkCount));
			viewerRef.current?.scrollToHunk(targetHunk);
		},
		[hunkCount, hunkNavigation, source.path],
	);

	const handleVisibleLineChange = useCallback(
		(lineNumber: number, side: SelectableSide) => {
			if (source.path) return;
			const hunks = diff?.hunks ?? [];
			const next = navigationAtVisibleLine(hunks, lineNumber, side);
			const pending = pendingHunkNavigationRef.current;
			if (pending) {
				const target = navigationAtHunk(pending.hunkIndex, hunks.length);
				const reachedTarget = next.previous === target.previous && next.next === target.next;
				if (!reachedTarget && Date.now() < pending.expiresAt) return;
				pendingHunkNavigationRef.current = null;
			}
			setHunkNavigation((current) =>
				current.previous === next.previous && current.next === next.next ? current : next,
			);
		},
		[diff, source.path],
	);

	useLayoutEffect(() => {
		if (!lineNavigation || !displayDiff || displayDiff.path !== lineNavigation.path) return;
		if (
			source.path &&
			(source.selectionId === null || source.loadedSelectionId !== source.selectionId)
		) {
			return;
		}
		if (!source.path && !diffContainsNewLine(displayDiff, lineNavigation.line)) {
			source.open(lineNavigation.path, lineNavigation.line, displayDiff.fileId);
			return;
		}
		const targetLine = source.path ? source.focusLine : lineNavigation.line;
		viewerRef.current?.scrollToLine({
			align: targetLine === 1 ? "start" : "center",
			behavior: "instant",
			lineNumber: targetLine,
			side: "new",
		});
		setLineNavigation(null);
	}, [
		displayDiff,
		lineNavigation,
		source.focusLine,
		source.loadedSelectionId,
		source.open,
		source.path,
		source.selectionId,
	]);

	const getCurrentFileId = useCallback(() => currentFileIdRef.current, []);
	const getDiff = useCallback(() => diffRef.current, []);

	return {
		activeFile,
		activeFileIndex,
		activePath,
		canNavigateNextHunk,
		canNavigatePreviousHunk,
		changeDiff: diff,
		currentFileId,
		diff: displayDiff,
		error: source.path ? source.error : error,
		getCurrentFileId,
		getDiff,
		handleVisibleLineChange,
		loadDiff,
		loading: source.path ? source.loading : loading,
		navigateFile,
		navigateHunk,
		openPathAtLine,
		readOnly: Boolean(source.path && !sourceChangedFile),
		retry: source.path ? source.retry : () => currentFileId && void loadDiff(currentFileId),
		rows,
		selectFile,
		setCurrentFileId,
		setDiff: setDiffState,
		viewerRef,
	};
}
