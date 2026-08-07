import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import type {
	BootstrapResponse,
	PackageRunEvent,
	PackageRunSnapshot,
	PackageRunSummary,
	PackageScriptDefinition,
	PackageScriptsPackage,
	PackageScriptsResponse,
} from "../../../shared/contracts.ts";
import { API_ROUTES } from "../../../shared/contracts.ts";
import { ApiError, api } from "../../api.ts";
import { type ServerEventSubscription, subscribeServerEvents } from "../../lib/api/serverEvents";
import { messageOf } from "../../lib/failures.ts";
import { emptyPackageScripts } from "./packageRuns.ts";

interface UsePackageRunsOptions {
	bootstrap: BootstrapResponse | null;
	onRunOpened: () => void;
	panelActive: boolean;
	repositoryId: string | null;
	repositoryReady: boolean;
	showToast: (message: string) => void;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function usePackageRuns({
	bootstrap,
	onRunOpened,
	panelActive,
	repositoryId,
	repositoryReady,
	showToast,
}: UsePackageRunsOptions) {
	const [scripts, setScripts] = useState<PackageScriptsResponse>(emptyPackageScripts);
	const [runs, setRuns] = useState<PackageRunSummary[]>([]);
	const [commandsLoading, setCommandsLoading] = useState(false);
	const [runBusy, setRunBusy] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<PackageRunSnapshot | null>(null);
	const [clock, setClock] = useState(() => Date.now());
	const outputRef = useRef<ScrollView>(null);
	const streamRef = useRef<ServerEventSubscription | null>(null);
	const requestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	repositoryIdRef.current = repositoryId;

	const reset = useCallback(() => {
		streamRef.current?.close();
		streamRef.current = null;
		requestRef.current?.abort();
		requestRef.current = null;
		setScripts(emptyPackageScripts);
		setRuns([]);
		setCommandsLoading(false);
		setRunBusy(null);
		setSelectedRunId(null);
		setSnapshot(null);
	}, []);

	useEffect(() => {
		reset();
		if (repositoryId) requestRef.current = new AbortController();
		return reset;
	}, [repositoryId, reset]);

	const refreshScripts = useCallback(async () => {
		const activeRepositoryId = repositoryIdRef.current;
		if (!activeRepositoryId) throw new Error("No repository is selected");
		const response = await api.packageScripts(activeRepositoryId, requestRef.current?.signal);
		if (repositoryIdRef.current === activeRepositoryId) setScripts(response);
		return response;
	}, []);

	const refreshRuns = useCallback(async () => {
		const activeRepositoryId = repositoryIdRef.current;
		if (!activeRepositoryId) throw new Error("No repository is selected");
		const response = await api.packageRuns(activeRepositoryId, requestRef.current?.signal);
		if (repositoryIdRef.current === activeRepositoryId) setRuns(response.runs);
		return response;
	}, []);

	useEffect(() => {
		if (!repositoryId || !repositoryReady) return;
		setCommandsLoading(true);
		void Promise.all([refreshScripts(), refreshRuns()])
			.catch((error) => {
				if (!isAbortError(error)) showToast(messageOf(error));
			})
			.finally(() => {
				if (repositoryIdRef.current === repositoryId) setCommandsLoading(false);
			});
	}, [refreshRuns, refreshScripts, repositoryId, repositoryReady, showToast]);

	useEffect(() => {
		if (!panelActive || !repositoryId || !repositoryReady) return;
		const interval = setInterval(() => {
			void refreshRuns().catch(() => undefined);
		}, 2_000);
		return () => clearInterval(interval);
	}, [panelActive, refreshRuns, repositoryId, repositoryReady]);

	useEffect(() => {
		streamRef.current?.close();
		streamRef.current = null;
		if (!repositoryId || !selectedRunId) {
			setSnapshot(null);
			return;
		}

		const stream = subscribeServerEvents(API_ROUTES.packageRunEvents(repositoryId, selectedRunId), {
			onMessage: (message) => {
				try {
					const event = JSON.parse(message.data) as PackageRunEvent;
					if (event.type === "snapshot") {
						setSnapshot(event.snapshot);
						setRuns((current) => [
							event.snapshot.run,
							...current.filter((run) => run.id !== event.snapshot.run.id),
						]);
						return;
					}
					if (event.type === "output") {
						setSnapshot((current) => {
							if (!current || current.run.id !== selectedRunId) return current;
							if (current.output.some((chunk) => chunk.sequence === event.chunk.sequence)) {
								return current;
							}
							return { ...current, output: [...current.output, event.chunk] };
						});
						return;
					}
					setSnapshot((current) =>
						current?.run.id === event.run.id ? { ...current, run: event.run } : current,
					);
					setRuns((current) => [event.run, ...current.filter((run) => run.id !== event.run.id)]);
				} catch {
					// Ignore malformed run events; the subscription will continue reconnecting.
				}
			},
		});
		streamRef.current = stream;
		return () => {
			stream.close();
			if (streamRef.current === stream) streamRef.current = null;
		};
	}, [repositoryId, selectedRunId]);

	const selectedRun = snapshot?.run ?? runs.find((run) => run.id === selectedRunId) ?? null;

	useEffect(() => {
		const active = selectedRun && ["running", "stopping"].includes(selectedRun.status);
		if (!active) return;
		const interval = setInterval(() => setClock(Date.now()), 1_000);
		return () => clearInterval(interval);
	}, [selectedRun]);

	useEffect(() => {
		outputRef.current?.scrollToEnd({ animated: false });
	}, [snapshot?.output]);

	const start = useCallback(
		async (packageEntry: PackageScriptsPackage, script: PackageScriptDefinition) => {
			if (!bootstrap || !repositoryId) return;
			const activeRepositoryId = repositoryId;
			const busyKey = `${packageEntry.packagePath}\0${script.name}`;
			const signal = requestRef.current?.signal;
			setRunBusy(busyKey);
			try {
				const response = await api.startPackageRun(
					activeRepositoryId,
					{
						packagePath: packageEntry.packagePath,
						scriptName: script.name,
						manifestRevision: packageEntry.manifestRevision,
					},
					bootstrap.csrfToken,
					signal,
				);
				if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
				setRuns((current) => [
					response.run,
					...current.filter((run) => run.id !== response.run.id),
				]);
				setSnapshot({ run: response.run, output: [] });
				setSelectedRunId(response.run.id);
				onRunOpened();
			} catch (error) {
				if (
					signal?.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				showToast(messageOf(error));
				if (error instanceof ApiError && error.code === "package_scripts_changed") {
					void refreshScripts();
				}
			} finally {
				if (repositoryIdRef.current === activeRepositoryId) setRunBusy(null);
			}
		},
		[bootstrap, onRunOpened, refreshScripts, repositoryId, showToast],
	);

	const stop = useCallback(async () => {
		if (!bootstrap || !repositoryId || !selectedRunId) return;
		const activeRepositoryId = repositoryId;
		const runId = selectedRunId;
		const signal = requestRef.current?.signal;
		setRunBusy(runId);
		try {
			const response = await api.stopPackageRun(
				activeRepositoryId,
				runId,
				bootstrap.csrfToken,
				signal,
			);
			if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
			setSnapshot((current) =>
				current?.run.id === runId ? { ...current, run: response.run } : current,
			);
			setRuns((current) => [response.run, ...current.filter((run) => run.id !== response.run.id)]);
		} catch (error) {
			if (
				signal?.aborted ||
				repositoryIdRef.current !== activeRepositoryId ||
				isAbortError(error)
			) {
				return;
			}
			showToast(messageOf(error));
		} finally {
			if (repositoryIdRef.current === activeRepositoryId) setRunBusy(null);
		}
	}, [bootstrap, repositoryId, selectedRunId, showToast]);

	const openRun = useCallback(
		(run: PackageRunSummary) => {
			setSnapshot({ run, output: [] });
			setSelectedRunId(run.id);
			onRunOpened();
		},
		[onRunOpened],
	);

	return {
		clock,
		commandsLoading,
		openRun,
		outputRef,
		refreshScripts,
		runBusy,
		runs,
		scripts,
		selectedRun,
		selectedRunId,
		setSelectedRunId,
		snapshot,
		start,
		stop,
	};
}
