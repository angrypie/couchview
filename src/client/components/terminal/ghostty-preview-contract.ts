import type { ResolvedTheme } from "../../../shared/theme.ts";
import type { TerminalTypographyPreferences } from "../../typographyPreferences.ts";

export interface GhosttyPreviewDomProps {
	dom?: import("expo/dom").DOMProps;
	preferences: TerminalTypographyPreferences;
	themeType: ResolvedTheme;
}
