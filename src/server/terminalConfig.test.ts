import { describe, expect, test } from "bun:test";

import {
  FALLBACK_TERMINAL_RENDERER_CONFIG,
  rendererConfigFromGhosttyText,
  resolveGhosttyRendererConfig,
} from "./terminalConfig.ts";

describe("Ghostty terminal appearance", () => {
  test("maps the supported local settings and ignores native-only options", () => {
    const config = rendererConfigFromGhosttyText(`
      font-family = "Local Font"
      font-size = 17
      cursor-style = underline
      cursor-style-blink = true
      adjust-cell-height = 4
      adjust-cell-width = -2
      shell-integration = fish
      background = 010203
      foreground = #fefefe
      cursor-color = abcdef
      selection-background = 111111
      selection-foreground = eeeeee
      palette = 0=#121212
      palette = 15=fafafa
    `);

    expect(config).toMatchObject({
      fontFamily: "Local Font",
      fontSize: 17,
      cellHeightAdjustment: 4,
      cellWidthAdjustment: -2,
      cursorStyle: "underline",
      cursorBlink: true,
      theme: {
        background: "#010203",
        foreground: "#fefefe",
        cursor: "#abcdef",
        selectionBackground: "#111111",
        selectionForeground: "#eeeeee",
      },
    });
    expect(config.theme.palette[0]).toBe("#121212");
    expect(config.theme.palette[15]).toBe("#fafafa");
  });

  test("falls back per field when local values are missing or malformed", () => {
    const config = rendererConfigFromGhosttyText(`
      font-size = enormous
      adjust-cell-height = 500
      adjust-cell-width = -25%
      cursor-style = hollow
      background = nope
      palette = 2=invalid
      palette = 3=#123456
    `);

    expect(config.fontFamily).toBe("Iosevka");
    expect(config.fontSize).toBe(15);
    expect(config.cellHeightAdjustment).toBe(1);
    expect(config.cellWidthAdjustment).toBe(-1);
    expect(config.cursorStyle).toBe("block");
    expect(config.theme.background).toBe("#1e1e2e");
    expect(config.theme.palette[2]).toBe("#a6e3a1");
    expect(config.theme.palette[3]).toBe("#123456");
  });

  test("prefers resolved Ghostty output over direct config files", () => {
    const shown: string[] = [];
    const resolved = resolveGhosttyRendererConfig({
      platform: "linux",
      homeDirectory: "/home/test",
      environment: {},
      which: () => "/usr/bin/ghostty",
      exists: (candidate) => [
        "/usr/bin/ghostty",
        "/home/test/.config/ghostty/config",
      ].includes(candidate),
      read: () => "font-size = 12",
      showConfig(executable) {
        shown.push(executable);
        return { exitCode: 0, stdout: "font-size = 18\nbackground = #020304\n" };
      },
    });

    expect(shown).toEqual(["/usr/bin/ghostty"]);
    expect(resolved.source).toBe("ghostty");
    expect(resolved.config.fontSize).toBe(18);
    expect(resolved.config.theme.background).toBe("#020304");
  });

  test("uses a conventional file and then bundled defaults when Ghostty is unavailable", () => {
    const fromFile = resolveGhosttyRendererConfig({
      platform: "linux",
      homeDirectory: "/home/test",
      environment: { XDG_CONFIG_HOME: "/custom" },
      which: () => null,
      exists: (candidate) => candidate === "/custom/ghostty/config",
      read: () => "font-family = File Font\nfont-size = 16\n",
    });
    expect(fromFile).toMatchObject({
      source: "file",
      config: { fontFamily: "File Font", fontSize: 16 },
    });

    const fallback = resolveGhosttyRendererConfig({
      platform: "linux",
      homeDirectory: "/missing",
      environment: {},
      which: () => null,
      exists: () => false,
    });
    expect(fallback).toEqual({
      source: "fallback",
      config: FALLBACK_TERMINAL_RENDERER_CONFIG,
    });
  });
});
