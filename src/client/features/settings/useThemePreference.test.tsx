import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React from "react";

import { THEME_PREFERENCE_STORAGE_KEY } from "../../../shared/theme.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const ReactNativeWeb = await import("react-native-web");

let reducedMotionEnabled = false;
const reducedMotionListeners = new Set<(enabled: boolean) => void>();
mock.module("react-native", () => ({
	...ReactNativeWeb,
	AccessibilityInfo: {
		...ReactNativeWeb.AccessibilityInfo,
		addEventListener(_event: string, listener: (enabled: boolean) => void) {
			reducedMotionListeners.add(listener);
			return { remove: () => reducedMotionListeners.delete(listener) };
		},
		isReduceMotionEnabled: async () => reducedMotionEnabled,
	},
}));

type TestTheme = "dark" | "light";
let currentTheme: TestTheme = "dark";
let themeSnapshot: { hasAdaptiveThemes: boolean; theme: TestTheme } = {
	hasAdaptiveThemes: true,
	theme: currentTheme,
};
const themeListeners = new Set<() => void>();
const themeWrites: Array<{ preference: string; transition?: { preset: number } }> = [];
mock.module("uniwind", () => ({
	ThemeTransitionPreset: { Fade: 1, None: 0 },
	Uniwind: {
		setTheme(preference: string, transition?: { preset: number }) {
			themeWrites.push({ preference, transition });
			currentTheme = preference === "light" ? "light" : "dark";
			themeSnapshot = { hasAdaptiveThemes: true, theme: currentTheme };
			for (const listener of themeListeners) listener();
		},
	},
	useResolveClassNames: () => ({ color: "#111827" }),
	useUniwind: () =>
		React.useSyncExternalStore(
			(listener) => {
				themeListeners.add(listener);
				return () => themeListeners.delete(listener);
			},
			() => themeSnapshot,
			() => themeSnapshot,
		),
	withUniwind: <Component,>(component: Component) => component,
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { createMemoryKvStore } = await import("../../lib/storage/memoryKvStore.ts");
const { AppStoreProvider, createAppStore } = await import("../../lib/store/appStore.tsx");
const { createThemePreferenceState } = await import("./themePreferenceState.ts");
const { useThemePreference } = await import("./useThemePreference.ts");

function ThemeHarness({ state }: { state: ReturnType<typeof createThemePreferenceState> }) {
	const theme = useThemePreference(state);
	return (
		<div>
			<output data-testid="theme-state">
				{String(theme.hydrated)}:{theme.preference}:{theme.resolvedTheme}
			</output>
			<button onClick={() => theme.setPreference("dark")} type="button">
				Dark
			</button>
		</div>
	);
}

beforeEach(() => {
	currentTheme = "dark";
	themeSnapshot = { hasAdaptiveThemes: true, theme: currentTheme };
	reducedMotionEnabled = false;
	themeWrites.length = 0;
});

afterEach(cleanup);

describe("theme preference", () => {
	test("hydrates, persists, and receives KV subscription updates", async () => {
		const kvStore = createMemoryKvStore({
			[THEME_PREFERENCE_STORAGE_KEY]: JSON.stringify("light"),
		});
		const state = createThemePreferenceState(kvStore);
		render(
			<AppStoreProvider store={createAppStore()}>
				<ThemeHarness state={state} />
			</AppStoreProvider>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("theme-state").textContent).toBe("true:light:light"),
		);
		expect(themeWrites).toEqual([{ preference: "light", transition: undefined }]);

		fireEvent.click(screen.getByRole("button", { name: "Dark" }));
		await waitFor(() =>
			expect(screen.getByTestId("theme-state").textContent).toBe("true:dark:dark"),
		);
		expect(JSON.parse((await kvStore.get(THEME_PREFERENCE_STORAGE_KEY)) ?? "null")).toBe("dark");
		expect(themeWrites.at(-1)).toEqual({ preference: "dark", transition: { preset: 1 } });

		await act(async () => {
			await kvStore.set(THEME_PREFERENCE_STORAGE_KEY, JSON.stringify("light"));
		});
		await waitFor(() =>
			expect(screen.getByTestId("theme-state").textContent).toBe("true:light:light"),
		);
		expect(themeWrites.at(-1)).toEqual({ preference: "light", transition: undefined });
	});

	test("keeps explicit changes instant when reduced motion is enabled", async () => {
		reducedMotionEnabled = true;
		const kvStore = createMemoryKvStore();
		const state = createThemePreferenceState(kvStore);
		render(
			<AppStoreProvider store={createAppStore()}>
				<ThemeHarness state={state} />
			</AppStoreProvider>,
		);
		await waitFor(() => expect(screen.getByTestId("theme-state").textContent).toContain("true:"));

		fireEvent.click(screen.getByRole("button", { name: "Dark" }));
		await waitFor(() =>
			expect(screen.getByTestId("theme-state").textContent).toBe("true:dark:dark"),
		);
		expect(themeWrites.at(-1)).toEqual({ preference: "dark", transition: undefined });
	});
});
