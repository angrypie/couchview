import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { NativePreferences } from "./types.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

interface ThemeWrite {
	preference: string;
	transition?: { preset: number };
}

const REDUCED_MOTION_EVENT = "reduceMotionChanged";
let reducedMotionEnabled = false;
const reducedMotionListeners = new Set<(enabled: boolean) => void>();
mock.module("react-native", () => ({
	AccessibilityInfo: {
		addEventListener(event: string, listener: (enabled: boolean) => void) {
			if (event === REDUCED_MOTION_EVENT) reducedMotionListeners.add(listener);
			return { remove: () => reducedMotionListeners.delete(listener) };
		},
		isReduceMotionEnabled: async () => reducedMotionEnabled,
	},
}));

const themeWrites: ThemeWrite[] = [];
mock.module("uniwind", () => ({
	ThemeTransitionPreset: {
		Fade: 1,
		None: 0,
	},
	Uniwind: {
		setTheme(preference: string, transition?: { preset: number }) {
			themeWrites.push({ preference, transition });
		},
	},
	useUniwind: () => ({ hasAdaptiveThemes: true, theme: "dark" }),
}));

let resolveLoad: ((preferences: NativePreferences) => void) | null = null;
const loadPromise = new Promise<NativePreferences>((resolve) => {
	resolveLoad = resolve;
});
const savedPreferences: NativePreferences[] = [];
mock.module("./storage", () => ({
	nativePreferencesStorage: {
		load: () => loadPromise,
		save: async (preferences: NativePreferences) => {
			savedPreferences.push(preferences);
		},
	},
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { NativePreferencesProvider, useNativePreferences } = await import(
	"./NativePreferencesProvider.tsx"
);

function PreferencesHarness() {
	const controller = useNativePreferences();
	return (
		<>
			<output data-testid="preferences-state">
				{JSON.stringify({ hydrated: controller.hydrated, ...controller.preferences })}
			</output>
			<button onClick={() => controller.update({ themePreference: "light" })} type="button">
				Use light theme
			</button>
			<button onClick={() => controller.update({ themePreference: "dark" })} type="button">
				Use dark theme
			</button>
		</>
	);
}

afterEach(cleanup);

describe("native preferences hydration", () => {
	test("merges an update made during loading without publishing the default theme", async () => {
		render(
			<NativePreferencesProvider>
				<PreferencesHarness />
			</NativePreferencesProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
		expect(themeWrites).toEqual([]);
		expect(savedPreferences).toEqual([]);

		await act(async () => {
			resolveLoad?.({
				diffFontSize: 18,
				terminalFontSize: 16,
				lineNumbersVisible: false,
				lineWrapEnabled: true,
				themePreference: "dark",
			});
			await loadPromise;
		});

		await waitFor(() => {
			const state = JSON.parse(screen.getByTestId("preferences-state").textContent ?? "{}");
			expect(state).toEqual({
				hydrated: true,
				diffFontSize: 18,
				terminalFontSize: 16,
				lineNumbersVisible: false,
				lineWrapEnabled: true,
				themePreference: "light",
			});
		});
		expect(themeWrites).toEqual([{ preference: "light", transition: undefined }]);
		expect(savedPreferences).toEqual([
			{
				diffFontSize: 18,
				terminalFontSize: 16,
				lineNumbersVisible: false,
				lineWrapEnabled: true,
				themePreference: "light",
			},
		]);

		fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
		expect(themeWrites.at(-1)).toEqual({
			preference: "dark",
			transition: { preset: 1 },
		});

		act(() => {
			reducedMotionEnabled = true;
			for (const listener of reducedMotionListeners) listener(true);
		});
		fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
		expect(themeWrites.at(-1)).toEqual({ preference: "light", transition: undefined });
		expect(savedPreferences.at(-1)?.themePreference).toBe("light");
	});
});
