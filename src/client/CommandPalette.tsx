import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CommandId } from "../shared/settings.ts";
import { COMMAND_CATEGORIES, type RuntimeCommand } from "./commands.ts";
import { formatShortcut } from "./shortcutEngine.ts";

interface CommandPaletteProps {
	commands: Record<CommandId, RuntimeCommand>;
	onOpenChange(open: boolean): void;
	open: boolean;
}

function ShortcutBadge({ command }: { command: RuntimeCommand }) {
	return (
		<kbd className={`command-shortcut ${command.binding ? "" : "unassigned"}`}>
			{formatShortcut(command.binding)}
		</kbd>
	);
}

export function CommandPalette({ commands, onOpenChange, open }: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	const previouslyOpenRef = useRef(false);
	const restoreFocusRef = useRef<HTMLElement | null>(null);
	if (open && !previouslyOpenRef.current) {
		restoreFocusRef.current =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}
	useLayoutEffect(() => {
		const previouslyOpen = previouslyOpenRef.current;
		previouslyOpenRef.current = open;
		if (open || !previouslyOpen) return;
		const target = restoreFocusRef.current;
		restoreFocusRef.current = null;
		const frame = window.requestAnimationFrame(() => {
			if (target?.isConnected) target.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [open]);
	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);
	const visible = useMemo(
		() => Object.values(commands).filter((command) => command.paletteVisible),
		[commands],
	);

	return (
		<Command.Dialog
			className="command-palette"
			label="Couchview command palette"
			onOpenChange={onOpenChange}
			open={open}
			shouldFilter
		>
			<div className="command-palette-input-row">
				<Search aria-hidden="true" size={18} />
				<Command.Input
					autoFocus
					onValueChange={setQuery}
					placeholder="Type a command or destination…"
					value={query}
				/>
			</div>
			<Command.List className="command-palette-list">
				<Command.Empty className="command-palette-empty">No commands found.</Command.Empty>
				{COMMAND_CATEGORIES.map((category) => {
					const categoryCommands = visible.filter((command) => command.category === category);
					if (categoryCommands.length === 0) return null;
					return (
						<Command.Group heading={category} key={category}>
							{categoryCommands.map((command) => {
								const Icon = command.icon;
								return (
									<Command.Item
										disabled={!command.enabled}
										key={command.id}
										keywords={command.keywords}
										onSelect={() => {
											if (!command.enabled) return;
											onOpenChange(false);
											window.setTimeout(command.perform, 0);
										}}
										value={`${command.title} ${command.keywords.join(" ")}`}
									>
										<Icon aria-hidden="true" size={17} />
										<span className="command-palette-item-copy">
											<span>{command.title}</span>
											{!command.enabled && command.disabledReason && (
												<small>{command.disabledReason}</small>
											)}
										</span>
										<ShortcutBadge command={command} />
									</Command.Item>
								);
							})}
						</Command.Group>
					);
				})}
			</Command.List>
		</Command.Dialog>
	);
}
