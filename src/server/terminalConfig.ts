import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { TerminalRendererConfig } from "../shared/contracts.ts";
import { FALLBACK_TERMINAL_RENDERER_CONFIG } from "../shared/terminalDefaults.ts";

export { FALLBACK_TERMINAL_RENDERER_CONFIG } from "../shared/terminalDefaults.ts";

const decoder = new TextDecoder();

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function color(value: string): string | null {
  const normalized = unquote(value);
  const match = /^#?([0-9a-f]{6})$/i.exec(normalized);
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

function cellAdjustment(value: string): number | null {
  const normalized = unquote(value);
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= -16 && parsed <= 32 ? parsed : null;
}

export function rendererConfigFromGhosttyText(
  text: string,
  fallback: TerminalRendererConfig = FALLBACK_TERMINAL_RENDERER_CONFIG,
): TerminalRendererConfig {
  let fontFamily = fallback.fontFamily;
  let fontFamilySeen = false;
  let fontSize = fallback.fontSize;
  let cellHeightAdjustment = fallback.cellHeightAdjustment ?? 0;
  let cellWidthAdjustment = fallback.cellWidthAdjustment ?? 0;
  let cursorStyle = fallback.cursorStyle;
  let cursorBlink = fallback.cursorBlink;
  const theme = {
    ...fallback.theme,
    palette: [...fallback.theme.palette],
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "font-family" && !fontFamilySeen) {
      const parsed = unquote(value);
      if (parsed) {
        fontFamily = parsed;
        fontFamilySeen = true;
      }
    } else if (key === "font-size") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 6 && parsed <= 72) fontSize = parsed;
    } else if (key === "adjust-cell-height") {
      cellHeightAdjustment = cellAdjustment(value) ?? cellHeightAdjustment;
    } else if (key === "adjust-cell-width") {
      cellWidthAdjustment = cellAdjustment(value) ?? cellWidthAdjustment;
    } else if (key === "cursor-style") {
      const parsed = unquote(value).replaceAll("_", "-");
      if (parsed === "block" || parsed === "underline" || parsed === "bar") {
        cursorStyle = parsed;
      }
    } else if (key === "cursor-style-blink") {
      if (value === "true" || value === "false") cursorBlink = value === "true";
    } else if (key === "palette") {
      const paletteSeparator = value.indexOf("=");
      const index = Number(value.slice(0, paletteSeparator));
      const parsed = paletteSeparator > 0 ? color(value.slice(paletteSeparator + 1)) : null;
      if (Number.isSafeInteger(index) && index >= 0 && index < 16 && parsed) {
        theme.palette[index] = parsed;
      }
    } else {
      const parsed = color(value);
      if (!parsed) continue;
      if (key === "background") theme.background = parsed;
      else if (key === "foreground") theme.foreground = parsed;
      else if (key === "cursor-color") theme.cursor = parsed;
      else if (key === "selection-background") theme.selectionBackground = parsed;
      else if (key === "selection-foreground") theme.selectionForeground = parsed;
    }
  }

  return {
    fontFamily,
    fontSize,
    cellHeightAdjustment,
    cellWidthAdjustment,
    cursorStyle,
    cursorBlink,
    theme,
  };
}

export interface ResolvedGhosttyRendererConfig {
  config: TerminalRendererConfig;
  source: "ghostty" | "file" | "fallback";
}

export interface GhosttyConfigResolutionOptions {
  environment?: Record<string, string | undefined>;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  which?: (command: string) => string | null;
  exists?: (candidate: string) => boolean;
  read?: (candidate: string) => string;
  showConfig?: (executable: string) => { exitCode: number; stdout: string };
}

export function resolveGhosttyRendererConfig(
  options: GhosttyConfigResolutionOptions = {},
): ResolvedGhosttyRendererConfig {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const read = options.read ?? ((candidate) => readFileSync(candidate, "utf8"));
  const which = options.which ?? ((command) => Bun.which(command));
  const showConfig = options.showConfig ?? ((executable) => {
    const result = Bun.spawnSync([executable, "+show-config"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 5_000,
    });
    return { exitCode: result.exitCode, stdout: decoder.decode(result.stdout) };
  });

  const executables = [
    which("ghostty"),
    ...(platform === "darwin"
      ? [
          "/Applications/Ghostty.app/Contents/MacOS/ghostty",
          path.join(homeDirectory, "Applications/Ghostty.app/Contents/MacOS/ghostty"),
        ]
      : []),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const executable of [...new Set(executables)]) {
    if (!exists(executable)) continue;
    try {
      const resolved = showConfig(executable);
      if (resolved.exitCode === 0 && resolved.stdout.trim()) {
        return {
          config: rendererConfigFromGhosttyText(resolved.stdout),
          source: "ghostty",
        };
      }
    } catch {
      // Direct config-file parsing remains available when the helper fails.
    }
  }

  const xdgConfig = environment.XDG_CONFIG_HOME;
  const candidates = [
    ...(xdgConfig ? [path.join(xdgConfig, "ghostty", "config")] : []),
    path.join(homeDirectory, ".config", "ghostty", "config"),
    ...(platform === "darwin"
      ? [
          path.join(homeDirectory, "Library/Application Support/com.mitchellh.ghostty/config"),
          path.join(homeDirectory, "Library/Application Support/com.mitchellh.ghostty/config.ghostty"),
        ]
      : []),
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (!exists(candidate)) continue;
    try {
      return {
        config: rendererConfigFromGhosttyText(read(candidate)),
        source: "file",
      };
    } catch {
      // Try the next conventional path before using bundled defaults.
    }
  }

  return {
    config: FALLBACK_TERMINAL_RENDERER_CONFIG,
    source: "fallback",
  };
}

let cachedRendererConfig: TerminalRendererConfig | null = null;

export function defaultTerminalRendererConfig(): TerminalRendererConfig {
  cachedRendererConfig ??= resolveGhosttyRendererConfig().config;
  return cachedRendererConfig;
}
