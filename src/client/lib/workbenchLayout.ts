export type WorkbenchLayout = "compact" | "rail" | "contextual";

export function selectWorkbenchLayout(width: number, height: number): WorkbenchLayout {
	const shortestSide = Math.min(width, height);
	if (shortestSide < 600 || width < 760) return "compact";
	return width >= 1180 ? "contextual" : "rail";
}
