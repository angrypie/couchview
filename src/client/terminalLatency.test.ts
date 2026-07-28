import { describe, expect, test } from "bun:test";

import {
  eligibleTerminalLatencyKey,
  normalizedTerminalKeyTimestamp,
  TerminalLatencyTracker,
  TerminalRoundTripTracker,
  terminalLatencyEnabled,
  type TerminalLatencyKeyEvent,
} from "./terminalLatency.ts";

function keyEvent(
  key: string,
  overrides: Partial<TerminalLatencyKeyEvent> = {},
): TerminalLatencyKeyEvent {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key,
    metaKey: false,
    repeat: false,
    timeStamp: 0,
    ...overrides,
  };
}

function completeSample(
  tracker: TerminalLatencyTracker,
  startedAt: number,
  responseAt: number,
  renderedAt: number,
) {
  tracker.keyEvent(keyEvent("x", { timeStamp: startedAt }), startedAt);
  tracker.dataSent(startedAt + 1);
  const sampleId = tracker.hostOutputReceived(responseAt);
  expect(sampleId).not.toBeNull();
  tracker.terminalWriteCompleted(sampleId!, responseAt);
  tracker.canvasRenderStarted(sampleId!, renderedAt);
  return tracker.canvasRendered(sampleId!, renderedAt);
}

describe("terminal key-to-canvas latency", () => {
  test("enables only for the explicit query value", () => {
    expect(terminalLatencyEnabled("?terminalLatency=1")).toBe(true);
    expect(terminalLatencyEnabled("?repo=one&terminalLatency=1")).toBe(true);
    expect(terminalLatencyEnabled("?terminalLatency=true")).toBe(false);
    expect(terminalLatencyEnabled("")).toBe(false);
  });

  test("normalizes compatible event timestamps and rejects unrelated clock origins", () => {
    expect(normalizedTerminalKeyTimestamp(92.5, 100)).toBe(92.5);
    expect(normalizedTerminalKeyTimestamp(101, 100)).toBe(100);
    expect(normalizedTerminalKeyTimestamp(Date.now(), 100)).toBe(100);
    expect(normalizedTerminalKeyTimestamp(Number.NaN, 100)).toBe(100);
  });

  test("accepts only printable unmodified physical key presses", () => {
    expect(eligibleTerminalLatencyKey(keyEvent("a"))).toBe(true);
    expect(eligibleTerminalLatencyKey(keyEvent("A"))).toBe(true);
    expect(eligibleTerminalLatencyKey(keyEvent("Enter"))).toBe(false);
    expect(eligibleTerminalLatencyKey(keyEvent("Dead"))).toBe(false);
    expect(eligibleTerminalLatencyKey(keyEvent("a", { repeat: true }))).toBe(false);
    expect(eligibleTerminalLatencyKey(keyEvent("a", { isComposing: true }))).toBe(false);
    expect(eligibleTerminalLatencyKey(keyEvent("a", { ctrlKey: true }))).toBe(false);
    expect(eligibleTerminalLatencyKey(keyEvent("a", { altKey: true }))).toBe(false);
    expect(eligibleTerminalLatencyKey(keyEvent("a", { metaKey: true }))).toBe(false);
  });

  test("measures from the DOM event timestamp through the matching canvas render", () => {
    const tracker = new TerminalLatencyTracker();
    tracker.keyEvent(keyEvent("x", { timeStamp: 90 }), 100);
    tracker.dataSent(101);
    const sampleId = tracker.hostOutputReceived(112);
    expect(sampleId).not.toBeNull();
    tracker.terminalWriteCompleted(sampleId!, 115);
    tracker.canvasRenderStarted(sampleId!, 122);
    expect(tracker.canvasRendered(sampleId!, 125)).toEqual({
      total: { lastMs: 35, p50Ms: 35, p95Ms: 35, sampleCount: 1 },
      pressToSend: { lastMs: 11, p50Ms: 11, p95Ms: 11, sampleCount: 1 },
      sendToReceive: { lastMs: 11, p50Ms: 11, p95Ms: 11, sampleCount: 1 },
      receiveToPaint: { lastMs: 13, p50Ms: 13, p95Ms: 13, sampleCount: 1 },
      receiveToWrite: { lastMs: 3, p50Ms: 3, p95Ms: 3, sampleCount: 1 },
      writeToRender: { lastMs: 7, p50Ms: 7, p95Ms: 7, sampleCount: 1 },
      renderDuration: { lastMs: 3, p50Ms: 3, p95Ms: 3, sampleCount: 1 },
    });
  });

  test("requires a quiet host-output window before accepting a key", () => {
    const tracker = new TerminalLatencyTracker();
    expect(tracker.hostOutputReceived(10)).toBeNull();
    tracker.keyEvent(keyEvent("x", { timeStamp: 109 }), 109);
    tracker.dataSent(110);
    expect(tracker.hostOutputReceived(120)).toBeNull();

    tracker.keyEvent(keyEvent("x", { timeStamp: 221 }), 221);
    tracker.dataSent(222);
    const sampleId = tracker.hostOutputReceived(230);
    expect(sampleId).not.toBeNull();
    tracker.terminalWriteCompleted(sampleId!, 232);
    tracker.canvasRenderStarted(sampleId!, 238);
    expect(tracker.canvasRendered(sampleId!, 240)?.total.lastMs).toBe(19);
  });

  test("discards overlapping input and ignores its later host response", () => {
    const tracker = new TerminalLatencyTracker();
    tracker.keyEvent(keyEvent("a"), 0);
    tracker.dataSent(1);
    tracker.keyEvent(keyEvent("b", { timeStamp: 5 }), 5);
    tracker.dataSent(6);
    expect(tracker.hostOutputReceived(20)).toBeNull();
    expect(tracker.summary()).toBeNull();
  });

  test("expires slow samples and rejects stale canvas callbacks", () => {
    const tracker = new TerminalLatencyTracker({ quietWindowMs: 0 });
    tracker.keyEvent(keyEvent("a"), 0);
    tracker.dataSent(1);
    expect(tracker.hostOutputReceived(2_001)).toBeNull();

    tracker.keyEvent(keyEvent("b", { timeStamp: 3_000 }), 3_000);
    tracker.dataSent(3_001);
    const staleId = tracker.hostOutputReceived(3_010)!;
    tracker.terminalWriteCompleted(staleId, 3_011);
    tracker.canvasRenderStarted(staleId, 3_012);
    tracker.reset();
    tracker.keyEvent(keyEvent("c", { timeStamp: 4_000 }), 4_000);
    tracker.dataSent(4_001);
    const currentId = tracker.hostOutputReceived(4_010)!;
    tracker.terminalWriteCompleted(currentId, 4_011);
    tracker.canvasRenderStarted(currentId, 4_020);
    expect(tracker.canvasRendered(staleId, 4_020)).toBeNull();
    expect(tracker.canvasRendered(currentId, 4_025)?.total.lastMs).toBe(25);
  });

  test("keeps bounded samples and reports nearest-rank percentiles", () => {
    const tracker = new TerminalLatencyTracker({ historyLimit: 3, quietWindowMs: 0 });
    completeSample(tracker, 0, 1, 10);
    completeSample(tracker, 20, 21, 50);
    completeSample(tracker, 60, 61, 80);
    const summary = completeSample(tracker, 90, 91, 130);
    expect(summary?.total).toEqual({
      lastMs: 40,
      p50Ms: 30,
      p95Ms: 40,
      sampleCount: 3,
    });
    expect(summary?.pressToSend).toEqual({
      lastMs: 1,
      p50Ms: 1,
      p95Ms: 1,
      sampleCount: 3,
    });
    expect(summary?.sendToReceive.sampleCount).toBe(3);
    expect(summary?.receiveToPaint).toEqual({
      lastMs: 39,
      p50Ms: 29,
      p95Ms: 39,
      sampleCount: 3,
    });
    expect(summary?.receiveToWrite.sampleCount).toBe(3);
    expect(summary?.writeToRender.sampleCount).toBe(3);
    expect(summary?.renderDuration.sampleCount).toBe(3);
  });

  test("tracks bounded server round trips and ignores stale or mismatched pongs", () => {
    const tracker = new TerminalRoundTripTracker({ historyLimit: 2, sampleTimeoutMs: 100 });
    expect(tracker.start(1, 0)).toBe(true);
    expect(tracker.start(2, 10)).toBe(false);
    expect(tracker.pong(2, 20)).toBeNull();
    expect(tracker.pong(1, 30)?.lastMs).toBe(30);

    expect(tracker.start(2, 40)).toBe(true);
    expect(tracker.pong(2, 60)?.p50Ms).toBe(20);
    expect(tracker.start(3, 70)).toBe(true);
    expect(tracker.pong(3, 110)).toEqual({
      lastMs: 40,
      p50Ms: 20,
      p95Ms: 40,
      sampleCount: 2,
    });

    expect(tracker.start(4, 200)).toBe(true);
    expect(tracker.start(5, 301)).toBe(true);
    expect(tracker.pong(4, 310)).toBeNull();
    tracker.reset();
    expect(tracker.summary()).toBeNull();
  });
});
