export const DIRTY_ROUTE_CONFIRMATION = "Discard the unsaved profile changes and leave settings?";

export interface DirtyRouteGuard {
	onDirtyChange(dirty: boolean): void;
	runNavigation(action: () => void): void;
}
