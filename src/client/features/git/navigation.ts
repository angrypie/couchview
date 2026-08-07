export const GIT_HISTORY_PATH = "/history";

export function isGitHistoryPath(pathname: string): boolean {
	return pathname.replace(/\/+$/, "") === GIT_HISTORY_PATH;
}
