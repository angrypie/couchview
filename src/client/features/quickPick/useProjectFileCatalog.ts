import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";

const CATALOG_CACHE_LIMIT = 4;

interface ProjectFileCatalog {
	key: string;
	paths: string[];
	truncated: boolean;
}

interface UseProjectFileCatalogOptions {
	enabled: boolean;
	onRefreshChanges: () => Promise<unknown>;
	operationRevision: string;
	repositoryId: string | null;
}

function catalogKey(repositoryId: string, operationRevision: string): string {
	return `${repositoryId}:${operationRevision}`;
}

function rememberCatalog(cache: Map<string, ProjectFileCatalog>, catalog: ProjectFileCatalog) {
	cache.delete(catalog.key);
	cache.set(catalog.key, catalog);
	while (cache.size > CATALOG_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

export function useProjectFileCatalog({
	enabled,
	onRefreshChanges,
	operationRevision,
	repositoryId,
}: UseProjectFileCatalogOptions) {
	const [catalog, setCatalog] = useState<ProjectFileCatalog | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const cacheRef = useRef(new Map<string, ProjectFileCatalog>());
	const requestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	const operationRevisionRef = useRef(operationRevision);
	repositoryIdRef.current = repositoryId;
	operationRevisionRef.current = operationRevision;

	const load = useCallback(
		async (force = false) => {
			if (!enabled || !repositoryId || !operationRevision) return;
			const key = catalogKey(repositoryId, operationRevision);
			const cached = force ? null : cacheRef.current.get(key);
			if (cached) {
				setCatalog(cached);
				setBusy(false);
				setError("");
				return;
			}
			const controller = new AbortController();
			requestRef.current?.abort();
			requestRef.current = controller;
			setBusy(true);
			setError("");
			try {
				const response = await api.projectFiles(repositoryId, controller.signal);
				if (
					controller.signal.aborted ||
					repositoryIdRef.current !== repositoryId ||
					operationRevisionRef.current !== operationRevision
				) {
					return;
				}
				if (
					response.repositoryId !== repositoryId ||
					response.operationRevision !== operationRevision
				) {
					setError("Project files changed. Refreshing…");
					void onRefreshChanges().catch(() => {});
					return;
				}
				const next = {
					key,
					paths: response.files.map((file) => file.path),
					truncated: response.truncated,
				};
				rememberCatalog(cacheRef.current, next);
				setCatalog(next);
			} catch (loadError) {
				if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
					setError(messageOf(loadError));
				}
			} finally {
				if (requestRef.current === controller) {
					requestRef.current = null;
					setBusy(false);
				}
			}
		},
		[enabled, onRefreshChanges, operationRevision, repositoryId],
	);

	useEffect(() => {
		if (!enabled) {
			requestRef.current?.abort();
			setBusy(false);
			setError("");
			return;
		}
		if (!repositoryId || !operationRevision) {
			requestRef.current?.abort();
			setCatalog(null);
			setBusy(false);
			setError("");
			return;
		}
		const cached = cacheRef.current.get(catalogKey(repositoryId, operationRevision));
		setCatalog(cached ?? null);
		void load();
	}, [enabled, load, operationRevision, repositoryId]);

	useEffect(() => () => requestRef.current?.abort(), []);
	const currentKey =
		repositoryId && operationRevision ? catalogKey(repositoryId, operationRevision) : null;
	const currentCatalog = catalog?.key === currentKey ? catalog : null;

	return {
		busy,
		error,
		paths: currentCatalog?.paths ?? [],
		retry: () => void load(true),
		truncated: currentCatalog?.truncated ?? false,
	};
}
