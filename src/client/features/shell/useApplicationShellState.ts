import { useCallback, useEffect, useState } from "react";

import type { DrawerView } from "../staging/types.ts";

interface UseApplicationShellStateOptions {
	clearFailure: () => void;
	clearToast: () => void;
	repositoryId: string | null;
	resetNavigationForRepository: () => void;
	setFailureDetailsOpen: (open: boolean) => void;
	setRepositoryPickerOpen: (open: boolean) => void;
}

export function useApplicationShellState({
	clearFailure,
	clearToast,
	repositoryId,
	resetNavigationForRepository,
	setFailureDetailsOpen,
	setRepositoryPickerOpen,
}: UseApplicationShellStateOptions) {
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [drawerView, setDrawerView] = useState<DrawerView>("files");
	const [remoteBridgeOpen, setRemoteBridgeOpen] = useState(false);
	const closeDrawer = useCallback(() => setDrawerOpen(false), []);

	useEffect(() => {
		resetNavigationForRepository();
		setDrawerView("files");
		clearToast();
		clearFailure();
		setFailureDetailsOpen(false);
		setDrawerOpen(false);
		setRepositoryPickerOpen(false);
	}, [
		clearFailure,
		clearToast,
		repositoryId,
		resetNavigationForRepository,
		setFailureDetailsOpen,
		setRepositoryPickerOpen,
	]);

	return {
		closeDrawer,
		drawerOpen,
		drawerView,
		remoteBridgeOpen,
		setDrawerOpen,
		setDrawerView,
		setRemoteBridgeOpen,
	};
}
