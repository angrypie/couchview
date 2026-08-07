import { Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import type { CommandId } from "../shared/settings.ts";
import { COMMAND_CATEGORIES, type RuntimeCommand } from "./commands.ts";
import { Badge, Dialog, Icon, Input, InputField, ListItem, Text } from "./components/ui";
import { formatShortcut } from "./shortcutEngine";

interface CommandPaletteProps {
	commands: Record<CommandId, RuntimeCommand>;
	onOpenChange(open: boolean): void;
	open: boolean;
}

function ShortcutBadge({ command }: { command: RuntimeCommand }) {
	return (
		<Badge variant={command.binding ? "outline" : "neutral"}>
			{formatShortcut(command.binding) || "Unassigned"}
		</Badge>
	);
}

export function CommandPalette({ commands, onOpenChange, open }: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);
	const visible = useMemo(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		return Object.values(commands).filter((command) => {
			if (!command.paletteVisible) return false;
			if (!normalizedQuery) return true;
			return `${command.title} ${command.keywords.join(" ")}`
				.toLocaleLowerCase()
				.includes(normalizedQuery);
		});
	}, [commands, query]);

	return (
		<Dialog
			description="Search destinations and actions"
			onOpenChange={onOpenChange}
			open={open}
			title="Command palette"
		>
			<Input>
				<View className="pl-1">
					<Icon as={Search} size={18} tone="muted" />
				</View>
				<InputField
					accessibilityLabel="Search commands"
					autoFocus
					onChangeText={setQuery}
					placeholder="Type a command or destination…"
					returnKeyType="search"
					value={query}
				/>
			</Input>
			<ScrollView
				className="max-h-[60vh]"
				contentContainerClassName="gap-3"
				keyboardShouldPersistTaps="handled"
			>
				{visible.length === 0 ? (
					<Text className="py-6 text-center text-muted-foreground">No commands found.</Text>
				) : null}
				{COMMAND_CATEGORIES.map((category) => {
					const categoryCommands = visible.filter((command) => command.category === category);
					if (categoryCommands.length === 0) return null;
					return (
						<View className="gap-1" key={category}>
							<Text className="px-3 uppercase tracking-wide text-muted-foreground" size="xs">
								{category}
							</Text>
							{categoryCommands.map((command) => (
								<ListItem
									density="compact"
									disabled={!command.enabled}
									key={command.id}
									leading={<Icon as={command.icon} size={18} tone="muted" />}
									onPress={() => {
										if (!command.enabled) return;
										onOpenChange(false);
										setTimeout(command.perform, 0);
									}}
									subtitle={!command.enabled ? command.disabledReason : undefined}
									title={command.title}
									trailing={<ShortcutBadge command={command} />}
								/>
							))}
						</View>
					);
				})}
			</ScrollView>
		</Dialog>
	);
}
