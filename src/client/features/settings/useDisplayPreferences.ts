import { useCallback, useLayoutEffect, useMemo } from "react";
import {
	effectiveKeybindings,
	type SettingsProfile,
	type SettingsProfileData,
} from "../../../shared/settings.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import { codeFontStack, terminalRendererConfig } from "../../typographyPreferences.ts";

interface UseDisplayPreferencesOptions {
	profile: SettingsProfile;
	updateProfileData: (update: (current: SettingsProfileData) => SettingsProfileData) => void;
	themeType: ResolvedTheme;
}

export function useDisplayPreferences({
	profile,
	themeType,
	updateProfileData,
}: UseDisplayPreferencesOptions) {
	const typography = profile.data.typography;
	const lineNumbersVisible = profile.data.display.lineNumbersVisible;
	const lineWrapEnabled = profile.data.display.lineWrapEnabled;
	const commandBindings = useMemo(
		() => effectiveKeybindings(profile.data.keyboard),
		[profile.data.keyboard],
	);
	const terminalConfig = useMemo(
		() => terminalRendererConfig(typography.terminal, themeType),
		[
			typography.terminal.cellHeightAdjustment,
			typography.terminal.cellWidthAdjustment,
			typography.terminal.fontFamily,
			typography.terminal.fontSize,
			themeType,
		],
	);

	const setFontSize = useCallback(
		(fontSize: number) => {
			updateProfileData((next) => {
				next.typography.diff.fontSize = fontSize;
				return next;
			});
		},
		[updateProfileData],
	);
	const setLineNumbersVisible = useCallback(
		(visible: boolean) => {
			updateProfileData((next) => {
				next.display.lineNumbersVisible = visible;
				return next;
			});
		},
		[updateProfileData],
	);
	const setLineWrapEnabled = useCallback(
		(enabled: boolean) => {
			updateProfileData((next) => {
				next.display.lineWrapEnabled = enabled;
				return next;
			});
		},
		[updateProfileData],
	);

	useLayoutEffect(() => {
		document.documentElement.style.setProperty("--code-size", `${typography.diff.fontSize}px`);
		document.documentElement.style.setProperty(
			"--code-font-family",
			codeFontStack(typography.diff.fontFamily),
		);
	}, [typography.diff.fontFamily, typography.diff.fontSize]);

	return {
		commandBindings,
		fontSize: typography.diff.fontSize,
		lineNumbersVisible,
		lineWrapEnabled,
		setFontSize,
		setLineNumbersVisible,
		setLineWrapEnabled,
		terminalConfig,
		typography,
	};
}
