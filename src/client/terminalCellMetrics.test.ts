import { describe, expect, test } from "bun:test";

import { adjustedTerminalCellMetrics } from "./terminalCellMetrics.ts";
import { SAFE_TERMINAL_RENDERER_CONFIG } from "./typographyPreferences.ts";

describe("browser terminal cell metrics", () => {
  test("preserves Ghostty cell metrics when default adjustments are zero", () => {
    expect(adjustedTerminalCellMetrics(
      { width: 10, height: 18, baseline: 14 },
      SAFE_TERMINAL_RENDERER_CONFIG,
    )).toEqual({
      width: 10,
      height: 18,
      baseline: 14,
    });
  });

  test("applies custom pixel adjustments and vertically centers the font", () => {
    expect(adjustedTerminalCellMetrics(
      { width: 10, height: 18, baseline: 14 },
      {
        ...SAFE_TERMINAL_RENDERER_CONFIG,
        cellWidthAdjustment: -1,
        cellHeightAdjustment: 1,
      },
    )).toEqual({
      width: 9,
      height: 19,
      baseline: 15,
    });
  });

  test("keeps malformed legacy dimensions usable", () => {
    expect(adjustedTerminalCellMetrics(
      { width: 2, height: 2, baseline: 2 },
      {
        ...SAFE_TERMINAL_RENDERER_CONFIG,
        cellWidthAdjustment: -16,
        cellHeightAdjustment: -16,
      },
    )).toEqual({
      width: 4,
      height: 4,
      baseline: 1,
    });
  });
});
