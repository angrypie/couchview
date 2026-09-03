import { useAtom, useAtomValue } from "jotai/react";
import { useCallback, useEffect, useMemo } from "react";

import type { PersistedAtom } from "../../lib/store/persistedAtom.ts";
import { useHydratePersistedAtom } from "../../lib/store/persistedAtom.ts";
import type {
	DeviceWorkspacePositionState,
	ReviewLineAnchor,
	SavedReviewPosition,
} from "./types.ts";
import { workspacePositionState } from "./workspacePositionState.ts";

interface UseWorkspacePositionOptions {
	legacyRepositoryId?: string | null;
	scope: string | null;
}

function sameAnchor(left: ReviewLineAnchor | null, right: ReviewLineAnchor | null): boolean {
	return left?.line === right?.line && left?.side === right?.side;
}

export function useWorkspacePosition(
	{ legacyRepositoryId = null, scope }: UseWorkspacePositionOptions,
	persistedState: PersistedAtom<DeviceWorkspacePositionState> = workspacePositionState,
) {
	const [state, setState] = useAtom(persistedState.valueAtom);
	const hydrated = useAtomValue(persistedState.hydratedAtom);
	useHydratePersistedAtom(persistedState);

	const serverPosition = scope ? state.servers[scope] : undefined;
	useEffect(() => {
		if (!hydrated || !scope || !legacyRepositoryId || serverPosition) return;
		void setState((current) => ({
			...current,
			servers: {
				...current.servers,
				[scope]: { lastRepositoryId: legacyRepositoryId, repositories: {} },
			},
		})).catch(() => undefined);
	}, [hydrated, legacyRepositoryId, scope, serverPosition, setState]);

	const rememberRepository = useCallback(
		(repositoryId: string) => {
			if (!scope) return;
			void setState((current) => {
				const server = current.servers[scope] ?? {
					lastRepositoryId: null,
					repositories: {},
				};
				if (server.lastRepositoryId === repositoryId) return current;
				return {
					...current,
					servers: {
						...current.servers,
						[scope]: { ...server, lastRepositoryId: repositoryId },
					},
				};
			}).catch(() => undefined);
		},
		[scope, setState],
	);

	const rememberFile = useCallback(
		(repositoryId: string, path: string, fileId: string | null) => {
			if (!scope || !path) return;
			void setState((current) => {
				const server = current.servers[scope] ?? {
					lastRepositoryId: null,
					repositories: {},
				};
				const previous = server.repositories[repositoryId];
				const next: SavedReviewPosition = {
					anchor: previous?.path === path ? previous.anchor : null,
					fileId,
					path,
				};
				if (
					previous?.path === next.path &&
					previous.fileId === next.fileId &&
					sameAnchor(previous.anchor, next.anchor)
				) {
					return current;
				}
				return {
					...current,
					servers: {
						...current.servers,
						[scope]: {
							...server,
							repositories: { ...server.repositories, [repositoryId]: next },
						},
					},
				};
			}).catch(() => undefined);
		},
		[scope, setState],
	);

	const rememberAnchor = useCallback(
		(repositoryId: string, path: string, anchor: ReviewLineAnchor) => {
			if (!scope) return;
			void setState((current) => {
				const server = current.servers[scope];
				const previous = server?.repositories[repositoryId];
				if (!server || !previous || previous.path !== path || sameAnchor(previous.anchor, anchor)) {
					return current;
				}
				return {
					...current,
					servers: {
						...current.servers,
						[scope]: {
							...server,
							repositories: {
								...server.repositories,
								[repositoryId]: { ...previous, anchor },
							},
						},
					},
				};
			}).catch(() => undefined);
		},
		[scope, setState],
	);

	return useMemo(
		() => ({
			hydrated: scope === null || hydrated,
			lastRepositoryId: serverPosition?.lastRepositoryId ?? legacyRepositoryId,
			positionFor: (repositoryId: string | null) =>
				repositoryId ? (serverPosition?.repositories[repositoryId] ?? null) : null,
			rememberAnchor,
			rememberFile,
			rememberRepository,
			scope,
		}),
		[
			hydrated,
			legacyRepositoryId,
			rememberAnchor,
			rememberFile,
			rememberRepository,
			scope,
			serverPosition,
		],
	);
}

export type WorkspacePositionController = ReturnType<typeof useWorkspacePosition>;

export function useRememberOpenedRepository(
	controller: WorkspacePositionController | null | undefined,
	repositoryId: string | null,
	ready: boolean,
): void {
	useEffect(() => {
		if (ready && repositoryId) controller?.rememberRepository(repositoryId);
	}, [controller, ready, repositoryId]);
}
