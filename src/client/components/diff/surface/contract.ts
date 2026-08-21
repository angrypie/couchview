import type {
	DiffTokenChanges,
	DiffTokenLayer,
	DiffTokenSnapshot,
} from "../paint/DiffTokenLayer.ts";
import type { DiffScene } from "../scene/types.ts";

export interface DiffRenderCursor {
	generation: string;
	sceneRevision: number;
	tokenRevision: number;
}

export interface DiffRenderSnapshot {
	cursor: DiffRenderCursor;
	interactive: boolean;
	scene: DiffScene | null;
	tokens: DiffTokenSnapshot;
}

export interface DiffRenderChanges {
	changedTokenRows: DiffTokenChanges["changedRows"];
	cursor: DiffRenderCursor;
	generation: string;
	sceneReplaced: boolean;
	tokensComplete: boolean;
}

export interface DiffRenderSession {
	changesSince(cursor: DiffRenderCursor): DiffRenderChanges | "reset";
	read(): DiffRenderSnapshot;
	subscribe(listener: () => void): () => void;
}

export interface DiffSurfaceProps {
	events: DiffSurfaceEventSink;
	session: DiffRenderSession;
}

export interface DiffSurfaceHandle {
	scrollTo(command: DiffSurfaceScrollCommand): void;
}

export interface DiffSurfaceScrollCommand {
	behavior: "instant" | "smooth";
	generation: string;
	x?: number;
	y: number;
}

export type DiffSurfaceFailurePhase = "draw" | "prepare" | "scroll";

export interface DiffSurfaceEventSink {
	activateAt(generation: string, x: number, y: number): void;
	failure(generation: string, phase: DiffSurfaceFailurePhase, recoverable: boolean): void;
	ready(generation: string): void;
	scrollSettled(y: number): void;
	viewportChanged(width: number, height: number, scale: number): void;
}

export interface DiffRenderSessionUpdate {
	interactive: boolean;
	scene: DiffScene | null;
	tokens: DiffTokenLayer;
}
