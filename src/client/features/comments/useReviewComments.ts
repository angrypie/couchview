import {
	type Dispatch,
	type FormEvent,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	ChangeFile,
	FileDiff,
	ReviewComment,
	ReviewStateResponse,
} from "../../../shared/contracts.ts";
import { api } from "../../api.ts";
import { exportCommentsForCodex, formatCommentReference } from "../../commentExport.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { messageOf } from "../../lib/failures.ts";
import type { CommentSelection, DisplayRow, LineSelection } from "../review/diffModel.ts";
import type { DiffViewerHandle } from "../review/types.ts";
import { useCommentNavigation } from "./useCommentNavigation.ts";

interface UseReviewCommentsOptions {
	activeFile: ChangeFile | null;
	csrfToken?: string;
	currentFileId: string | null;
	diff: FileDiff | null;
	files: ChangeFile[];
	onSelectFile: (fileId: string) => void;
	repositoryId: string | null;
	rows: DisplayRow[];
	selection: CommentSelection | null;
	setFiles: Dispatch<SetStateAction<ChangeFile[]>>;
	setSelection: Dispatch<SetStateAction<LineSelection | null>>;
	showToast: (message: string) => void;
	viewerRef: RefObject<DiffViewerHandle | null>;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useReviewComments({
	activeFile,
	csrfToken,
	currentFileId,
	diff,
	files,
	onSelectFile,
	repositoryId,
	rows,
	selection,
	setFiles,
	setSelection,
	showToast,
	viewerRef,
}: UseReviewCommentsOptions) {
	const [comments, setComments] = useState<ReviewComment[]>([]);
	const [composerOpen, setComposerOpen] = useState(false);
	const [trayOpen, setTrayOpen] = useState(false);
	const [codexPanelOpen, setCodexPanelOpen] = useState(false);
	const [body, setBody] = useState("");
	const [editingComment, setEditingComment] = useState<ReviewComment | null>(null);
	const [busy, setBusy] = useState(false);
	const [copyFallbackText, setCopyFallbackText] = useState("");
	const [pendingComment, setPendingComment] = useState<ReviewComment | null>(null);
	const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
	const requestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	repositoryIdRef.current = repositoryId;

	useEffect(() => {
		requestRef.current?.abort();
		requestRef.current = repositoryId ? new AbortController() : null;
		setComments([]);
		setComposerOpen(false);
		setTrayOpen(false);
		setCodexPanelOpen(false);
		setBody("");
		setEditingComment(null);
		setBusy(false);
		setCopyFallbackText("");
		setPendingComment(null);
		setFocusedCommentId(null);
		return () => requestRef.current?.abort();
	}, [repositoryId]);

	const applyReviewState = useCallback(
		(response: ReviewStateResponse) => {
			setComments(response.comments);
			const commentCounts = new Map<string, number>();
			for (const comment of response.comments) {
				commentCounts.set(comment.fileId, (commentCounts.get(comment.fileId) ?? 0) + 1);
			}
			setFiles((current) =>
				current.map((file) => {
					const review = response.reviews.find((item) => item.fileId === file.id);
					return {
						...file,
						...(review ? { reviewed: review.reviewed } : {}),
						commentCount: commentCounts.get(file.id) ?? 0,
					};
				}),
			);
			return response;
		},
		[setFiles],
	);

	const refreshReviewState = useCallback(async () => {
		const activeRepositoryId = repositoryIdRef.current;
		if (!activeRepositoryId) throw new Error("No repository is selected");
		const response = await api.reviews(activeRepositoryId, requestRef.current?.signal);
		if (repositoryIdRef.current === activeRepositoryId) applyReviewState(response);
		return response;
	}, [applyReviewState]);

	const openComposer = useCallback(() => {
		if (!selection) return;
		setEditingComment(null);
		setBody("");
		setComposerOpen(true);
	}, [selection]);

	const saveComment = useCallback(
		async (event?: FormEvent) => {
			event?.preventDefault();
			const normalizedBody = body.trim();
			if (!normalizedBody || !csrfToken || !repositoryId || busy) return;
			const activeRepositoryId = repositoryId;
			const signal = requestRef.current?.signal;
			setBusy(true);
			try {
				if (editingComment) {
					const response = await api.updateComment(
						activeRepositoryId,
						{ id: editingComment.id, body: normalizedBody },
						csrfToken,
						signal,
					);
					if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
					setComments((current) =>
						current.map((comment) =>
							comment.id === response.comment.id ? response.comment : comment,
						),
					);
					showToast("Comment updated");
				} else if (activeFile && selection?.hunk) {
					const response = await api.createComment(
						activeRepositoryId,
						{
							fileId: activeFile.id,
							contentRevision: activeFile.contentRevision,
							side: selection.side,
							startLine: selection.start,
							endLine: selection.end,
							oldStartLine: selection.oldStartLine,
							oldEndLine: selection.oldEndLine,
							newStartLine: selection.newStartLine,
							newEndLine: selection.newEndLine,
							hunkHeader: selection.hunk.header,
							excerpt: selection.excerpt,
							body: normalizedBody,
						},
						csrfToken,
						signal,
					);
					if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
					setComments((current) =>
						current.some((comment) => comment.id === response.comment.id)
							? current.map((comment) =>
									comment.id === response.comment.id ? response.comment : comment,
								)
							: [...current, response.comment],
					);
					void refreshReviewState();
					setSelection(null);
					showToast("Comment added");
				}
				setComposerOpen(false);
				setBody("");
				setEditingComment(null);
			} catch (error) {
				if (
					signal?.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				showToast(messageOf(error));
			} finally {
				if (repositoryIdRef.current === activeRepositoryId) setBusy(false);
			}
		},
		[
			activeFile,
			body,
			busy,
			csrfToken,
			editingComment,
			refreshReviewState,
			repositoryId,
			selection,
			setSelection,
			showToast,
		],
	);

	const editComment = useCallback((comment: ReviewComment) => {
		setEditingComment(comment);
		setBody(comment.body);
		setTrayOpen(false);
		setComposerOpen(true);
	}, []);

	const deleteComment = useCallback(
		async (comment: ReviewComment) => {
			if (
				!csrfToken ||
				!repositoryId ||
				!window.confirm(`Delete comment at ${formatCommentReference(comment)}?`)
			) {
				return;
			}
			const activeRepositoryId = repositoryId;
			const signal = requestRef.current?.signal;
			try {
				await api.deleteComment(activeRepositoryId, { id: comment.id }, csrfToken, signal);
				if (signal?.aborted || repositoryIdRef.current !== activeRepositoryId) return;
				setComments((current) => current.filter((item) => item.id !== comment.id));
				setFiles((current) =>
					current.map((file) =>
						file.id === comment.fileId
							? { ...file, commentCount: Math.max(0, file.commentCount - 1) }
							: file,
					),
				);
				showToast("Comment deleted");
			} catch (error) {
				if (
					signal?.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				showToast(messageOf(error));
			}
		},
		[csrfToken, repositoryId, setFiles, showToast],
	);

	const copyComments = useCallback(async () => {
		const activeRepositoryId = repositoryIdRef.current;
		if (!activeRepositoryId) return;
		let currentComments: ReviewComment[];
		try {
			const reviewState = await refreshReviewState();
			if (repositoryIdRef.current !== activeRepositoryId) return;
			currentComments = reviewState.comments.filter((comment) => !comment.stale);
		} catch (error) {
			if (repositoryIdRef.current !== activeRepositoryId || isAbortError(error)) return;
			showToast(`Could not refresh comment anchors: ${messageOf(error)}`);
			return;
		}
		if (currentComments.length === 0) {
			showToast("No current comments to copy");
			return;
		}
		const payload = exportCommentsForCodex(currentComments);
		try {
			await copyToClipboard(payload);
			showToast(
				`Copied ${currentComments.length} comment${currentComments.length === 1 ? "" : "s"}`,
			);
		} catch (error) {
			setCopyFallbackText(payload);
			setTrayOpen(false);
			showToast(`${messageOf(error)} The export is ready for manual copy.`);
		}
	}, [refreshReviewState, showToast]);

	const jumpToComment = useCallback(
		(comment: ReviewComment) => {
			if (comment.stale) {
				showToast("This comment is stale; its saved excerpt is no longer anchored to the diff");
				return;
			}
			if (!files.some((file) => file.id === comment.fileId)) {
				showToast("That file is no longer in the review queue");
				return;
			}
			setPendingComment(comment);
			setTrayOpen(false);
			if (comment.fileId !== currentFileId) onSelectFile(comment.fileId);
		},
		[currentFileId, files, onSelectFile, showToast],
	);

	const openInlineComment = useCallback((comment: ReviewComment) => {
		setFocusedCommentId(comment.id);
		setTrayOpen(true);
	}, []);

	useCommentNavigation({
		diff,
		focusedCommentId,
		pendingComment,
		rows,
		setPendingComment,
		setSelection,
		trayOpen,
		viewerRef,
	});

	return {
		activeComments: activeFile
			? comments.filter((comment) => comment.fileId === activeFile.id)
			: [],
		applyReviewState,
		body,
		busy,
		codexPanelOpen,
		comments,
		composerOpen,
		copyComments,
		copyFallbackText,
		currentCommentCount: comments.filter((comment) => !comment.stale).length,
		deleteComment,
		editComment,
		editingComment,
		focusedCommentId,
		jumpToComment,
		openComposer,
		openInlineComment,
		refreshReviewState,
		saveComment,
		setBody,
		setCodexPanelOpen,
		setComposerOpen,
		setCopyFallbackText,
		setFocusedCommentId,
		setTrayOpen,
		trayOpen,
	};
}
