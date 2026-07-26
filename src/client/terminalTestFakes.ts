interface RendererOptions {
  container: HTMLElement;
  onData(data: Uint8Array<ArrayBuffer>): void;
  onResize(cols: number, rows: number): void;
}

export const rendererState = {
  calls: 0,
  disposed: 0,
  failure: null as Error | null,
  fits: 0,
  focuses: 0,
  options: null as RendererOptions | null,
  writes: [] as Uint8Array[],
};

export function resetRendererState(): void {
  rendererState.calls = 0;
  rendererState.disposed = 0;
  rendererState.failure = null;
  rendererState.fits = 0;
  rendererState.focuses = 0;
  rendererState.options = null;
  rendererState.writes.length = 0;
}

export async function terminalRendererFactory(options: RendererOptions) {
  rendererState.calls += 1;
  const failure = rendererState.failure;
  rendererState.failure = null;
  if (failure) throw failure;
  rendererState.options = options;
  return {
    cols: 100,
    rows: 32,
    dispose() {
      rendererState.disposed += 1;
    },
    fit() {
      rendererState.fits += 1;
    },
    focus() {
      rendererState.focuses += 1;
    },
    write(data: Uint8Array<ArrayBuffer>) {
      rendererState.writes.push(data);
    },
  };
}

type Listener = (event: { data?: unknown; code?: number }) => void;

export class FakeTerminalWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeTerminalWebSocket[] = [];

  readonly url: string;
  readonly protocols: string[];
  binaryType = "blob";
  readyState = FakeTerminalWebSocket.CONNECTING;
  readonly sent: Array<string | Uint8Array<ArrayBuffer>> = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string, protocols: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : [protocols];
    FakeTerminalWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener as unknown as Listener);
    this.listeners.set(type, listeners);
  }

  send(data: string | Uint8Array<ArrayBuffer>) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = FakeTerminalWebSocket.CLOSED;
    this.closes.push({ code, reason });
  }

  emitMessage(data: string | ArrayBuffer) {
    this.readyState = FakeTerminalWebSocket.OPEN;
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  emitClose(code: number) {
    this.readyState = FakeTerminalWebSocket.CLOSED;
    for (const listener of this.listeners.get("close") ?? []) listener({ code });
  }
}

export function resetFakeTerminalWebSockets(): void {
  FakeTerminalWebSocket.instances = [];
}
