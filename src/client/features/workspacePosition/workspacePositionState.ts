import type { KvStore } from "../../lib/storage/kvStore.ts";
import { platformKvStore } from "../../lib/storage/platformKvStore";
import { createPersistedAtom } from "../../lib/store/persistedAtom.ts";
import type {
	DeviceWorkspacePositionState,
	ReviewLineAnchor,
	SavedReviewPosition,
	ServerWorkspacePosition,
} from "./types.ts";

export const WORKSPACE_POSITION_KEY = "couchview.workspace-position.v1";

export const EMPTY_WORKSPACE_POSITION: DeviceWorkspacePositionState = {
	servers: {},
	version: 1,
};

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeAnchor(value: unknown): ReviewLineAnchor | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<ReviewLineAnchor>;
	if (
		typeof candidate.line !== "number" ||
		!Number.isSafeInteger(candidate.line) ||
		candidate.line < 1 ||
		(candidate.side !== "old" && candidate.side !== "new")
	) {
		return null;
	}
	return { line: candidate.line, side: candidate.side };
}

function normalizeReviewPosition(value: unknown): SavedReviewPosition | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<SavedReviewPosition>;
	const path = nonEmptyString(candidate.path);
	if (!path) return null;
	return {
		anchor: normalizeAnchor(candidate.anchor),
		fileId: nonEmptyString(candidate.fileId),
		path,
	};
}

function normalizeServerPosition(value: unknown): ServerWorkspacePosition | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<ServerWorkspacePosition>;
	const repositories: Record<string, SavedReviewPosition> = {};
	if (candidate.repositories && typeof candidate.repositories === "object") {
		for (const [repositoryId, position] of Object.entries(candidate.repositories)) {
			if (!repositoryId) continue;
			const normalized = normalizeReviewPosition(position);
			if (normalized) repositories[repositoryId] = normalized;
		}
	}
	return {
		lastRepositoryId: nonEmptyString(candidate.lastRepositoryId),
		repositories,
	};
}

export function normalizeWorkspacePosition(value: unknown): DeviceWorkspacePositionState {
	if (!value || typeof value !== "object") return EMPTY_WORKSPACE_POSITION;
	const candidate = value as Partial<DeviceWorkspacePositionState>;
	const servers: Record<string, ServerWorkspacePosition> = {};
	if (candidate.servers && typeof candidate.servers === "object") {
		for (const [scope, position] of Object.entries(candidate.servers)) {
			if (!scope) continue;
			const normalized = normalizeServerPosition(position);
			if (normalized) servers[scope] = normalized;
		}
	}
	return { servers, version: 1 };
}

export function createWorkspacePositionState(kvStore: KvStore) {
	return createPersistedAtom({
		key: WORKSPACE_POSITION_KEY,
		initialValue: EMPTY_WORKSPACE_POSITION,
		kvStore,
		normalize: normalizeWorkspacePosition,
	});
}

export const workspacePositionState = createWorkspacePositionState(platformKvStore);
