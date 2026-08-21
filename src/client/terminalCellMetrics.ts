import type { TerminalRendererConfig } from "./typographyPreferences.ts";

const MIN_TERMINAL_CELL_SIZE = 4;

export interface TerminalCellMetrics {
	width: number;
	height: number;
	baseline: number;
}

export function adjustedTerminalCellMetrics(
	metrics: TerminalCellMetrics,
	config: TerminalRendererConfig,
): TerminalCellMetrics {
	const widthAdjustment = config.cellWidthAdjustment ?? 0;
	const heightAdjustment = config.cellHeightAdjustment ?? 0;
	const width = Math.max(MIN_TERMINAL_CELL_SIZE, metrics.width + widthAdjustment);
	const height = Math.max(MIN_TERMINAL_CELL_SIZE, metrics.height + heightAdjustment);
	const centeredBaseline = metrics.baseline + Math.ceil(heightAdjustment / 2);
	return {
		width,
		height,
		baseline: Math.max(1, Math.min(height, centeredBaseline)),
	};
}
