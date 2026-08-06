import { expect, test } from "bun:test";
import vm from "node:vm";

import { createNativeSurfaceScript } from "./nativeSurfaceBridge.ts";

interface NativeAction {
	actionId: string;
	args: unknown[];
}

function runBridge(themePreference: "system" | "light" | "dark", existingTheme?: string) {
	const attributes = new Map<string, string>();
	if (existingTheme) attributes.set("data-theme-preference", existingTheme);
	const actions: NativeAction[] = [];
	let notifyMutation = () => undefined;
	class FakeMutationObserver {
		constructor(callback: () => void) {
			notifyMutation = callback;
		}

		observe() {}
	}
	const documentElement = {
		getAttribute: (name: string) => attributes.get(name) ?? null,
		setAttribute: (name: string, value: string) => attributes.set(name, value),
	};
	const document = {
		addEventListener: () => undefined,
		documentElement,
		readyState: "complete",
	};
	const window = {
		ReactNativeWebView: {
			postMessage(message: string) {
				const payload = JSON.parse(message) as {
					data: NativeAction;
				};
				actions.push(payload.data);
			},
		},
	};
	vm.runInNewContext(createNativeSurfaceScript(themePreference), {
		document,
		MutationObserver: FakeMutationObserver,
		window,
	});
	return {
		actions,
		attributes,
		setThemePreference(value: string) {
			attributes.set("data-theme-preference", value);
			notifyMutation();
		},
	};
}

test("native surface bridge seeds an unset hosted theme before reporting ready", () => {
	const result = runBridge("dark");
	expect(result.attributes.get("data-theme-preference")).toBe("dark");
	expect(result.actions.map(({ actionId, args }) => ({ actionId, args }))).toEqual([
		{ actionId: "onSurfaceReady", args: [] },
	]);
});

test("native surface bridge adopts an existing hosted theme preference", () => {
	const result = runBridge("dark", "light");
	expect(result.actions.map(({ actionId, args }) => ({ actionId, args }))).toEqual([
		{ actionId: "onThemePreferenceChange", args: ["light"] },
		{ actionId: "onSurfaceReady", args: [] },
	]);
});

test("native surface bridge mirrors hosted theme preference changes without reloading", () => {
	const result = runBridge("system", "light");
	result.setThemePreference("dark");
	expect(result.actions.at(-1)).toMatchObject({
		actionId: "onThemePreferenceChange",
		args: ["dark"],
	});
});
