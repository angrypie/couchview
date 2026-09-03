import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";

import type { FileChange } from "../../../shared/contracts.ts";
import type {
	ReviewLineAnchor,
	ReviewLineSide,
	ReviewLocation,
} from "../workspacePosition/index.ts";

export interface InitialReviewLocation {
	fallbackOnMissing: boolean;
	location: ReviewLocation & { fileId?: string | null };
	updateRoute: boolean;
}

export interface PendingLineNavigation {
	allowSource: boolean;
	line: number;
	path: string;
	side: ReviewLineSide;
}

interface UseReviewLocationRestorationOptions {
	closeSource: () => void;
	currentFileId: string | null;
	files: FileChange[];
	initialLocation: InitialReviewLocation | null;
	notFoundPath: string | null;
	onFileOpened?: (path: string, fileId: string | null, updateRoute: boolean) => void;
	openSource: (path: string, focusLine?: number, changeFileId?: string | null) => void;
	operationRevision: string;
	repositoryId: string | null;
	setCurrentFileId: (value: SetStateAction<string | null>) => void;
	setLineNavigation: Dispatch<SetStateAction<PendingLineNavigation | null>>;
	setVisibleAnchor: Dispatch<SetStateAction<ReviewLineAnchor | null>>;
}

function fallbackFile(files: FileChange[]): FileChange | null {
	return files.find((file) => !file.reviewed) ?? files[0] ?? null;
}

export function useReviewLocationRestoration({
	closeSource,
	currentFileId,
	files,
	initialLocation,
	notFoundPath,
	onFileOpened,
	openSource,
	operationRevision,
	repositoryId,
	setCurrentFileId,
	setLineNavigation,
	setVisibleAnchor,
}: UseReviewLocationRestorationOptions): void {
	const appliedLocationRef = useRef("");
	useEffect(() => {
		appliedLocationRef.current = "";
	}, [repositoryId]);

	useEffect(() => {
		if (!repositoryId || !operationRevision) return;
		const locationKey = initialLocation
			? `${repositoryId}\0${initialLocation.location.path}\0${initialLocation.location.anchor?.line ?? ""}\0${initialLocation.location.anchor?.side ?? ""}`
			: "";
		if (initialLocation && appliedLocationRef.current !== locationKey) {
			appliedLocationRef.current = locationKey;
			const { anchor, fileId, path } = initialLocation.location;
			const changedFile = files.find((file) => file.id === fileId || file.path === path);
			setVisibleAnchor(anchor);
			if (changedFile) {
				closeSource();
				setCurrentFileId(changedFile.id);
				setLineNavigation(
					anchor
						? {
								allowSource: !initialLocation.fallbackOnMissing,
								line: anchor.line,
								path,
								side: anchor.side,
							}
						: null,
				);
				onFileOpened?.(path, changedFile.id, initialLocation.updateRoute);
				return;
			}
			setCurrentFileId(null);
			setLineNavigation(
				anchor ? { allowSource: false, line: anchor.line, path, side: anchor.side } : null,
			);
			openSource(path, anchor?.line ?? 1);
			onFileOpened?.(path, null, initialLocation.updateRoute);
			return;
		}
		if (currentFileId && files.some((file) => file.id === currentFileId)) return;
		const fallback = fallbackFile(files);
		setCurrentFileId(fallback?.id ?? null);
		if (fallback) onFileOpened?.(fallback.path, fallback.id, true);
	}, [
		closeSource,
		currentFileId,
		files,
		initialLocation,
		onFileOpened,
		openSource,
		operationRevision,
		repositoryId,
		setCurrentFileId,
		setLineNavigation,
		setVisibleAnchor,
	]);

	useEffect(() => {
		if (
			!notFoundPath ||
			!initialLocation?.fallbackOnMissing ||
			notFoundPath !== initialLocation.location.path
		) {
			return;
		}
		const fallback = fallbackFile(files);
		closeSource();
		setLineNavigation(null);
		setVisibleAnchor(null);
		setCurrentFileId(fallback?.id ?? null);
		if (fallback) onFileOpened?.(fallback.path, fallback.id, true);
	}, [
		closeSource,
		files,
		initialLocation,
		notFoundPath,
		onFileOpened,
		setCurrentFileId,
		setLineNavigation,
		setVisibleAnchor,
	]);
}
