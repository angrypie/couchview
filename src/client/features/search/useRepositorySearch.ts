import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ChangeFile,
	SearchMatch,
	SearchResponse,
	SourcePreviewResponse,
} from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";

export type SearchScope = "current" | "other";

interface UseRepositorySearchOptions {
	activeFile: ChangeFile | null;
	repositoryId: string | null;
	showToast: (message: string) => void;
}

export function useRepositorySearch({
	activeFile,
	repositoryId,
	showToast,
}: UseRepositorySearchOptions) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<SearchScope>("current");
	const [result, setResult] = useState<SearchResponse | null>(null);
	const [busy, setBusy] = useState(false);
	const [sourcePreview, setSourcePreview] = useState<SourcePreviewResponse | null>(null);
	const [sourceBusy, setSourceBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const searchRequestRef = useRef<AbortController | null>(null);
	const sourceRequestRef = useRef<{
		generation: number;
		controller: AbortController;
	} | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	repositoryIdRef.current = repositoryId;

	const reset = useCallback(() => {
		searchRequestRef.current?.abort();
		sourceRequestRef.current?.controller.abort();
		setOpen(false);
		setQuery("");
		setScope("current");
		setResult(null);
		setBusy(false);
		setSourcePreview(null);
		setSourceBusy(false);
	}, []);

	useEffect(() => reset, [reset]);

	useEffect(() => {
		reset();
	}, [repositoryId, reset]);

	useEffect(() => {
		if (!open || query.trim().length < 1 || !activeFile || !repositoryId) {
			setResult(null);
			setBusy(false);
			return;
		}

		setResult(null);
		const normalizedQuery = query.trim();
		const currentPath = activeFile.path;
		const controller = new AbortController();
		searchRequestRef.current = controller;
		const timeout = window.setTimeout(() => {
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
			window.clearTimeout(timeout);
			controller.abort();
			if (searchRequestRef.current === controller) {
				searchRequestRef.current = null;
			}
		};
	}, [activeFile, open, query, repositoryId, showToast]);

	useEffect(() => {
		if (open) return;
		sourceRequestRef.current?.controller.abort();
		setSourceBusy(false);
		setSourcePreview(null);
	}, [open]);

	const openWithQuery = useCallback((word: string) => {
		setQuery(word);
		setScope("current");
		setSourcePreview(null);
		setOpen(true);
		window.setTimeout(() => inputRef.current?.focus(), 30);
	}, []);

	const showSource = useCallback(
		async (match: SearchMatch) => {
			if (!repositoryId) return;
			const activeRepositoryId = repositoryId;
			sourceRequestRef.current?.controller.abort();
			const generation = (sourceRequestRef.current?.generation ?? 0) + 1;
			const controller = new AbortController();
			sourceRequestRef.current = { generation, controller };
			setSourceBusy(true);

			try {
				const response = await api.source(
					activeRepositoryId,
					match.path,
					match.line,
					controller.signal,
				);
				if (
					sourceRequestRef.current?.generation === generation &&
					!controller.signal.aborted &&
					repositoryIdRef.current === activeRepositoryId &&
					response.path === match.path
				) {
					setSourcePreview(response);
				}
			} catch (error) {
				if (
					repositoryIdRef.current === activeRepositoryId &&
					!(error instanceof DOMException && error.name === "AbortError")
				) {
					showToast(messageOf(error));
				}
			} finally {
				if (
					sourceRequestRef.current?.generation === generation &&
					repositoryIdRef.current === activeRepositoryId
				) {
					setSourceBusy(false);
				}
			}
		},
		[repositoryId, showToast],
	);

	return {
		busy,
		inputRef,
		open,
		openWithQuery,
		query,
		reset,
		result,
		scope,
		setOpen,
		setQuery,
		setScope,
		setSourcePreview,
		showSource,
		sourceBusy,
		sourcePreview,
	};
}
