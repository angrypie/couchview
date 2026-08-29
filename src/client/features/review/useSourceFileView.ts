import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileDiff } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import type { FailureState } from "../../lib/failures.ts";

const SOURCE_CACHE_LIMIT = 5;

type SourceFileResponse = Awaited<ReturnType<typeof api.sourceFile>>;

interface SourceTarget {
	changeFileId: string | null;
	focusLine: number;
	path: string;
	selectionId: number;
}

interface LoadedSource {
	response: SourceFileResponse;
	selectionId: number;
}

interface UseSourceFileViewOptions {
	onRefreshChanges: () => Promise<unknown>;
	operationRevision: string;
	reportFailure: (error: unknown, context: string, toastMessage?: boolean) => FailureState;
	repositoryId: string | null;
}

function responseCacheKey(response: SourceFileResponse): string {
	return `${response.repositoryId}\0${response.operationRevision}\0${response.path}`;
}

function sourceResponseToDiff(response: SourceFileResponse): FileDiff {
	const lines = response.lines.map((line) => ({
		id: `source-${line.line}`,
		kind: "context" as const,
		newLine: line.line,
		noNewline: false,
		oldLine: line.line,
		text: line.text,
	}));
	return {
		additions: 0,
		binary: false,
		contentRevision: response.contentRevision,
		deletions: 0,
		fileId: `source:${response.path}`,
		header: response.truncated ? ["Source view truncated around the selected line."] : [],
		hunks:
			lines.length > 0
				? [
						{
							header: `@@ -${response.startLine},${lines.length} +${response.startLine},${lines.length} @@`,
							id: `source-${response.startLine}-${response.endLine}`,
							lines,
							newLines: lines.length,
							newStart: response.startLine,
							oldLines: lines.length,
							oldStart: response.startLine,
						},
					]
				: [],
		kind: "modified",
		operationRevision: response.operationRevision,
		path: response.path,
		previousPath: null,
		tooLarge: response.truncated,
	};
}

function responseCoversLine(response: SourceFileResponse, line: number): boolean {
	return !response.truncated || (line >= response.startLine && line <= response.endLine);
}

export function useSourceFileView({
	onRefreshChanges,
	operationRevision,
	reportFailure,
	repositoryId,
}: UseSourceFileViewOptions) {
	const [target, setTarget] = useState<SourceTarget | null>(null);
	const [loaded, setLoaded] = useState<LoadedSource | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const nextSelectionIdRef = useRef(0);
	const cacheRef = useRef(new Map<string, SourceFileResponse>());

	const close = useCallback(() => {
		setTarget(null);
		setLoaded(null);
		setLoading(false);
		setError("");
	}, []);
	const open = useCallback((path: string, focusLine = 1, changeFileId: string | null = null) => {
		nextSelectionIdRef.current += 1;
		setTarget({
			changeFileId,
			focusLine: Number.isSafeInteger(focusLine) && focusLine > 0 ? focusLine : 1,
			path,
			selectionId: nextSelectionIdRef.current,
		});
	}, []);
	const retry = useCallback(() => {
		setTarget((current) =>
			current ? { ...current, selectionId: (nextSelectionIdRef.current += 1) } : current,
		);
	}, []);

	useEffect(() => close(), [close, repositoryId]);
	useEffect(() => {
		if (!target || !repositoryId || !operationRevision) return;
		const cacheKey = `${repositoryId}\0${operationRevision}\0${target.path}`;
		const cached = cacheRef.current.get(cacheKey);
		if (cached && responseCoversLine(cached, target.focusLine)) {
			cacheRef.current.delete(cacheKey);
			cacheRef.current.set(cacheKey, cached);
			setLoaded({ response: cached, selectionId: target.selectionId });
			setLoading(false);
			setError("");
			return;
		}

		const controller = new AbortController();
		setLoading(true);
		setError("");
		void api
			.sourceFile(repositoryId, target.path, target.focusLine, controller.signal)
			.then((response) => {
				if (controller.signal.aborted) return;
				if (response.repositoryId !== repositoryId || response.path !== target.path) return;
				if (response.operationRevision !== operationRevision) {
					setError("The file changed while it was opening. Refreshing…");
					return onRefreshChanges().catch((refreshError) => {
						if (!controller.signal.aborted) {
							setError(reportFailure(refreshError, "Refresh changed files", false).message);
						}
					});
				}
				const key = responseCacheKey(response);
				cacheRef.current.delete(key);
				cacheRef.current.set(key, response);
				while (cacheRef.current.size > SOURCE_CACHE_LIMIT) {
					const oldest = cacheRef.current.keys().next().value;
					if (oldest === undefined) break;
					cacheRef.current.delete(oldest);
				}
				setLoaded({ response, selectionId: target.selectionId });
			})
			.catch((loadError) => {
				if (loadError instanceof DOMException && loadError.name === "AbortError") return;
				setError(reportFailure(loadError, "Load source file", false).message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [onRefreshChanges, operationRevision, reportFailure, repositoryId, target]);

	const currentLoaded =
		loaded?.response.repositoryId === repositoryId &&
		loaded.response.operationRevision === operationRevision &&
		loaded.response.path === target?.path
			? loaded
			: null;
	const diff = useMemo(
		() => (currentLoaded ? sourceResponseToDiff(currentLoaded.response) : null),
		[currentLoaded],
	);

	return {
		changeFileId: target?.changeFileId ?? null,
		close,
		diff,
		error,
		focusLine: currentLoaded?.response.focusLine ?? target?.focusLine ?? 1,
		loadedSelectionId: currentLoaded?.selectionId ?? null,
		loading,
		open,
		path: target?.path ?? null,
		retry,
		selectionId: target?.selectionId ?? null,
	};
}
