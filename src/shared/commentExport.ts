import type { ReviewComment } from "./contracts.ts";

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
	const range = formatRange(comment.startLine, comment.endLine);
	const side = comment.side === "old" ? " (old)" : "";
	return `${safePath(comment.path)}:${range}${side}`;
}

function isInformationalQuestion(body: string): boolean {
	const text = body.trim();
	if (!text.endsWith("?")) return false;
	// Requests phrased as questions ("Can you fix…?", "Could you update…?")
	// still need to be treated as actionable review feedback.
	return !/\b(add|change|document|fix|implement|make|prevent|refactor|remove|rename|replace|support|test|update)\b/i.test(
		text,
	);
}

export function exportCommentsForCodex(comments: ReviewComment[]): string {
	const sorted = comments
		.filter((comment) => !comment.stale)
		.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);
	return [
		"Please address each review comment below and preserve unrelated behavior:",
		"",
		"First classify each comment before acting:",
		"- Informational questions (for example, what/why/how questions) should be answered in your response only; do not edit files, add code comments, or create a diff for them.",
		"- Make code, documentation, or test changes only when a comment explicitly requests a change or fix.",
		"- If a comment is ambiguous, explain the answer and ask for clarification instead of changing files.",
		"- If all comments are informational questions, leave the workspace unchanged.",
		"",
		...sorted.flatMap((comment, index) => [
			`${index + 1}. ${formatCommentReference(comment)}`,
			`   Comment (JSON): ${JSON.stringify(comment.body)}`,
			...(isInformationalQuestion(comment.body)
				? ["   Intent: informational question — answer only; do not edit files."]
				: []),
			...(comment.excerpt.length > 0
				? ["   Code:", ...comment.excerpt.map((line) => `       ${line}`)]
				: []),
			"",
		]),
	].join("\n");
}
