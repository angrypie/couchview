export type ReviewLineSide = "old" | "new";

export interface ReviewLineAnchor {
	line: number;
	side: ReviewLineSide;
}

export interface ReviewLocation {
	anchor: ReviewLineAnchor | null;
	path: string;
}

export interface SavedReviewPosition extends ReviewLocation {
	fileId: string | null;
}

export interface ServerWorkspacePosition {
	lastRepositoryId: string | null;
	repositories: Record<string, SavedReviewPosition>;
}

export interface DeviceWorkspacePositionState {
	servers: Record<string, ServerWorkspacePosition>;
	version: 1;
}
