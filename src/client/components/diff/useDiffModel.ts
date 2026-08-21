import { useMemo } from "react";

import type { FileDiff } from "../../../shared/contracts.ts";
import { DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER } from "../../typographyPreferences.ts";
import {
	adaptFileDiff,
	buildDiffRows,
	buildRowMetrics,
	charWidthFor,
	DIFF_PALETTE,
	type DiffRow,
	type DiffRowMetrics,
	lineRowColors,
	reconstructUnifiedPatch,
	SEPARATOR_ROW_HEIGHT,
	wrappedLineCount,
} from "./engine/index.ts";
import type { DiffSceneLayout } from "./scene/types.ts";

export interface ParsedDiff {
	adaptedError: string | null;
	fallbackPatch: string;
	metrics: DiffRowMetrics;
	rows: DiffRow[];
}

const IOSEVKA_GLYPH_RATIO = 0.5;

export function useParsedDiff(diff: FileDiff): ParsedDiff {
	return useMemo(() => {
		try {
			const parsed = adaptFileDiff(diff).fileDiff;
			const rows = buildDiffRows(parsed);
			const metrics = buildRowMetrics(rows, 0);
			return {
				adaptedError: null,
				fallbackPatch: "",
				metrics,
				rows,
			};
		} catch (error) {
			const adaptedError = error instanceof Error ? error.message : "Could not parse this patch.";
			let fallbackPatch = "";
			try {
				fallbackPatch = reconstructUnifiedPatch(diff);
			} catch {
				fallbackPatch = diff.header.join("\n");
			}
			return {
				adaptedError,
				fallbackPatch,
				metrics: emptyMetrics(),
				rows: [],
			};
		}
	}, [diff]);
}

export interface DiffGeometry {
	availableColumns: number;
	contentWidth: number;
	gutterWidth: number;
	layout: DiffSceneLayout;
	rowHeights: number[];
	rowOffsets: number[];
	totalHeight: number;
}

export interface DiffGeometryOptions {
	fontFamily: string;
	fontSize: number;
	lineHeightAdjustment: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	maxColumns: number;
	maxNumberDigits: number;
	rows: DiffRow[];
	viewportWidth: number;
	widthAdjustment: number;
}

export function useDiffGeometry({
	fontFamily,
	fontSize,
	lineHeightAdjustment,
	lineNumbersVisible,
	lineWrapEnabled,
	maxColumns,
	maxNumberDigits,
	rows,
	viewportWidth,
	widthAdjustment,
}: DiffGeometryOptions): DiffGeometry {
	return useMemo(() => {
		const lineHeight = fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + lineHeightAdjustment;
		const charStride = charWidthFor(fontSize, widthAdjustment);
		const glyphWidth = fontSize * IOSEVKA_GLYPH_RATIO;
		const gutterPadding = glyphWidth * 0.45;
		const gutterWidth = lineNumbersVisible
			? Math.ceil(gutterPadding * 2 + maxNumberDigits * charStride + 2)
			: 6;
		const contentPadding = glyphWidth;
		const fixedContentWidth = gutterWidth + contentPadding * 2 + maxColumns * charStride;
		const contentWidth = lineWrapEnabled
			? viewportWidth || 0
			: Math.max(viewportWidth || 0, fixedContentWidth);
		const availableColumns = Math.max(
			1,
			Math.floor(
				(Math.max(viewportWidth, gutterWidth + contentPadding * 2 + 1) -
					gutterWidth -
					contentPadding * 2) /
					charStride,
			),
		);
		const rowHeights: number[] = new Array(rows.length);
		const rowOffsets: number[] = new Array(rows.length);
		let offset = 0;
		for (let index = 0; index < rows.length; index += 1) {
			const row = rows[index];
			if (!row) continue;
			let height = lineHeight;
			if (row.kind === "separator") height = SEPARATOR_ROW_HEIGHT;
			else if (lineWrapEnabled && !row.noNewline && row.visualColumns > 0) {
				height = wrappedLineCount(row.text, availableColumns) * lineHeight;
			}
			rowHeights[index] = height;
			rowOffsets[index] = offset;
			offset += height;
		}
		const contextColors = lineRowColors("context");
		const additionColors = lineRowColors("addition");
		const deletionColors = lineRowColors("deletion");
		const layout: DiffSceneLayout = {
			lineHeight,
			fontSize,
			charWidth: glyphWidth,
			letterSpacing: widthAdjustment,
			gutterWidth,
			gutterBorderWidth: 2,
			gutterPadding,
			contentPadding,
			separatorHeight: SEPARATOR_ROW_HEIGHT,
			separatorBackground: DIFF_PALETTE.separator,
			separatorTextColor: DIFF_PALETTE.separatorText,
			rowBackground: DIFF_PALETTE.background,
			textColor: DIFF_PALETTE.text,
			additionIndicatorColor: DIFF_PALETTE.additionBase,
			deletionIndicatorBackground: deletionColors.background,
			deletionIndicatorColor: DIFF_PALETTE.deletionBase,
			fontFamily,
			lineNumbersVisible,
			lineWrapEnabled,
			lineBackgroundByKind: {
				context: contextColors.background,
				addition: additionColors.background,
				deletion: deletionColors.background,
			},
			numberCellByKind: {
				context: contextColors.numberCell,
				addition: additionColors.numberCell,
				deletion: deletionColors.numberCell,
			},
			numberTextByKind: {
				context: contextColors.numberText,
				addition: additionColors.numberText,
				deletion: deletionColors.numberText,
			},
		};
		return {
			availableColumns,
			contentWidth,
			gutterWidth,
			layout,
			rowHeights,
			rowOffsets,
			totalHeight: offset,
		};
	}, [
		fontFamily,
		fontSize,
		lineHeightAdjustment,
		lineNumbersVisible,
		lineWrapEnabled,
		maxColumns,
		maxNumberDigits,
		rows,
		viewportWidth,
		widthAdjustment,
	]);
}

function emptyMetrics(): DiffRowMetrics {
	return {
		rowCount: 0,
		lineRows: 0,
		maxColumns: 0,
		maxNumberDigits: 1,
		firstRowByLineNumber: new Map(),
		firstRowByHunkIndex: new Map(),
		prefixOffsets: [],
		totalHeight: 0,
	};
}
