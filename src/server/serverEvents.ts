import type { ServerEvent, ServerEventType } from "../shared/contracts.ts";
import type { StateDatabase } from "./database.ts";
import type { RepositoryManager } from "./repositories.ts";
import type { GitRepository } from "./repository.ts";

const encoder = new TextEncoder();

interface StreamState {
	controller: ReadableStreamDefaultController<Uint8Array>;
	repositoryId: string;
	operationRevision: string;
	stateRevision: number;
	catalogRevision: number;
	ready: boolean;
}

export class ServerEventStreams {
	private readonly streams = new Set<StreamState>();
	private readonly subscriptions = new Map<string, () => void>();
	private readonly poller: ReturnType<typeof setInterval>;
	private readonly keepAlive: ReturnType<typeof setInterval>;
	private pollInFlight = false;

	constructor(
		private readonly database: StateDatabase,
		private readonly repositories: RepositoryManager,
		revisionPollIntervalMs: number,
	) {
		this.poller = setInterval(() => this.poll(), revisionPollIntervalMs);
		this.keepAlive = setInterval(() => this.sendKeepAlive(), 5_000);
	}

	private sendEvent(
		stream: StreamState,
		type: ServerEventType,
		values: Partial<
			Pick<ServerEvent, "operationRevision" | "stateRevision" | "catalogRevision">
		> = {},
	): void {
		const event: ServerEvent = {
			type,
			repositoryId: stream.repositoryId,
			operationRevision: values.operationRevision ?? stream.operationRevision,
			stateRevision: values.stateRevision ?? stream.stateRevision,
			catalogRevision: values.catalogRevision ?? stream.catalogRevision,
			at: new Date().toISOString(),
		};
		stream.operationRevision = event.operationRevision;
		stream.stateRevision = event.stateRevision;
		stream.catalogRevision = event.catalogRevision;
		try {
			stream.controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
		} catch {
			this.removeStream(stream);
		}
	}

	async emitRepository(
		repositoryId: string,
		type: ServerEventType,
		operationRevision?: string,
	): Promise<void> {
		const matching = [...this.streams].filter((stream) => stream.repositoryId === repositoryId);
		if (matching.length === 0) return;
		const resolvedOperation =
			operationRevision ??
			(await (await this.repositories.get(repositoryId)).changes()).operationRevision;
		const stateRevision = this.database.stateRevision(repositoryId) ?? 0;
		const catalogRevision = this.database.catalogRevision();
		for (const stream of matching) {
			if (
				(type === "changes" && stream.operationRevision === resolvedOperation) ||
				(type === "state" && stream.stateRevision === stateRevision)
			) {
				continue;
			}
			this.sendEvent(stream, type, {
				operationRevision: resolvedOperation,
				stateRevision,
				catalogRevision,
			});
		}
	}

	emitCatalog(): void {
		const catalogRevision = this.database.catalogRevision();
		for (const stream of this.streams) {
			this.sendEvent(stream, "repositories", { catalogRevision });
		}
	}

	private ensureSubscription(repositoryId: string): void {
		if (this.subscriptions.has(repositoryId)) return;
		this.subscriptions.set(
			repositoryId,
			this.repositories.subscribe(repositoryId, (operationRevision) => {
				void this.emitRepository(repositoryId, "changes", operationRevision).catch(() => undefined);
			}),
		);
	}

	private releaseSubscription(repositoryId: string): void {
		if ([...this.streams].some((stream) => stream.repositoryId === repositoryId)) return;
		this.subscriptions.get(repositoryId)?.();
		this.subscriptions.delete(repositoryId);
	}

	private removeStream(stream: StreamState): void {
		this.streams.delete(stream);
		this.releaseSubscription(stream.repositoryId);
	}

	private poll(): void {
		if (this.streams.size === 0 || this.pollInFlight) return;
		this.pollInFlight = true;
		const catalogRevision = this.database.catalogRevision();
		for (const stream of this.streams) {
			if (stream.ready && catalogRevision !== stream.catalogRevision) {
				this.sendEvent(stream, "repositories", { catalogRevision });
			}
		}
		const repositoryIds = [
			...new Set(
				[...this.streams].filter((stream) => stream.ready).map((stream) => stream.repositoryId),
			),
		];
		void Promise.all(
			repositoryIds.map(async (repositoryId) => {
				const repository = await this.repositories.get(repositoryId);
				const changes = await repository.changes();
				const stateRevision = this.database.stateRevision(repositoryId) ?? 0;
				for (const stream of this.streams) {
					if (!stream.ready || stream.repositoryId !== repositoryId) continue;
					if (changes.operationRevision !== stream.operationRevision) {
						this.sendEvent(stream, "changes", {
							operationRevision: changes.operationRevision,
						});
					}
					if (stateRevision !== stream.stateRevision) {
						this.sendEvent(stream, "state", { stateRevision });
					}
				}
			}),
		)
			.catch(() => undefined)
			.finally(() => {
				this.pollInFlight = false;
			});
	}

	private sendKeepAlive(): void {
		const bytes = encoder.encode(": keep-alive\n\n");
		for (const stream of this.streams) {
			try {
				stream.controller.enqueue(bytes);
			} catch {
				this.removeStream(stream);
			}
		}
	}

	open(request: Request, repositoryId: string, repository: GitRepository): Response {
		let streamState: StreamState | null = null;
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				streamState = {
					controller,
					repositoryId,
					operationRevision: "",
					stateRevision: this.database.stateRevision(repositoryId) ?? 0,
					catalogRevision: this.database.catalogRevision(),
					ready: false,
				};
				this.streams.add(streamState);
				this.ensureSubscription(repositoryId);
				void repository
					.changes()
					.then((state) => {
						if (!streamState || !this.streams.has(streamState)) return;
						streamState.ready = true;
						this.sendEvent(streamState, "ready", {
							operationRevision: state.operationRevision,
							stateRevision: this.database.stateRevision(repositoryId) ?? 0,
							catalogRevision: this.database.catalogRevision(),
						});
					})
					.catch((error) => {
						if (!streamState) return;
						this.removeStream(streamState);
						try {
							controller.error(error);
						} catch {
							// The request may already have been cancelled.
						}
					});
			},
			cancel: () => {
				if (streamState) this.removeStream(streamState);
			},
		});
		request.signal.addEventListener(
			"abort",
			() => {
				if (!streamState) return;
				this.removeStream(streamState);
				try {
					streamState.controller.close();
				} catch {
					// The stream may already have been cancelled.
				}
			},
			{ once: true },
		);
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	}

	close(): void {
		clearInterval(this.keepAlive);
		clearInterval(this.poller);
		for (const unsubscribe of this.subscriptions.values()) unsubscribe();
		this.subscriptions.clear();
		for (const stream of this.streams) {
			try {
				stream.controller.close();
			} catch {
				// Ignore already-closed streams during shutdown.
			}
		}
		this.streams.clear();
	}
}
