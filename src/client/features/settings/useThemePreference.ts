import { useAtom, useAtomValue } from "jotai/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { ThemeTransitionPreset, Uniwind, useUniwind } from "uniwind";

import type { ResolvedTheme, ThemePreference } from "../../../shared/theme.ts";
import type { PersistedAtom } from "../../lib/store/persistedAtom.ts";
import { useHydratePersistedAtom } from "../../lib/store/persistedAtom.ts";
import { themePreferenceState } from "./themePreferenceState.ts";

function useReducedMotionEnabled(): boolean {
	const [enabled, setEnabled] = useState(true);

	useEffect(() => {
		let active = true;
		void AccessibilityInfo.isReduceMotionEnabled().then(
			(nextEnabled) => {
				if (active) setEnabled(nextEnabled);
			},
			() => undefined,
		);
		const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setEnabled);
		return () => {
			active = false;
			subscription.remove();
		};
	}, []);

	return enabled;
}

export function useThemePreference(
	persistedState: PersistedAtom<ThemePreference> = themePreferenceState,
) {
	const [preference, setPersistedPreference] = useAtom(persistedState.valueAtom);
	const hydrated = useAtomValue(persistedState.hydratedAtom);
	const preferenceRef = useRef(preference);
	const appliedPreferenceRef = useRef<ThemePreference | null>(null);
	const pendingUserPreferenceRef = useRef<ThemePreference | null>(null);
	const reducedMotionEnabled = useReducedMotionEnabled();
	const { theme } = useUniwind();
	const resolvedTheme: ResolvedTheme = theme === "dark" ? "dark" : "light";
	useHydratePersistedAtom(persistedState);
	preferenceRef.current = preference;

	useEffect(() => {
		if (!hydrated || appliedPreferenceRef.current === preference) return;
		const animate = pendingUserPreferenceRef.current === preference && !reducedMotionEnabled;
		pendingUserPreferenceRef.current = null;
		appliedPreferenceRef.current = preference;
		Uniwind.setTheme(preference, animate ? { preset: ThemeTransitionPreset.Fade } : undefined);
	}, [hydrated, preference, reducedMotionEnabled]);

	const updatePreference = useCallback(
		(nextPreference: ThemePreference) => {
			if (nextPreference === preferenceRef.current) return;
			pendingUserPreferenceRef.current = hydrated ? nextPreference : null;
			preferenceRef.current = nextPreference;
			void setPersistedPreference(nextPreference).catch(() => undefined);
		},
		[hydrated, setPersistedPreference],
	);

	return {
		hydrated,
		preference,
		resolvedTheme,
		setPreference: updatePreference,
	};
}

export type ThemePreferenceController = ReturnType<typeof useThemePreference>;
