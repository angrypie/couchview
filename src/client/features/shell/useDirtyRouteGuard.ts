import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useRef, useState } from "react";

import { confirmAction } from "../../lib/confirmAction";
import { DIRTY_ROUTE_CONFIRMATION, type DirtyRouteGuard } from "./dirtyRouteGuard";

export function useDirtyRouteGuard(active: boolean): DirtyRouteGuard {
	const navigation = useNavigation();
	const [dirty, setDirty] = useState(false);
	const activeRef = useRef(active);
	const dirtyRef = useRef(false);
	activeRef.current = active;
	const onDirtyChange = useCallback((nextDirty: boolean) => {
		dirtyRef.current = nextDirty;
		setDirty(nextDirty);
	}, []);
	const continueNavigation = useCallback((action: () => void) => {
		dirtyRef.current = false;
		setDirty(false);
		globalThis.setTimeout(action, 0);
	}, []);

	usePreventRemove(active && dirty, ({ data }) => {
		const dispatchBlockedAction = () => navigation.dispatch(data.action);
		if (!dirtyRef.current) {
			continueNavigation(dispatchBlockedAction);
			return;
		}
		void confirmAction(DIRTY_ROUTE_CONFIRMATION).then((confirmed) => {
			if (confirmed && activeRef.current) continueNavigation(dispatchBlockedAction);
		});
	});

	const runNavigation = useCallback(
		(action: () => void) => {
			if (!activeRef.current || !dirtyRef.current) {
				action();
				return;
			}
			void confirmAction(DIRTY_ROUTE_CONFIRMATION).then((confirmed) => {
				if (confirmed && activeRef.current) continueNavigation(action);
			});
		},
		[continueNavigation],
	);
	return { onDirtyChange, runNavigation };
}
