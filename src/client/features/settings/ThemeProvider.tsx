import { createContext, type ReactNode, use } from "react";

import { type ThemePreferenceController, useThemePreference } from "./useThemePreference.ts";

const ThemeContext = createContext<ThemePreferenceController | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
	const theme = useThemePreference();
	return <ThemeContext value={theme}>{children}</ThemeContext>;
}

export function useAppTheme(): ThemePreferenceController {
	const theme = use(ThemeContext);
	if (!theme) throw new Error("useAppTheme must be used inside ThemeProvider");
	return theme;
}
