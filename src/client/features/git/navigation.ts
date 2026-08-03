export const GIT_HISTORY_PATH = "/history";

export function isGitHistoryPath(pathname = window.location.pathname): boolean {
	return pathname.replace(/\/+$/, "") === GIT_HISTORY_PATH;
}
