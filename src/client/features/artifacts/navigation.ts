export const ARTIFACTS_PATH = "/artifacts";

export function isArtifactsPath(pathname = window.location.pathname): boolean {
	return pathname.replace(/\/+$/, "") === ARTIFACTS_PATH;
}
