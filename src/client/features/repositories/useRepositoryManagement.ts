import { useCallback, useEffect, useRef, useState } from "react";
import type { BootstrapResponse, RepositoryCatalogEntry } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";
import { waitForDelay } from "../../lib/waitForDelay.ts";
import { clearPwaStorage } from "../../offlineApp.ts";
import type { RestartPhase } from "./types.ts";
import type { RepositoryHistoryMode } from "./useRepositoryWorkspace.ts";

interface UseRepositoryManagementOptions {
	bootstrap: BootstrapResponse | null;
	clearRepositorySelection: () => void;
	getRepositoryId: () => string | null;
	loadRepository: (repositoryId: string, historyMode: RepositoryHistoryMode) => Promise<void>;
	refreshRepositories: () => Promise<{
		repositories: RepositoryCatalogEntry[];
	}>;
	showToast: (message: string) => void;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useRepositoryManagement({
	bootstrap,
	clearRepositorySelection,
	getRepositoryId,
	loadRepository,
	refreshRepositories,
	showToast,
}: UseRepositoryManagementOptions) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [forgetBusy, setForgetBusy] = useState<string | null>(null);
	const [restartPhase, setRestartPhase] = useState<RestartPhase>(null);
	const restartRequestRef = useRef<AbortController | null>(null);
	const forgetRequestRef = useRef<AbortController | null>(null);

	useEffect(
		() => () => {
			restartRequestRef.current?.abort();
			forgetRequestRef.current?.abort();
		},
		[],
	);

	const openPicker = useCallback(() => {
		setPickerOpen(true);
		void refreshRepositories().catch((error) => showToast(messageOf(error)));
	}, [refreshRepositories, showToast]);

	const rebuildAndRestart = useCallback(async () => {
		if (!bootstrap?.restart.available || restartPhase) return;
		const controller = new AbortController();
		restartRequestRef.current?.abort();
		restartRequestRef.current = controller;
		setPickerOpen(false);
		setRestartPhase("building");
		try {
			const response = await api.restart(bootstrap.csrfToken, controller.signal);
			if (controller.signal.aborted) return;
			setRestartPhase("restarting");
			const deadline = Date.now() + 60_000;
			let nextInstance = null;
			while (!controller.signal.aborted && Date.now() < deadline) {
				await waitForDelay(250, controller.signal);
				try {
					const candidate = await api.instance(controller.signal);
					if (candidate.instanceId !== response.previousInstanceId) {
						nextInstance = candidate;
						break;
					}
				} catch (error) {
					if (controller.signal.aborted) throw error;
					// The listener is expected to disappear briefly during the handoff.
				}
			}
			if (!nextInstance) {
				throw new Error(
					"Couchview did not come back within 60 seconds. Start it from the terminal.",
				);
			}
			setRestartPhase("loading");
			try {
				await clearPwaStorage();
			} catch {
				// A network reload still refreshes non-PWA and restricted browser sessions.
			}
			window.location.reload();
		} catch (error) {
			if (controller.signal.aborted) return;
			setRestartPhase(null);
			showToast(messageOf(error));
		} finally {
			if (restartRequestRef.current === controller) restartRequestRef.current = null;
		}
	}, [bootstrap, restartPhase, showToast]);

	const selectRepository = useCallback(
		(entry: RepositoryCatalogEntry) => {
			if (!entry.available) return;
			if (entry.id === getRepositoryId()) {
				setPickerOpen(false);
				return;
			}
			void loadRepository(entry.id, "push");
		},
		[getRepositoryId, loadRepository],
	);

	const forgetRepository = useCallback(
		async (entry: RepositoryCatalogEntry) => {
			if (
				!bootstrap ||
				forgetBusy ||
				!window.confirm(
					`Forget ${entry.name}? Its saved reviews and comments will be deleted, and any running tmux session—including running programs and unsaved work—will be terminated.`,
				)
			) {
				return;
			}
			const controller = new AbortController();
			forgetRequestRef.current?.abort();
			forgetRequestRef.current = controller;
			setForgetBusy(entry.id);
			try {
				await api.forgetRepository(entry.id, bootstrap.csrfToken, controller.signal);
				if (controller.signal.aborted) return;
				const catalog = await refreshRepositories();
				if (entry.id === getRepositoryId()) {
					const next = catalog.repositories.find((item) => item.available);
					if (next) await loadRepository(next.id, "replace");
					else clearRepositorySelection();
				}
				showToast(`Forgot ${entry.name}`);
			} catch (error) {
				if (controller.signal.aborted || isAbortError(error)) return;
				showToast(messageOf(error));
			} finally {
				if (forgetRequestRef.current === controller) forgetRequestRef.current = null;
				setForgetBusy((current) => (current === entry.id ? null : current));
			}
		},
		[
			bootstrap,
			clearRepositorySelection,
			forgetBusy,
			getRepositoryId,
			loadRepository,
			refreshRepositories,
			showToast,
		],
	);

	return {
		forgetBusy,
		forgetRepository,
		openPicker,
		pickerOpen,
		rebuildAndRestart,
		restartPhase,
		selectRepository,
		setPickerOpen,
	};
}
