import { FlashList } from "@shopify/flash-list";
import { useMemo, useState } from "react";
import { Modal, Pressable, View } from "react-native";

import { Input, InputField } from "../ui/input";
import { Text } from "../ui/text";

export interface NativeCommand {
	id: string;
	label: string;
	run(): void;
}

export function NativeCommandPalette(props: {
	commands: readonly NativeCommand[];
	open: boolean;
	onClose(): void;
}) {
	const [query, setQuery] = useState("");
	const commands = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		return normalized
			? props.commands.filter(({ label }) => label.toLocaleLowerCase().includes(normalized))
			: [...props.commands];
	}, [props.commands, query]);
	return (
		<Modal animationType="fade" onRequestClose={props.onClose} transparent visible={props.open}>
			<Pressable
				accessibilityLabel="Close command palette"
				className="flex-1 items-center justify-start bg-black/60 px-6 pt-[90px]"
				onPress={props.onClose}
			>
				<Pressable
					className="max-h-[460px] w-full overflow-hidden rounded-2xl border border-border bg-card"
					onPress={(event) => event.stopPropagation()}
				>
					<Input className="rounded-none border-x-0 border-t-0 bg-card shadow-none">
						<InputField
							accessibilityLabel="Search commands"
							autoFocus
							className="p-3.5"
							onChangeText={setQuery}
							placeholder="Type a command"
							value={query}
						/>
					</Input>
					<FlashList
						data={commands}
						keyExtractor={(item) => item.id}
						renderItem={({ item }) => (
							<Pressable
								className="border-b border-border p-3.5 active:bg-accent"
								onPress={() => {
									props.onClose();
									item.run();
								}}
							>
								<Text selectable>{item.label}</Text>
							</Pressable>
						)}
					/>
					{commands.length === 0 ? (
						<View className="p-4">
							<Text className="text-muted-foreground" selectable size="sm">
								No matching commands
							</Text>
						</View>
					) : null}
				</Pressable>
			</Pressable>
		</Modal>
	);
}
