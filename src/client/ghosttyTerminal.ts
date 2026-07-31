import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

import { adjustedTerminalCellMetrics } from "./terminalCellMetrics.ts";
import { TerminalEchoPaintController } from "./terminalEchoPaint.ts";
import { installTerminalClipboardPaste } from "./terminalClipboardPaste.ts";
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

export interface BrowserTerminalPreviewRenderer {
  updateConfig(config: TerminalRendererConfig): Promise<void>;
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

interface CreateBrowserTerminalPreviewOptions {
  container: HTMLElement;
  config: TerminalRendererConfig;
}

let initialization: Promise<import("ghostty-web").Ghostty> | null = null;
const encoder = new TextEncoder();
const BUNDLED_TEXT_FONT_FAMILY = "Iosevka";
const FONT_RESIZE_SETTLE_MS = 75;

async function loadGhostty() {
  const ghostty = await import("ghostty-web");
  initialization ??= ghostty.Ghostty.load(ghosttyWasmUrl).catch((error) => {
    initialization = null;
    throw error;
  });
  return {
    ghostty,
    instance: await initialization,
  };
}

async function loadTerminalFont(config: TerminalRendererConfig): Promise<void> {
  if (config.fontFamily === "iosevka") {
    await document.fonts?.load(`${config.fontSize}px "${BUNDLED_TEXT_FONT_FAMILY}"`);
  }
}

function ghosttyTheme(config: TerminalRendererConfig) {
  const palette = config.theme.palette;
  return {
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
  };
}

function applyTerminalAdjustedMetrics(
  terminal: import("ghostty-web").Terminal,
  config: TerminalRendererConfig,
): void {
  const renderer = terminal.renderer;
  if (!renderer) return;
  renderer.remeasureFont();
  const adjustedMetrics = adjustedTerminalCellMetrics(
    renderer.getMetrics(),
    config,
  );
  // ghostty-web 0.4 has no public cell-metric adjustment API. Its TypeScript
  // private field is a normal runtime property, so keep this adaptation small
  // and guarded until upstream exposes line-height and letter-spacing options.
  (renderer as unknown as { metrics: typeof adjustedMetrics }).metrics = adjustedMetrics;
  renderer.resize(terminal.cols, terminal.rows);
  renderTerminalBuffer(terminal);
}

function renderTerminalBuffer(
  terminal: import("ghostty-web").Terminal,
  forceAll = true,
): void {
  const renderer = terminal.renderer;
  const wasmTerm = terminal.wasmTerm;
  if (!renderer || !wasmTerm) return;
  const { scrollbarOpacity } = terminal as unknown as {
    scrollbarOpacity: number;
  };
  renderer.render(
    wasmTerm,
    forceAll,
    terminal.viewportY,
    terminal,
    scrollbarOpacity,
  );
}

function terminalPreviewContent(cols: number, rows: number): string {
  const width = Math.max(2, cols);
  const height = Math.max(1, rows);
  const ruler = Array.from({ length: width }, () => "·");
  for (let marker = 10; marker <= width; marker += 10) {
    const label = String(marker);
    const start = marker - label.length;
    for (let index = 0; index < label.length; index += 1) {
      ruler[start + index] = label[index]!;
    }
  }

  const lualineRow = Math.max(1, height - 2);
  const tmuxRow = height;
  const location = " utf-8  3:18 ";
  const locationColumn = Math.max(1, width - location.length + 1);
  const commandRow = Math.min(3, Math.max(1, lualineRow - 1));
  return [
    "\x1b[?25l\x1b[2J\x1b[H",
    "\x1b[48;2;24;24;37m\x1b[38;2;125;138;156m",
    ruler.join(""),
    `\x1b[${commandRow};1H\x1b[49m\x1b[38;2;166;227;161m❯`,
    "\x1b[39m nvim ~/.config/nvim/init.lua",
    `\x1b[${lualineRow};1H`,
    "\x1b[1m\x1b[48;2;137;180;250m\x1b[38;2;17;17;27m NORMAL ",
    "\x1b[48;2;49;50;68m\x1b[38;2;137;180;250m",
    "\x1b[22m\x1b[38;2;205;214;244m settings.lua ",
    "\x1b[48;2;24;24;37m\x1b[38;2;49;50;68m",
    `\x1b[${lualineRow};${locationColumn}H`,
    "\x1b[48;2;49;50;68m\x1b[38;2;186;194;222m",
    location,
    `\x1b[${tmuxRow};1H`,
    "\x1b[1m\x1b[48;2;137;180;250m\x1b[38;2;17;17;27m 0 ",
    "\x1b[48;2;69;71;90m\x1b[38;2;137;180;250m",
    "\x1b[22m\x1b[38;2;205;214;244m bun ",
    "\x1b[48;2;137;180;250m\x1b[38;2;69;71;90m",
    "\x1b[1m\x1b[38;2;17;17;27m 1 ",
    "\x1b[48;2;148;226;213m\x1b[38;2;137;180;250m",
    "\x1b[38;2;17;17;27m nvim * ",
    "\x1b[48;2;49;50;68m\x1b[38;2;148;226;213m",
    "\x1b[0m\x1b[?25l",
  ].join("");
}

export async function createBrowserTerminalPreview(
  options: CreateBrowserTerminalPreviewOptions,
): Promise<BrowserTerminalPreviewRenderer> {
  const { ghostty, instance } = await loadGhostty();
  await loadTerminalFont(options.config);
  const terminal = new ghostty.Terminal({
    cols: 80,
    rows: 8,
    cursorBlink: false,
    cursorStyle: options.config.cursorStyle,
    disableStdin: true,
    fontFamily: codeFontStack(options.config.fontFamily),
    fontSize: options.config.fontSize,
    ghostty: instance,
    scrollback: 0,
    theme: ghosttyTheme(options.config),
  });
  const fitAddon = new ghostty.FitAddon();
  terminal.loadAddon(fitAddon);
  const previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  terminal.open(options.container);
  options.container.setAttribute("aria-hidden", "true");
  options.container.setAttribute("contenteditable", "false");
  options.container.setAttribute("tabindex", "-1");
  terminal.textarea?.setAttribute("aria-hidden", "true");
  terminal.textarea?.setAttribute("tabindex", "-1");
  terminal.blur();
  const restoreFocusTimer = window.setTimeout(() => {
    terminal.blur();
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
  }, 0);

  let config = options.config;
  let disposed = false;
  let updateRevision = 0;
  const renderPreview = () => {
    if (!disposed) terminal.write(terminalPreviewContent(terminal.cols, terminal.rows));
  };
  const resizeSubscription = terminal.onResize(renderPreview);
  applyTerminalAdjustedMetrics(terminal, config);
  fitAddon.observeResize();
  fitAddon.fit();
  renderPreview();

  return {
    async updateConfig(nextConfig) {
      const revision = ++updateRevision;
      await loadTerminalFont(nextConfig);
      if (disposed || revision !== updateRevision) return;
      config = nextConfig;
      terminal.options.fontFamily = codeFontStack(config.fontFamily);
      terminal.options.fontSize = config.fontSize;
      applyTerminalAdjustedMetrics(terminal, config);
      fitAddon.fit();
      renderPreview();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      updateRevision += 1;
      window.clearTimeout(restoreFocusTimer);
      resizeSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
    },
  };
}

export async function createBrowserTerminal(
  options: CreateBrowserTerminalOptions,
): Promise<BrowserTerminalRenderer> {
  const { ghostty, instance: ghosttyInstance } = await loadGhostty();
  const { config } = options;
  await loadTerminalFont(config);
  const fontFamily = codeFontStack(config.fontFamily);

  const terminal = new ghostty.Terminal({
    cursorBlink: config.cursorBlink,
    cursorStyle: config.cursorStyle,
    fontFamily,
    fontSize: config.fontSize,
    scrollback: 5_000,
    ghostty: ghosttyInstance,
    theme: ghosttyTheme(config),
  });
  const fitAddon = new ghostty.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(options.container);
  const disposeClipboardPaste = installTerminalClipboardPaste(options.container);
  const disposeKeyRepeat = installTerminalKeyRepeat(options.container);
  const terminalRenderer = terminal.renderer;
  const originalRender = terminalRenderer?.render;
  const echoPaintController = new TerminalEchoPaintController();
  let hostWriteDepth = 0;
  let pendingCanvasRenders: BrowserTerminalWriteProfile[] | null = null;
  let keySubscription: { dispose(): void } | null = null;
  let fontRefitTimer: number | null = null;
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
    applyTerminalAdjustedMetrics(terminal, config);
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
      if (fontRefitTimer !== null) window.clearTimeout(fontRefitTimer);
      // ghostty-web 0.4 ignores fit calls for 50ms after it resizes. Reconcile
      // once a hotkey burst settles so the final font metrics fill the surface.
      fontRefitTimer = window.setTimeout(() => {
        fontRefitTimer = null;
        fitAddon.fit();
      }, FONT_RESIZE_SETTLE_MS);
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
          // ghostty-web#179 ships this behavior on main, but 0.4.0 predates it.
          // Keep this adapter local until the next upstream release is available.
          renderTerminalBuffer(terminal, false);
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
      disposeClipboardPaste();
      disposeFontShortcuts();
      if (fontRefitTimer !== null) window.clearTimeout(fontRefitTimer);
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
