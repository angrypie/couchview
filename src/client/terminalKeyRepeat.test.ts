import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { installTerminalKeyRepeat } from "./terminalKeyRepeat.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const disposals: Array<() => void> = [];

function keyboardEvent(type: "keydown" | "keyup", options: KeyboardEventInit): KeyboardEvent {
	return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options });
}

function terminalHost(): HTMLDivElement {
	const container = document.createElement("div");
	container.setAttribute("contenteditable", "true");
	document.body.appendChild(container);
	disposals.push(installTerminalKeyRepeat(container));
	return container;
}

afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
	document.body.replaceChildren();
});

describe("terminal key repeat", () => {
	test("keeps the host non-editable while native printable repeats are arriving", () => {
		const container = terminalHost();
		const received: Array<{ editable: string | null; repeat: boolean }> = [];
		container.addEventListener("keydown", (event) => {
			received.push({
				editable: container.getAttribute("contenteditable"),
				repeat: event.repeat,
			});
		});

		container.dispatchEvent(
			keyboardEvent("keydown", {
				code: "KeyU",
				key: "u",
			}),
		);
		container.dispatchEvent(
			keyboardEvent("keydown", {
				code: "KeyU",
				key: "u",
				repeat: true,
			}),
		);

		expect(received).toEqual([
			{ editable: "false", repeat: false },
			{ editable: "false", repeat: true },
		]);
		expect(container.getAttribute("contenteditable")).toBe("false");

		container.dispatchEvent(
			keyboardEvent("keyup", {
				code: "KeyU",
				key: "u",
			}),
		);
		expect(container.getAttribute("contenteditable")).toBe("true");
	});

	test("does not interfere with shortcuts, dead keys, or composition", () => {
		const container = terminalHost();
		const ignoredEvents: KeyboardEventInit[] = [
			{ code: "KeyC", key: "c", metaKey: true },
			{ code: "KeyE", key: "Dead", altKey: true },
			{ code: "KeyA", key: "a", isComposing: true },
		];

		for (const options of ignoredEvents) {
			container.dispatchEvent(keyboardEvent("keydown", options));
			expect(container.getAttribute("contenteditable")).toBe("true");
		}
	});

	test("restores editable input when focus leaves during a held key", () => {
		const container = terminalHost();
		container.dispatchEvent(
			keyboardEvent("keydown", {
				code: "KeyU",
				key: "u",
			}),
		);
		expect(container.getAttribute("contenteditable")).toBe("false");

		window.dispatchEvent(new Event("blur"));
		expect(container.getAttribute("contenteditable")).toBe("true");
	});
});
