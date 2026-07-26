import { describe, expect, test } from "bun:test";
import type { CodexEvent } from "../shared/contracts.ts";
import { eventPresentation } from "./CodexCommentsPanel.tsx";

function event(overrides: Partial<CodexEvent>): CodexEvent {
  return {
    sequence: 1,
    type: "notification",
    threadId: "thread-1",
    turnId: "turn-1",
    ...overrides,
  };
}

describe("Codex activity presentation", () => {
  test("hides protocol bookkeeping while preserving command output", () => {
    expect(eventPresentation(event({ method: "thread/tokenUsage/updated" }))).toBeNull();
    expect(eventPresentation(event({ method: "turn/diff/updated" }))).toBeNull();
    expect(eventPresentation(event({ method: "item/completed", data: { item: { type: "reasoning", id: "item-1" } } }))).toBeNull();
    expect(eventPresentation(event({ method: "item/commandExecution/outputDelta", data: { delta: "Production build\n" } }))).toEqual({
      kind: "output",
      text: "Production build\n",
    });
  });

  test("turns command lifecycle items into readable progress", () => {
    expect(eventPresentation(event({
      method: "item/started",
      data: { item: { type: "commandExecution", id: "item-1", command: "git diff --check" } },
    }))).toEqual({ kind: "command", command: "git diff --check", status: "running" });
    expect(eventPresentation(event({
      method: "item/completed",
      data: { item: { type: "commandExecution", id: "item-1", command: "git diff --check", status: "completed" } },
    }))).toEqual({ kind: "command", command: "git diff --check", status: "completed" });
  });
});
