import type { FileChange, FileChangeDelta, FileDiff } from "../../../shared/contracts.ts";

export function changeLabel(file: FileChange): string {
	if (file.conflicted) return "conflict";
	return file.kind.replace("type-changed", "type");
}

export function stageLabel(
	file: FileChange,
): "partial" | "staged" | "unstaged" | "untracked" | null {
	if (file.staged && file.unstaged) return "partial";
	if (file.staged) return "staged";
	if (file.kind === "untracked") return "untracked";
	if (file.unstaged) return "unstaged";
	return null;
}

export function applyChangeFileDelta(
	current: readonly FileChange[],
	delta: FileChangeDelta,
): FileChange[] {
	const removed = new Set(delta.removedFileIds);
	const upserted = new Map(delta.upserted.map((file) => [file.id, file]));
	const next = current.flatMap((file) => {
		if (removed.has(file.id)) return [];
		return [upserted.get(file.id) ?? file];
	});
	for (const file of delta.upserted) {
		if (!current.some((candidate) => candidate.id === file.id)) next.push(file);
	}
	const nextById = new Map(next.map((file) => [file.id, file]));
	return delta.orderedFileIds.flatMap((fileId) => {
		const file = nextById.get(fileId);
		return file ? [file] : [];
	});
}

export function withDiffFileMetadata(
	current: FileDiff,
	file: FileChange,
	operationRevision: string,
): FileDiff {
	return {
		...current,
		path: file.path,
		previousPath: file.previousPath,
		kind: file.kind,
		operationRevision,
	};
}
