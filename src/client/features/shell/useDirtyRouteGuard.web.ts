import { useCallback, useEffect, useRef, useState } from "react";

import { confirmAction } from "../../lib/confirmAction";
import { DIRTY_ROUTE_CONFIRMATION, type DirtyRouteGuard } from "./dirtyRouteGuard";

const HISTORY_MARKER = "__couchviewDirtyRouteGuard";
let nextGuardId = 0;

interface GuardState {
	armed: boolean;
	guardedUrl: string;
	pendingNavigation: (() => void) | null;
}

function markedHistoryState(token: string): Record<string, unknown> {
	const current = window.history.state;
	return typeof current === "object" && current !== null
		? { ...current, [HISTORY_MARKER]: token }
		: { [HISTORY_MARKER]: token };
}

function currentUrl(): string {
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function useDirtyRouteGuard(active: boolean): DirtyRouteGuard {
	const [token] = useState(() => `dirty-route-${(nextGuardId += 1)}`);
	const activeRef = useRef(active);
	const dirtyRef = useRef(false);
	const guardRef = useRef<GuardState>({
		armed: false,
		guardedUrl: "",
		pendingNavigation: null,
	});
	activeRef.current = active;

	const isCurrentGuardEntry = useCallback(
		() => window.history.state?.[HISTORY_MARKER] === token,
		[token],
	);
	const armGuard = useCallback(() => {
		const guard = guardRef.current;
		if (!activeRef.current || guard.armed) return;
		guard.guardedUrl = currentUrl();
		// A duplicate settings entry absorbs the first Back traversal so the dirty
		// screen stays mounted while the browser confirmation is open.
		window.history.pushState(markedHistoryState(token), "", guard.guardedUrl);
		guard.armed = true;
	}, [token]);
	const onDirtyChange = useCallback(
		(nextDirty: boolean) => {
			dirtyRef.current = nextDirty;
			if (nextDirty) armGuard();
		},
		[armGuard],
	);
	const disarmThenRun = useCallback(
		(action: () => void) => {
			const guard = guardRef.current;
			if (guard.armed && isCurrentGuardEntry()) {
				guard.pendingNavigation = action;
				window.history.back();
				return;
			}
			guard.armed = false;
			action();
		},
		[isCurrentGuardEntry],
	);
	const runNavigation = useCallback(
		(action: () => void) => {
			if (!dirtyRef.current) {
				disarmThenRun(action);
				return;
			}
			void confirmAction(DIRTY_ROUTE_CONFIRMATION).then((confirmed) => {
				if (!confirmed || !activeRef.current) return;
				dirtyRef.current = false;
				disarmThenRun(action);
			});
		},
		[disarmThenRun],
	);

	useEffect(() => {
		if (!active) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!dirtyRef.current) return;
			event.preventDefault();
			event.returnValue = "";
		};
		const onPopState = () => {
			const guard = guardRef.current;
			if (!guard.armed) return;
			guard.armed = false;
			const pendingNavigation = guard.pendingNavigation;
			guard.pendingNavigation = null;
			if (pendingNavigation) {
				pendingNavigation();
				return;
			}
			if (!dirtyRef.current) {
				window.history.back();
				return;
			}
			void confirmAction(DIRTY_ROUTE_CONFIRMATION).then((confirmed) => {
				if (!activeRef.current) return;
				if (confirmed) {
					dirtyRef.current = false;
					// The sentinel was already traversed; this second Back intentionally
					// completes the route change the user originally requested.
					window.history.back();
					return;
				}
				window.history.pushState(markedHistoryState(token), "", guard.guardedUrl);
				guard.armed = true;
			});
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		window.addEventListener("popstate", onPopState);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
			window.removeEventListener("popstate", onPopState);
		};
	}, [active, token]);

	return { onDirtyChange, runNavigation };
}
