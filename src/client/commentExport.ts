import type { ReviewComment } from "../shared/contracts.ts";

function safePath(path: string): string {
  return /^[A-Za-z0-9_./@+ -]+$/.test(path) ? path : JSON.stringify(path);
}

export function formatCommentReference(comment: ReviewComment): string {
  const formatRange = (start: number, end: number) =>
    start === end ? `L${start}` : `L${start}-L${end}`;
  if (
    comment.side === "mixed" &&
    comment.oldStartLine !== undefined &&
    comment.oldEndLine !== undefined &&
    comment.newStartLine !== undefined &&
    comment.newEndLine !== undefined
  ) {
    return `${safePath(comment.path)}:old ${formatRange(comment.oldStartLine, comment.oldEndLine)} / new ${formatRange(comment.newStartLine, comment.newEndLine)}`;
  }
  const range =
    formatRange(comment.startLine, comment.endLine);
  const side = comment.side === "old" ? " (old)" : "";
  return `${safePath(comment.path)}:${range}${side}`;
}

export function exportCommentsForCodex(comments: ReviewComment[]): string {
  const sorted = comments.filter((comment) => !comment.stale).sort(
    (a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine,
  );
  return [
    "Please address each review comment below and preserve unrelated behavior:",
    "",
    ...sorted.flatMap((comment, index) => [
      `${index + 1}. ${formatCommentReference(comment)}`,
      `   Comment (JSON): ${JSON.stringify(comment.body)}`,
      ...(comment.excerpt.length > 0
        ? ["   Code:", ...comment.excerpt.map((line) => `       ${line}`)]
        : []),
      "",
    ]),
  ].join("\n");
}
