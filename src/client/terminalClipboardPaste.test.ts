import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { installTerminalClipboardPaste } from "./terminalClipboardPaste.ts";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

function keydown(options: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

describe("terminal clipboard paste", () => {
  test("pastes with Command on Apple platforms and Control elsewhere", async () => {
    const cases = [
      { isApplePlatform: true, event: { code: "KeyV", key: "v", metaKey: true } },
      { isApplePlatform: false, event: { code: "KeyV", key: "v", ctrlKey: true } },
    ];

    for (const testCase of cases) {
      const container = document.createElement("div");
      const pasted: string[] = [];
      let terminalKeyEvents = 0;
      container.addEventListener("keydown", () => {
        terminalKeyEvents += 1;
      });
      const dispose = installTerminalClipboardPaste(container, {
        isApplePlatform: testCase.isApplePlatform,
        readText: () => Promise.resolve("one\ntwo"),
        onPaste: (text) => pasted.push(text),
      });

      const event = keydown(testCase.event);
      container.dispatchEvent(event);
      await Promise.resolve();

      expect(event.defaultPrevented).toBe(true);
      expect(terminalKeyEvents).toBe(0);
      expect(pasted).toEqual(["one\ntwo"]);
      dispose();
    }
  });

  test("leaves native paste shortcuts and unrelated keys unchanged", async () => {
    const cases: Array<{ isApplePlatform: boolean; event: KeyboardEventInit }> = [
      { isApplePlatform: true, event: { code: "KeyV", key: "v", ctrlKey: true } },
      { isApplePlatform: true, event: { code: "KeyV", key: "V", metaKey: true, shiftKey: true } },
      { isApplePlatform: false, event: { code: "KeyV", key: "v", metaKey: true } },
      { isApplePlatform: false, event: { code: "KeyC", key: "c", ctrlKey: true } },
    ];

    for (const testCase of cases) {
      const container = document.createElement("div");
      let reads = 0;
      installTerminalClipboardPaste(container, {
        isApplePlatform: testCase.isApplePlatform,
        readText: async () => {
          reads += 1;
          return "clipboard";
        },
        onPaste: () => undefined,
      });
      const event = keydown(testCase.event);
      container.dispatchEvent(event);
      await Promise.resolve();
      expect(event.defaultPrevented).toBe(false);
      expect(reads).toBe(0);
    }
  });

  test("consumes the shortcut without inserting anything when clipboard access fails", async () => {
    const container = document.createElement("div");
    const pasted: string[] = [];
    installTerminalClipboardPaste(container, {
      isApplePlatform: true,
      readText: () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
      onPaste: (text) => pasted.push(text),
    });

    const event = keydown({ code: "KeyV", key: "v", metaKey: true });
    container.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(pasted).toEqual([]);
  });
});
