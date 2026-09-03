import { useCallback, useEffect, useMemo, useRef } from "react";

import { copyToClipboard } from "../../lib/clipboard.ts";
import { messageOf } from "../../lib/failures.ts";
import { absoluteReviewUrl } from "../shell/reviewRoute.ts";
import type {
	ReviewLineAnchor,
	ReviewLocation,
	WorkspacePositionController,
} from "../workspacePosition/index.ts";

interface UseReviewLocationOptions {
	active?: boolean;
	onReviewLocationChange?: (location: ReviewLocation) => void;
	repositoryId: string | null;
	requestedLocation?: ReviewLocation | null;
	restoreSavedPosition?: boolean;
	shareBaseUrl?: string | null;
	showToast: (message: string) => void;
	workspacePosition?: WorkspacePositionController | null;
}

function locationKey(location: ReviewLocation | null): string | null {
	if (!location) return null;
	return `${location.path}\0${location.anchor?.line ?? ""}\0${location.anchor?.side ?? ""}`;
}

export function useReviewLocation({
	active = true,
	onReviewLocationChange,
	repositoryId,
	requestedLocation = null,
	restoreSavedPosition = false,
	shareBaseUrl = null,
	showToast,
	workspacePosition,
}: UseReviewLocationOptions) {
	const requestedLocationKey = locationKey(requestedLocation);
	const pendingRouteKeyRef = useRef<string | null>(null);
	const ignoredRouteKeyRef = useRef<string | null>(null);
	const suppressRequestedLocation =
		pendingRouteKeyRef.current !== null ||
		(requestedLocationKey !== null && ignoredRouteKeyRef.current === requestedLocationKey);
	useEffect(() => {
		if (!active) {
			pendingRouteKeyRef.current = null;
			return;
		}
		if (
			pendingRouteKeyRef.current !== null &&
			pendingRouteKeyRef.current === requestedLocationKey
		) {
			ignoredRouteKeyRef.current = requestedLocationKey;
			pendingRouteKeyRef.current = null;
			return;
		}
		if (
			pendingRouteKeyRef.current === null &&
			ignoredRouteKeyRef.current !== requestedLocationKey
		) {
			ignoredRouteKeyRef.current = null;
		}
	}, [active, requestedLocationKey]);
	const savedPosition = restoreSavedPosition
		? (workspacePosition?.positionFor(repositoryId) ?? null)
		: null;
	const initialLocation = suppressRequestedLocation
		? null
		: requestedLocation
			? { fallbackOnMissing: false, location: requestedLocation, updateRoute: false }
			: savedPosition
				? { fallbackOnMissing: true, location: savedPosition, updateRoute: true }
				: null;

	const onFileOpened = useCallback(
		(path: string, fileId: string | null, updateRoute: boolean) => {
			if (!repositoryId) return;
			workspacePosition?.rememberFile(repositoryId, path, fileId);
			if (updateRoute && active && onReviewLocationChange) {
				const nextLocation = { anchor: null, path };
				const nextLocationKey = locationKey(nextLocation);
				if (nextLocationKey === requestedLocationKey) {
					ignoredRouteKeyRef.current = nextLocationKey;
					pendingRouteKeyRef.current = null;
				} else {
					pendingRouteKeyRef.current = nextLocationKey;
				}
				onReviewLocationChange(nextLocation);
			}
		},
		[active, onReviewLocationChange, repositoryId, requestedLocationKey, workspacePosition],
	);
	const onAnchorChanged = useCallback(
		(path: string, anchor: ReviewLineAnchor) => {
			if (repositoryId) workspacePosition?.rememberAnchor(repositoryId, path, anchor);
		},
		[repositoryId, workspacePosition],
	);
	const copyLink = useCallback(
		async (path: string | null, anchor: ReviewLineAnchor | null) => {
			if (!path || !repositoryId || !shareBaseUrl) return;
			try {
				await copyToClipboard(absoluteReviewUrl(shareBaseUrl, repositoryId, { anchor, path }));
				showToast(anchor ? "Link to current line copied" : "File link copied");
			} catch (error) {
				showToast(messageOf(error));
			}
		},
		[repositoryId, shareBaseUrl, showToast],
	);

	return useMemo(
		() => ({ copyLink, initialLocation, onAnchorChanged, onFileOpened }),
		[copyLink, initialLocation, onAnchorChanged, onFileOpened],
	);
}
