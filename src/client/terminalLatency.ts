export interface TerminalLatencySummary {
  lastMs: number;
  p50Ms: number;
  p95Ms: number;
  sampleCount: number;
}

export interface TerminalKeyLatencySummary {
  total: TerminalLatencySummary;
  pressToSend: TerminalLatencySummary;
  sendToReceive: TerminalLatencySummary;
  receiveToPaint: TerminalLatencySummary;
  receiveToWrite: TerminalLatencySummary;
  writeToRender: TerminalLatencySummary;
  renderDuration: TerminalLatencySummary;
}

export interface TerminalLatencyKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
  timeStamp: number;
}

interface TerminalLatencyTrackerOptions {
  historyLimit?: number;
  quietWindowMs?: number;
  sampleTimeoutMs?: number;
}

interface TerminalRoundTripTrackerOptions {
  historyLimit?: number;
  sampleTimeoutMs?: number;
}

interface PendingKey {
  startedAt: number;
}

interface ActiveSample extends PendingKey {
  id: number;
  sentAt: number;
  responseAt: number | null;
  writeCompletedAt: number | null;
  renderStartedAt: number | null;
}

interface CompletedKeySample {
  total: number;
  pressToSend: number;
  sendToReceive: number;
  receiveToPaint: number;
  receiveToWrite: number;
  writeToRender: number;
  renderDuration: number;
}

const DEFAULT_HISTORY_LIMIT = 200;
const DEFAULT_QUIET_WINDOW_MS = 100;
const DEFAULT_SAMPLE_TIMEOUT_MS = 2_000;
const DEFAULT_PING_TIMEOUT_MS = 5_000;
const MAX_EVENT_TIMESTAMP_DISTANCE_MS = 60_000;

function roundedMilliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index] ?? 0;
}

function summarizeLatencySamples(samples: readonly number[]): TerminalLatencySummary | null {
  const last = samples.at(-1);
  if (last === undefined) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    lastMs: roundedMilliseconds(last),
    p50Ms: roundedMilliseconds(percentile(sorted, 0.5)),
    p95Ms: roundedMilliseconds(percentile(sorted, 0.95)),
    sampleCount: samples.length,
  };
}

function summarizeKeySamples(
  samples: readonly CompletedKeySample[],
): TerminalKeyLatencySummary | null {
  if (samples.length === 0) return null;
  return {
    total: summarizeLatencySamples(samples.map((sample) => sample.total))!,
    pressToSend: summarizeLatencySamples(samples.map((sample) => sample.pressToSend))!,
    sendToReceive: summarizeLatencySamples(samples.map((sample) => sample.sendToReceive))!,
    receiveToPaint: summarizeLatencySamples(samples.map((sample) => sample.receiveToPaint))!,
    receiveToWrite: summarizeLatencySamples(samples.map((sample) => sample.receiveToWrite))!,
    writeToRender: summarizeLatencySamples(samples.map((sample) => sample.writeToRender))!,
    renderDuration: summarizeLatencySamples(samples.map((sample) => sample.renderDuration))!,
  };
}

export function terminalLatencyEnabled(search: string): boolean {
  return new URLSearchParams(search).get("terminalLatency") === "1";
}

export function eligibleTerminalLatencyKey(event: TerminalLatencyKeyEvent): boolean {
  return !event.altKey &&
    !event.ctrlKey &&
    !event.isComposing &&
    !event.metaKey &&
    !event.repeat &&
    event.key !== "Dead" &&
    event.key.length === 1;
}

export function normalizedTerminalKeyTimestamp(eventTimeStamp: number, now: number): number {
  if (
    Number.isFinite(eventTimeStamp) &&
    eventTimeStamp >= 0 &&
    eventTimeStamp <= now &&
    now - eventTimeStamp <= MAX_EVENT_TIMESTAMP_DISTANCE_MS
  ) {
    return eventTimeStamp;
  }
  return now;
}

export class TerminalLatencyTracker {
  private readonly historyLimit: number;
  private readonly quietWindowMs: number;
  private readonly sampleTimeoutMs: number;
  private readonly samples: CompletedKeySample[] = [];
  private pendingKey: PendingKey | null = null;
  private activeSample: ActiveSample | null = null;
  private lastHostOutputAt = Number.NEGATIVE_INFINITY;
  private blockedUntil = Number.NEGATIVE_INFINITY;
  private nextSampleId = 1;

  constructor(options: TerminalLatencyTrackerOptions = {}) {
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.quietWindowMs = options.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
    this.sampleTimeoutMs = options.sampleTimeoutMs ?? DEFAULT_SAMPLE_TIMEOUT_MS;
  }

  keyEvent(event: TerminalLatencyKeyEvent, now: number): void {
    this.expirePending(now);
    if (!eligibleTerminalLatencyKey(event)) return;
    if (
      this.pendingKey ||
      this.activeSample ||
      now < this.blockedUntil ||
      now - this.lastHostOutputAt < this.quietWindowMs
    ) {
      this.rejectPending(now);
      return;
    }
    this.pendingKey = {
      startedAt: normalizedTerminalKeyTimestamp(event.timeStamp, now),
    };
  }

  dataSent(now: number): void {
    this.expirePending(now);
    if (this.activeSample) {
      this.rejectPending(now);
      return;
    }
    if (!this.pendingKey) {
      this.blockedUntil = Math.max(this.blockedUntil, now + this.quietWindowMs);
      return;
    }
    this.activeSample = {
      ...this.pendingKey,
      id: this.nextSampleId++,
      sentAt: now,
      responseAt: null,
      writeCompletedAt: null,
      renderStartedAt: null,
    };
    this.pendingKey = null;
  }

  hostOutputReceived(now: number): number | null {
    this.expirePending(now);
    this.lastHostOutputAt = now;
    if (!this.activeSample || this.activeSample.responseAt !== null) return null;
    this.activeSample.responseAt = now;
    return this.activeSample.id;
  }

  terminalWriteCompleted(sampleId: number, now: number): void {
    this.expirePending(now);
    if (
      !this.activeSample ||
      this.activeSample.id !== sampleId ||
      this.activeSample.responseAt === null ||
      this.activeSample.writeCompletedAt !== null
    ) {
      return;
    }
    this.activeSample.writeCompletedAt = now;
  }

  canvasRenderStarted(sampleId: number, now: number): void {
    this.expirePending(now);
    if (
      !this.activeSample ||
      this.activeSample.id !== sampleId ||
      this.activeSample.writeCompletedAt === null ||
      this.activeSample.renderStartedAt !== null
    ) {
      return;
    }
    this.activeSample.renderStartedAt = now;
  }

  canvasRendered(sampleId: number, now: number): TerminalKeyLatencySummary | null {
    this.expirePending(now);
    if (
      !this.activeSample ||
      this.activeSample.id !== sampleId ||
      this.activeSample.responseAt === null ||
      this.activeSample.writeCompletedAt === null ||
      this.activeSample.renderStartedAt === null
    ) {
      return null;
    }
    const responseAt = this.activeSample.responseAt;
    const writeCompletedAt = this.activeSample.writeCompletedAt;
    const renderStartedAt = this.activeSample.renderStartedAt;
    this.samples.push({
      total: Math.max(0, now - this.activeSample.startedAt),
      pressToSend: Math.max(0, this.activeSample.sentAt - this.activeSample.startedAt),
      sendToReceive: Math.max(0, responseAt - this.activeSample.sentAt),
      receiveToPaint: Math.max(0, now - responseAt),
      receiveToWrite: Math.max(0, writeCompletedAt - responseAt),
      writeToRender: Math.max(0, renderStartedAt - writeCompletedAt),
      renderDuration: Math.max(0, now - renderStartedAt),
    });
    if (this.samples.length > this.historyLimit) this.samples.shift();
    this.activeSample = null;
    return this.summary();
  }

  cancelPending(now?: number): void {
    this.pendingKey = null;
    this.activeSample = null;
    if (now !== undefined) {
      this.blockedUntil = Math.max(this.blockedUntil, now + this.quietWindowMs);
    }
  }

  reset(): void {
    this.cancelPending();
    this.samples.length = 0;
    this.lastHostOutputAt = Number.NEGATIVE_INFINITY;
    this.blockedUntil = Number.NEGATIVE_INFINITY;
  }

  summary(): TerminalKeyLatencySummary | null {
    return summarizeKeySamples(this.samples);
  }

  private expirePending(now: number): void {
    const startedAt = this.activeSample?.startedAt ?? this.pendingKey?.startedAt;
    if (startedAt !== undefined && now - startedAt > this.sampleTimeoutMs) {
      this.cancelPending();
    }
  }

  private rejectPending(now: number): void {
    this.cancelPending(now);
  }
}

export class TerminalRoundTripTracker {
  private readonly historyLimit: number;
  private readonly sampleTimeoutMs: number;
  private readonly samples: number[] = [];
  private pending: { id: number; startedAt: number } | null = null;

  constructor(options: TerminalRoundTripTrackerOptions = {}) {
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.sampleTimeoutMs = options.sampleTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  }

  start(id: number, now: number): boolean {
    this.expirePending(now);
    if (this.pending) return false;
    this.pending = { id, startedAt: now };
    return true;
  }

  pong(id: number, now: number): TerminalLatencySummary | null {
    this.expirePending(now);
    if (!this.pending || this.pending.id !== id) return null;
    this.samples.push(Math.max(0, now - this.pending.startedAt));
    if (this.samples.length > this.historyLimit) this.samples.shift();
    this.pending = null;
    return this.summary();
  }

  cancelPending(): void {
    this.pending = null;
  }

  reset(): void {
    this.cancelPending();
    this.samples.length = 0;
  }

  summary(): TerminalLatencySummary | null {
    return summarizeLatencySamples(this.samples);
  }

  private expirePending(now: number): void {
    if (this.pending && now - this.pending.startedAt > this.sampleTimeoutMs) {
      this.pending = null;
    }
  }
}
