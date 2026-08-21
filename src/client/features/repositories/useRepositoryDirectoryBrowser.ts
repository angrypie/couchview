import { useCallback, useEffect, useRef, useState } from "react";
import type { RepositoryDirectoryListing } from "../../../shared/repositoryDirectories.ts";
import { api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";

interface UseRepositoryDirectoryBrowserOptions {
	showToast: (message: string) => void;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useRepositoryDirectoryBrowser({ showToast }: UseRepositoryDirectoryBrowserOptions) {
	const [active, setActive] = useState(false);
	const [busy, setBusy] = useState(false);
	const [listing, setListing] = useState<RepositoryDirectoryListing | null>(null);
	const requestRef = useRef<AbortController | null>(null);

	const browse = useCallback(
		async (path?: string) => {
			const controller = new AbortController();
			requestRef.current?.abort();
			requestRef.current = controller;
			setBusy(true);
			try {
				const response = await api.repositoryDirectories(path, controller.signal);
				if (!controller.signal.aborted) setListing(response);
			} catch (error) {
				if (!controller.signal.aborted && !isAbortError(error)) showToast(messageOf(error));
			} finally {
				if (requestRef.current === controller) {
					requestRef.current = null;
					setBusy(false);
				}
			}
		},
		[showToast],
	);

	const open = useCallback(
		(path?: string) => {
			setActive(true);
			void browse(path);
		},
		[browse],
	);

	const close = useCallback(() => {
		requestRef.current?.abort();
		requestRef.current = null;
		setBusy(false);
		setActive(false);
	}, []);

	useEffect(() => () => requestRef.current?.abort(), []);

	return { active, browse, busy, close, listing, open };
}
