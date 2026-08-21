import type { DiffRow, TokenRun } from "../engine/types.ts";
import type { DiffTokenReader } from "../scene/types.ts";

export interface DiffTokenSnapshot extends DiffTokenReader {
	complete: boolean;
	revision: number;
}

export interface DiffTokenChanges {
	changedRows: readonly { end: number; start: number }[];
	complete: boolean;
	fromRevision: number;
	toRevision: number;
}

interface DiffTokenHistoryEntry {
	changedRows: readonly { end: number; start: number }[];
	revision: number;
}

const MAX_DELTA_HISTORY = 32;

function rangesFor(indices: readonly number[]): { end: number; start: number }[] {
	const sorted = [...new Set(indices)].sort((left, right) => left - right);
	const ranges: { end: number; start: number }[] = [];
	for (const index of sorted) {
		const last = ranges.at(-1);
		if (last && index <= last.end) last.end = Math.max(last.end, index + 1);
		else ranges.push({ end: index + 1, start: index });
	}
	return ranges;
}

function mergeRanges(
	ranges: readonly { end: number; start: number }[],
): { end: number; start: number }[] {
	const sorted = [...ranges].sort((left, right) => left.start - right.start);
	const merged: { end: number; start: number }[] = [];
	for (const range of sorted) {
		const last = merged.at(-1);
		if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

function assertRunsMatchRow(row: DiffRow, runs: readonly TokenRun[]): void {
	if (runs.map((run) => run.text).join("") !== row.text) {
		throw new Error(`Token runs do not match diff row ${row.id}.`);
	}
}

export class DiffTokenLayer {
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private complete = false;
	private readonly history: DiffTokenHistoryEntry[] = [];
	private readonly indexById: ReadonlyMap<string, number>;
	private readonly listeners = new Set<() => void>();
	private revision = 0;
	private readonly rows: readonly DiffRow[];
	private snapshot: DiffTokenSnapshot;
	private readonly tokens = new Map<string, readonly TokenRun[]>();

	constructor(rows: readonly DiffRow[]) {
		this.rows = rows;
		this.indexById = new Map(rows.map((row, index) => [row.id, index]));
		this.snapshot = this.createSnapshot();
	}

	apply(batch: ReadonlyMap<number, readonly TokenRun[]>): void {
		const changed: { index: number; rowId: string; runs: readonly TokenRun[] }[] = [];
		for (const [index, runs] of batch) {
			const row = this.rows[index];
			if (!row || this.tokens.get(row.id) === runs) continue;
			assertRunsMatchRow(row, runs);
			changed.push({ index, rowId: row.id, runs });
		}
		if (changed.length === 0) return;
		for (const entry of changed) this.tokens.set(entry.rowId, entry.runs);
		this.commit(rangesFor(changed.map((entry) => entry.index)));
	}

	changesSince(revision: number): DiffTokenChanges | "reset" {
		if (revision === this.revision) {
			return {
				changedRows: [],
				complete: this.complete,
				fromRevision: revision,
				toRevision: this.revision,
			};
		}
		if (revision < 0 || revision > this.revision) return "reset";
		const first = this.history[0];
		if (!first || revision < first.revision - 1) return "reset";
		const changedRows = this.history
			.filter((entry) => entry.revision > revision)
			.flatMap((entry) => entry.changedRows);
		return {
			changedRows: mergeRanges(changedRows),
			complete: this.complete,
			fromRevision: revision,
			toRevision: this.revision,
		};
	}

	finish(): void {
		if (this.complete) return;
		this.complete = true;
		this.commit([]);
	}

	hydrate(tokens: ReadonlyMap<string, readonly TokenRun[]>, complete: boolean): void {
		const accepted: { index: number; rowId: string; runs: readonly TokenRun[] }[] = [];
		for (const [rowId, runs] of tokens) {
			const index = this.indexById.get(rowId);
			const row = index === undefined ? undefined : this.rows[index];
			if (!row || index === undefined) continue;
			assertRunsMatchRow(row, runs);
			accepted.push({ index, rowId, runs });
		}
		this.tokens.clear();
		for (const entry of accepted) this.tokens.set(entry.rowId, entry.runs);
		this.complete = complete;
		this.commit(rangesFor(accepted.map((entry) => entry.index)));
	}

	read = (): DiffTokenSnapshot => this.snapshot;

	tokenMap(): Map<string, readonly TokenRun[]> {
		return this.tokens;
	}

	private commit(changedRows: readonly { end: number; start: number }[]): void {
		this.revision += 1;
		this.history.push({ changedRows, revision: this.revision });
		if (this.history.length > MAX_DELTA_HISTORY) this.history.shift();
		this.snapshot = this.createSnapshot();
		for (const listener of this.listeners) listener();
	}

	private createSnapshot(): DiffTokenSnapshot {
		return {
			complete: this.complete,
			revision: this.revision,
			runsAt: (rowIndex) => {
				const row = this.rows[rowIndex];
				return row ? (this.tokens.get(row.id) ?? null) : null;
			},
		};
	}
}
