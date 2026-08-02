import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { CommitMessageCapability } from "../../../shared/contracts.ts";
import { ApiError, api } from "../../api.ts";
import type { FailureState } from "../../lib/failures.ts";

interface UseCommitWorkflowOptions {
	capability: CommitMessageCapability;
	csrfToken?: string;
	onCommittedStateRefresh: () => Promise<unknown>;
	onOpen: () => void;
	onOperationRevision: (operationRevision: string) => void;
	operationRevision: string;
	refreshChanges: () => Promise<unknown>;
	reportFailure: (error: unknown, context: string) => FailureState;
	repositoryId: string | null;
	showToast: (message: string) => void;
	stagedCount: number;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useCommitWorkflow({
	capability,
	csrfToken,
	onCommittedStateRefresh,
	onOpen,
	onOperationRevision,
	operationRevision,
	refreshChanges,
	reportFailure,
	repositoryId,
	showToast,
	stagedCount,
}: UseCommitWorkflowOptions) {
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [messageBusy, setMessageBusy] = useState(false);
	const messageRequestRef = useRef<AbortController | null>(null);
	const commitRequestRef = useRef<AbortController | null>(null);
	const repositoryIdRef = useRef(repositoryId);
	const operationRevisionRef = useRef(operationRevision);
	repositoryIdRef.current = repositoryId;
	operationRevisionRef.current = operationRevision;

	const reset = useCallback(() => {
		messageRequestRef.current?.abort();
		commitRequestRef.current?.abort();
		messageRequestRef.current = null;
		commitRequestRef.current = null;
		setOpen(false);
		setMessage("");
		setBusy(false);
		setMessageBusy(false);
	}, []);

	useEffect(() => reset, [reset]);
	useEffect(() => reset(), [repositoryId, reset]);

	const openComposer = useCallback(() => {
		messageRequestRef.current?.abort();
		messageRequestRef.current = null;
		setMessageBusy(false);
		setMessage("");
		setOpen(true);
		onOpen();
	}, [onOpen]);

	const closeComposer = useCallback(() => {
		messageRequestRef.current?.abort();
		messageRequestRef.current = null;
		setMessageBusy(false);
		setOpen(false);
	}, []);

	const generateMessage = useCallback(async () => {
		if (!csrfToken || !repositoryId || !capability.available || messageBusy || stagedCount === 0) {
			return;
		}
		const activeRepositoryId = repositoryId;
		const requestedRevision = operationRevision;
		const controller = new AbortController();
		messageRequestRef.current?.abort();
		messageRequestRef.current = controller;
		setMessageBusy(true);
		try {
			const response = await api.generateCommitMessage(
				activeRepositoryId,
				{ operationRevision: requestedRevision },
				csrfToken,
				controller.signal,
			);
			if (
				controller.signal.aborted ||
				messageRequestRef.current !== controller ||
				repositoryIdRef.current !== activeRepositoryId ||
				operationRevisionRef.current !== response.operationRevision
			) {
				return;
			}
			setMessage(response.message);
		} catch (error) {
			if (controller.signal.aborted || isAbortError(error)) return;
			reportFailure(error, "Generate commit message");
			if (error instanceof ApiError && error.status === 409) void refreshChanges();
		} finally {
			if (messageRequestRef.current === controller) {
				messageRequestRef.current = null;
				setMessageBusy(false);
			}
		}
	}, [
		capability.available,
		csrfToken,
		messageBusy,
		operationRevision,
		refreshChanges,
		reportFailure,
		repositoryId,
		stagedCount,
	]);

	const commit = useCallback(
		async (event?: FormEvent) => {
			event?.preventDefault();
			const normalizedMessage = message.trim();
			if (!normalizedMessage || !csrfToken || !repositoryId || busy || stagedCount === 0) {
				return;
			}
			const activeRepositoryId = repositoryId;
			const controller = new AbortController();
			commitRequestRef.current?.abort();
			commitRequestRef.current = controller;
			setBusy(true);
			try {
				const response = await api.commit(
					activeRepositoryId,
					{ message: normalizedMessage, operationRevision },
					csrfToken,
					controller.signal,
				);
				if (controller.signal.aborted || repositoryIdRef.current !== activeRepositoryId) {
					return;
				}
				operationRevisionRef.current = response.operationRevision;
				onOperationRevision(response.operationRevision);
				setOpen(false);
				setMessage("");
				await Promise.all([refreshChanges(), onCommittedStateRefresh()]);
				if (controller.signal.aborted || repositoryIdRef.current !== activeRepositoryId) {
					return;
				}
				showToast(`Committed ${response.commit.slice(0, 7)}`);
			} catch (error) {
				if (
					controller.signal.aborted ||
					repositoryIdRef.current !== activeRepositoryId ||
					isAbortError(error)
				) {
					return;
				}
				reportFailure(error, "Commit staged changes");
				if (error instanceof ApiError && error.status === 409) void refreshChanges();
			} finally {
				if (commitRequestRef.current === controller) commitRequestRef.current = null;
				if (repositoryIdRef.current === activeRepositoryId) setBusy(false);
			}
		},
		[
			busy,
			csrfToken,
			message,
			onCommittedStateRefresh,
			onOperationRevision,
			operationRevision,
			refreshChanges,
			reportFailure,
			repositoryId,
			showToast,
			stagedCount,
		],
	);

	return {
		busy,
		closeComposer,
		commit,
		generateMessage,
		message,
		messageBusy,
		open,
		openComposer,
		reset,
		setMessage,
	};
}
