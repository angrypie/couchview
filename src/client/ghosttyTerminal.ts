import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

import type { TerminalRendererConfig } from "../shared/contracts.ts";
import { adjustedTerminalCellMetrics } from "./terminalCellMetrics.ts";

export interface BrowserTerminalRenderer {
  readonly cols: number;
  readonly rows: number;
  write(data: Uint8Array<ArrayBuffer>): void;
  focus(): void;
  fit(): void;
  dispose(): void;
}

interface CreateBrowserTerminalOptions {
  container: HTMLElement;
  config: TerminalRendererConfig;
  onData(data: Uint8Array<ArrayBuffer>): void;
  onResize(cols: number, rows: number): void;
}

let initialization: Promise<import("ghostty-web").Ghostty> | null = null;
const encoder = new TextEncoder();
const BUNDLED_FONT_FAMILY = "Hack Nerd Font Mono";

function quotedFontFamily(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export async function createBrowserTerminal(
  options: CreateBrowserTerminalOptions,
): Promise<BrowserTerminalRenderer> {
  const ghostty = await import("ghostty-web");
  initialization ??= ghostty.Ghostty.load(ghosttyWasmUrl).catch((error) => {
    initialization = null;
    throw error;
  });
  const ghosttyInstance = await initialization;
  const { config } = options;
  await document.fonts?.load(`${config.fontSize}px "${BUNDLED_FONT_FAMILY}"`);
  const configuredFamily = config.fontFamily.toLowerCase() === "hack nerd font"
    ? BUNDLED_FONT_FAMILY
    : config.fontFamily;
  const quotedConfiguredFamily = quotedFontFamily(configuredFamily);
  const fontFamily = configuredFamily.toLowerCase() === BUNDLED_FONT_FAMILY.toLowerCase()
    ? `${quotedConfiguredFamily}, monospace`
    : `${quotedConfiguredFamily}, "${BUNDLED_FONT_FAMILY}", monospace`;
  const palette = config.theme.palette;

  const terminal = new ghostty.Terminal({
    cursorBlink: config.cursorBlink,
    cursorStyle: config.cursorStyle,
    fontFamily,
    fontSize: config.fontSize,
    scrollback: 5_000,
    ghostty: ghosttyInstance,
    theme: {
      background: config.theme.background,
      foreground: config.theme.foreground,
      cursor: config.theme.cursor,
      cursorAccent: config.theme.background,
      selectionBackground: config.theme.selectionBackground,
      selectionForeground: config.theme.selectionForeground,
      black: palette[0],
      red: palette[1],
      green: palette[2],
      yellow: palette[3],
      blue: palette[4],
      magenta: palette[5],
      cyan: palette[6],
      white: palette[7],
      brightBlack: palette[8],
      brightRed: palette[9],
      brightGreen: palette[10],
      brightYellow: palette[11],
      brightBlue: palette[12],
      brightMagenta: palette[13],
      brightCyan: palette[14],
      brightWhite: palette[15],
    },
  });
  const fitAddon = new ghostty.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(options.container);
  const renderer = terminal.renderer;
  if (renderer) {
    const adjustedMetrics = adjustedTerminalCellMetrics(renderer.getMetrics(), config);
    // ghostty-web 0.4 has no public cell-metric adjustment API. Its TypeScript
    // private field is a normal runtime property, so keep this adaptation small
    // and guarded until upstream exposes line-height and letter-spacing options.
    (renderer as unknown as { metrics: typeof adjustedMetrics }).metrics = adjustedMetrics;
    renderer.resize(terminal.cols, terminal.rows);
  }
  const dataSubscription = terminal.onData((data) => {
    options.onData(encoder.encode(data));
  });
  const resizeSubscription = terminal.onResize(({ cols, rows }) => {
    options.onResize(cols, rows);
  });
  fitAddon.observeResize();
  fitAddon.fit();

  return {
    get cols() {
      return terminal.cols;
    },
    get rows() {
      return terminal.rows;
    },
    write(data) {
      terminal.write(data);
    },
    focus() {
      terminal.focus();
    },
    fit() {
      fitAddon.fit();
    },
    dispose() {
      dataSubscription.dispose();
      resizeSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
    },
  };
}
