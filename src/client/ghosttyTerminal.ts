import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

import { adjustedTerminalCellMetrics } from "./terminalCellMetrics.ts";
import { installTerminalFontShortcuts } from "./terminalFontShortcuts.ts";
import { installTerminalKeyRepeat } from "./terminalKeyRepeat.ts";
import {
  codeFontStack,
  type TerminalRendererConfig,
} from "./typographyPreferences.ts";

export interface BrowserTerminalRenderer {
  readonly cols: number;
  readonly rows: number;
  write(data: Uint8Array<ArrayBuffer>, onCanvasRender?: () => void): void;
  setLatencyKeyHandler(handler: ((event: KeyboardEvent) => void) | null): void;
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
const BUNDLED_TEXT_FONT_FAMILY = "Iosevka";

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
  if (config.fontFamily === "iosevka") {
    await document.fonts?.load(`${config.fontSize}px "${BUNDLED_TEXT_FONT_FAMILY}"`);
  }
  const fontFamily = codeFontStack(config.fontFamily);
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
  const disposeKeyRepeat = installTerminalKeyRepeat(options.container);
  const terminalRenderer = terminal.renderer;
  const originalRender = terminalRenderer?.render;
  let pendingCanvasRenders: Array<() => void> | null = null;
  let keySubscription: { dispose(): void } | null = null;
  const setLatencyKeyHandler = (handler: ((event: KeyboardEvent) => void) | null) => {
    keySubscription?.dispose();
    keySubscription = null;
    pendingCanvasRenders?.splice(0);
    pendingCanvasRenders = null;
    if (terminalRenderer && originalRender) terminalRenderer.render = originalRender;
    if (!handler || !terminalRenderer || !originalRender) return;

    pendingCanvasRenders = [];
    terminalRenderer.render = (...args: Parameters<typeof terminalRenderer.render>) => {
      originalRender.apply(terminalRenderer, args);
      const callbacks = pendingCanvasRenders?.splice(0) ?? [];
      for (const callback of callbacks) callback();
    };
    keySubscription = terminal.onKey(({ domEvent }) => handler(domEvent));
  };
  const applyAdjustedMetrics = () => {
    const renderer = terminal.renderer;
    if (!renderer) return;
    const adjustedMetrics = adjustedTerminalCellMetrics(
      renderer.getMetrics(),
      config,
    );
    // ghostty-web 0.4 has no public cell-metric adjustment API. Its TypeScript
    // private field is a normal runtime property, so keep this adaptation small
    // and guarded until upstream exposes line-height and letter-spacing options.
    (renderer as unknown as { metrics: typeof adjustedMetrics }).metrics = adjustedMetrics;
    renderer.resize(terminal.cols, terminal.rows);
  };
  applyAdjustedMetrics();
  const dataSubscription = terminal.onData((data) => {
    options.onData(encoder.encode(data));
  });
  const resizeSubscription = terminal.onResize(({ cols, rows }) => {
    options.onResize(cols, rows);
  });
  fitAddon.observeResize();
  fitAddon.fit();
  const disposeFontShortcuts = installTerminalFontShortcuts(options.container, {
    initialFontSize: config.fontSize,
    onFontSizeChange(fontSize) {
      terminal.options.fontSize = fontSize;
      applyAdjustedMetrics();
      fitAddon.fit();
      terminal.focus();
    },
  });

  return {
    get cols() {
      return terminal.cols;
    },
    get rows() {
      return terminal.rows;
    },
    write(data, onCanvasRender) {
      if (pendingCanvasRenders && onCanvasRender) {
        pendingCanvasRenders.push(onCanvasRender);
      }
      try {
        terminal.write(data);
      } catch (error) {
        if (pendingCanvasRenders && onCanvasRender) {
          const callbackIndex = pendingCanvasRenders.lastIndexOf(onCanvasRender);
          if (callbackIndex >= 0) pendingCanvasRenders.splice(callbackIndex, 1);
        }
        throw error;
      }
    },
    setLatencyKeyHandler,
    focus() {
      terminal.focus();
    },
    fit() {
      fitAddon.fit();
    },
    dispose() {
      disposeFontShortcuts();
      disposeKeyRepeat();
      dataSubscription.dispose();
      setLatencyKeyHandler(null);
      resizeSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
    },
  };
}
