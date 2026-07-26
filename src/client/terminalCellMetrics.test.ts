import { describe, expect, test } from "bun:test";

import { FALLBACK_TERMINAL_RENDERER_CONFIG } from "../shared/terminalDefaults.ts";
import { adjustedTerminalCellMetrics } from "./terminalCellMetrics.ts";

describe("browser terminal cell metrics", () => {
  test("applies Ghostty pixel adjustments and vertically centers the font", () => {
    expect(adjustedTerminalCellMetrics(
      { width: 10, height: 18, baseline: 14 },
      FALLBACK_TERMINAL_RENDERER_CONFIG,
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
        ...FALLBACK_TERMINAL_RENDERER_CONFIG,
        cellWidthAdjustment: -16,
        cellHeightAdjustment: -16,
      },
    )).toEqual({
      width: 1,
      height: 1,
      baseline: 1,
    });
  });
});
