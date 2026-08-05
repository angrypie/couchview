import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import type {
	BootstrapResponse,
	ChangeFile,
	ChangesResponse,
	CreateCommentRequest,
	FileDiff,
	InstanceResponse,
	RepositoryCatalogEntry,
	ReviewStateResponse,
	ServerEvent,
} from "../../../shared/contracts.ts";
import { readCachedDiff, rememberDiff } from "../review/diffCache.ts";
import { nativeCredentialStore } from "./credentialStore";
import { NativeApiClient, NativeApiError } from "./nativeApi.ts";
import { runNativeRepositoryStream } from "./nativeRepositoryStream.ts";
import type { NativeServerProfile } from "./types.ts";

export type NativeWorkspacePhase = "idle" | "loading" | "ready" | "error";
export type NativeConnectionState = "connected" | "reconnecting" | "offline";
export type NativeCommentAnchor = Omit<CreateCommentRequest, "body">;

export interface NativeTerminalDescriptor {
	clientId: string;
	ticket: string;
	expiresAt: string;
	protocol: "couchview-terminal-v1";
	socketUrl: string;
}

export interface NativeWorkspaceController {
	phase: NativeWorkspacePhase;
	connectionState: NativeConnectionState;
	instance: InstanceResponse | null;
	bootstrap: BootstrapResponse | null;
	repositories: RepositoryCatalogEntry[];
	repositoryId: string | null;
	changes: ChangesResponse | null;
	reviewState: ReviewStateResponse;
	selectedFileId: string | null;
	diff: FileDiff | null;
	diffLoading: boolean;
	mutationBusy: boolean;
	error: string | null;
	selectRepository(repositoryId: string): Promise<void>;
	selectFile(fileId: string): void;
	refresh(): Promise<void>;
	retry(): void;
	toggleReview(file: ChangeFile): Promise<void>;
	toggleStage(file: ChangeFile): Promise<void>;
	createComment(anchor: NativeCommentAnchor, body: string): Promise<void>;
	issueTerminal(): Promise<NativeTerminalDescriptor>;
	endTerminal(): Promise<void>;
	clearError(): void;
}

const EMPTY_REVIEW_STATE: ReviewStateResponse = { reviews: [], comments: [] };

function messageFor(error: unknown): string {
	if (error instanceof NativeApiError && error.code === "native_client_unauthorized") {
		return "This device credential was revoked. Remove this server and pair it again.";
	}
	return error instanceof Error ? error.message : "Could not load this Couchview server";
}

function websocketUrl(baseUrl: string, pathname: string): string {
	const url = new URL(pathname, baseUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

function terminalClientId(): string {
	return `native_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function updateChangedFile(
	current: ChangesResponse | null,
	fileId: string,
	update: (file: ChangeFile) => ChangeFile,
): ChangesResponse | null {
	return current
		? {
				...current,
				files: current.files.map((file) => (file.id === fileId ? update(file) : file)),
			}
		: null;
}

function useNativeTerminalActions(
	apiRef: RefObject<NativeApiClient | null>,
	repositoryIdRef: RefObject<string | null>,
	profileRef: RefObject<NativeServerProfile | null>,
) {
	const issueTerminal = useCallback(async () => {
		const api = apiRef.current;
		const currentRepositoryId = repositoryIdRef.current;
		const currentProfile = profileRef.current;
		if (!api || !currentRepositoryId || !currentProfile) {
			throw new Error("Choose a repository before opening the terminal");
		}
		const clientId = terminalClientId();
		const attachment = await api.issueTerminalAttachment(currentRepositoryId, {
			clientId,
			profileId: "tmux",
			cols: 80,
			rows: 24,
			takeover: false,
		});
		return {
			clientId,
			ticket: attachment.ticket,
			expiresAt: attachment.expiresAt,
			protocol: attachment.protocol,
			socketUrl: websocketUrl(
				currentProfile.baseUrl,
				`/api/repositories/${encodeURIComponent(currentRepositoryId)}/terminal/socket`,
			),
		};
	}, [apiRef, profileRef, repositoryIdRef]);
	const endTerminal = useCallback(async () => {
		const api = apiRef.current;
		const currentRepositoryId = repositoryIdRef.current;
		if (api && currentRepositoryId) await api.endTerminal(currentRepositoryId);
	}, [apiRef, repositoryIdRef]);
	return { endTerminal, issueTerminal };
}

export function useNativeWorkspace(
	profile: NativeServerProfile | null,
	updateProfile: (profile: NativeServerProfile) => Promise<void>,
): NativeWorkspaceController {
	const [phase, setPhase] = useState<NativeWorkspacePhase>("idle");
	const [connectionState, setConnectionState] = useState<NativeConnectionState>("offline");
	const [instance, setInstance] = useState<InstanceResponse | null>(null);
	const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
	const [repositoryId, setRepositoryId] = useState<string | null>(null);
	const [changes, setChanges] = useState<ChangesResponse | null>(null);
	const [reviewState, setReviewState] = useState<ReviewStateResponse>(EMPTY_REVIEW_STATE);
	const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
	const [diff, setDiff] = useState<FileDiff | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);
	const [mutationBusy, setMutationBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retryRevision, setRetryRevision] = useState(0);
	const apiRef = useRef<NativeApiClient | null>(null);
	const repositoryIdRef = useRef<string | null>(null);
	const profileRef = useRef(profile);
	const updateProfileRef = useRef(updateProfile);
	const loadGeneration = useRef(0);
	const diffGeneration = useRef(0);
	const diffCache = useRef(new Map<string, FileDiff>());
	profileRef.current = profile;
	updateProfileRef.current = updateProfile;
	repositoryIdRef.current = repositoryId;
	const terminal = useNativeTerminalActions(apiRef, repositoryIdRef, profileRef);

	const applySnapshot = useCallback(
		(nextChanges: ChangesResponse, nextReview: ReviewStateResponse) => {
			setChanges(nextChanges);
			setReviewState(nextReview);
			setSelectedFileId((current) =>
				current && nextChanges.files.some(({ id }) => id === current)
					? current
					: (nextChanges.files[0]?.id ?? null),
			);
		},
		[],
	);

	const loadSnapshot = useCallback(
		async (api: NativeApiClient, nextRepositoryId: string, signal?: AbortSignal) => {
			const [nextChanges, nextReview] = await Promise.all([
				api.files(nextRepositoryId, signal),
				api.reviewState(nextRepositoryId, signal),
			]);
			if (repositoryIdRef.current !== nextRepositoryId) return;
			applySnapshot(nextChanges, nextReview);
		},
		[applySnapshot],
	);

	useEffect(() => {
		const generation = ++loadGeneration.current;
		const controller = new AbortController();
		apiRef.current = null;
		setError(null);
		setInstance(null);
		setBootstrap(null);
		setRepositoryId(null);
		setChanges(null);
		setReviewState(EMPTY_REVIEW_STATE);
		setSelectedFileId(null);
		setDiff(null);
		setConnectionState("offline");
		if (!profile) {
			setPhase("idle");
			return () => controller.abort();
		}
		setPhase("loading");
		void (async () => {
			const token = await nativeCredentialStore.get(profile.serverId);
			if (!token) throw new Error("This server profile has no device credential; pair it again");
			const api = new NativeApiClient(profile.baseUrl, token);
			const [nextInstance, nextBootstrap] = await Promise.all([
				api.instance(controller.signal),
				api.bootstrap(controller.signal),
			]);
			if (nextInstance.serverId !== profile.serverId) {
				throw new Error("The server at this address has a different Couchview identity");
			}
			const nextRepositoryId =
				(profile.lastRepositoryId &&
				nextBootstrap.repositories.some(
					({ id, available }) => id === profile.lastRepositoryId && available,
				)
					? profile.lastRepositoryId
					: nextBootstrap.defaultRepositoryId) ??
				nextBootstrap.repositories.find(({ available }) => available)?.id ??
				null;
			if (generation !== loadGeneration.current) return;
			apiRef.current = api;
			setInstance(nextInstance);
			setBootstrap(nextBootstrap);
			setRepositoryId(nextRepositoryId);
			repositoryIdRef.current = nextRepositoryId;
			if (nextRepositoryId) await loadSnapshot(api, nextRepositoryId, controller.signal);
			if (generation !== loadGeneration.current) return;
			setPhase("ready");
			setConnectionState("connected");
			if (
				profile.lastInstanceId !== nextInstance.instanceId ||
				profile.lastRepositoryId !== nextRepositoryId
			) {
				await updateProfileRef.current({
					...profile,
					lastInstanceId: nextInstance.instanceId,
					lastRepositoryId: nextRepositoryId,
					updatedAt: new Date().toISOString(),
				});
			}
		})().catch((loadError) => {
			if (controller.signal.aborted || generation !== loadGeneration.current) return;
			setError(messageFor(loadError));
			setPhase("error");
			setConnectionState("offline");
		});
		return () => controller.abort();
	}, [loadSnapshot, profile?.baseUrl, profile?.id, profile?.serverId, retryRevision]);

	const refresh = useCallback(async () => {
		const api = apiRef.current;
		const currentRepositoryId = repositoryIdRef.current;
		if (!api || !currentRepositoryId) return;
		try {
			await loadSnapshot(api, currentRepositoryId);
			setConnectionState("connected");
		} catch (refreshError) {
			setError(messageFor(refreshError));
			setConnectionState("offline");
		}
	}, [loadSnapshot]);

	useEffect(() => {
		const api = apiRef.current;
		if (phase !== "ready" || !api || !repositoryId) return;
		const controller = new AbortController();
		void runNativeRepositoryStream({
			api,
			repositoryId,
			signal: controller.signal,
			onConnected: () => setConnectionState("connected"),
			onReconnecting: () => setConnectionState("reconnecting"),
			onAuthoritativeRefetch: refresh,
			onEvent: (event: ServerEvent) => {
				if (event.repositoryId !== repositoryId) return;
				if (event.type === "changes" || event.type === "ready" || event.type === "state") {
					void refresh();
				}
			},
		});
		return () => controller.abort();
	}, [phase, refresh, repositoryId]);

	useEffect(() => {
		const api = apiRef.current;
		const currentChanges = changes;
		const file = currentChanges?.files.find(({ id }) => id === selectedFileId);
		if (!repositoryId || !currentChanges || phase !== "ready") return;
		if (!file) {
			setDiff(null);
			setDiffLoading(false);
			return;
		}
		if (!api || !profile) return;
		const cacheScope = `${profile.serverId}\0${repositoryId}`;
		const cached = readCachedDiff(diffCache.current, cacheScope, file);
		if (cached) setDiff(cached);
		const generation = ++diffGeneration.current;
		const controller = new AbortController();
		setDiffLoading(true);
		void api.diff(repositoryId, file.id, controller.signal).then(
			({ diff: nextDiff }) => {
				if (
					generation !== diffGeneration.current ||
					nextDiff.contentRevision !== file.contentRevision
				) {
					return;
				}
				rememberDiff(diffCache.current, cacheScope, nextDiff);
				setDiff(nextDiff);
				setDiffLoading(false);
				const index = currentChanges.files.findIndex(({ id }) => id === file.id);
				for (const adjacent of [currentChanges.files[index - 1], currentChanges.files[index + 1]]) {
					if (!adjacent || readCachedDiff(diffCache.current, cacheScope, adjacent)) continue;
					void api.diff(repositoryId, adjacent.id).then(({ diff: prefetched }) => {
						if (prefetched.contentRevision === adjacent.contentRevision) {
							rememberDiff(diffCache.current, cacheScope, prefetched);
						}
					});
				}
			},
			(diffError) => {
				if (controller.signal.aborted || generation !== diffGeneration.current) return;
				setError(messageFor(diffError));
				setDiffLoading(false);
			},
		);
		return () => controller.abort();
	}, [changes, phase, profile, repositoryId, selectedFileId]);

	const selectRepository = useCallback(
		async (nextRepositoryId: string) => {
			const api = apiRef.current;
			if (!api || nextRepositoryId === repositoryIdRef.current) return;
			const previousRepositoryId = repositoryIdRef.current;
			setRepositoryId(nextRepositoryId);
			repositoryIdRef.current = nextRepositoryId;
			setPhase("loading");
			try {
				await loadSnapshot(api, nextRepositoryId);
				setPhase("ready");
				const currentProfile = profileRef.current;
				if (currentProfile) {
					await updateProfileRef.current({
						...currentProfile,
						lastRepositoryId: nextRepositoryId,
						updatedAt: new Date().toISOString(),
					});
				}
			} catch (selectError) {
				repositoryIdRef.current = previousRepositoryId;
				setRepositoryId(previousRepositoryId);
				setError(messageFor(selectError));
				setPhase(changes ? "ready" : "error");
			}
		},
		[changes, loadSnapshot],
	);

	const withMutation = useCallback(
		async (operation: (api: NativeApiClient, repositoryId: string) => Promise<void>) => {
			const api = apiRef.current;
			const currentRepositoryId = repositoryIdRef.current;
			if (!api || !currentRepositoryId || mutationBusy) return;
			setMutationBusy(true);
			setError(null);
			try {
				await operation(api, currentRepositoryId);
			} catch (mutationError) {
				setError(messageFor(mutationError));
				await refresh();
			} finally {
				setMutationBusy(false);
			}
		},
		[mutationBusy, refresh],
	);

	const toggleReview = useCallback(
		(file: ChangeFile) =>
			withMutation(async (api, currentRepositoryId) => {
				setChanges((current) =>
					updateChangedFile(current, file.id, (candidate) => ({
						...candidate,
						reviewed: !file.reviewed,
					})),
				);
				await api.setReview(currentRepositoryId, file.id, {
					fileId: file.id,
					contentRevision: file.contentRevision,
					reviewed: !file.reviewed,
				});
				await refresh();
			}),
		[refresh, withMutation],
	);

	const toggleStage = useCallback(
		(file: ChangeFile) =>
			withMutation(async (api, currentRepositoryId) => {
				setChanges((current) =>
					updateChangedFile(current, file.id, (candidate) => ({
						...candidate,
						staged: !file.staged,
					})),
				);
				await api.stageFile(currentRepositoryId, file.id, {
					fileId: file.id,
					contentRevision: file.contentRevision,
					operationRevision: changes?.operationRevision ?? "",
					staged: !file.staged,
				});
				await refresh();
			}),
		[changes?.operationRevision, refresh, withMutation],
	);

	const createComment = useCallback(
		(anchor: NativeCommentAnchor, body: string) =>
			withMutation(async (api, currentRepositoryId) => {
				const response = await api.createComment(currentRepositoryId, anchor.fileId, {
					...anchor,
					body,
				});
				setReviewState((current) => ({
					...current,
					comments: [...current.comments, response.comment],
				}));
				setChanges((current) =>
					updateChangedFile(current, anchor.fileId, (file) => ({
						...file,
						commentCount: file.commentCount + 1,
					})),
				);
			}),
		[withMutation],
	);

	return {
		phase,
		connectionState,
		instance,
		bootstrap,
		repositories: bootstrap?.repositories ?? [],
		repositoryId,
		changes,
		reviewState,
		selectedFileId,
		diff,
		diffLoading,
		mutationBusy,
		error,
		selectRepository,
		selectFile: setSelectedFileId,
		refresh,
		retry: () => setRetryRevision((current) => current + 1),
		toggleReview,
		toggleStage,
		createComment,
		issueTerminal: terminal.issueTerminal,
		endTerminal: terminal.endTerminal,
		clearError: () => setError(null),
	};
}
