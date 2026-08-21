import { useEffect, useMemo } from "react";

import type { FileDiff } from "../../../shared/contracts.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import {
	DEFAULT_TOKENIZE_OPTIONS,
	type DiffRow,
	languageForFileName,
	readCachedTokens,
	storeCachedTokens,
	type TokenCacheKey,
	tokenizeRows,
} from "./engine/index.ts";
import { DiffTokenLayer } from "./paint/DiffTokenLayer.ts";

export function useDiffTokens(options: {
	diff: FileDiff;
	repositoryId: string | null | undefined;
	rows: DiffRow[];
	themeType: ResolvedTheme;
}): DiffTokenLayer {
	const { diff, repositoryId, rows, themeType } = options;
	const identity = `${repositoryId ?? ""}:${diff.fileId}:${diff.contentRevision}:${themeType}`;
	const layer = useMemo(() => new DiffTokenLayer(rows), [identity, rows]);

	useEffect(() => {
		const cacheKey: TokenCacheKey = {
			repositoryId: repositoryId ?? "",
			fileId: diff.fileId,
			contentRevision: diff.contentRevision,
			themeType,
		};
		const cached = readCachedTokens(cacheKey);
		let cacheComplete = false;
		if (cached !== null) {
			try {
				layer.hydrate(cached.tokens, cached.complete);
				cacheComplete = cached.complete;
			} catch {
				cacheComplete = false;
			}
		}
		if (cacheComplete) return;
		let cancelled = false;
		const controller = { cancelled: () => cancelled };
		const language = languageForFileName(diff.path);
		void tokenizeRows({
			rows,
			language,
			themeType,
			tokenizeOptions: { ...DEFAULT_TOKENIZE_OPTIONS, themeType },
			controller,
			cacheKey,
			onBatch: (batch) => layer.apply(batch),
		})
			.then((result) => {
				if (!cancelled) {
					storeCachedTokens(cacheKey, result);
					layer.finish();
				}
			})
			.catch(() => {
				if (!cancelled) layer.finish();
			});
		return () => {
			cancelled = true;
		};
	}, [diff, identity, layer, repositoryId, rows, themeType]);

	return layer;
}
