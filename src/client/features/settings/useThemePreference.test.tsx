import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	DEFAULT_THEME_PREFERENCE,
	THEME_METADATA_COLORS,
	THEME_PREFERENCE_ATTRIBUTE,
	THEME_PREFERENCE_STORAGE_KEY,
} from "../../../shared/theme.ts";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	testThemeRuntime,
} from "../../appTestEnvironment.tsx";

const { ThemeTransitionPreset } = await import("uniwind");
const { loadThemePreference, saveThemePreference, useThemePreference } = await import(
	"./useThemePreference.ts"
);

function setReducedMotion(enabled: boolean): void {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			addEventListener() {},
			dispatchEvent: () => false,
			matches: query === "(prefers-reduced-motion: reduce)" && enabled,
			media: query,
			onchange: null,
			removeEventListener() {},
		}),
	});
}

function ThemeHarness() {
	const theme = useThemePreference();
	return (
		<div>
			<output data-testid="theme-state">
				{theme.preference}:{theme.resolvedTheme}
			</output>
			<button onClick={() => theme.setPreference("light")} type="button">
				Light
			</button>
			<button onClick={() => theme.setPreference("dark")} type="button">
				Dark
			</button>
			<button onClick={() => theme.setPreference("system")} type="button">
				System
			</button>
		</div>
	);
}

describe("theme preference", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.classList.remove("light", "dark");
		document.documentElement.removeAttribute(THEME_PREFERENCE_ATTRIBUTE);
		document.documentElement.style.removeProperty("color-scheme");
		setReducedMotion(false);
		testThemeRuntime.reset();
	});

	afterEach(() => cleanup());

	test("normalizes missing, invalid, and unavailable browser storage", () => {
		expect(loadThemePreference(null)).toBe(DEFAULT_THEME_PREFERENCE);
		expect(loadThemePreference({ getItem: () => "sepia" })).toBe(DEFAULT_THEME_PREFERENCE);
		expect(
			loadThemePreference({
				getItem: () => {
					throw new Error("blocked");
				},
			}),
		).toBe(DEFAULT_THEME_PREFERENCE);
		expect(() =>
			saveThemePreference("light", {
				setItem: () => {
					throw new Error("blocked");
				},
			}),
		).not.toThrow();
	});

	test("applies a stored preference and follows the device in system mode", () => {
		localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "light");
		render(<ThemeHarness />);

		expect(screen.getByTestId("theme-state").textContent).toBe("light:light");
		expect(document.documentElement.getAttribute(THEME_PREFERENCE_ATTRIBUTE)).toBe("light");
		expect(document.documentElement.classList.contains("light")).toBe(true);
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.style.colorScheme).toBe("light");
		expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
			THEME_METADATA_COLORS.light,
		);
		expect(testThemeRuntime.writes).toEqual([{ preference: "light", transition: undefined }]);

		fireEvent.click(screen.getByRole("button", { name: "System" }));
		expect(screen.getByTestId("theme-state").textContent).toBe("system:dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.classList.contains("light")).toBe(false);
		expect(document.documentElement.style.colorScheme).toBe("dark");
		expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
			THEME_METADATA_COLORS.dark,
		);
		expect(testThemeRuntime.writes.at(-1)).toEqual({
			preference: "system",
			transition: { preset: ThemeTransitionPreset.Fade },
		});
		act(() => testThemeRuntime.setSystemTheme("light"));
		expect(screen.getByTestId("theme-state").textContent).toBe("system:light");
		expect(document.documentElement.classList.contains("light")).toBe(true);
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.style.colorScheme).toBe("light");
		expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
			THEME_METADATA_COLORS.light,
		);
		expect(testThemeRuntime.writes).toHaveLength(2);
	});

	test("persists explicit changes and accepts updates from another tab", () => {
		render(<ThemeHarness />);
		fireEvent.click(screen.getByRole("button", { name: "Dark" }));

		expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("dark");
		expect(document.documentElement.getAttribute(THEME_PREFERENCE_ATTRIBUTE)).toBe("dark");
		expect(screen.getByTestId("theme-state").textContent).toBe("dark:dark");
		expect(testThemeRuntime.writes.at(-1)).toEqual({
			preference: "dark",
			transition: { preset: ThemeTransitionPreset.Fade },
		});

		act(() => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: THEME_PREFERENCE_STORAGE_KEY,
					newValue: "light",
				}),
			);
		});
		expect(screen.getByTestId("theme-state").textContent).toBe("light:light");
		expect(testThemeRuntime.writes.at(-1)).toEqual({
			preference: "light",
			transition: undefined,
		});
	});

	test("keeps explicit theme changes instant when reduced motion is enabled", () => {
		setReducedMotion(true);
		render(<ThemeHarness />);

		fireEvent.click(screen.getByRole("button", { name: "Light" }));

		expect(testThemeRuntime.writes).toEqual([
			{ preference: "system", transition: undefined },
			{ preference: "light", transition: undefined },
		]);
	});
});
