import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CodexCapability, CodexGenerationPreferences } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 16 * 1024;
const MAX_RETAINED_STDERR_BYTES = 64 * 1024;

interface ProcessHandle {
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exited: Promise<number>;
	kill(signal?: NodeJS.Signals): void;
}

interface SpawnOptions {
	cwd: string;
	env: Record<string, string | undefined>;
	stdin: string;
}

export type SpawnCodexProcess = (
	command: readonly string[],
	options: SpawnOptions,
) => ProcessHandle;

export interface CodexStructuredOutputRequest {
	action: string;
	context: string;
	outputDescription: string;
	preferences: CodexGenerationPreferences;
	prompt: string;
	schema: object;
	temporaryPrefix: string;
}

export interface CodexStructuredOutputServiceOptions {
	executable?: string | null;
	spawn?: SpawnCodexProcess;
	timeoutMs?: number;
}

interface CapturedStream {
	bytes: Uint8Array;
	exceeded: boolean;
}

interface CaptureStreamOptions {
	maximumBytes: number;
	overflow: "terminate" | "truncate-middle";
	onLimit?: () => void;
}

function appendBoundedTail(
	chunks: Uint8Array[],
	currentBytes: number,
	value: Uint8Array,
	maximumBytes: number,
): number {
	if (maximumBytes === 0 || value.byteLength === 0) return currentBytes;
	const relevant =
		value.byteLength > maximumBytes ? value.subarray(value.byteLength - maximumBytes) : value;
	const copied = Uint8Array.from(relevant);
	chunks.push(copied);
	currentBytes += copied.byteLength;
	while (currentBytes > maximumBytes) {
		const first = chunks[0];
		if (!first) break;
		const excess = currentBytes - maximumBytes;
		if (first.byteLength <= excess) {
			chunks.shift();
			currentBytes -= first.byteLength;
			continue;
		}
		chunks[0] = Uint8Array.from(first.subarray(excess));
		currentBytes -= excess;
	}
	return currentBytes;
}

function concatenateChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function defaultSpawn(command: readonly string[], options: SpawnOptions): ProcessHandle {
	const child = Bun.spawn([...command], {
		cwd: options.cwd,
		env: options.env,
		stdin: new Blob([options.stdin], { type: "text/plain;charset=utf-8" }),
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		stdout: child.stdout,
		stderr: child.stderr,
		exited: child.exited,
		kill(signal) {
			child.kill(signal);
		},
	};
}

async function captureStream(
	stream: ReadableStream<Uint8Array> | null,
	options: CaptureStreamOptions,
): Promise<CapturedStream> {
	if (!stream) return { bytes: new Uint8Array(), exceeded: false };
	const { maximumBytes, overflow, onLimit } = options;
	const prefixLimit = overflow === "truncate-middle" ? Math.floor(maximumBytes / 4) : maximumBytes;
	const tailLimit = overflow === "truncate-middle" ? maximumBytes - prefixLimit : 0;
	const reader = stream.getReader();
	const prefixChunks: Uint8Array[] = [];
	const tailChunks: Uint8Array[] = [];
	let prefixBytes = 0;
	let tailBytes = 0;
	let totalBytes = 0;
	let exceeded = false;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			totalBytes += result.value.byteLength;
			let offset = 0;
			const prefixRemaining = Math.max(0, prefixLimit - prefixBytes);
			if (prefixRemaining > 0) {
				const chunk = Uint8Array.from(result.value.subarray(0, prefixRemaining));
				prefixChunks.push(chunk);
				prefixBytes += chunk.byteLength;
				offset = chunk.byteLength;
			}
			if (tailLimit > 0 && offset < result.value.byteLength) {
				tailBytes = appendBoundedTail(
					tailChunks,
					tailBytes,
					result.value.subarray(offset),
					tailLimit,
				);
			}
			if (totalBytes > maximumBytes && !exceeded) {
				exceeded = true;
				if (overflow === "terminate") onLimit?.();
			}
		}
	} finally {
		reader.releaseLock();
	}
	if (!exceeded || overflow === "terminate") {
		return {
			bytes: concatenateChunks([...prefixChunks, ...tailChunks], prefixBytes + tailBytes),
			exceeded,
		};
	}
	const marker = new TextEncoder().encode("\n[... middle of Codex stderr omitted ...]\n");
	return {
		bytes: concatenateChunks(
			[...prefixChunks, marker, ...tailChunks],
			prefixBytes + marker.byteLength + tailBytes,
		),
		exceeded,
	};
}

function codexEnvironment(): Record<string, string | undefined> {
	const environment: Record<string, string | undefined> = { ...globalThis.process.env };
	for (const variable of [
		"EDITOR",
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_COMMON_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_NAMESPACE",
		"GIT_PREFIX",
		"GIT_CONFIG_PARAMETERS",
		"GIT_CONFIG_COUNT",
		"GIT_EDITOR",
		"GIT_EXTERNAL_DIFF",
		"GIT_SSH",
		"GIT_SSH_COMMAND",
		"PAGER",
		"SSH_ASKPASS",
	]) {
		delete environment[variable];
	}
	environment.NO_COLOR = "1";
	return environment;
}

function cleanProcessText(value: string): string {
	return value
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replaceAll("\0", "�")
		.trim();
}

function processFailure(stderr: string, model: string, action: string): HttpError {
	const detail = cleanProcessText(stderr);
	if (
		/not logged in|login required|run [`']?codex login|authentication|unauthorized|\b401\b/i.test(
			detail,
		)
	) {
		return new HttpError(
			503,
			"codex_login_required",
			"Codex is not logged in on this computer; run `codex login` and try again",
		);
	}
	if (
		/unknown model|model .*not found|model .*unavailable|model .*not supported|access to .*model/i.test(
			detail,
		)
	) {
		return new HttpError(
			503,
			"codex_model_unavailable",
			`Codex model ${model} is unavailable for this account`,
		);
	}
	const summary = detail
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1)
		?.slice(0, 240);
	return new HttpError(
		502,
		"codex_failed",
		summary ? `Codex could not ${action}: ${summary}` : `Codex could not ${action}`,
	);
}

export class CodexStructuredOutputService {
	readonly capability: CodexCapability;
	private readonly executable: string | null;
	private readonly spawnProcess: SpawnCodexProcess;
	private readonly timeoutMs: number;
	private active = false;
	private cancelActive: (() => void) | null = null;

	constructor(options: CodexStructuredOutputServiceOptions = {}) {
		this.executable = options.executable === undefined ? Bun.which("codex") : options.executable;
		this.spawnProcess = options.spawn ?? defaultSpawn;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.capability = this.executable
			? { available: true, reason: null }
			: {
					available: false,
					reason: "Codex CLI is not available on the Couchview server PATH.",
				};
	}

	async generate(request: CodexStructuredOutputRequest, signal?: AbortSignal): Promise<unknown> {
		if (!this.executable) {
			throw new HttpError(
				503,
				"codex_unavailable",
				"Codex CLI is not available; install it or add `codex` to PATH",
			);
		}
		if (this.active) {
			throw new HttpError(429, "codex_busy", "Another Codex generation is already running");
		}
		if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");

		this.active = true;
		let temporaryDirectory: string | null = null;
		let process: ProcessHandle | null = null;
		let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
		let terminalReason: "abort" | "limit" | "timeout" | null = null;
		const stop = (reason: NonNullable<typeof terminalReason>): void => {
			terminalReason ??= reason;
			try {
				process?.kill("SIGTERM");
			} catch {
				// The subprocess may already have exited.
			}
			if (process && !forceKillTimer) {
				forceKillTimer = setTimeout(() => {
					try {
						process?.kill("SIGKILL");
					} catch {
						// The subprocess may already have exited.
					}
				}, 1_000);
			}
		};
		this.cancelActive = () => stop("abort");
		const onAbort = () => stop("abort");
		signal?.addEventListener("abort", onAbort, { once: true });

		try {
			temporaryDirectory = await mkdtemp(
				path.join(tmpdir(), `couchview-${request.temporaryPrefix}-`),
			);
			const schemaPath = path.join(temporaryDirectory, "schema.json");
			await writeFile(schemaPath, JSON.stringify(request.schema), {
				encoding: "utf8",
				mode: 0o600,
			});
			if (signal?.aborted || terminalReason === "abort") {
				throw new DOMException("The request was aborted.", "AbortError");
			}
			const command = [
				this.executable,
				"exec",
				"--model",
				request.preferences.model,
				"-c",
				`model_reasoning_effort="${request.preferences.reasoning}"`,
				"--ephemeral",
				"--sandbox",
				"read-only",
				"--ignore-user-config",
				"--skip-git-repo-check",
				"--output-schema",
				schemaPath,
				"--color",
				"never",
				request.prompt,
			] as const;
			try {
				process = this.spawnProcess(command, {
					cwd: temporaryDirectory,
					env: codexEnvironment(),
					stdin: request.context,
				});
			} catch {
				throw new HttpError(
					503,
					"codex_unavailable",
					"Codex CLI could not be started from the Couchview server",
				);
			}

			const timeout = setTimeout(() => stop("timeout"), this.timeoutMs);
			const stdoutPromise = captureStream(process.stdout, {
				maximumBytes: MAX_STDOUT_BYTES,
				overflow: "terminate",
				onLimit: () => stop("limit"),
			});
			const stderrPromise = captureStream(process.stderr, {
				maximumBytes: MAX_RETAINED_STDERR_BYTES,
				overflow: "truncate-middle",
			});
			let exitCode: number;
			let stdout: CapturedStream;
			let stderr: CapturedStream;
			try {
				[exitCode, stdout, stderr] = await Promise.all([
					process.exited,
					stdoutPromise,
					stderrPromise,
				]);
			} finally {
				clearTimeout(timeout);
			}

			if (terminalReason === "abort") {
				throw new DOMException("The request was aborted.", "AbortError");
			}
			if (terminalReason === "timeout") {
				throw new HttpError(
					504,
					"codex_timeout",
					`Codex did not ${request.action} within ${Math.ceil(this.timeoutMs / 1_000)} seconds`,
				);
			}
			if (terminalReason === "limit" || stdout.exceeded) {
				throw new HttpError(
					502,
					"codex_output_limit",
					"Codex returned more output than Couchview can process safely",
				);
			}

			const decodedStderr = new TextDecoder().decode(stderr.bytes);
			if (exitCode !== 0) {
				throw processFailure(decodedStderr, request.preferences.model, request.action);
			}
			try {
				return JSON.parse(new TextDecoder().decode(stdout.bytes).trim());
			} catch {
				throw new HttpError(
					502,
					"codex_invalid_output",
					`Codex returned an invalid ${request.outputDescription}; try generating it again`,
				);
			}
		} finally {
			signal?.removeEventListener("abort", onAbort);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			this.cancelActive = null;
			this.active = false;
			if (temporaryDirectory) {
				await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
			}
		}
	}

	close(): void {
		this.cancelActive?.();
	}
}
