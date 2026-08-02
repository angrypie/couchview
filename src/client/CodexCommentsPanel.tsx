import { useEffect, useMemo, useRef, useState } from "react";
import {
	Check,
	ChevronLeft,
	CircleAlert,
	LoaderCircle,
	Plus,
	RefreshCw,
	Send,
	Square,
	X,
} from "lucide-react";

import {
	API_ROUTES,
	type CodexApprovalDecision,
	type CodexCapability,
	type CodexEvent,
	type CodexThreadSummary,
	type CodexTurnResponse,
} from "../shared/contracts.ts";
import { ApiError, api } from "./api.ts";

interface CodexCommentsPanelProps {
	repositoryId: string;
	csrfToken: string;
	capability: CodexCapability;
	currentCommentCount: number;
	onClose(): void;
	showToast(message: string): void;
}

type PanelView = "threads" | "activity";

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : "Something went wrong.";
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function formatTime(value: string): string {
	if (!value) return "unknown time";
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return "unknown time";
	const elapsed = Math.max(0, Date.now() - timestamp);
	if (elapsed < 60_000) return "just now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
	return new Date(timestamp).toLocaleDateString();
}

function statusLabel(thread: CodexThreadSummary): string {
	if (thread.status === "active") return "active elsewhere";
	if (thread.status === "systemError") return "error";
	if (thread.status === "notLoaded") return "saved";
	return "ready";
}

type EventPresentation =
	| { kind: "text"; text: string }
	| { kind: "command"; command: string; status?: string }
	| { kind: "output"; text: string }
	| { kind: "file-change"; text: string }
	| null;

function itemOf(event: CodexEvent): Record<string, unknown> | null {
	const data = recordOf(event.data);
	return recordOf(data?.item);
}

/**
 * App Server deliberately sends a fairly noisy event stream. Keep protocol
 * bookkeeping out of the activity UI and turn item lifecycle events into
 * human-readable progress cards instead.
 */
export function eventPresentation(event: CodexEvent): EventPresentation {
	if (event.type === "error") {
		const data = recordOf(event.data);
		const message = data?.message ?? recordOf(data?.error)?.message;
		return {
			kind: "text",
			text: typeof message === "string" ? message : "Codex reported an error.",
		};
	}
	if (event.type === "completed") return { kind: "text", text: "Turn completed." };
	if (event.type === "approval") return null;

	const data = recordOf(event.data);
	if (event.method === "item/agentMessage/delta") {
		return typeof data?.delta === "string" ? { kind: "text", text: data.delta } : null;
	}
	if (
		event.method === "item/commandExecution/outputDelta" ||
		event.method === "item/fileChange/outputDelta"
	) {
		return typeof data?.delta === "string" ? { kind: "output", text: data.delta } : null;
	}
	if (event.method === "item/started") {
		const item = itemOf(event);
		if (item?.type === "commandExecution") {
			return {
				kind: "command",
				command: typeof item.command === "string" ? item.command : "Codex started a command.",
				status: "running",
			};
		}
		if (item?.type === "fileChange")
			return { kind: "file-change", text: "Codex is preparing file changes…" };
		if (item?.type === "mcpToolCall") return { kind: "text", text: "Codex is using a tool…" };
		return null;
	}
	if (event.method === "item/completed") {
		const item = itemOf(event);
		if (item?.type === "agentMessage") {
			// The message is normally already visible through delta events. Keep a
			// completed message as a fallback for servers that do not stream deltas.
			return typeof item.text === "string" ? { kind: "text", text: item.text } : null;
		}
		if (item?.type === "commandExecution") {
			return {
				kind: "command",
				command: typeof item.command === "string" ? item.command : "Command",
				status:
					item.status === "completed"
						? "completed"
						: typeof item.status === "string"
							? item.status
							: undefined,
			};
		}
		if (item?.type === "fileChange") {
			const status = typeof item.status === "string" ? item.status : "completed";
			return {
				kind: "file-change",
				text: status === "completed" ? "File changes completed." : `File changes ${status}.`,
			};
		}
		return null;
	}
	if (event.method === "turn/started") return { kind: "text", text: "Codex started working…" };

	// Notifications such as thread/status/changed, turn/diff/updated, and
	// thread/tokenUsage/updated are useful to protocol clients but not people.
	return null;
}

function eventText(event: CodexEvent): string | null {
	const presentation = eventPresentation(event);
	return presentation?.kind === "text" ? presentation.text : null;
}

function approvalSummary(event: CodexEvent): string {
	const data = recordOf(event.data);
	const command = data?.command;
	if (typeof command === "string") return command;
	const cwd = data?.cwd;
	if (typeof cwd === "string") return `Permission requested in ${cwd}`;
	const reason = data?.reason;
	if (typeof reason === "string" && reason) return reason;
	return "Codex is requesting approval to continue.";
}

function CodexUnavailablePanel({ onClose, reason }: { onClose(): void; reason: string | null }) {
	return (
		<>
			<button
				aria-label="Close Codex thread picker"
				className="sheet-scrim codex-scrim"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label="Send comments to Codex"
				aria-modal="true"
				className="bottom-sheet codex-sheet"
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">Send to Codex</h2>
						<div className="repo-meta">Unavailable</div>
					</div>
					<button
						aria-label="Close Codex thread picker"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>
				<div className="empty-state codex-empty-state">
					<CircleAlert className="state-icon" size={26} />
					<p className="state-copy">{reason}</p>
				</div>
				<footer className="sheet-footer">
					<button className="action-button secondary" onClick={onClose} type="button">
						Close
					</button>
				</footer>
			</section>
		</>
	);
}

interface CodexPanelHeaderProps {
	currentCommentCount: number;
	onBack(): void;
	onClose(): void;
	selectedThread: CodexThreadSummary | null;
	view: PanelView;
}

function CodexPanelHeader({
	currentCommentCount,
	onBack,
	onClose,
	selectedThread,
	view,
}: CodexPanelHeaderProps) {
	return (
		<header className="sheet-header">
			<div>
				<h2 className="sheet-title">
					{view === "activity" && (
						<button
							aria-label="Back to Codex threads"
							className="icon-button codex-back-button"
							onClick={onBack}
							type="button"
						>
							<ChevronLeft size={17} />
						</button>
					)}
					{view === "threads" ? "Send to Codex" : "Codex activity"}
				</h2>
				<div className="repo-meta">
					{view === "threads"
						? `${currentCommentCount} current comment${currentCommentCount === 1 ? "" : "s"}`
						: selectedThread?.preview || "Review comments"}
				</div>
			</div>
			<button
				aria-label="Close Codex activity"
				className="icon-button"
				onClick={onClose}
				type="button"
			>
				<X size={19} />
			</button>
		</header>
	);
}

interface CodexActivityProps {
	approvalBusy: string | null;
	eventError: string | null;
	events: CodexEvent[];
	onRespondApproval(event: CodexEvent, decision: CodexApprovalDecision): Promise<void>;
}

function CodexActivity({
	approvalBusy,
	eventError,
	events,
	onRespondApproval,
}: CodexActivityProps) {
	return (
		<div className="codex-activity" aria-live="polite">
			{events.length === 0 && !eventError && (
				<div className="loading-state" style={{ minHeight: 150 }}>
					<LoaderCircle className="state-icon spinner" size={24} />
					<p className="state-copy">Waiting for Codex…</p>
				</div>
			)}
			{events.map((event) => {
				if (event.type === "approval") {
					const busy = approvalBusy === event.approvalId;
					const sessionApproval =
						event.approvalMethod?.includes("commandExecution") ||
						event.approvalMethod?.includes("fileChange") ||
						event.approvalMethod === "item/permissions/requestApproval";
					return (
						<article className="codex-approval-card" key={`${event.approvalId}-${event.sequence}`}>
							<strong>Codex needs approval</strong>
							<code>{approvalSummary(event)}</code>
							<div className="codex-approval-actions">
								<button
									className="action-button"
									disabled={busy}
									onClick={() => void onRespondApproval(event, "accept")}
									type="button"
								>
									{busy ? <LoaderCircle className="spinner" size={14} /> : <Check size={14} />}{" "}
									Allow
								</button>
								{sessionApproval && (
									<button
										className="action-button secondary"
										disabled={busy}
										onClick={() => void onRespondApproval(event, "acceptForSession")}
										type="button"
									>
										Allow for session
									</button>
								)}
								<button
									className="action-button secondary"
									disabled={busy}
									onClick={() => void onRespondApproval(event, "decline")}
									type="button"
								>
									Deny
								</button>
								<button
									className="text-button danger"
									disabled={busy}
									onClick={() => void onRespondApproval(event, "cancel")}
									type="button"
								>
									Cancel turn
								</button>
							</div>
						</article>
					);
				}
				const presentation = eventPresentation(event);
				if (!presentation) return null;
				const key = `${event.sequence}-${event.method ?? event.type}`;
				if (presentation.kind === "output") {
					return (
						<pre className="codex-event codex-command-output" key={key}>
							{presentation.text}
						</pre>
					);
				}
				if (presentation.kind === "command") {
					return (
						<article className="codex-progress-card codex-command-card" key={key}>
							<span>
								{presentation.status === "running"
									? "Running command"
									: `Command ${presentation.status ?? "updated"}`}
							</span>
							<code>{presentation.command}</code>
						</article>
					);
				}
				if (presentation.kind === "file-change") {
					return (
						<div className="codex-progress-card" key={key}>
							{presentation.text}
						</div>
					);
				}
				return (
					<div className={`codex-event codex-event-${event.type}`} key={key}>
						{presentation.text}
					</div>
				);
			})}
			{eventError && (
				<div className="codex-event codex-event-error">
					<CircleAlert size={15} /> {eventError}
				</div>
			)}
		</div>
	);
}

export function CodexCommentsPanel({
	repositoryId,
	csrfToken,
	capability,
	currentCommentCount,
	onClose,
	showToast,
}: CodexCommentsPanelProps) {
	const [view, setView] = useState<PanelView>("threads");
	const [threads, setThreads] = useState<CodexThreadSummary[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
	const [loadingThreads, setLoadingThreads] = useState(true);
	const [threadBusy, setThreadBusy] = useState(false);
	const [turn, setTurn] = useState<CodexTurnResponse | null>(null);
	const [events, setEvents] = useState<CodexEvent[]>([]);
	const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
	const [eventError, setEventError] = useState<string | null>(null);
	const eventSourceRef = useRef<EventSource | null>(null);

	const selectedThread = useMemo(
		() => threads.find((thread) => thread.id === selectedThreadId) ?? null,
		[selectedThreadId, threads],
	);

	const loadThreads = async (cursor: string | null = null, signal?: AbortSignal) => {
		if (!capability.available) {
			setLoadingThreads(false);
			return;
		}
		setLoadingThreads(true);
		try {
			const response = await api.codexThreads(repositoryId, cursor, signal);
			setThreads((current) => (cursor ? [...current, ...response.threads] : response.threads));
			setNextCursor(response.nextCursor);
			if (!cursor) {
				const stored = window.localStorage.getItem(`couchview:codex-thread:${repositoryId}`);
				const available = response.threads.find(
					(thread) => thread.id === stored && thread.status !== "active",
				);
				setSelectedThreadId(
					available?.id ??
						response.threads.find((thread) => thread.status !== "active")?.id ??
						null,
				);
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			showToast(messageOf(error));
		} finally {
			if (!signal?.aborted) setLoadingThreads(false);
		}
	};

	useEffect(() => {
		const controller = new AbortController();
		eventSourceRef.current?.close();
		eventSourceRef.current = null;
		setView("threads");
		setThreads([]);
		setNextCursor(null);
		setSelectedThreadId(null);
		setTurn(null);
		setEvents([]);
		setEventError(null);
		void loadThreads(null, controller.signal);
		return () => {
			controller.abort();
			eventSourceRef.current?.close();
		};
		// Opening this sheet represents an intentional refresh of the Codex picker.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [repositoryId, capability.available]);

	const watchTurn = (response: CodexTurnResponse) => {
		eventSourceRef.current?.close();
		const stream = new EventSource(
			`${API_ROUTES.codexThreadEvents(repositoryId, response.threadId)}?turnId=${encodeURIComponent(response.turnId)}`,
		);
		eventSourceRef.current = stream;
		stream.onmessage = (message) => {
			try {
				const event = JSON.parse(message.data) as CodexEvent;
				setEvents((current) =>
					current.some((item) => item.sequence === event.sequence) ? current : [...current, event],
				);
				if (event.type === "error") setEventError(eventText(event));
				if (event.type === "completed") stream.close();
			} catch {
				setEventError("Codex sent an unreadable event.");
			}
		};
		stream.onerror = () => {
			if (!stream.readyState || stream.readyState === EventSource.CLOSED) {
				setEventError("The Codex event stream closed unexpectedly.");
			}
		};
	};

	const sendComments = async (threadId: string) => {
		if (currentCommentCount === 0) {
			showToast("There are no current review comments to send");
			return;
		}
		setThreadBusy(true);
		setEventError(null);
		setEvents([]);
		try {
			window.localStorage.setItem(`couchview:codex-thread:${repositoryId}`, threadId);
			const response = await api.sendCodexComments(repositoryId, threadId, csrfToken);
			setTurn(response);
			setView("activity");
			watchTurn(response);
		} catch (error) {
			if (error instanceof ApiError && error.code === "codex_thread_in_use") {
				await loadThreads();
			}
			showToast(messageOf(error));
		} finally {
			setThreadBusy(false);
		}
	};

	const createAndSend = async () => {
		if (currentCommentCount === 0) {
			showToast("There are no current review comments to send");
			return;
		}
		setThreadBusy(true);
		let threadId: string | null = null;
		try {
			const response = await api.createCodexThread(repositoryId, csrfToken);
			setThreads((current) => [response.thread, ...current]);
			setSelectedThreadId(response.thread.id);
			threadId = response.thread.id;
		} catch (error) {
			showToast(messageOf(error));
			return;
		} finally {
			setThreadBusy(false);
		}
		if (threadId) await sendComments(threadId);
	};

	const respondApproval = async (event: CodexEvent, decision: CodexApprovalDecision) => {
		if (!event.approvalId || !turn) return;
		setApprovalBusy(event.approvalId);
		try {
			const permissionRequest = event.approvalMethod === "item/permissions/requestApproval";
			const permissionProfile = permissionRequest ? recordOf(event.data)?.permissions : undefined;
			const requestDecision =
				permissionRequest && (decision === "accept" || decision === "acceptForSession")
					? {
							permissions: permissionProfile ?? {},
							scope: decision === "acceptForSession" ? ("session" as const) : ("turn" as const),
						}
					: decision;
			await api.respondCodexApproval(
				repositoryId,
				turn.threadId,
				event.approvalId,
				{ decision: requestDecision },
				csrfToken,
			);
		} catch (error) {
			showToast(messageOf(error));
		} finally {
			setApprovalBusy(null);
		}
	};

	const interrupt = async () => {
		if (!turn) return;
		try {
			await api.interruptCodexTurn(repositoryId, turn.threadId, turn.turnId, csrfToken);
			showToast("Stopping Codex turn…");
		} catch (error) {
			showToast(messageOf(error));
		}
	};

	if (!capability.available) {
		return <CodexUnavailablePanel onClose={onClose} reason={capability.reason} />;
	}

	return (
		<>
			<button
				aria-label="Close Codex thread picker"
				className="sheet-scrim codex-scrim"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label={view === "threads" ? "Send comments to Codex" : "Codex activity"}
				aria-modal="true"
				className="bottom-sheet codex-sheet"
				role="dialog"
			>
				<span className="sheet-grabber" />
				<CodexPanelHeader
					currentCommentCount={currentCommentCount}
					onBack={() => setView("threads")}
					onClose={onClose}
					selectedThread={selectedThread}
					view={view}
				/>

				{view === "threads" ? (
					<>
						<div className="codex-toolbar">
							<button
								className="action-button secondary"
								disabled={threadBusy}
								onClick={() => void createAndSend()}
								type="button"
							>
								<Plus size={15} /> New thread
							</button>
							<button
								aria-label="Refresh Codex threads"
								className="icon-button"
								disabled={loadingThreads || threadBusy}
								onClick={() => void loadThreads()}
								type="button"
							>
								<RefreshCw className={loadingThreads ? "spinner" : ""} size={16} />
							</button>
						</div>
						<div className="comment-list codex-thread-list">
							{loadingThreads && threads.length === 0 ? (
								<div className="loading-state" style={{ minHeight: 150 }}>
									<LoaderCircle className="state-icon spinner" size={24} />
									<p className="state-copy">Finding project threads…</p>
								</div>
							) : threads.length === 0 ? (
								<div className="empty-state codex-empty-state">
									<Send className="state-icon" size={26} />
									<p className="state-copy">No Codex threads exist for this project yet.</p>
								</div>
							) : (
								threads.map((thread) => {
									const unavailable = thread.status === "active";
									return (
										<button
											className={`codex-thread-row ${selectedThreadId === thread.id ? "selected" : ""}`}
											disabled={unavailable || threadBusy}
											key={thread.id}
											onClick={() => setSelectedThreadId(thread.id)}
											title={
												unavailable
													? "This thread is active in another Codex client. Hand it off there before sending."
													: undefined
											}
											type="button"
										>
											<span className="codex-thread-copy">
												<strong>{thread.preview || "Untitled Codex thread"}</strong>
												<span>
													{formatTime(thread.recencyAt ?? thread.updatedAt)} · {statusLabel(thread)}
												</span>
											</span>
											{selectedThreadId === thread.id && <Check aria-label="Selected" size={16} />}
										</button>
									);
								})
							)}
							{nextCursor && (
								<button
									className="text-button codex-load-more"
									disabled={loadingThreads}
									onClick={() => void loadThreads(nextCursor)}
									type="button"
								>
									Load older threads
								</button>
							)}
						</div>
						<footer className="sheet-footer codex-sheet-footer">
							<button
								className="action-button"
								disabled={!selectedThreadId || threadBusy || currentCommentCount === 0}
								onClick={() => selectedThreadId && void sendComments(selectedThreadId)}
								type="button"
							>
								{threadBusy ? <LoaderCircle className="spinner" size={16} /> : <Send size={16} />}{" "}
								{currentCommentCount === 0 ? "No current comments" : "Send comments"}
							</button>
						</footer>
					</>
				) : (
					<>
						<CodexActivity
							approvalBusy={approvalBusy}
							eventError={eventError}
							events={events}
							onRespondApproval={respondApproval}
						/>
						<footer className="sheet-footer codex-sheet-footer">
							<button
								className="action-button secondary"
								disabled={!turn || Boolean(events.some((event) => event.type === "completed"))}
								onClick={() => void interrupt()}
								type="button"
							>
								<Square size={14} /> Stop turn
							</button>
						</footer>
					</>
				)}
			</section>
		</>
	);
}
