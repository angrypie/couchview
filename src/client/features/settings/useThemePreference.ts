import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ThemeTransitionPreset, Uniwind, useUniwind } from "uniwind";

import {
	normalizeThemePreference,
	type ResolvedTheme,
	THEME_METADATA_COLORS,
	THEME_PREFERENCE_ATTRIBUTE,
	THEME_PREFERENCE_STORAGE_KEY,
	type ThemePreference,
} from "../../../shared/theme.ts";

type ThemeStorageReader = Pick<Storage, "getItem">;
type ThemeStorageWriter = Pick<Storage, "setItem">;

function browserStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function loadThemePreference(storage: ThemeStorageReader | null = browserStorage()) {
	if (!storage) return normalizeThemePreference(null);
	try {
		return normalizeThemePreference(storage.getItem(THEME_PREFERENCE_STORAGE_KEY));
	} catch {
		return normalizeThemePreference(null);
	}
}

export function saveThemePreference(
	preference: ThemePreference,
	storage: ThemeStorageWriter | null = browserStorage(),
): void {
	try {
		storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
	} catch {
		// The live theme remains usable when browser storage is unavailable.
	}
}

function exposeThemePreference(preference: ThemePreference, resolvedTheme: ResolvedTheme): void {
	if (typeof document !== "undefined") {
		document.documentElement.classList.remove("light", "dark");
		document.documentElement.classList.add(resolvedTheme);
		document.documentElement.setAttribute(THEME_PREFERENCE_ATTRIBUTE, preference);
		document.documentElement.style.colorScheme = resolvedTheme;
		let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		if (!themeColor) {
			themeColor = document.createElement("meta");
			themeColor.name = "theme-color";
			document.head.append(themeColor);
		}
		themeColor.content = THEME_METADATA_COLORS[resolvedTheme];
	}
}

export function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export function useThemePreference() {
	const [preference, setPreference] = useState(loadThemePreference);
	const preferenceRef = useRef(preference);
	const pendingUserPreferenceRef = useRef<ThemePreference | null>(null);
	const { theme } = useUniwind();
	const resolvedTheme: ResolvedTheme = theme === "dark" ? "dark" : "light";

	useLayoutEffect(() => {
		const animate = pendingUserPreferenceRef.current === preference && !prefersReducedMotion();
		pendingUserPreferenceRef.current = null;
		Uniwind.setTheme(preference, animate ? { preset: ThemeTransitionPreset.Fade } : undefined);
	}, [preference]);

	useLayoutEffect(() => {
		exposeThemePreference(preference, resolvedTheme);
	}, [preference, resolvedTheme]);

	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key !== null && event.key !== THEME_PREFERENCE_STORAGE_KEY) return;
			const nextPreference = normalizeThemePreference(event.newValue);
			pendingUserPreferenceRef.current = null;
			preferenceRef.current = nextPreference;
			setPreference(nextPreference);
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const updatePreference = useCallback((nextPreference: ThemePreference) => {
		if (nextPreference === preferenceRef.current) return;
		pendingUserPreferenceRef.current = nextPreference;
		preferenceRef.current = nextPreference;
		saveThemePreference(nextPreference);
		setPreference(nextPreference);
	}, []);

	return {
		preference,
		resolvedTheme,
		setPreference: updatePreference,
	};
}

export type ThemePreferenceController = ReturnType<typeof useThemePreference>;
