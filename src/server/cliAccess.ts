import { isIP } from "node:net";

function normalizedHostname(origin: string): string {
	const hostname = new URL(origin).hostname;
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function originPreference(origin: string): number {
	const url = new URL(origin);
	const hostname = normalizedHostname(origin);
	if (isIP(hostname) === 0 && hostname !== "localhost") return url.protocol === "https:" ? 0 : 1;
	if (isIP(hostname) !== 0 && hostname !== "::1" && !hostname.startsWith("127.")) return 2;
	if (isIP(hostname) !== 0) return 3;
	return 4;
}

export function projectUrls(origins: readonly string[], repositoryId: string): string[] {
	return origins
		.filter((origin) => !origin.includes("//0.0.0.0:") && !origin.includes("//[::]:"))
		.sort((left, right) => originPreference(left) - originPreference(right))
		.map((origin) => {
			const url = new URL(origin);
			url.searchParams.set("repo", repositoryId);
			return url.toString();
		});
}

export function preferredProjectUrl(
	origins: readonly string[],
	repositoryId: string,
): string | null {
	return projectUrls(origins, repositoryId)[0] ?? null;
}
