import { View } from "react-native";

import type { CommandId, ShortcutSequence } from "../../shared/settings.ts";
import { CommandPalette } from "../CommandPalette.tsx";
import type { RuntimeCommand } from "../commands.ts";
import { formatShortcut } from "../shortcutEngine";
import { Badge } from "./ui";

interface GlobalCommandUiProps {
	commands: Record<CommandId, RuntimeCommand>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	querySeed?: string;
	pendingShortcut: ShortcutSequence;
}

export function GlobalCommandUi({
	commands,
	onOpenChange,
	open,
	querySeed,
	pendingShortcut,
}: GlobalCommandUiProps) {
	return (
		<>
			<CommandPalette
				commands={commands}
				onOpenChange={onOpenChange}
				open={open}
				querySeed={querySeed}
			/>
			{pendingShortcut.length > 0 ? (
				<View
					accessibilityLiveRegion="polite"
					accessibilityRole="alert"
					className="absolute right-4 top-safe-offset-4 z-50"
				>
					<Badge variant="primary">{formatShortcut(pendingShortcut)}</Badge>
				</View>
			) : null}
		</>
	);
}
