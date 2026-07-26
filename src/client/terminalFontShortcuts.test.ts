import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { installTerminalFontShortcuts } from "./terminalFontShortcuts.ts";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const disposals: Array<() => void> = [];

function keydown(options: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

function terminalHost(
  initialFontSize = 15,
  isApplePlatform = false,
): { container: HTMLDivElement; fontSizes: number[] } {
  const container = document.createElement("div");
  const fontSizes: number[] = [];
  document.body.appendChild(container);
  disposals.push(installTerminalFontShortcuts(container, {
    initialFontSize,
    isApplePlatform,
    onFontSizeChange: (fontSize) => fontSizes.push(fontSize),
  }));
  return { container, fontSizes };
}

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
});

describe("terminal font shortcuts", () => {
  test("changes and resets only the terminal font while consuming browser zoom", () => {
    const { container, fontSizes } = terminalHost();
    let terminalKeyEvents = 0;
    container.addEventListener("keydown", () => {
      terminalKeyEvents += 1;
    });

    const increase = keydown({ code: "Equal", key: "+", ctrlKey: true, shiftKey: true });
    container.dispatchEvent(increase);
    expect(increase.defaultPrevented).toBe(true);
    expect(fontSizes).toEqual([16]);
    expect(terminalKeyEvents).toBe(0);

    container.dispatchEvent(keydown({ code: "Minus", key: "-", ctrlKey: true }));
    container.dispatchEvent(keydown({ code: "Minus", key: "-", ctrlKey: true }));
    container.dispatchEvent(keydown({ code: "Digit0", key: "0", ctrlKey: true }));
    expect(fontSizes).toEqual([16, 15, 14, 15]);
    expect(terminalKeyEvents).toBe(0);
  });

  test("uses Command on Apple platforms and leaves Control available to tmux", () => {
    const { container, fontSizes } = terminalHost(15, true);
    let terminalKeyEvents = 0;
    container.addEventListener("keydown", () => {
      terminalKeyEvents += 1;
    });

    const commandIncrease = keydown({ code: "Equal", key: "+", metaKey: true });
    container.dispatchEvent(commandIncrease);
    expect(commandIncrease.defaultPrevented).toBe(true);
    expect(fontSizes).toEqual([16]);
    expect(terminalKeyEvents).toBe(0);

    container.dispatchEvent(keydown({ code: "Minus", key: "-", ctrlKey: true }));
    expect(fontSizes).toEqual([16]);
    expect(terminalKeyEvents).toBe(1);
  });

  test("leaves unrelated, modified, and composing keys available to the terminal", () => {
    const { container, fontSizes } = terminalHost();
    let terminalKeyEvents = 0;
    container.addEventListener("keydown", () => {
      terminalKeyEvents += 1;
    });

    for (const options of [
      { code: "Equal", key: "=", ctrlKey: false },
      { code: "Equal", key: "=", ctrlKey: true, metaKey: true },
      { code: "Equal", key: "=", ctrlKey: true, altKey: true },
      { code: "Equal", key: "=", ctrlKey: true, isComposing: true },
      { code: "KeyC", key: "c", ctrlKey: true },
    ]) {
      container.dispatchEvent(keydown(options));
    }

    expect(fontSizes).toEqual([]);
    expect(terminalKeyEvents).toBe(5);
  });

  test("bounds repeated changes to supported Ghostty sizes", () => {
    const { container, fontSizes } = terminalHost(71);
    for (let index = 0; index < 5; index += 1) {
      container.dispatchEvent(keydown({ code: "NumpadAdd", key: "+", ctrlKey: true }));
    }
    expect(fontSizes).toEqual([72]);

    for (let index = 0; index < 70; index += 1) {
      container.dispatchEvent(keydown({
        code: "NumpadSubtract",
        key: "-",
        ctrlKey: true,
      }));
    }
    expect(fontSizes.at(-1)).toBe(6);
  });
});
