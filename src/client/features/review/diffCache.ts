import type { ChangeFile, FileDiff } from "../../../shared/contracts.ts";

const DIFF_CACHE_LIMIT = 8;

export function diffCacheKey(
	repositoryId: string,
	fileId: string,
	contentRevision: string,
): string {
	return `${repositoryId}\0${fileId}\0${contentRevision}`;
}

export function readCachedDiff(
	cache: Map<string, FileDiff>,
	repositoryId: string,
	file: ChangeFile,
): FileDiff | null {
	const key = diffCacheKey(repositoryId, file.id, file.contentRevision);
	const cached = cache.get(key) ?? null;
	if (cached) {
		cache.delete(key);
		cache.set(key, cached);
	}
	return cached;
}

export function rememberDiff(
	cache: Map<string, FileDiff>,
	repositoryId: string,
	diff: FileDiff,
): void {
	const key = diffCacheKey(repositoryId, diff.fileId, diff.contentRevision);
	cache.delete(key);
	cache.set(key, diff);
	while (cache.size > DIFF_CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (oldest.done) break;
		cache.delete(oldest.value);
	}
}
