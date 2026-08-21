export function normalizeGitRemoteIdentity(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed || trimmed.includes("\0")) return null;
	let host: string;
	let pathname: string;
	const scp = /^(?:[^@/:\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
	if (scp && !trimmed.includes("://")) {
		host = scp[1] ?? "";
		pathname = scp[2] ?? "";
	} else {
		let parsed: URL;
		try {
			parsed = new URL(trimmed);
		} catch {
			return null;
		}
		if (!["http:", "https:", "ssh:", "git:"].includes(parsed.protocol)) return null;
		host = parsed.host;
		pathname = parsed.pathname;
	}
	const normalizedHost = host.toLowerCase().replace(/\.$/, "");
	const normalizedPath = pathname
		.replace(/^\/+|\/+$/g, "")
		.replace(/\.git$/i, "")
		.replace(/\/{2,}/g, "/");
	if (!normalizedHost || !normalizedPath || normalizedPath.split("/").some((part) => !part)) {
		return null;
	}
	return `${normalizedHost}/${normalizedPath}`;
}
