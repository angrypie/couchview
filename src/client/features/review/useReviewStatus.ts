import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ChangeFile } from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { messageOf } from "../../lib/failures.ts";

export interface UndoReview {
	fileId: string;
	contentRevision: string;
	reviewed: boolean;
}

interface UseReviewStatusOptions {
	activeFileIndex: number;
	csrfToken?: string;
	dismissToast: () => void;
	files: ChangeFile[];
	onSelectFile: (fileId: string) => void;
	refreshReviewState: () => Promise<unknown>;
	repositoryId: string | null;
	setFiles: Dispatch<SetStateAction<ChangeFile[]>>;
	showToast: (message: string, undo?: UndoReview) => void;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useReviewStatus({
	activeFileIndex,
	csrfToken,
	dismissToast,
	files,
	onSelectFile,
	refreshReviewState,
	repositoryId,
	setFiles,
	showToast,
}: UseReviewStatusOptions) {
	const [busy, setBusy] = useState(false);
	const [bulkBusy, setBulkBusy] = useState(false);
	const requestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	repositoryIdRef.current = repositoryId;

	useEffect(() => {
		requestRef.current?.abort();
		requestRef.current = repositoryId ? new AbortController() : null;
		setBusy(false);
		setBulkBusy(false);
		return () => requestRef.current?.abort();
	}, [repositoryId]);

	const setReviewed = useCallback(
		async (file: ChangeFile, reviewed: boolean, advance: boolean) => {
			if (!csrfToken || !repositoryId || busy || bulkBusy) return;
			const activeRepositoryId = repositoryId;
			const signal = requestRef.current?.signal;
			setBusy(true);
			const previous = file.reviewed;
			setFiles((current) =>
				current.map((item) => (item.id === file.id ? { ...item, reviewed } : item)),
			);
			try {
				await api.setReviewed(
					activeRepositoryId,
					{ fileId: file.id, contentRevision: file.contentRevision, reviewed },
					csrfToken,
					signal,
				);
				if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
				if (advance && reviewed) {
					const after = files.slice(activeFileIndex + 1);
					const before = files.slice(0, Math.max(0, activeFileIndex));
					const next =
						after.find((item) => item.id !== file.id && !item.reviewed) ??
						before.find((item) => item.id !== file.id && !item.reviewed) ??
						files[activeFileIndex + 1];
					if (next) onSelectFile(next.id);
				}
				showToast(reviewed ? "Marked reviewed" : "Review mark removed", {
					fileId: file.id,
					contentRevision: file.contentRevision,
					reviewed: previous,
				});
			} catch (error) {
				if (
					signal?.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				setFiles((current) =>
					current.map((item) => (item.id === file.id ? { ...item, reviewed: previous } : item)),
				);
				showToast(messageOf(error));
			} finally {
				if (repositoryIdRef.current === activeRepositoryId) setBusy(false);
			}
		},
		[
			activeFileIndex,
			bulkBusy,
			busy,
			csrfToken,
			files,
			onSelectFile,
			repositoryId,
			setFiles,
			showToast,
		],
	);

	const unreviewMultiple = useCallback(
		async (targets: ChangeFile[]) => {
			const reviewedTargets = targets.filter((file) => file.reviewed);
			if (!csrfToken || !repositoryId || busy || bulkBusy || reviewedTargets.length === 0) {
				return;
			}
			const activeRepositoryId = repositoryId;
			const signal = requestRef.current?.signal;
			const targetIds = new Set(reviewedTargets.map((file) => file.id));
			setBulkBusy(true);
			setFiles((current) =>
				current.map((file) => (targetIds.has(file.id) ? { ...file, reviewed: false } : file)),
			);
			try {
				await api.setReviewedFiles(
					activeRepositoryId,
					{
						files: reviewedTargets.map((file) => ({
							fileId: file.id,
							contentRevision: file.contentRevision,
						})),
						reviewed: false,
					},
					csrfToken,
					signal,
				);
				if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
				const noun = reviewedTargets.length === 1 ? "mark" : "marks";
				showToast(`${reviewedTargets.length} review ${noun} removed`);
			} catch (error) {
				if (
					signal?.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				setFiles((current) =>
					current.map((file) => (targetIds.has(file.id) ? { ...file, reviewed: true } : file)),
				);
				void refreshReviewState();
				showToast(messageOf(error));
			} finally {
				if (repositoryIdRef.current === activeRepositoryId) setBulkBusy(false);
			}
		},
		[bulkBusy, busy, csrfToken, refreshReviewState, repositoryId, setFiles, showToast],
	);

	const undoReview = useCallback(
		async (undo: UndoReview) => {
			if (!csrfToken || !repositoryId) return;
			const activeRepositoryId = repositoryId;
			const signal = requestRef.current?.signal;
			const file = files.find((item) => item.id === undo.fileId);
			if (!file) return;
			dismissToast();
			setFiles((current) =>
				current.map((item) =>
					item.id === undo.fileId ? { ...item, reviewed: undo.reviewed } : item,
				),
			);
			try {
				await api.setReviewed(
					activeRepositoryId,
					{
						fileId: undo.fileId,
						contentRevision: undo.contentRevision,
						reviewed: undo.reviewed,
					},
					csrfToken,
					signal,
				);
			} catch (error) {
				if (
					signal?.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				void refreshReviewState();
				showToast(messageOf(error));
			}
		},
		[csrfToken, dismissToast, files, refreshReviewState, repositoryId, setFiles, showToast],
	);

	return { bulkBusy, busy: busy || bulkBusy, setReviewed, undoReview, unreviewMultiple };
}
