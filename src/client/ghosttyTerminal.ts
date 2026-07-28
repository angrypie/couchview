import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

import { adjustedTerminalCellMetrics } from "./terminalCellMetrics.ts";
import { TerminalEchoPaintController } from "./terminalEchoPaint.ts";
import { installTerminalFontShortcuts } from "./terminalFontShortcuts.ts";
import { installTerminalKeyRepeat } from "./terminalKeyRepeat.ts";
import {
  codeFontStack,
  type TerminalRendererConfig,
} from "./typographyPreferences.ts";

export interface BrowserTerminalRenderer {
  readonly cols: number;
  readonly rows: number;
  write(data: Uint8Array<ArrayBuffer>, profile?: BrowserTerminalWriteProfile): void;
  setLatencyKeyHandler(handler: ((event: KeyboardEvent) => void) | null): void;
  focus(): void;
  fit(): void;
  dispose(): void;
}

export interface BrowserTerminalWriteProfile {
  onWriteComplete(): void;
  onRenderStart(): void;
  onRenderComplete(): void;
}

interface CreateBrowserTerminalOptions {
  container: HTMLElement;
  config: TerminalRendererConfig;
  onData(data: Uint8Array<ArrayBuffer>): boolean;
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
  const echoPaintController = new TerminalEchoPaintController();
  let hostWriteDepth = 0;
  let pendingCanvasRenders: BrowserTerminalWriteProfile[] | null = null;
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
      const profiles = pendingCanvasRenders?.splice(0) ?? [];
      for (const profile of profiles) profile.onRenderStart();
      originalRender.apply(terminalRenderer, args);
      for (const profile of profiles) profile.onRenderComplete();
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
    const bytes = encoder.encode(data);
    if (hostWriteDepth > 0) {
      options.onData(bytes);
      return;
    }
    const token = echoPaintController.beginInput();
    if (!options.onData(bytes)) {
      echoPaintController.rejectInput(token);
    }
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
    write(data, profile) {
      if (pendingCanvasRenders && profile) {
        pendingCanvasRenders.push(profile);
      }
      try {
        hostWriteDepth += 1;
        try {
          terminal.write(data);
        } finally {
          hostWriteDepth -= 1;
        }
        profile?.onWriteComplete();
        echoPaintController.renderFirstOutput(() => {
          const renderer = terminal.renderer;
          const wasmTerm = terminal.wasmTerm;
          if (!renderer || !wasmTerm) return;
          // ghostty-web#179 ships this behavior on main, but 0.4.0 predates it.
          // Keep this adapter local until the next upstream release is available.
          const { scrollbarOpacity } = terminal as unknown as {
            scrollbarOpacity: number;
          };
          renderer.render(
            wasmTerm,
            false,
            terminal.viewportY,
            terminal,
            scrollbarOpacity,
          );
        });
      } catch (error) {
        if (pendingCanvasRenders && profile) {
          const profileIndex = pendingCanvasRenders.lastIndexOf(profile);
          if (profileIndex >= 0) pendingCanvasRenders.splice(profileIndex, 1);
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
      echoPaintController.reset();
      dataSubscription.dispose();
      setLatencyKeyHandler(null);
      resizeSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
    },
  };
}
