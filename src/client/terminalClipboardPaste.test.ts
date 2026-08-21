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
	test("preserves native paste with Command on Apple platforms and Control elsewhere", () => {
		const cases = [
			{ isApplePlatform: true, event: { code: "KeyK", key: "v", metaKey: true } },
			{ isApplePlatform: false, event: { code: "KeyK", key: "v", ctrlKey: true } },
		];

		for (const testCase of cases) {
			const container = document.createElement("div");
			let terminalKeyEvents = 0;
			container.addEventListener("keydown", () => {
				terminalKeyEvents += 1;
			});
			const dispose = installTerminalClipboardPaste(container, {
				isApplePlatform: testCase.isApplePlatform,
			});

			const event = keydown(testCase.event);
			container.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(false);
			expect(terminalKeyEvents).toBe(0);
			dispose();
		}
	});

	test("uses the typed character instead of the physical keyboard position", () => {
		const cases: Array<{ isApplePlatform: boolean; event: KeyboardEventInit }> = [
			{ isApplePlatform: true, event: { code: "KeyV", key: "v", ctrlKey: true } },
			{ isApplePlatform: true, event: { code: "KeyV", key: "V", metaKey: true, shiftKey: true } },
			{ isApplePlatform: false, event: { code: "KeyV", key: "v", metaKey: true } },
			{ isApplePlatform: false, event: { code: "KeyC", key: "c", ctrlKey: true } },
			{ isApplePlatform: true, event: { code: "KeyV", key: "x", metaKey: true } },
		];

		for (const testCase of cases) {
			const container = document.createElement("div");
			let terminalKeyEvents = 0;
			container.addEventListener("keydown", () => {
				terminalKeyEvents += 1;
			});
			installTerminalClipboardPaste(container, {
				isApplePlatform: testCase.isApplePlatform,
			});
			const event = keydown(testCase.event);
			container.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
			expect(terminalKeyEvents).toBe(1);
		}
	});

	test("removes the keyboard interception when disposed", () => {
		const container = document.createElement("div");
		let terminalKeyEvents = 0;
		container.addEventListener("keydown", () => {
			terminalKeyEvents += 1;
		});
		const dispose = installTerminalClipboardPaste(container, {
			isApplePlatform: true,
		});
		dispose();

		container.dispatchEvent(keydown({ code: "KeyK", key: "v", metaKey: true }));

		expect(terminalKeyEvents).toBe(1);
	});
});
