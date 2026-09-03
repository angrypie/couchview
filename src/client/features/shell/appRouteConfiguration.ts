import type { RepositoryHistoryMode } from "../repositories/useRepositoryWorkspace.ts";
import type { ReviewLocation, WorkspacePositionController } from "../workspacePosition/index.ts";
import type { WorkspaceMode } from "./useWorkspaceNavigation.ts";

export interface AppRouteConfiguration {
	accessRefreshAttempted?: boolean;
	initialMode?: WorkspaceMode;
	nativeServerManagerUrl?: string | null;
	onAccessRefreshHandled?: () => void;
	onNavigate?: (mode: WorkspaceMode, replace?: boolean) => void;
	onManageServers?: () => void;
	onReload?: () => void;
	onTerminalLatencyChange?: (enabled: boolean) => void | Promise<void>;
	onSettingsDirtyChange?: (dirty: boolean) => void;
	onRepositorySelection?: (
		repositoryId: string | null,
		historyMode: Exclude<RepositoryHistoryMode, "none">,
	) => void;
	onReviewLocationChange?: (location: ReviewLocation) => void;
	requestedRepositoryId?: string | null;
	requestedReviewLocation?: ReviewLocation | null;
	restoreSavedReviewPosition?: boolean;
	shareBaseUrl?: string | null;
	terminalLatencyEnabled?: boolean;
	workspacePosition?: WorkspacePositionController | null;
}
