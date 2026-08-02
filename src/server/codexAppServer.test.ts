import { afterEach, describe, expect, test } from "bun:test";

import type { CodexEvent } from "../shared/contracts.ts";
import { CodexAppServerService } from "./codexAppServer.ts";

interface JsonRpcMessage {
	id?: number | string;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
}

class FakeCodexProcess {
	readonly writes: JsonRpcMessage[] = [];
	readonly stdout: ReadableStream<Uint8Array>;
	readonly stderr: ReadableStream<Uint8Array>;
	readonly exited: Promise<number>;
	private readonly output: ReadableStreamDefaultController<Uint8Array>;
	private resolveExit!: (code: number) => void;
	private readonly threads = new Map<string, Record<string, unknown>>();
	private turnNumber = 0;
	private closed = false;

	constructor() {
		let output: ReadableStreamDefaultController<Uint8Array> | undefined;
		this.stdout = new ReadableStream({
			start(controller) {
				output = controller;
			},
		});
		this.output = output!;
		this.stderr = new ReadableStream({ start() {} });
		this.exited = new Promise((resolve) => {
			this.resolveExit = resolve;
		});
	}

	async write(data: string): Promise<void> {
		for (const line of data.split("\n").filter(Boolean)) {
			const message = JSON.parse(line) as JsonRpcMessage;
			this.writes.push(message);
			if (!message.method || message.id === undefined) continue;
			const params = message.params ?? {};
			if (message.method === "initialize") {
				this.respond(message.id, { serverInfo: { name: "fake-codex" } });
			} else if (message.method === "thread/list") {
				const root = params.cwd;
				this.respond(message.id, {
					data: [
						this.thread("same", root, "same project", "idle"),
						this.thread("other", "/other/project", "other project", "idle"),
					],
					nextCursor: "next-page",
				});
			} else if (message.method === "thread/start") {
				const thread = this.thread(
					`new-${this.threads.size + 1}`,
					params.cwd,
					"new thread",
					"idle",
				);
				this.threads.set(String(thread.id), thread);
				this.respond(message.id, { thread });
			} else if (message.method === "thread/read" || message.method === "thread/resume") {
				const threadId = String(params.threadId);
				this.respond(message.id, {
					thread: this.threads.get(threadId) ?? this.thread(threadId, "/project", threadId, "idle"),
				});
			} else if (message.method === "turn/start") {
				this.turnNumber += 1;
				this.respond(message.id, { turn: { id: `turn-${this.turnNumber}` } });
			} else if (message.method === "turn/interrupt") {
				this.respond(message.id, {});
			}
		}
	}

	close(): void {
		this.exit(0);
	}

	kill(): void {
		this.exit(0);
	}

	notify(method: string, params: Record<string, unknown>): void {
		this.output.enqueue(new TextEncoder().encode(`${JSON.stringify({ method, params })}\n`));
	}

	request(id: number, method: string, params: Record<string, unknown>): void {
		this.output.enqueue(new TextEncoder().encode(`${JSON.stringify({ id, method, params })}\n`));
	}

	exit(code: number): void {
		if (this.closed) return;
		this.closed = true;
		this.output.close();
		this.resolveExit(code);
	}

	private thread(
		id: string,
		cwd: unknown,
		preview: string,
		status: string,
	): Record<string, unknown> {
		return {
			id,
			cwd: typeof cwd === "string" ? cwd : null,
			preview,
			createdAt: 1_700_000_000,
			updatedAt: 1_700_000_100,
			recencyAt: 1_700_000_100,
			modelProvider: "fake",
			status: { type: status },
		};
	}

	private respond(id: number | string, result: unknown): void {
		this.output.enqueue(new TextEncoder().encode(`${JSON.stringify({ id, result })}\n`));
	}
}

const processes: FakeCodexProcess[] = [];

afterEach(() => {
	for (const process of processes.splice(0)) process.close();
});

function makeService(): { service: CodexAppServerService; process: FakeCodexProcess } {
	const process = new FakeCodexProcess();
	processes.push(process);
	const service = new CodexAppServerService({
		executable: "/fake/codex",
		processFactory: () => process,
	});
	return { service, process };
}

describe("Codex app-server bridge", () => {
	test("reports a structured unavailable capability when the CLI is missing", async () => {
		const service = new CodexAppServerService({ executable: null });
		expect(service.capability).toEqual({
			available: false,
			reason: "Codex CLI is not available on the Couchview server PATH.",
		});
		await expect(service.listThreads("/project", null)).rejects.toMatchObject({
			status: 503,
			code: "codex_unavailable",
		});
		service.close();
	});

	test("initializes once, correlates requests, and filters threads by exact cwd", async () => {
		const { service, process } = makeService();
		const result = await service.listThreads("/project", null, 20);
		expect(result.threads.map((thread) => thread.id)).toEqual(["same"]);
		expect(result.nextCursor).toBe("next-page");
		expect(process.writes.map((message) => message.method)).toEqual([
			"initialize",
			"initialized",
			"thread/list",
		]);
		expect(process.writes[2]?.params).toMatchObject({
			cwd: "/project",
			archived: false,
			sourceKinds: ["cli", "vscode", "appServer"],
		});
		service.close();
	});

	test("creates, resumes, starts turns, streams events, and interrupts", async () => {
		const { service, process } = makeService();
		const created = await service.startThread("/project");
		expect(created.cwd).toBe("/project");
		expect(process.writes.find((message) => message.method === "thread/start")?.params).toEqual({
			cwd: "/project",
			threadSource: "appServer",
		});
		const resumed = await service.resumeThread(created.id);
		expect(resumed.id).toBe(created.id);
		const turn = await service.startTurn(created.id, "Please fix the review comments");
		const observed: CodexEvent[] = [];
		const subscription = service.events(created.id, turn.turnId, 0, (event) =>
			observed.push(event),
		);
		process.notify("item/agentMessage/delta", {
			threadId: created.id,
			turnId: turn.turnId,
			delta: "Working…",
		});
		process.notify("turn/completed", { threadId: created.id, turnId: turn.turnId });
		await Bun.sleep(10);
		expect(subscription.events).toHaveLength(0);
		expect(observed.map((event) => event.type)).toEqual(["notification", "completed"]);
		expect(observed[0]?.sequence).toBe(1);
		expect(observed[1]?.sequence).toBe(2);
		await service.interruptTurn(created.id, turn.turnId);
		expect(process.writes.some((message) => message.method === "turn/interrupt")).toBe(true);
		subscription.unsubscribe();
		service.close();
	});

	test("routes approval requests and preserves bounded replay history", async () => {
		const { service, process } = makeService();
		const turn = await service.startTurn("same", "prompt");
		const approvalPromise = new Promise<CodexEvent>((resolve) => {
			service.events("same", turn.turnId, 0, (event) => {
				if (event.type === "approval") resolve(event);
			});
		});
		process.request(77, "item/commandExecution/requestApproval", {
			threadId: "same",
			turnId: turn.turnId,
			command: "git status",
		});
		const approval = await approvalPromise;
		expect(approval.approvalId).toBeString();
		await service.respondApproval("same", approval.approvalId!, "acceptForSession");
		const response = process.writes.at(-1);
		expect(response?.id).toBe(77);
		expect(response?.result).toEqual({ decision: "acceptForSession" });
		service.close();
	});
});
