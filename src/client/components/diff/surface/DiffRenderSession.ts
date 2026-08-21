import type { DiffTokenLayer } from "../paint/DiffTokenLayer.ts";
import type {
	DiffRenderChanges,
	DiffRenderCursor,
	DiffRenderSession,
	DiffRenderSessionUpdate,
	DiffRenderSnapshot,
} from "./contract.ts";

export class DiffRenderSessionStore implements DiffRenderSession {
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private readonly listeners = new Set<() => void>();
	private sceneRevision = 0;
	private snapshot: DiffRenderSnapshot;
	private tokenLayer: DiffTokenLayer;
	private unsubscribeTokens: (() => void) | null = null;

	constructor(initial: DiffRenderSessionUpdate) {
		this.tokenLayer = initial.tokens;
		this.snapshot = this.createSnapshot(initial);
		this.unsubscribeTokens = this.tokenLayer.subscribe(this.handleTokenChange);
	}

	changesSince(cursor: DiffRenderCursor): DiffRenderChanges | "reset" {
		const current = this.snapshot.cursor;
		if (cursor.generation !== current.generation || cursor.sceneRevision > current.sceneRevision) {
			return "reset";
		}
		const tokenChanges = this.tokenLayer.changesSince(cursor.tokenRevision);
		if (tokenChanges === "reset") return "reset";
		return {
			changedTokenRows: tokenChanges.changedRows,
			cursor: current,
			generation: current.generation,
			sceneReplaced: cursor.sceneRevision !== current.sceneRevision,
			tokensComplete: tokenChanges.complete,
		};
	}

	read = (): DiffRenderSnapshot => this.snapshot;

	update(next: DiffRenderSessionUpdate): void {
		const sceneChanged = this.snapshot.scene !== next.scene;
		const layerChanged = this.tokenLayer !== next.tokens;
		const interactionChanged = this.snapshot.interactive !== next.interactive;
		if (!sceneChanged && !layerChanged && !interactionChanged) return;
		if (sceneChanged || layerChanged) this.sceneRevision += 1;
		if (layerChanged) {
			this.unsubscribeTokens?.();
			this.tokenLayer = next.tokens;
			this.unsubscribeTokens = this.tokenLayer.subscribe(this.handleTokenChange);
		}
		this.snapshot = this.createSnapshot(next);
		this.notify();
	}

	private createSnapshot(update: DiffRenderSessionUpdate): DiffRenderSnapshot {
		const tokenSnapshot = update.tokens.read();
		return {
			cursor: {
				generation: update.scene?.generation ?? "pending",
				sceneRevision: this.sceneRevision,
				tokenRevision: tokenSnapshot.revision,
			},
			interactive: update.interactive,
			scene: update.scene,
			tokens: tokenSnapshot,
		};
	}

	private readonly handleTokenChange = () => {
		const tokens = this.tokenLayer.read();
		this.snapshot = {
			...this.snapshot,
			cursor: { ...this.snapshot.cursor, tokenRevision: tokens.revision },
			tokens,
		};
		this.notify();
	};

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
