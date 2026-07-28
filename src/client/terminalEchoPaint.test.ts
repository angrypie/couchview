import { describe, expect, test } from "bun:test";

import { TerminalEchoPaintController } from "./terminalEchoPaint.ts";

describe("terminal echo paint optimization", () => {
  test("renders only the first host output after accepted input", () => {
    const controller = new TerminalEchoPaintController();
    const renders: string[] = [];

    controller.beginInput();
    expect(controller.renderFirstOutput(() => renders.push("echo"))).toBe(true);
    expect(controller.renderFirstOutput(() => renders.push("bulk"))).toBe(false);
    expect(renders).toEqual(["echo"]);
  });

  test("does not render immediately when the input was rejected", () => {
    const controller = new TerminalEchoPaintController();
    const token = controller.beginInput();

    controller.rejectInput(token);

    expect(controller.renderFirstOutput(() => {
      throw new Error("unexpected render");
    })).toBe(false);
  });

  test("does not let an older rejection clear newer input", () => {
    const controller = new TerminalEchoPaintController();
    const olderToken = controller.beginInput();
    controller.beginInput();

    controller.rejectInput(olderToken);

    expect(controller.renderFirstOutput(() => {})).toBe(true);
  });

  test("restores an older accepted input when newer input is rejected", () => {
    const controller = new TerminalEchoPaintController();
    controller.beginInput();
    const rejectedToken = controller.beginInput();

    controller.rejectInput(rejectedToken);

    expect(controller.renderFirstOutput(() => {})).toBe(true);
  });

  test("clears the marker before rendering", () => {
    const controller = new TerminalEchoPaintController();
    controller.beginInput();

    expect(() => controller.renderFirstOutput(() => {
      throw new Error("render failed");
    })).toThrow("render failed");
    expect(controller.renderFirstOutput(() => {})).toBe(false);
  });

  test("reset discards pending input", () => {
    const controller = new TerminalEchoPaintController();
    controller.beginInput();

    controller.reset();

    expect(controller.renderFirstOutput(() => {})).toBe(false);
  });
});
