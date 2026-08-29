import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchMatch, SearchResponse } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";

export type SearchScope = "current" | "other";

interface UseRepositorySearchOptions {
	currentPath: string | null;
	onOpenMatch: (match: SearchMatch) => boolean;
	repositoryId: string | null;
	showToast: (message: string) => void;
}

export function useRepositorySearch({
	currentPath,
	onOpenMatch,
	repositoryId,
	showToast,
}: UseRepositorySearchOptions) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<SearchScope>("current");
	const [result, setResult] = useState<SearchResponse | null>(null);
	const [busy, setBusy] = useState(false);
	const searchRequestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	repositoryIdRef.current = repositoryId;

	const reset = useCallback(() => {
		searchRequestRef.current?.abort();
		setOpen(false);
		setQuery("");
		setScope("current");
		setResult(null);
		setBusy(false);
	}, []);

	useEffect(() => reset, [reset]);

	useEffect(() => {
		reset();
	}, [repositoryId, reset]);

	useEffect(() => {
		if (!open || query.trim().length < 1 || !currentPath || !repositoryId) {
			setResult(null);
			setBusy(false);
			return;
		}

		setResult(null);
		const normalizedQuery = query.trim();
		const controller = new AbortController();
		searchRequestRef.current = controller;
		const timeout = setTimeout(() => {
			setBusy(true);
			void api
				.search(repositoryId, normalizedQuery, currentPath, controller.signal)
				.then((response) => {
					if (
						!controller.signal.aborted &&
						repositoryIdRef.current === repositoryId &&
						response.query === normalizedQuery &&
						response.currentPath === currentPath
					) {
						setResult(response);
					}
				})
				.catch((error) => {
					if (!(error instanceof DOMException && error.name === "AbortError")) {
						showToast(messageOf(error));
					}
				})
				.finally(() => {
					if (!controller.signal.aborted) setBusy(false);
				});
		}, 220);

		return () => {
			clearTimeout(timeout);
			controller.abort();
			if (searchRequestRef.current === controller) {
				searchRequestRef.current = null;
			}
		};
	}, [currentPath, open, query, repositoryId, showToast]);

	const openWithQuery = useCallback((word: string) => {
		setQuery(word);
		setScope("current");
		setOpen(true);
	}, []);

	const selectMatch = useCallback(
		(match: SearchMatch) => {
			if (!onOpenMatch(match)) return false;
			setOpen(false);
			return true;
		},
		[onOpenMatch],
	);

	return {
		busy,
		open,
		openWithQuery,
		query,
		reset,
		result,
		scope,
		selectMatch,
		setOpen,
		setQuery,
		setScope,
	};
}
