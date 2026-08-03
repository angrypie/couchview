import { randomUUID } from "node:crypto";
import { exportCommentsForCodex } from "../shared/commentExport.ts";
import type {
	CodexApprovalDecision,
	CodexCapability,
	CodexEvent,
	CodexThreadStatus,
	CodexThreadSummary,
	CodexTurnResponse,
	ReviewComment,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";

type RpcId = number | string;

interface RpcResponse {
	id: RpcId;
	result?: unknown;
	error?: { code?: number; message?: string; data?: unknown };
}

interface RpcNotification {
	method: string;
	params?: unknown;
}

interface RpcServerRequest extends RpcNotification {
	id: RpcId;
}

interface CodexProcess {
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exited: Promise<number>;
	write(data: string): Promise<void>;
	close(): void;
	kill(signal?: NodeJS.Signals): void;
}

export interface CodexProcessFactory {
	(executable: string): CodexProcess;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: unknown): void;
}

interface ApprovalState {
	approvalId: string;
	rpcId: RpcId;
	method: string;
	threadId: string;
	turnId: string | null;
	params: Record<string, unknown>;
}

interface TurnState {
	threadId: string;
	turnId: string;
	events: CodexEvent[];
	listeners: Set<(event: CodexEvent) => void>;
	sequence: number;
	completed: boolean;
}

interface ThreadRecord {
	id: string;
	preview?: string;
	createdAt?: number;
	updatedAt?: number;
	recencyAt?: number | null;
	modelProvider?: string;
	status?: { type?: string };
	cwd?: string;
}

interface TurnRecord {
	id?: string;
}

function defaultProcessFactory(executable: string): CodexProcess {
	// Couchview is often launched from a Codex task. Do not let the parent's
	// internal task/profile variables make the child app-server impersonate the
	// desktop task or inherit its elevated permission profile. Explicit state
	// locations such as CODEX_HOME and CODEX_SQLITE_HOME are intentionally kept.
	const env = { ...process.env };
	for (const key of [
		"CODEX_CI",
		"CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
		"CODEX_PERMISSION_PROFILE",
		"CODEX_SHELL",
		"CODEX_THREAD_ID",
	])
		delete env[key];
	const child = Bun.spawn([executable, "app-server", "--listen", "stdio://"], {
		cwd: process.cwd(),
		env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdin = child.stdin;
	if (!stdin) throw new Error("Codex app-server stdin was not created");
	const writable = stdin as unknown as {
		write(data: string): number | Promise<number>;
		flush?(): void | Promise<void>;
		end?(): void;
	};
	return {
		stdout: child.stdout,
		stderr: child.stderr,
		exited: child.exited,
		async write(data) {
			await writable.write(data);
			await writable.flush?.();
		},
		close() {
			writable.end?.();
		},
		kill(signal) {
			child.kill(signal);
		},
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asThread(value: unknown): ThreadRecord {
	const record = asRecord(value);
	if (!record || typeof record.id !== "string") {
		throw new HttpError(502, "codex_protocol_error", "Codex returned an invalid thread");
	}
	return record as unknown as ThreadRecord;
}

function statusOf(value: unknown): CodexThreadStatus {
	const type = asRecord(value)?.type;
	return type === "active" || type === "idle" || type === "systemError" ? type : "notLoaded";
}

function timestamp(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "";
	return new Date(value * 1_000).toISOString();
}

function normalizeThread(value: unknown): CodexThreadSummary & { cwd: string | null } {
	const thread = asThread(value);
	return {
		id: thread.id,
		preview: thread.preview ?? "",
		createdAt: timestamp(thread.createdAt),
		updatedAt: timestamp(thread.updatedAt),
		recencyAt: thread.recencyAt == null ? null : timestamp(thread.recencyAt),
		modelProvider: thread.modelProvider ?? "unknown",
		status: statusOf(thread.status),
		cwd: thread.cwd ?? null,
	};
}

function requestError(error: RpcResponse["error"]): HttpError {
	const message = error?.message ?? "Codex app-server request failed";
	if (/not logged|login|authenticat/i.test(message)) {
		return new HttpError(
			503,
			"codex_auth_required",
			"Codex is not logged in; run `codex login` and try again",
		);
	}
	if (/not found|unknown thread|does not exist/i.test(message)) {
		return new HttpError(404, "codex_thread_not_found", "Codex thread was not found");
	}
	if (
		/already.*(loaded|running|owned)|in use|another.*client|active.*thread|one app-server|hold.*thread|process.*owns/i.test(
			message,
		)
	) {
		return new HttpError(
			409,
			"codex_thread_in_use",
			"This Codex thread is currently owned by another client",
		);
	}
	return new HttpError(502, "codex_protocol_error", message.slice(0, 400));
}

function eventThreadId(params: unknown): string | null {
	return asString(asRecord(params)?.threadId);
}

function eventTurnId(params: unknown): string | null {
	return asString(asRecord(params)?.turnId);
}

export class CodexAppServerService {
	readonly capability: CodexCapability;
	private readonly executable: string | null;
	private readonly processFactory: CodexProcessFactory;
	private process: CodexProcess | null = null;
	private startPromise: Promise<void> | null = null;
	private nextRequestId = 1;
	private readonly pending = new Map<RpcId, PendingRequest>();
	private readonly turns = new Map<string, TurnState>();
	private readonly activeTurns = new Map<string, TurnState>();
	private readonly loadedThreads = new Set<string>();
	private readonly approvals = new Map<string, ApprovalState>();
	private closed = false;

	constructor(
		options: {
			executable?: string | null;
			processFactory?: CodexProcessFactory;
		} = {},
	) {
		this.executable = options.executable === undefined ? Bun.which("codex") : options.executable;
		this.processFactory = options.processFactory ?? defaultProcessFactory;
		this.capability = this.executable
			? { available: true, reason: null }
			: {
					available: false,
					reason: "Codex CLI is not available on the Couchview server PATH.",
				};
	}

	private async readLines(
		stream: ReadableStream<Uint8Array> | null,
		stderr = false,
	): Promise<void> {
		if (!stream) return;
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			while (true) {
				const result = await reader.read();
				if (result.done) break;
				buffer += decoder.decode(result.value, { stream: true });
				let newline = buffer.indexOf("\n");
				while (newline >= 0) {
					const line = buffer.slice(0, newline).replace(/\r$/, "");
					buffer = buffer.slice(newline + 1);
					if (line.trim()) {
						if (stderr) {
							console.error(`[codex] ${line.slice(0, 2_000)}`);
						} else {
							this.handleLine(line);
						}
					}
					newline = buffer.indexOf("\n");
				}
			}
			const tail = buffer.trim();
			if (tail && !stderr) this.handleLine(tail);
		} catch (error) {
			if (!this.closed) this.fail(error);
		} finally {
			reader.releaseLock();
		}
	}

	private handleLine(line: string): void {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			this.fail(new Error("Codex app-server returned invalid JSON"));
			return;
		}
		const record = asRecord(value);
		if (!record) return;
		if (
			Object.hasOwn(record, "id") &&
			(Object.hasOwn(record, "result") || Object.hasOwn(record, "error"))
		) {
			const response = record as unknown as RpcResponse;
			const pending = this.pending.get(response.id);
			if (!pending) return;
			this.pending.delete(response.id);
			if (response.error) {
				const failure = requestError(response.error);
				if (failure.code === "codex_auth_required") {
					this.capability.available = false;
					this.capability.reason = failure.message;
				}
				pending.reject(failure);
			} else pending.resolve(response.result);
			return;
		}
		if (typeof record.method === "string" && Object.hasOwn(record, "id")) {
			void this.handleServerRequest(record as unknown as RpcServerRequest);
			return;
		}
		if (typeof record.method === "string")
			this.handleNotification(record as unknown as RpcNotification);
	}

	private async handleServerRequest(request: RpcServerRequest): Promise<void> {
		const params = asRecord(request.params) ?? {};
		const threadId = asString(params.threadId);
		const turnId = asString(params.turnId);
		if (threadId && request.method.includes("requestApproval")) {
			const approvalId = randomUUID();
			this.approvals.set(approvalId, {
				approvalId,
				rpcId: request.id,
				method: request.method,
				threadId,
				turnId,
				params,
			});
			this.emit(threadId, turnId, {
				type: "approval",
				threadId,
				turnId,
				approvalId,
				approvalMethod: request.method,
				data: params,
				sequence: 0,
			});
			return;
		}
		await this.write(
			JSON.stringify({
				id: request.id,
				error: { code: -32601, message: `Couchview does not support ${request.method}` },
			}) + "\n",
		);
	}

	private handleNotification(notification: RpcNotification): void {
		const params = asRecord(notification.params) ?? {};
		const threadId = eventThreadId(params);
		if (!threadId) return;
		const turnId = eventTurnId(params);
		const state = this.activeTurns.get(threadId) ?? (turnId ? this.turns.get(turnId) : undefined);
		if (!state) return;
		if (notification.method === "turn/completed") {
			state.completed = true;
			this.activeTurns.delete(threadId);
			for (const [approvalId, approval] of this.approvals) {
				if (approval.threadId === threadId && approval.turnId === state.turnId) {
					this.approvals.delete(approvalId);
				}
			}
		}
		const resolvedTurnId = (turnId ?? state.turnId) || null;
		this.emit(threadId, resolvedTurnId, {
			type:
				notification.method === "turn/completed"
					? "completed"
					: notification.method === "error"
						? "error"
						: "notification",
			threadId,
			turnId: resolvedTurnId,
			method: notification.method,
			data: notification.params,
			sequence: 0,
		});
	}

	private fail(error: unknown): void {
		const reason = error instanceof Error ? error : new Error("Codex app-server stopped");
		const structured =
			reason instanceof HttpError
				? reason
				: new HttpError(503, "codex_process_failed", `Codex app-server stopped: ${reason.message}`);
		for (const pending of this.pending.values()) pending.reject(structured);
		this.pending.clear();
		for (const state of this.activeTurns.values()) {
			this.emit(state.threadId, state.turnId || null, {
				type: "error",
				threadId: state.threadId,
				turnId: state.turnId || null,
				data: { message: reason.message },
				sequence: 0,
			});
		}
		this.activeTurns.clear();
		this.loadedThreads.clear();
		this.process = null;
		this.startPromise = null;
	}

	private async write(value: string): Promise<void> {
		if (!this.process)
			throw new HttpError(503, "codex_unavailable", "Codex app-server is not running");
		try {
			await this.process.write(value);
		} catch {
			throw new HttpError(503, "codex_unavailable", "Could not write to the Codex app-server");
		}
	}

	private async send<T>(method: string, params: unknown): Promise<T> {
		await this.ensureStarted();
		const id = this.nextRequestId++;
		const result = new Promise<unknown>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
		try {
			await this.write(JSON.stringify({ id, method, params }) + "\n");
		} catch (error) {
			this.pending.delete(id);
			throw error;
		}
		return (await result) as T;
	}

	private async notify(method: string, params: unknown): Promise<void> {
		await this.ensureStarted();
		await this.write(JSON.stringify({ method, params }) + "\n");
	}

	private async ensureStarted(): Promise<void> {
		if (!this.capability.available || !this.executable) {
			throw new HttpError(
				503,
				"codex_unavailable",
				this.capability.reason ?? "Codex is unavailable",
			);
		}
		if (this.closed) throw new HttpError(503, "codex_unavailable", "Couchview is shutting down");
		if (this.process) return;
		if (this.startPromise) return await this.startPromise;
		this.startPromise = (async () => {
			let process: CodexProcess;
			try {
				process = this.processFactory(this.executable as string);
			} catch {
				throw new HttpError(503, "codex_unavailable", "Codex app-server could not be started");
			}
			this.process = process;
			void process.exited
				.then((code) => {
					if (!this.closed) this.fail(new Error(`Codex app-server exited with code ${code}`));
				})
				.catch((error) => this.fail(error));
			void this.readLines(process.stdout);
			void this.readLines(process.stderr, true);
			const id = this.nextRequestId++;
			const initialized = new Promise<unknown>((resolve, reject) => {
				this.pending.set(id, { resolve, reject });
			});
			await this.write(
				JSON.stringify({
					id,
					method: "initialize",
					params: {
						clientInfo: {
							name: "couchview",
							title: "Couchview",
							version: "0.1.0",
						},
					},
				}) + "\n",
			);
			await initialized;
			await this.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
		})().catch((error) => {
			this.fail(error);
			throw error;
		});
		try {
			await this.startPromise;
		} finally {
			this.startPromise = null;
		}
	}

	private emit(threadId: string, turnId: string | null, event: CodexEvent): void {
		const state = this.activeTurns.get(threadId) ?? (turnId ? this.turns.get(turnId) : undefined);
		if (!state) return;
		const normalized = { ...event, sequence: ++state.sequence };
		state.events.push(normalized);
		if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
		for (const listener of state.listeners) listener(normalized);
	}

	capabilityFor(): CodexCapability {
		return this.capability;
	}

	async listThreads(
		root: string,
		cursor: string | null,
		limit = 40,
	): Promise<{
		threads: Array<CodexThreadSummary & { cwd: string | null }>;
		nextCursor: string | null;
	}> {
		const result = await this.send<{ data?: unknown[]; nextCursor?: unknown }>("thread/list", {
			cwd: root,
			archived: false,
			sourceKinds: ["cli", "vscode", "appServer"],
			sortKey: "recency_at",
			sortDirection: "desc",
			cursor,
			limit,
		});
		const threads = Array.isArray(result.data)
			? result.data.map(normalizeThread).filter((thread) => thread.cwd === root)
			: [];
		return {
			threads,
			nextCursor: typeof result.nextCursor === "string" ? result.nextCursor : null,
		};
	}

	async startThread(root: string): Promise<CodexThreadSummary & { cwd: string | null }> {
		const result = await this.send<{ thread?: unknown }>("thread/start", {
			cwd: root,
			// Keep Couchview-created sessions identifiable to other App Server
			// clients while remaining part of the normal persisted thread history.
			threadSource: "appServer",
		});
		const thread = normalizeThread(result.thread);
		this.loadedThreads.add(thread.id);
		return thread;
	}

	async readThread(threadId: string): Promise<CodexThreadSummary & { cwd: string | null }> {
		const result = await this.send<{ thread?: unknown }>("thread/read", { threadId });
		return normalizeThread(result.thread);
	}

	async resumeThread(threadId: string): Promise<CodexThreadSummary & { cwd: string | null }> {
		if (this.loadedThreads.has(threadId)) return await this.readThread(threadId);
		const result = await this.send<{ thread?: unknown }>("thread/resume", {
			threadId,
			excludeTurns: true,
		});
		const thread = normalizeThread(result.thread);
		this.loadedThreads.add(thread.id);
		return thread;
	}

	async startTurn(threadId: string, prompt: string): Promise<CodexTurnResponse> {
		const existing = this.activeTurns.get(threadId);
		if (existing && !existing.completed) {
			throw new HttpError(
				409,
				"codex_turn_active",
				"A Codex turn is already active for this thread",
			);
		}
		const provisional: TurnState = {
			threadId,
			turnId: "",
			events: [],
			listeners: new Set(),
			sequence: 0,
			completed: false,
		};
		this.activeTurns.set(threadId, provisional);
		try {
			const result = await this.send<{ turn?: TurnRecord }>("turn/start", {
				threadId,
				input: [{ type: "text", text: prompt }],
			});
			const turnId = asString(result.turn?.id);
			if (!turnId)
				throw new HttpError(502, "codex_protocol_error", "Codex did not return a turn ID");
			provisional.turnId = turnId;
			this.turns.set(turnId, provisional);
			if (this.turns.size > 100) {
				for (const [oldTurnId, oldState] of this.turns) {
					if (oldState.completed) this.turns.delete(oldTurnId);
					if (this.turns.size <= 100) break;
				}
			}
			return { threadId, turnId, status: "started" };
		} catch (error) {
			this.activeTurns.delete(threadId);
			throw error;
		}
	}

	async interruptTurn(threadId: string, turnId: string): Promise<void> {
		await this.send("turn/interrupt", { threadId, turnId });
	}

	events(
		threadId: string,
		turnId: string,
		after = 0,
		listener?: (event: CodexEvent) => void,
	): { events: CodexEvent[]; found: boolean; unsubscribe(): void } {
		const state = this.turns.get(turnId);
		if (!state || state.threadId !== threadId)
			return { events: [], found: false, unsubscribe() {} };
		const events = state.events.filter((event) => event.sequence > after);
		if (listener) state.listeners.add(listener);
		return {
			events,
			found: true,
			unsubscribe: () => {
				if (listener) state.listeners.delete(listener);
			},
		};
	}

	async respondApproval(
		threadId: string,
		approvalId: string,
		decision: CodexApprovalDecision | Record<string, unknown>,
	): Promise<void> {
		const approval = this.approvals.get(approvalId);
		if (!approval || approval.threadId !== threadId) {
			throw new HttpError(
				404,
				"codex_approval_not_found",
				"Codex approval request is no longer pending",
			);
		}
		this.approvals.delete(approvalId);
		const result =
			approval.method === "item/permissions/requestApproval"
				? this.permissionDecision(decision)
				: { decision };
		await this.write(
			JSON.stringify({
				id: approval.rpcId,
				result,
			}) + "\n",
		);
	}

	private permissionDecision(decision: CodexApprovalDecision | Record<string, unknown>): unknown {
		if (typeof decision === "string") {
			if (decision === "decline" || decision === "cancel") {
				return { permissions: {}, scope: "turn" };
			}
			return { permissions: {}, scope: decision === "acceptForSession" ? "session" : "turn" };
		}
		return decision;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const pending of this.pending.values()) {
			pending.reject(new Error("Codex app-server closed"));
		}
		this.pending.clear();
		this.process?.close();
		try {
			this.process?.kill("SIGTERM");
		} catch {
			// The process may already have exited.
		}
		this.process = null;
		this.startPromise = null;
	}
}

export function codexPrompt(comments: ReviewComment[]): string {
	return exportCommentsForCodex(comments);
}
