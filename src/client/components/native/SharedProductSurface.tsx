"use dom";

import { useEffect } from "react";

import { THEME_PREFERENCE_ATTRIBUTE, type ThemePreference } from "../../../shared/theme.ts";
import "../../../../native.css";

interface SharedProductSurfaceProps {
	dom?: import("expo/dom").DOMProps;
	onManageServers(): Promise<void>;
	onSurfaceReady(): Promise<void>;
	onThemePreferenceChange(themePreference: ThemePreference): Promise<void>;
	themePreference: ThemePreference;
}

export default function SharedProductSurface({
	onThemePreferenceChange,
	themePreference,
}: SharedProductSurfaceProps) {
	useEffect(() => {
		const root = document.documentElement;
		root.setAttribute(THEME_PREFERENCE_ATTRIBUTE, themePreference);
		const observer = new MutationObserver(() => {
			const nextPreference = root.getAttribute(THEME_PREFERENCE_ATTRIBUTE);
			if (nextPreference === "system" || nextPreference === "light" || nextPreference === "dark") {
				void onThemePreferenceChange(nextPreference);
			}
		});
		observer.observe(root, {
			attributeFilter: [THEME_PREFERENCE_ATTRIBUTE],
			attributes: true,
		});
		return () => observer.disconnect();
	}, [onThemePreferenceChange, themePreference]);

	return (
		<main className="flex h-screen items-center justify-center bg-background text-[15px] text-foreground">
			Opening Couchview…
		</main>
	);
}
