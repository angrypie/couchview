import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	API_ROUTES,
	type ArtifactCatalogItem,
	type ArtifactDefinition,
	type ArtifactDefinitionInput,
	type ArtifactRun,
	type ArtifactRunEvent,
	type ArtifactRunSnapshot,
	type BootstrapResponse,
	type CodexCapability,
	type CodexGenerationPreferences,
	quoteArtifactInvocation,
	type RemoteBridgeDevice,
} from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { messageOf } from "../../lib/failures.ts";
import { useArtifactProposal } from "./useArtifactProposal.ts";

interface UseArtifactsOptions {
	active: boolean;
	bootstrap: BootstrapResponse | null;
	codexPreferences: CodexGenerationPreferences;
	proposalCapability: CodexCapability;
	remoteBridgeAvailable: boolean;
	repositoryId: string | null;
	showToast(message: string): void;
}

type ArtifactBusyAction = "create" | "update" | "delete" | "build" | "stop";

interface ArtifactStream {
	runId: string;
	source: EventSource;
}

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "stopped"]);
const RUN_PROGRESS: Record<ArtifactRun["status"], number> = {
	running: 0,
	capturing: 1,
	stopping: 2,
	succeeded: 3,
	failed: 3,
	stopped: 3,
};

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function replaceCatalogItem(
	items: ArtifactCatalogItem[],
	artifactId: string,
	update: (item: ArtifactCatalogItem) => ArtifactCatalogItem,
): ArtifactCatalogItem[] {
	return items.map((item) => (item.definition.id === artifactId ? update(item) : item));
}

function artifactPullCommand(
	definition: ArtifactDefinition,
	device: RemoteBridgeDevice,
	repositoryId: string,
): string {
	return quoteArtifactInvocation([
		"couchview",
		"artifacts",
		"pull",
		definition.name,
		"--profile",
		device.sshAlias,
		"--repository",
		repositoryId,
	]);
}

export function useArtifacts({
	active,
	bootstrap,
	codexPreferences,
	proposalCapability,
	remoteBridgeAvailable,
	repositoryId,
	showToast,
}: UseArtifactsOptions) {
	const [artifacts, setArtifacts] = useState<ArtifactCatalogItem[]>([]);
	const [busy, setBusy] = useState<Record<string, ArtifactBusyAction>>({});
	const [devices, setDevices] = useState<RemoteBridgeDevice[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
	const [snapshots, setSnapshots] = useState<Record<string, ArtifactRunSnapshot>>({});
	const requestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	const refreshSequenceRef = useRef(0);
	const refreshRef = useRef<() => Promise<void>>(async () => undefined);
	const latestRunsRef = useRef(new Map<string, ArtifactRun>());
	const streamsRef = useRef(new Map<string, ArtifactStream>());
	repositoryIdRef.current = repositoryId;
	const proposal = useArtifactProposal({
		active,
		bootstrap,
		codexPreferences,
		proposalCapability,
		repositoryId,
		showToast,
	});

	const closeStream = useCallback((artifactId: string) => {
		const stream = streamsRef.current.get(artifactId);
		stream?.source.close();
		streamsRef.current.delete(artifactId);
	}, []);

	const updateRun = useCallback((run: ArtifactRun) => {
		const observed = latestRunsRef.current.get(run.id);
		const latest =
			observed && RUN_PROGRESS[observed.status] > RUN_PROGRESS[run.status] ? observed : run;
		latestRunsRef.current.set(latest.id, latest);
		setSnapshots((current) => {
			const existing = current[latest.artifactId];
			return {
				...current,
				[latest.artifactId]: {
					run: latest,
					output: existing?.run.id === latest.id ? existing.output : [],
				},
			};
		});
		setArtifacts((current) =>
			replaceCatalogItem(current, latest.artifactId, (item) => ({
				...item,
				activeRun: TERMINAL_RUN_STATUSES.has(latest.status) ? null : latest,
				recentRun: latest,
			})),
		);
	}, []);

	const connectRun = useCallback(
		(run: ArtifactRun) => {
			const current = streamsRef.current.get(run.artifactId);
			if (current?.runId === run.id) return;
			closeStream(run.artifactId);
			setSnapshots((snapshots) => ({
				...snapshots,
				[run.artifactId]:
					snapshots[run.artifactId]?.run.id === run.id
						? snapshots[run.artifactId]!
						: { run, output: [] },
			}));
			const source = new EventSource(
				API_ROUTES.artifactRunEvents(run.repositoryId, run.artifactId, run.id),
			);
			streamsRef.current.set(run.artifactId, { runId: run.id, source });
			source.onmessage = (message) => {
				try {
					const event = JSON.parse(message.data) as ArtifactRunEvent;
					if (event.type === "snapshot") {
						setSnapshots((currentSnapshots) => ({
							...currentSnapshots,
							[run.artifactId]: event.snapshot,
						}));
						updateRun(event.snapshot.run);
						return;
					}
					if (event.type === "output") {
						setSnapshots((currentSnapshots) => {
							const snapshot = currentSnapshots[run.artifactId];
							if (!snapshot || snapshot.run.id !== run.id) return currentSnapshots;
							if (snapshot.output.some((chunk) => chunk.sequence === event.chunk.sequence)) {
								return currentSnapshots;
							}
							return {
								...currentSnapshots,
								[run.artifactId]: {
									...snapshot,
									output: [...snapshot.output, event.chunk],
								},
							};
						});
						return;
					}
					updateRun(event.run);
					if (TERMINAL_RUN_STATUSES.has(event.run.status)) {
						closeStream(run.artifactId);
						window.setTimeout(() => void refreshRef.current(), 0);
					}
				} catch {
					// EventSource reconnects after malformed or interrupted event delivery.
				}
			};
		},
		[closeStream, updateRun],
	);

	const refresh = useCallback(async () => {
		const activeRepositoryId = repositoryIdRef.current;
		if (!activeRepositoryId) return;
		const sequence = ++refreshSequenceRef.current;
		const response = await api.artifacts(activeRepositoryId, requestRef.current?.signal);
		if (repositoryIdRef.current !== activeRepositoryId || sequence !== refreshSequenceRef.current) {
			return;
		}
		const reconciled = response.artifacts.map((item) => {
			const incoming = item.activeRun ?? item.recentRun;
			const observed = incoming ? latestRunsRef.current.get(incoming.id) : null;
			const run =
				incoming && observed && RUN_PROGRESS[observed.status] > RUN_PROGRESS[incoming.status]
					? observed
					: incoming;
			if (run) latestRunsRef.current.set(run.id, run);
			return {
				...item,
				activeRun: run && !TERMINAL_RUN_STATUSES.has(run.status) ? run : null,
				recentRun: run,
			};
		});
		const byArtifact = new Map(reconciled.map((item) => [item.definition.id, item]));
		for (const [artifactId, stream] of streamsRef.current) {
			if (byArtifact.get(artifactId)?.activeRun?.id !== stream.runId) closeStream(artifactId);
		}
		setSnapshots((current) => {
			const next: Record<string, ArtifactRunSnapshot> = {};
			for (const item of reconciled) {
				const snapshot = current[item.definition.id];
				if (snapshot && item.recentRun?.id === snapshot.run.id) {
					next[item.definition.id] = { ...snapshot, run: item.recentRun };
				}
			}
			return next;
		});
		setArtifacts(reconciled);
		setError(null);
		for (const item of reconciled) {
			if (item.activeRun) connectRun(item.activeRun);
		}
	}, [closeStream, connectRun]);
	refreshRef.current = refresh;

	const refreshDevices = useCallback(async () => {
		const activeRepositoryId = repositoryIdRef.current;
		if (!activeRepositoryId || !remoteBridgeAvailable) {
			setDevices([]);
			setSelectedDeviceId(null);
			return;
		}
		const response = await api.remoteBridgeDevices(activeRepositoryId, requestRef.current?.signal);
		if (repositoryIdRef.current !== activeRepositoryId) return;
		setDevices(response.devices);
		setSelectedDeviceId((current) =>
			response.devices.some((device) => device.id === current)
				? current
				: (response.devices[0]?.id ?? null),
		);
	}, [remoteBridgeAvailable]);

	useEffect(() => {
		requestRef.current?.abort();
		for (const stream of streamsRef.current.values()) stream.source.close();
		streamsRef.current.clear();
		latestRunsRef.current.clear();
		setArtifacts([]);
		setBusy({});
		setDevices([]);
		setError(null);
		setLoading(false);
		setSelectedDeviceId(null);
		setSnapshots({});
		refreshSequenceRef.current += 1;
		if (!active || !repositoryId || !bootstrap) return;

		const controller = new AbortController();
		requestRef.current = controller;
		setLoading(true);
		void Promise.all([refresh(), refreshDevices()])
			.catch((loadError) => {
				if (!controller.signal.aborted && !isAbortError(loadError)) {
					setError(messageOf(loadError));
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		const catalogInterval = window.setInterval(() => {
			void refresh().catch(() => undefined);
		}, 3_000);
		const deviceInterval = window.setInterval(() => {
			void refreshDevices().catch(() => undefined);
		}, 10_000);
		return () => {
			controller.abort();
			window.clearInterval(catalogInterval);
			window.clearInterval(deviceInterval);
			for (const stream of streamsRef.current.values()) stream.source.close();
			streamsRef.current.clear();
			if (requestRef.current === controller) requestRef.current = null;
		};
	}, [active, bootstrap, refresh, refreshDevices, repositoryId]);

	const mutate = useCallback(
		async (
			artifactId: string,
			action: ArtifactBusyAction,
			operation: (repositoryId: string, csrfToken: string, signal?: AbortSignal) => Promise<void>,
		): Promise<boolean> => {
			if (!bootstrap || !repositoryId) return false;
			const activeRepositoryId = repositoryId;
			const signal = requestRef.current?.signal;
			setBusy((current) => ({ ...current, [artifactId]: action }));
			try {
				await operation(activeRepositoryId, bootstrap.csrfToken, signal);
				if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return false;
				await refresh();
				return true;
			} catch (mutationError) {
				if (!signal?.aborted && !isAbortError(mutationError)) showToast(messageOf(mutationError));
				return false;
			} finally {
				if (repositoryIdRef.current === activeRepositoryId) {
					setBusy((current) => {
						if (current[artifactId] !== action) return current;
						const next = { ...current };
						delete next[artifactId];
						return next;
					});
				}
			}
		},
		[bootstrap, refresh, repositoryId, showToast],
	);

	const create = useCallback(
		(input: ArtifactDefinitionInput) =>
			mutate("new", "create", async (id, csrfToken, signal) => {
				await api.createArtifact(id, input, csrfToken, signal);
			}),
		[mutate],
	);

	const update = useCallback(
		(definition: ArtifactDefinition, input: ArtifactDefinitionInput) =>
			mutate(definition.id, "update", async (id, csrfToken, signal) => {
				await api.updateArtifact(
					id,
					definition.id,
					{ ...input, expectedRevision: definition.revision },
					csrfToken,
					signal,
				);
			}),
		[mutate],
	);

	const remove = useCallback(
		(artifactId: string) =>
			mutate(artifactId, "delete", async (id, csrfToken, signal) => {
				await api.deleteArtifact(id, artifactId, csrfToken, signal);
				closeStream(artifactId);
				setSnapshots((current) => {
					const next = { ...current };
					delete next[artifactId];
					return next;
				});
			}),
		[closeStream, mutate],
	);

	const build = useCallback(
		(artifactId: string) =>
			mutate(artifactId, "build", async (id, csrfToken, signal) => {
				const response = await api.startArtifactRun(id, artifactId, csrfToken, signal);
				updateRun(response.run);
				connectRun(response.run);
			}),
		[connectRun, mutate, updateRun],
	);

	const stop = useCallback(
		(artifactId: string, runId: string) =>
			mutate(artifactId, "stop", async (id, csrfToken, signal) => {
				const response = await api.stopArtifactRun(id, artifactId, runId, csrfToken, signal);
				updateRun(response.run);
			}),
		[mutate, updateRun],
	);

	const copyCommand = useCallback(
		async (definition: ArtifactDefinition, deviceId = selectedDeviceId): Promise<boolean> => {
			if (!repositoryId || !deviceId) return false;
			const device = devices.find((candidate) => candidate.id === deviceId);
			if (!device) return false;
			try {
				await copyToClipboard(artifactPullCommand(definition, device, repositoryId));
				showToast(`Copied pull command for ${device.label}`);
				return true;
			} catch (copyError) {
				showToast(messageOf(copyError));
				return false;
			}
		},
		[devices, repositoryId, selectedDeviceId, showToast],
	);

	const hasActiveRuns = useMemo(
		() => artifacts.some((item) => item.activeRun !== null),
		[artifacts],
	);
	const busyCount = Object.keys(busy).length + (proposal.busy ? 1 : 0);

	return {
		artifacts,
		build,
		busy,
		busyCount,
		copyCommand,
		create,
		devices,
		error,
		hasActiveRuns,
		loading,
		proposalBusy: proposal.busy,
		proposalCapability: proposal.capability,
		propose: proposal.propose,
		refresh,
		refreshDevices,
		remove,
		selectedDeviceId,
		setSelectedDeviceId,
		snapshots,
		stop,
		update,
	};
}

export type ArtifactsController = ReturnType<typeof useArtifacts>;
