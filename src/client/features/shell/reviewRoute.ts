import type { ReviewLineSide, ReviewLocation } from "../workspacePosition/index.ts";

function positiveLine(value: string | null): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const line = Number(value);
	return Number.isSafeInteger(line) && line > 0 ? line : null;
}

function lineSide(value: string | null): ReviewLineSide | null {
	return value === "old" || value === "new" ? value : null;
}

export function parseReviewLocation(
	path: string | null,
	line: string | null,
	side: string | null,
): ReviewLocation | null {
	if (!path) return null;
	const parsedLine = positiveLine(line);
	return {
		anchor: parsedLine ? { line: parsedLine, side: lineSide(side) ?? "new" } : null,
		path,
	};
}

export function reviewLocationParams(location: ReviewLocation | null): Record<string, string> {
	if (!location) return {};
	return {
		file: location.path,
		...(location.anchor ? { line: String(location.anchor.line), side: location.anchor.side } : {}),
	};
}

export function absoluteReviewUrl(
	baseUrl: string,
	repositoryId: string,
	location: ReviewLocation,
): string {
	const url = new URL("/", baseUrl);
	url.searchParams.set("repo", repositoryId);
	for (const [key, value] of Object.entries(reviewLocationParams(location))) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}
