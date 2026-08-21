import type { FileChange, FileDiff } from "../src/shared/contracts.ts";

export interface DiffScrollFixture {
	diff: FileDiff;
	file: FileChange;
}

function sourceLine(lineNumber: number): string {
	const suffix = String(lineNumber).padStart(5, "0");
	return `export const line${suffix} = calculateMetric(source${suffix}, ${lineNumber});`;
}

export function createDiffScrollFixture(lineCount: number): DiffScrollFixture {
	if (!Number.isInteger(lineCount) || lineCount < 100) {
		throw new Error("The diff scroll fixture requires at least 100 lines.");
	}
	const changedLine = Math.floor(lineCount / 2);
	const oldChangedText = sourceLine(changedLine);
	const newChangedText = `${oldChangedText.slice(0, -1)} + 1;`;
	const patchLines = [
		"diff --git a/src/generated/large-scroll.ts b/src/generated/large-scroll.ts",
		"--- a/src/generated/large-scroll.ts",
		"+++ b/src/generated/large-scroll.ts",
		`@@ -1,${lineCount} +1,${lineCount} @@`,
	];
	for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
		if (lineNumber === changedLine) {
			patchLines.push(`-${oldChangedText}`, `+${newChangedText}`);
		} else {
			patchLines.push(` ${sourceLine(lineNumber)}`);
		}
	}
	patchLines.push("");
	const fileId = "diff-scroll-benchmark";
	const contentRevision = `diff-scroll-${lineCount}-v1`;
	const file: FileChange = {
		additions: 1,
		binary: false,
		conflicted: false,
		contentRevision,
		deletions: 1,
		id: fileId,
		indexStatus: ".",
		kind: "modified",
		path: "src/generated/large-scroll.ts",
		previousPath: null,
		reviewed: false,
		staged: false,
		unstaged: true,
		worktreeStatus: "M",
	};
	const beforeLine = changedLine - 1;
	const afterLine = changedLine + 1;
	const diff: FileDiff = {
		additions: 1,
		binary: false,
		contentRevision,
		deletions: 1,
		fileId,
		fullFilePatch: patchLines.join("\n"),
		header: [patchLines[0]!],
		hunks: [
			{
				header: `@@ -${beforeLine},3 +${beforeLine},3 @@`,
				id: "diff-scroll-hunk",
				lines: [
					{
						id: "diff-scroll-before",
						kind: "context",
						newLine: beforeLine,
						noNewline: false,
						oldLine: beforeLine,
						text: sourceLine(beforeLine),
					},
					{
						id: "diff-scroll-deletion",
						kind: "deletion",
						newLine: null,
						noNewline: false,
						oldLine: changedLine,
						text: oldChangedText,
					},
					{
						id: "diff-scroll-addition",
						kind: "addition",
						newLine: changedLine,
						noNewline: false,
						oldLine: null,
						text: newChangedText,
					},
					{
						id: "diff-scroll-after",
						kind: "context",
						newLine: afterLine,
						noNewline: false,
						oldLine: afterLine,
						text: sourceLine(afterLine),
					},
				],
				newLines: 3,
				newStart: beforeLine,
				oldLines: 3,
				oldStart: beforeLine,
			},
		],
		kind: "modified",
		operationRevision: "diff-scroll-operation-v1",
		path: file.path,
		previousPath: null,
		tooLarge: false,
	};
	return { diff, file };
}
