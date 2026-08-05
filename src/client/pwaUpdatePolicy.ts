const UPDATE_LAUNCH_WINDOW_MS = 15_000;

export function shouldApplyPwaUpdate(
	updateSafe: boolean,
	visibilityState: DocumentVisibilityState,
	millisecondsSinceLaunch: number,
): boolean {
	return (
		updateSafe &&
		(visibilityState === "hidden" || millisecondsSinceLaunch <= UPDATE_LAUNCH_WINDOW_MS)
	);
}
