import { createContext, type ReactNode, use, useCallback, useEffect, useState } from "react";

import { nativePreferencesStorage } from "./storage";
import {
	DEFAULT_NATIVE_PREFERENCES,
	type NativePreferences,
	normalizeNativePreferences,
} from "./types.ts";

interface NativePreferencesController {
	hydrated: boolean;
	preferences: NativePreferences;
	error: string | null;
	update(patch: Partial<NativePreferences>): void;
	clearError(): void;
}

const NativePreferencesContext = createContext<NativePreferencesController | null>(null);

export function NativePreferencesProvider({ children }: { children: ReactNode }) {
	const [preferences, setPreferences] = useState(DEFAULT_NATIVE_PREFERENCES);
	const [hydrated, setHydrated] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		void nativePreferencesStorage.load().then(
			(stored) => {
				if (!active) return;
				setPreferences(stored);
				setHydrated(true);
			},
			(loadError) => {
				if (!active) return;
				setError(loadError instanceof Error ? loadError.message : "Could not load app settings");
				setHydrated(true);
			},
		);
		return () => {
			active = false;
		};
	}, []);

	const update = useCallback((patch: Partial<NativePreferences>) => {
		setError(null);
		setPreferences((current) => {
			const next = normalizeNativePreferences({ ...current, ...patch });
			void nativePreferencesStorage.save(next).catch((saveError) => {
				setError(saveError instanceof Error ? saveError.message : "Could not save app settings");
			});
			return next;
		});
	}, []);

	return (
		<NativePreferencesContext
			value={{
				clearError: () => setError(null),
				error,
				hydrated,
				preferences,
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
