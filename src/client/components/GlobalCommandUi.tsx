import type { CommandId, ShortcutSequence } from "../../shared/settings.ts";
import { CommandPalette } from "../CommandPalette.tsx";
import type { RuntimeCommand } from "../commands.ts";
import { formatShortcut } from "../shortcutEngine.ts";

interface GlobalCommandUiProps {
	commands: Record<CommandId, RuntimeCommand>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pendingShortcut: ShortcutSequence;
}

export function GlobalCommandUi({
	commands,
	onOpenChange,
	open,
	pendingShortcut,
}: GlobalCommandUiProps) {
	return (
		<>
			<CommandPalette commands={commands} onOpenChange={onOpenChange} open={open} />
			{pendingShortcut.length > 0 && (
				<div aria-live="polite" className="shortcut-pending-hud" role="status">
					{formatShortcut(pendingShortcut)}
				</div>
			)}
		</>
	);
}
