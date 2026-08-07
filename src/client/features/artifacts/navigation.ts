export const ARTIFACTS_PATH = "/artifacts";

export function isArtifactsPath(pathname: string): boolean {
	return pathname.replace(/\/+$/, "") === ARTIFACTS_PATH;
}
