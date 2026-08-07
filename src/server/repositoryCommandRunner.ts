import { randomUUID } from "node:crypto";

import { ARTIFACT_MAX_LOG_BYTES } from "../shared/artifacts.ts";
import { HttpError } from "./errors.ts";

const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_COMPLETED_RUNS_PER_OWNER = 20;
const STOP_GRACE_MS = 3_000;

export type RepositoryCommandStatus =
	| "running"
	| "stopping"
	| "finalizing"
	| "succeeded"
	| "failed"
	| "stopped";

export interface RepositoryCommandSummary {
	id: string;
	owner: string;
	repositoryId: string;
	key: string;
	argv: string[];
	cwd: string;
	status: RepositoryCommandStatus;
	exitCode: number | null;
	startedAt: string;
	finishedAt: string | null;
	outputTruncated: boolean;
	error: string | null;
}

export interface RepositoryCommandOutputChunk {
	sequence: number;
	stream: "stdout" | "stderr";
	text: string;
}

export interface RepositoryCommandSnapshot {
	run: RepositoryCommandSummary;
	output: RepositoryCommandOutputChunk[];
}

export type RepositoryCommandEvent =
	| { type: "output"; chunk: RepositoryCommandOutputChunk }
	| { type: "status"; run: RepositoryCommandSummary };

interface RepositoryCommandProcess {
	pid: number;
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exited: Promise<number>;
	kill(signal?: NodeJS.Signals): void;
}

interface RepositoryCommandSpawnOptions {
	cwd: string;
	env: Record<string, string | undefined>;
}

export type SpawnRepositoryCommand = (
	argv: readonly string[],
	options: RepositoryCommandSpawnOptions,
) => RepositoryCommandProcess;

export interface RepositoryCommandRunnerOptions {
	maxConcurrentRuns?: number;
	maxOutputBytes?: number;
	completedRunsPerOwner?: number;
	spawn?: SpawnRepositoryCommand;
}

export interface StartRepositoryCommand {
	id?: string;
	owner: string;
	repositoryId: string;
	key: string;
	argv: readonly string[];
	cwd: string;
	env?: Record<string, string | undefined>;
	startError?: string;
	finalize?(signal: AbortSignal): Promise<void>;
}

interface StoredCommand {
	summary: RepositoryCommandSummary;
	output: RepositoryCommandOutputChunk[];
	outputBytes: number;
	nextSequence: number;
	process: RepositoryCommandProcess | null;
	stopRequested: boolean;
	stopTimer: ReturnType<typeof setTimeout> | null;
	abortController: AbortController;
	finalize?: (signal: AbortSignal) => Promise<void>;
}

type CommandListener = (event: RepositoryCommandEvent) => void;

const ACTIVE_STATUSES = new Set<RepositoryCommandStatus>(["running", "stopping", "finalizing"]);

function defaultSpawn(
	argv: readonly string[],
	options: RepositoryCommandSpawnOptions,
): RepositoryCommandProcess {
	const child = Bun.spawn([...argv], {
		cwd: options.cwd,
		detached: true,
		env: options.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		pid: child.pid,
		stdout: child.stdout,
		stderr: child.stderr,
		exited: child.exited,
		kill(signal) {
			child.kill(signal);
		},
	};
}

function cloneSummary(summary: RepositoryCommandSummary): RepositoryCommandSummary {
	return structuredClone(summary);
}

export class RepositoryCommandRunner {
	private readonly maxConcurrentRuns: number;
	private readonly maxOutputBytes: number;
	private readonly completedRunsPerOwner: number;
	private readonly spawnProcess: SpawnRepositoryCommand;
	private readonly commands = new Map<string, StoredCommand>();
	private readonly listeners = new Map<string, Set<CommandListener>>();

	constructor(options: RepositoryCommandRunnerOptions = {}) {
		this.maxConcurrentRuns = options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
		this.maxOutputBytes = options.maxOutputBytes ?? ARTIFACT_MAX_LOG_BYTES;
		this.completedRunsPerOwner = options.completedRunsPerOwner ?? DEFAULT_COMPLETED_RUNS_PER_OWNER;
		this.spawnProcess = options.spawn ?? defaultSpawn;
	}

	runs(owner: string, repositoryId: string): RepositoryCommandSummary[] {
		return [...this.commands.values()]
			.map((command) => command.summary)
			.filter((run) => run.owner === owner && run.repositoryId === repositoryId)
			.sort((left, right) => {
				const active =
					Number(ACTIVE_STATUSES.has(right.status)) - Number(ACTIVE_STATUSES.has(left.status));
				return active || right.startedAt.localeCompare(left.startedAt);
			})
			.map(cloneSummary);
	}

	start(input: StartRepositoryCommand): RepositoryCommandSummary {
		if (!input.argv.length || !input.argv[0]) {
			throw new HttpError(400, "command_invalid", "The command executable is required");
		}
		const active = [...this.commands.values()].filter((command) =>
			ACTIVE_STATUSES.has(command.summary.status),
		);
		if (active.length >= this.maxConcurrentRuns) {
			throw new HttpError(
				429,
				"command_run_limit",
				`At most ${this.maxConcurrentRuns} repository commands can run at once`,
			);
		}
		if (
			active.some(
				(command) =>
					command.summary.owner === input.owner &&
					command.summary.repositoryId === input.repositoryId &&
					command.summary.key === input.key,
			)
		) {
			throw new HttpError(409, "command_already_running", "This command is already running");
		}

		const id = input.id ?? randomUUID();
		const command: StoredCommand = {
			summary: {
				id,
				owner: input.owner,
				repositoryId: input.repositoryId,
				key: input.key,
				argv: [...input.argv],
				cwd: input.cwd,
				status: "running",
				exitCode: null,
				startedAt: new Date().toISOString(),
				finishedAt: null,
				outputTruncated: false,
				error: null,
			},
			output: [],
			outputBytes: 0,
			nextSequence: 1,
			process: null,
			stopRequested: false,
			stopTimer: null,
			abortController: new AbortController(),
			finalize: input.finalize,
		};
		this.commands.set(id, command);
		if (input.startError) {
			this.appendOutput(command, "stderr", `${input.startError}\n`);
			this.finish(command, "failed", null, input.startError);
			return cloneSummary(command.summary);
		}
		try {
			command.process = this.spawnProcess(input.argv, {
				cwd: input.cwd,
				env: { ...process.env, ...input.env },
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.appendOutput(command, "stderr", `Could not start command: ${message}\n`);
			this.finish(command, "failed", null, message);
			return cloneSummary(command.summary);
		}
		void this.monitor(command);
		return cloneSummary(command.summary);
	}

	stop(owner: string, repositoryId: string, runId: string): RepositoryCommandSummary {
		const command = this.require(owner, repositoryId, runId);
		if (!ACTIVE_STATUSES.has(command.summary.status)) return cloneSummary(command.summary);
		if (command.summary.status !== "stopping") {
			command.stopRequested = true;
			command.abortController.abort();
			command.summary.status = "stopping";
			this.emit(command, { type: "status", run: cloneSummary(command.summary) });
			this.kill(command, "SIGTERM");
			command.stopTimer = setTimeout(() => {
				if (ACTIVE_STATUSES.has(command.summary.status)) this.kill(command, "SIGKILL");
			}, STOP_GRACE_MS);
			(command.stopTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
		}
		return cloneSummary(command.summary);
	}

	subscribe(
		owner: string,
		repositoryId: string,
		runId: string,
		listener: CommandListener,
	): { snapshot: RepositoryCommandSnapshot; unsubscribe(): void } {
		const command = this.require(owner, repositoryId, runId);
		const listeners = this.listeners.get(runId) ?? new Set<CommandListener>();
		listeners.add(listener);
		this.listeners.set(runId, listeners);
		return {
			snapshot: {
				run: cloneSummary(command.summary),
				output: structuredClone(command.output),
			},
			unsubscribe: () => {
				listeners.delete(listener);
				if (!listeners.size) this.listeners.delete(runId);
			},
		};
	}

	stopOwnerRepository(owner: string, repositoryId: string): void {
		for (const command of this.commands.values()) {
			if (
				command.summary.owner === owner &&
				command.summary.repositoryId === repositoryId &&
				ACTIVE_STATUSES.has(command.summary.status)
			) {
				this.stop(owner, repositoryId, command.summary.id);
			}
		}
	}

	close(): void {
		for (const command of this.commands.values()) {
			if (ACTIVE_STATUSES.has(command.summary.status)) {
				this.stop(command.summary.owner, command.summary.repositoryId, command.summary.id);
			}
		}
		this.listeners.clear();
	}

	private require(owner: string, repositoryId: string, runId: string): StoredCommand {
		const command = this.commands.get(runId);
		if (
			!command ||
			command.summary.owner !== owner ||
			command.summary.repositoryId !== repositoryId
		) {
			throw new HttpError(404, "command_run_not_found", "Command run not found");
		}
		return command;
	}

	private async monitor(command: StoredCommand): Promise<void> {
		const process = command.process;
		if (!process) return;
		const stdout = this.captureStream(command, "stdout", process.stdout);
		const stderr = this.captureStream(command, "stderr", process.stderr);
		let exitCode: number | null = null;
		try {
			exitCode = await process.exited;
		} catch (error) {
			this.appendOutput(
				command,
				"stderr",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
		await Promise.allSettled([stdout, stderr]);
		command.process = null;
		if (command.stopRequested) {
			this.finish(command, "stopped", exitCode, null);
			return;
		}
		if (exitCode !== 0) {
			this.finish(command, "failed", exitCode, null);
			return;
		}
		if (!command.finalize) {
			this.finish(command, "succeeded", exitCode, null);
			return;
		}
		command.summary.status = "finalizing";
		this.emit(command, { type: "status", run: cloneSummary(command.summary) });
		try {
			await command.finalize(command.abortController.signal);
			this.finish(command, command.stopRequested ? "stopped" : "succeeded", exitCode, null);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.appendOutput(command, "stderr", `${message}\n`);
			this.finish(command, command.stopRequested ? "stopped" : "failed", exitCode, message);
		}
	}

	private async captureStream(
		command: StoredCommand,
		stream: RepositoryCommandOutputChunk["stream"],
		readable: ReadableStream<Uint8Array> | null,
	): Promise<void> {
		if (!readable) return;
		const reader = readable.getReader();
		const decoder = new TextDecoder("utf-8", { fatal: false });
		try {
			while (true) {
				const result = await reader.read();
				if (result.done) break;
				const text = decoder.decode(result.value, { stream: true });
				if (text) this.appendOutput(command, stream, text);
			}
			const tail = decoder.decode();
			if (tail) this.appendOutput(command, stream, tail);
		} catch (error) {
			if (!command.stopRequested) {
				this.appendOutput(
					command,
					"stderr",
					`Could not read ${stream}: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		} finally {
			reader.releaseLock();
		}
	}

	private appendOutput(
		command: StoredCommand,
		stream: RepositoryCommandOutputChunk["stream"],
		text: string,
	): void {
		let sanitized = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replaceAll("\0", "�");
		if (!sanitized) return;
		const encoded = Buffer.from(sanitized);
		if (encoded.byteLength > this.maxOutputBytes) {
			sanitized = encoded.subarray(encoded.byteLength - this.maxOutputBytes).toString("utf8");
			while (Buffer.byteLength(sanitized) > this.maxOutputBytes) {
				sanitized = sanitized.slice(1);
			}
			command.summary.outputTruncated = true;
		}
		const chunk: RepositoryCommandOutputChunk = {
			sequence: command.nextSequence++,
			stream,
			text: sanitized,
		};
		command.output.push(chunk);
		command.outputBytes += Buffer.byteLength(sanitized);
		while (command.outputBytes > this.maxOutputBytes && command.output.length > 1) {
			const removed = command.output.shift();
			if (removed) command.outputBytes -= Buffer.byteLength(removed.text);
			command.summary.outputTruncated = true;
		}
		this.emit(command, { type: "output", chunk: structuredClone(chunk) });
	}

	private finish(
		command: StoredCommand,
		status: Extract<RepositoryCommandStatus, "succeeded" | "failed" | "stopped">,
		exitCode: number | null,
		error: string | null,
	): void {
		if (!ACTIVE_STATUSES.has(command.summary.status)) return;
		if (command.stopTimer) clearTimeout(command.stopTimer);
		command.stopTimer = null;
		command.summary.status = status;
		command.summary.exitCode = exitCode;
		command.summary.error = error;
		command.summary.finishedAt = new Date().toISOString();
		command.process = null;
		this.emit(command, { type: "status", run: cloneSummary(command.summary) });
		this.prune(command.summary.owner, command.summary.repositoryId);
	}

	private kill(command: StoredCommand, signal: NodeJS.Signals): void {
		const child = command.process;
		if (!child) return;
		if (process.platform !== "win32" && child.pid > 0) {
			try {
				process.kill(-child.pid, signal);
				return;
			} catch {
				// Fall back to direct child signaling when process groups are unavailable.
			}
		}
		try {
			child.kill(signal);
		} catch {
			// The process may have exited between the state check and signal delivery.
		}
	}

	private emit(command: StoredCommand, event: RepositoryCommandEvent): void {
		for (const listener of this.listeners.get(command.summary.id) ?? []) {
			try {
				listener(event);
			} catch {
				// A disconnected response removes its listener independently.
			}
		}
	}

	private prune(owner: string, repositoryId: string): void {
		const completed = [...this.commands.values()]
			.filter(
				(command) =>
					command.summary.owner === owner &&
					command.summary.repositoryId === repositoryId &&
					!ACTIVE_STATUSES.has(command.summary.status),
			)
			.sort((left, right) => right.summary.startedAt.localeCompare(left.summary.startedAt));
		for (const command of completed.slice(this.completedRunsPerOwner)) {
			this.commands.delete(command.summary.id);
			this.listeners.delete(command.summary.id);
		}
	}
}
