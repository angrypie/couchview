import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { AccessibilityInfo } from "react-native";
import { ThemeTransitionPreset, Uniwind, useUniwind } from "uniwind";

import type { ResolvedTheme } from "../../../shared/theme.ts";
import { nativePreferencesStorage } from "./storage";
import {
	DEFAULT_NATIVE_PREFERENCES,
	type NativePreferences,
	normalizeNativePreferences,
} from "./types.ts";

interface NativePreferencesController {
	hydrated: boolean;
	preferences: NativePreferences;
	resolvedTheme: ResolvedTheme;
	update(patch: Partial<NativePreferences>): void;
}

const NativePreferencesContext = createContext<NativePreferencesController | null>(null);

function useReducedMotionEnabled(): boolean {
	const [enabled, setEnabled] = useState(true);

	useEffect(() => {
		let active = true;
		void AccessibilityInfo.isReduceMotionEnabled().then(
			(nextEnabled) => {
				if (active) setEnabled(nextEnabled);
			},
			() => {
				// Keep transitions disabled when the accessibility preference cannot be read.
			},
		);
		const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setEnabled);
		return () => {
			active = false;
			subscription.remove();
		};
	}, []);

	return enabled;
}

export function NativePreferencesProvider({ children }: { children: ReactNode }) {
	const [preferences, setPreferences] = useState(DEFAULT_NATIVE_PREFERENCES);
	const [hydrated, setHydrated] = useState(false);
	const preferencesRef = useRef(DEFAULT_NATIVE_PREFERENCES);
	const pendingPatchRef = useRef<Partial<NativePreferences>>({});
	const hydratedRef = useRef(false);
	const reducedMotionEnabled = useReducedMotionEnabled();
	const { theme } = useUniwind();
	const resolvedTheme: ResolvedTheme = theme === "dark" ? "dark" : "light";

	const save = useCallback((next: NativePreferences) => {
		void nativePreferencesStorage.save(next).catch(() => undefined);
	}, []);

	useEffect(() => {
		let active = true;
		void nativePreferencesStorage.load().then(
			(stored) => {
				if (!active) return;
				const pendingPatch = pendingPatchRef.current;
				const next = normalizeNativePreferences({ ...stored, ...pendingPatch });
				pendingPatchRef.current = {};
				preferencesRef.current = next;
				hydratedRef.current = true;
				Uniwind.setTheme(next.themePreference);
				setPreferences(next);
				setHydrated(true);
				if (Object.keys(pendingPatch).length > 0) save(next);
			},
			() => {
				if (!active) return;
				const pendingPatch = pendingPatchRef.current;
				const next = normalizeNativePreferences({
					...preferencesRef.current,
					...pendingPatch,
				});
				pendingPatchRef.current = {};
				preferencesRef.current = next;
				hydratedRef.current = true;
				Uniwind.setTheme(next.themePreference);
				setPreferences(next);
				setHydrated(true);
				if (Object.keys(pendingPatch).length > 0) save(next);
			},
		);
		return () => {
			active = false;
		};
	}, [save]);

	const update = useCallback(
		(patch: Partial<NativePreferences>) => {
			const current = preferencesRef.current;
			const next = normalizeNativePreferences({ ...current, ...patch });
			preferencesRef.current = next;
			setPreferences(next);
			if (!hydratedRef.current) {
				pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
				return;
			}
			if (next.themePreference !== current.themePreference) {
				Uniwind.setTheme(
					next.themePreference,
					reducedMotionEnabled ? undefined : { preset: ThemeTransitionPreset.Fade },
				);
			}
			save(next);
		},
		[reducedMotionEnabled, save],
	);

	return (
		<NativePreferencesContext
			value={{
				hydrated,
				preferences,
				resolvedTheme,
				update,
			}}
		>
			{children}
		</NativePreferencesContext>
	);
}

export function useNativePreferences(): NativePreferencesController {
	const controller = use(NativePreferencesContext);
	if (!controller) {
		throw new Error("useNativePreferences must be used inside NativePreferencesProvider");
	}
	return controller;
}
