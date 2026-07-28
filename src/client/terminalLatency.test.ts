import { describe, expect, test } from "bun:test";

import {
  eligibleTerminalLatencyKey,
  normalizedTerminalKeyTimestamp,
  TerminalLatencyTracker,
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
    expect(tracker.canvasRendered(sampleId!, 125)).toEqual({
      lastMs: 35,
      p50Ms: 35,
      p95Ms: 35,
      sampleCount: 1,
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
    expect(tracker.canvasRendered(sampleId!, 240)?.lastMs).toBe(19);
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
    tracker.reset();
    tracker.keyEvent(keyEvent("c", { timeStamp: 4_000 }), 4_000);
    tracker.dataSent(4_001);
    const currentId = tracker.hostOutputReceived(4_010)!;
    expect(tracker.canvasRendered(staleId, 4_020)).toBeNull();
    expect(tracker.canvasRendered(currentId, 4_025)?.lastMs).toBe(25);
  });

  test("keeps bounded samples and reports nearest-rank percentiles", () => {
    const tracker = new TerminalLatencyTracker({ historyLimit: 3, quietWindowMs: 0 });
    completeSample(tracker, 0, 1, 10);
    completeSample(tracker, 20, 21, 50);
    completeSample(tracker, 60, 61, 80);
    const summary = completeSample(tracker, 90, 91, 130);
    expect(summary).toEqual({
      lastMs: 40,
      p50Ms: 30,
      p95Ms: 40,
      sampleCount: 3,
    });
  });
});
