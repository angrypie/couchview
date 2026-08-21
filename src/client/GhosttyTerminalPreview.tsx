import { View } from "react-native";

import type { ResolvedTheme } from "../shared/theme.ts";
import GhosttyPreviewDom from "./components/terminal/ghostty-preview-dom.tsx";
import type { TerminalTypographyPreferences } from "./typographyPreferences.ts";

interface GhosttyTerminalPreviewProps {
	preferences: TerminalTypographyPreferences;
	themeType?: ResolvedTheme;
}

export function GhosttyTerminalPreview({
	preferences,
	themeType = "dark",
}: GhosttyTerminalPreviewProps) {
	return (
		<View
			accessibilityLabel="Ghostty terminal typography preview"
			className="mt-5 h-44 min-h-44 overflow-hidden rounded-lg border border-border bg-background"
		>
			<GhosttyPreviewDom
				dom={{ scrollEnabled: false, style: { flex: 1 } }}
				preferences={preferences}
				themeType={themeType}
			/>
		</View>
	);
}
