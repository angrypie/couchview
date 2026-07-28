import { describe, expect, test } from "bun:test";

import {
  codeFontStack,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  loadTypographyPreferences,
  normalizeTypographyPreferences,
  terminalRendererConfig,
  TYPOGRAPHY_STORAGE_KEY,
  type TypographyPreferences,
} from "./typographyPreferences.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("browser typography preferences", () => {
  test("normalizes independently bounded diff and terminal settings", () => {
    expect(normalizeTypographyPreferences({
      diff: {
        fontFamily: "comic-sans",
        fontSize: 200,
        lineHeight: 0,
        letterSpacing: 0.36,
      },
      terminal: {
        fontFamily: "system",
        fontSize: 4,
        cellHeightAdjustment: 100,
        cellWidthAdjustment: -20,
      },
    })).toEqual({
      diff: {
        fontFamily: "iosevka",
        fontSize: 24,
        lineHeight: 1.1,
        letterSpacing: 0.4,
      },
      terminal: {
        fontFamily: "system",
        fontSize: 8,
        cellHeightAdjustment: 16,
        cellWidthAdjustment: -5,
      },
    });
  });

  test("migrates the previous diff font size without coupling terminal defaults", () => {
    const storage = new MemoryStorage();
    storage.setItem("couch-review:font-size", "13");

    const preferences = loadTypographyPreferences(storage);

    expect(preferences.diff.fontSize).toBe(13);
    expect(preferences.terminal).toEqual(DEFAULT_TYPOGRAPHY_PREFERENCES.terminal);
    expect(
      JSON.parse(storage.getItem(TYPOGRAPHY_STORAGE_KEY)!) as TypographyPreferences,
    ).toEqual(preferences);
  });

  test("uses a true system monospace stack and creates a client-only terminal config", () => {
    expect(codeFontStack("system")).toStartWith("ui-monospace");
    expect(codeFontStack("system")).not.toContain("Iosevka");
    expect(terminalRendererConfig({
      fontFamily: "system",
      fontSize: 18,
      cellHeightAdjustment: 4,
      cellWidthAdjustment: 2,
    })).toMatchObject({
      fontFamily: "system",
      fontSize: 18,
      cellHeightAdjustment: 4,
      cellWidthAdjustment: 2,
      cursorStyle: "block",
      cursorBlink: false,
      theme: { background: "#1e1e2e" },
    });
  });

  test("clamps terminal cell width symmetrically from minus five to plus five", () => {
    expect(normalizeTypographyPreferences({
      terminal: {
        ...DEFAULT_TYPOGRAPHY_PREFERENCES.terminal,
        cellWidthAdjustment: 20,
      },
    }).terminal.cellWidthAdjustment).toBe(5);
    expect(normalizeTypographyPreferences({
      terminal: {
        ...DEFAULT_TYPOGRAPHY_PREFERENCES.terminal,
        cellWidthAdjustment: -20,
      },
    }).terminal.cellWidthAdjustment).toBe(-5);
  });
});
