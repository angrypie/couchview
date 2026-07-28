import {
  TERMINAL_DATA_CHANNEL_LABEL,
  TERMINAL_DATA_CHANNEL_PROTOCOL,
  type TerminalWebRtcConfiguration,
} from "../shared/contracts.ts";

const MAX_CONTROL_BYTES = 48 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;

export type TerminalTransportStatus = "websocket" | "finding" | "direct" | "fallback";

interface TerminalWebRtcCallbacks {
  sendSignal(value: unknown): boolean;
  onControl(value: Record<string, unknown>): void;
  onData(value: Uint8Array<ArrayBufferLike>): void;
  onDirectActive(): void;
  onActiveFailure(): void;
  onStatus(status: TerminalTransportStatus): void;
}

type BufferedMessage = Uint8Array<ArrayBufferLike> | string;

function applicationOnlySdp(description: RTCSessionDescriptionInit): boolean {
  if (typeof description.sdp !== "string" ||
    new TextEncoder().encode(description.sdp).byteLength > MAX_CONTROL_BYTES) return false;
  const mediaLines = description.sdp.split(/\r?\n/).filter((line) => line.startsWith("m="));
  return mediaLines.length === 1 && mediaLines[0]?.startsWith("m=application ") === true;
}

function messageBytes(value: BufferedMessage): number {
  return typeof value === "string"
    ? new TextEncoder().encode(value).byteLength
    : value.byteLength;
}

function waitForIceGathering(
  peer: RTCPeerConnection,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", changed);
      signal.removeEventListener("abort", aborted);
    };
    const completed = () => {
      cleanup();
      resolve();
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timeout = window.setTimeout(() => {
      failed(new Error("No direct ICE candidates were gathered in time."));
    }, timeoutMs);
    const changed = () => {
      if (peer.iceGatheringState !== "complete") return;
      completed();
    };
    const aborted = () => failed(new DOMException("WebRTC setup was cancelled.", "AbortError"));
    peer.addEventListener("icegatheringstatechange", changed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export class TerminalWebRtcUpgrade {
  private readonly callbacks: TerminalWebRtcCallbacks;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private phase: "idle" | "finding" | "switching" | "active" | "closed" = "idle";
  private attempt = 0;
  private attemptAbort: AbortController | null = null;
  private buffered: BufferedMessage[] = [];
  private bufferedBytes = 0;

  constructor(callbacks: TerminalWebRtcCallbacks) {
    this.callbacks = callbacks;
  }

  get active(): boolean {
    return this.phase === "active";
  }

  get canRetry(): boolean {
    return this.phase === "idle";
  }

  private resetPeer(): void {
    this.attempt += 1;
    this.attemptAbort?.abort();
    this.attemptAbort = null;
    const channel = this.channel;
    const peer = this.peer;
    this.channel = null;
    this.peer = null;
    this.buffered = [];
    this.bufferedBytes = 0;
    try {
      channel?.close();
    } catch {
      // A failed SCTP association may already have closed the channel.
    }
    try {
      peer?.close();
    } catch {
      // A failed ICE transport may already have closed the peer.
    }
  }

  private fail(activeFailure: boolean): void {
    if (this.phase === "closed") return;
    this.resetPeer();
    this.phase = "idle";
    if (activeFailure) {
      this.callbacks.onStatus("fallback");
      this.callbacks.onActiveFailure();
    } else {
      this.callbacks.onStatus("websocket");
    }
  }

  private queue(value: BufferedMessage): boolean {
    const size = messageBytes(value);
    if (this.bufferedBytes + size > MAX_BUFFERED_BYTES) {
      this.fail(true);
      return false;
    }
    this.buffered.push(value);
    this.bufferedBytes += size;
    return true;
  }

  private sendChannel(value: BufferedMessage): boolean {
    const channel = this.channel;
    if (!channel || channel.readyState !== "open" ||
      channel.bufferedAmount + messageBytes(value) > MAX_BUFFERED_BYTES) {
      this.fail(true);
      return false;
    }
    try {
      if (typeof value === "string") {
        channel.send(value);
      } else {
        channel.send(new Uint8Array(value).buffer);
      }
      return true;
    } catch {
      this.fail(true);
      return false;
    }
  }

  sendData(value: Uint8Array<ArrayBufferLike>): boolean {
    if (this.phase === "switching") {
      this.queue(value.slice());
      return true;
    }
    if (this.phase === "active") {
      this.sendChannel(value);
      return true;
    }
    return false;
  }

  sendControl(value: Record<string, unknown>): boolean {
    const serialized = JSON.stringify(value);
    if (messageBytes(serialized) > MAX_CONTROL_BYTES) return false;
    if (this.phase === "switching") {
      this.queue(serialized);
      return true;
    }
    if (this.phase === "active") {
      this.sendChannel(serialized);
      return true;
    }
    return false;
  }

  async start(configuration: TerminalWebRtcConfiguration): Promise<void> {
    if (this.phase !== "idle") return;
    if (typeof window.RTCPeerConnection !== "function") {
      this.callbacks.onStatus("websocket");
      return;
    }
    this.phase = "finding";
    this.callbacks.onStatus("finding");
    const attempt = ++this.attempt;
    const attemptAbort = new AbortController();
    this.attemptAbort = attemptAbort;
    try {
      const peer = new window.RTCPeerConnection({
        iceServers: configuration.iceServers.map(({ urls }) => ({ urls })),
      });
      const channel = peer.createDataChannel(TERMINAL_DATA_CHANNEL_LABEL, {
        ordered: true,
        protocol: TERMINAL_DATA_CHANNEL_PROTOCOL,
      });
      channel.binaryType = "arraybuffer";
      this.peer = peer;
      this.channel = channel;
      channel.addEventListener("message", (event) => this.handleChannelMessage(event));
      channel.addEventListener("close", () => {
        if (attempt === this.attempt) this.fail(this.phase === "active");
      });
      channel.addEventListener("error", () => {
        if (attempt === this.attempt) this.fail(this.phase === "active");
      });
      peer.addEventListener("connectionstatechange", () => {
        if (attempt !== this.attempt) return;
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          this.fail(this.phase === "active");
        }
      });
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIceGathering(peer, configuration.negotiationTimeoutMs, attemptAbort.signal);
      if (attempt !== this.attempt || this.phase !== "finding") return;
      const offer = peer.localDescription;
      if (!offer || offer.type !== "offer" || !applicationOnlySdp(offer)) {
        throw new Error("The browser created an invalid direct-path offer.");
      }
      const offerControl = { type: "webrtc-offer", offer: offer.toJSON() };
      if (messageBytes(JSON.stringify(offerControl)) > MAX_CONTROL_BYTES) {
        throw new Error("The browser WebRTC offer is too large.");
      }
      if (!this.callbacks.sendSignal(offerControl)) {
        throw new Error("The signaling WebSocket closed during direct-path setup.");
      }
    } catch {
      if (attempt === this.attempt) this.fail(false);
    }
  }

  handleSignal(control: Record<string, unknown>): boolean {
    if (control.type === "webrtc-unavailable") {
      if (this.phase === "finding" || this.phase === "switching") this.fail(false);
      return true;
    }
    if (control.type === "webrtc-answer") {
      if (this.phase !== "finding" || !this.peer) return true;
      const answer = control.answer as RTCSessionDescriptionInit | undefined;
      if (!answer || answer.type !== "answer" || !applicationOnlySdp(answer)) {
        this.fail(false);
        return true;
      }
      const attempt = this.attempt;
      void this.peer.setRemoteDescription(answer).catch(() => {
        if (attempt === this.attempt) this.fail(false);
      });
      return true;
    }
    if (control.type !== "webrtc-switch") return false;
    if (this.phase !== "finding" || this.channel?.readyState !== "open") {
      this.fail(false);
      return true;
    }
    this.phase = "switching";
    if (!this.callbacks.sendSignal({ type: "webrtc-activate" })) this.fail(false);
    return true;
  }

  private handleChannelMessage(event: MessageEvent): void {
    if (this.phase !== "switching" && this.phase !== "active") return;
    if (typeof event.data === "string") {
      if (messageBytes(event.data) > MAX_CONTROL_BYTES) {
        this.fail(this.phase === "active");
        return;
      }
      let control: Record<string, unknown>;
      try {
        control = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        this.fail(this.phase === "active");
        return;
      }
      if (this.phase === "switching") {
        if (control.type !== "ready" || control.transport !== "webrtc") {
          this.fail(false);
          return;
        }
        this.phase = "active";
        this.callbacks.onStatus("direct");
        this.callbacks.onDirectActive();
        const buffered = this.buffered;
        this.buffered = [];
        this.bufferedBytes = 0;
        for (const value of buffered) {
          if (!this.sendChannel(value)) return;
        }
        return;
      }
      this.callbacks.onControl(control);
      return;
    }
    if (this.phase !== "active" || !(event.data instanceof ArrayBuffer)) {
      this.fail(this.phase === "active");
      return;
    }
    this.callbacks.onData(new Uint8Array(event.data));
  }

  close(): void {
    if (this.phase === "closed") return;
    this.phase = "closed";
    this.resetPeer();
  }
}
