import { type RefObject, useCallback, useEffect, useRef } from "react";

import type { FileChange, FileDiff } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { diffCacheKey, readCachedDiff, rememberDiff } from "./diffCache.ts";

interface UseDiffPrefetchOptions {
	cacheRef: RefObject<Map<string, FileDiff>>;
	currentFileId: string | null;
	files: FileChange[];
	repositoryId: string | null;
	repositoryIdRef: RefObject<string | null>;
	repositoryRequestRef: RefObject<AbortController | null>;
}

export function useDiffPrefetch({
	cacheRef,
	currentFileId,
	files,
	repositoryId,
	repositoryIdRef,
	repositoryRequestRef,
}: UseDiffPrefetchOptions): RefObject<Map<string, Promise<FileDiff | null>>> {
	const prefetchRef = useRef(new Map<string, Promise<FileDiff | null>>());
	const prefetchDiff = useCallback(
		(activeRepositoryId: string, file: FileChange): Promise<FileDiff | null> => {
			const cached = readCachedDiff(cacheRef.current, activeRepositoryId, file);
			if (cached) return Promise.resolve(cached);
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
		[cacheRef, repositoryIdRef, repositoryRequestRef],
	);

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
	}, [currentFileId, files, prefetchDiff, repositoryId, repositoryIdRef]);

	return prefetchRef;
}
