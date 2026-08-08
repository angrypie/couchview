import { randomUUID } from "node:crypto";

import { SPEECH_MODEL, type SpeechTranscriber, type SpeechTranscriberResult } from "./types.ts";

interface SidecarReadyMessage {
	type: "ready";
	model: string;
}

interface SidecarResponseMessage {
	type: "result";
	id: string;
	ok: boolean;
	text?: string;
	language?: string | null;
	inferenceMs?: number;
	message?: string;
}

type SidecarMessage = SidecarReadyMessage | SidecarResponseMessage;

interface PendingRequest {
	resolve(value: SpeechTranscriberResult): void;
	reject(reason: unknown): void;
	cleanup(): void;
}

interface ReadyWaiter {
	resolve(): void;
	reject(reason: unknown): void;
}

export interface SpeechProcessTranscriberOptions {
	command: readonly string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	startupTimeoutMs?: number;
}

export class SpeechProcessTranscriber implements SpeechTranscriber {
	readonly model = SPEECH_MODEL;
	private readonly command: readonly string[];
	private readonly cwd?: string;
	private readonly env?: NodeJS.ProcessEnv;
	private readonly startupTimeoutMs: number;
	private process: ReturnType<typeof Bun.spawn> | null = null;
	private startPromise: Promise<void> | null = null;
	private readyWaiter: ReadyWaiter | null = null;
	private readonly pending = new Map<string, PendingRequest>();
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;
	private readyState = false;

	private constructor(options: SpeechProcessTranscriberOptions) {
		this.command = options.command;
		this.cwd = options.cwd;
		this.env = options.env;
		this.startupTimeoutMs = options.startupTimeoutMs ?? 15 * 60_000;
	}

	static async create(options: SpeechProcessTranscriberOptions): Promise<SpeechProcessTranscriber> {
		const transcriber = new SpeechProcessTranscriber(options);
		try {
			await transcriber.ensureStarted();
			return transcriber;
		} catch (error) {
			transcriber.close();
			throw error;
		}
	}

	get ready(): boolean {
		return this.readyState && !this.closed;
	}

	async transcribe(audioPath: string, signal?: AbortSignal): Promise<SpeechTranscriberResult> {
		if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
		await this.ensureStarted();
		const processHandle = this.process;
		const stdin = processHandle?.stdin;
		if (!stdin || typeof stdin === "number" || !this.ready) {
			throw new Error("Speech sidecar is unavailable");
		}
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const abort = () => {
				const request = this.pending.get(id);
				if (!request) return;
				this.pending.delete(id);
				request.cleanup();
				reject(new DOMException("The request was aborted.", "AbortError"));
				this.restartProcess();
			};
			const cleanup = () => signal?.removeEventListener("abort", abort);
			this.pending.set(id, { resolve, reject, cleanup });
			signal?.addEventListener("abort", abort, { once: true });
			try {
				stdin.write(`${JSON.stringify({ type: "transcribe", id, audioPath })}\n`);
				stdin.flush();
			} catch (error) {
				this.pending.delete(id);
				cleanup();
				reject(error);
				this.restartProcess();
			}
		});
	}

	private async ensureStarted(): Promise<void> {
		if (this.closed) throw new Error("Speech sidecar is closed");
		if (this.ready && this.process) return;
		if (!this.startPromise) {
			this.startPromise = this.start().finally(() => {
				this.startPromise = null;
			});
		}
		await this.startPromise;
	}

	private async start(): Promise<void> {
		if (this.command.length === 0) throw new Error("Speech sidecar command is empty");
		const child = Bun.spawn([...this.command], {
			cwd: this.cwd,
			env: this.env ?? process.env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "inherit",
		});
		this.process = child;
		this.readyState = false;
		const ready = new Promise<void>((resolve, reject) => {
			this.readyWaiter = { resolve, reject };
		});
		void this.consumeOutput(child);
		void child.exited.then((exitCode) => this.handleExit(child, exitCode));
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				ready,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("Speech sidecar model startup timed out")),
						this.startupTimeoutMs,
					);
				}),
			]);
		} catch (error) {
			if (this.process === child) child.kill("SIGTERM");
			throw error;
		} finally {
			if (timeout) clearTimeout(timeout);
			if (this.readyWaiter) this.readyWaiter = null;
		}
	}

	private async consumeOutput(child: ReturnType<typeof Bun.spawn>): Promise<void> {
		if (!child.stdout || typeof child.stdout === "number") return;
		const reader = child.stdout.getReader();
		const decoder = new TextDecoder();
		let buffered = "";
		try {
			while (true) {
				const result = await reader.read();
				if (result.done) break;
				buffered += decoder.decode(result.value, { stream: true });
				let newline = buffered.indexOf("\n");
				while (newline >= 0) {
					const line = buffered.slice(0, newline).trim();
					buffered = buffered.slice(newline + 1);
					if (line) this.handleLine(child, line);
					newline = buffered.indexOf("\n");
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	private handleLine(child: ReturnType<typeof Bun.spawn>, line: string): void {
		if (this.process !== child) return;
		let message: SidecarMessage;
		try {
			message = JSON.parse(line) as SidecarMessage;
		} catch {
			console.warn("Speech sidecar emitted a malformed protocol line.");
			return;
		}
		if (message.type === "ready") {
			this.readyState = true;
			this.readyWaiter?.resolve();
			return;
		}
		if (message.type !== "result" || typeof message.id !== "string") return;
		const request = this.pending.get(message.id);
		if (!request) return;
		this.pending.delete(message.id);
		request.cleanup();
		if (!message.ok) {
			request.reject(new Error(message.message ?? "Speech sidecar transcription failed"));
			return;
		}
		if (typeof message.text !== "string" || typeof message.inferenceMs !== "number") {
			request.reject(new Error("Speech sidecar returned an invalid result"));
			return;
		}
		request.resolve({
			text: message.text,
			language: typeof message.language === "string" ? message.language : null,
			inferenceMs: message.inferenceMs,
		});
	}

	private handleExit(child: ReturnType<typeof Bun.spawn>, exitCode: number): void {
		if (this.process !== child) return;
		this.process = null;
		this.readyState = false;
		const error = new Error(`Speech sidecar exited with code ${exitCode}`);
		this.readyWaiter?.reject(error);
		this.readyWaiter = null;
		for (const [id, request] of this.pending) {
			this.pending.delete(id);
			request.cleanup();
			request.reject(error);
		}
		if (!this.closed) {
			this.restartTimer = setTimeout(() => {
				this.restartTimer = null;
				void this.ensureStarted().catch((restartError) => {
					console.error(`Speech sidecar restart failed: ${(restartError as Error).message}`);
				});
			}, 1_000);
		}
	}

	private restartProcess(): void {
		this.readyState = false;
		this.process?.kill("SIGTERM");
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.readyState = false;
		if (this.restartTimer) clearTimeout(this.restartTimer);
		this.restartTimer = null;
		this.readyWaiter?.reject(new Error("Speech sidecar closed"));
		this.readyWaiter = null;
		for (const [id, request] of this.pending) {
			this.pending.delete(id);
			request.cleanup();
			request.reject(new Error("Speech sidecar closed"));
		}
		if (this.process?.stdin && typeof this.process.stdin !== "number") this.process.stdin.end();
		this.process?.kill("SIGTERM");
		this.process = null;
	}
}
