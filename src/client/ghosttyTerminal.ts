import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

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
  onData(data: Uint8Array<ArrayBuffer>): void;
  onResize(cols: number, rows: number): void;
}

let initialization: Promise<import("ghostty-web").Ghostty> | null = null;
const encoder = new TextEncoder();

export async function createBrowserTerminal(
  options: CreateBrowserTerminalOptions,
): Promise<BrowserTerminalRenderer> {
  const ghostty = await import("ghostty-web");
  initialization ??= ghostty.Ghostty.load(ghosttyWasmUrl).catch((error) => {
    initialization = null;
    throw error;
  });
  const ghosttyInstance = await initialization;

  const terminal = new ghostty.Terminal({
    cursorBlink: true,
    fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", monospace',
    fontSize: 14,
    scrollback: 5_000,
    ghostty: ghosttyInstance,
    theme: {
      background: "#0b0d10",
      foreground: "#d9dde5",
      cursor: "#8fb3ff",
      cursorAccent: "#0b0d10",
      selectionBackground: "#33476b",
      black: "#15191f",
      red: "#ff7b72",
      green: "#75c991",
      yellow: "#e3b341",
      blue: "#79a7ff",
      magenta: "#d2a8ff",
      cyan: "#76d4d7",
      white: "#d9dde5",
      brightBlack: "#737b8c",
      brightRed: "#ffa198",
      brightGreen: "#9be9a8",
      brightYellow: "#f2cc60",
      brightBlue: "#a5c8ff",
      brightMagenta: "#e2c5ff",
      brightCyan: "#a5e8ea",
      brightWhite: "#ffffff",
    },
  });
  const fitAddon = new ghostty.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(options.container);
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
