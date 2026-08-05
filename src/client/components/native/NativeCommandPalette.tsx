import { FlashList } from "@shopify/flash-list";
import { useMemo, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { nativeTheme } from "./nativeTheme.ts";

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
				onPress={props.onClose}
				style={{
					alignItems: "center",
					backgroundColor: "rgba(0,0,0,.62)",
					flex: 1,
					justifyContent: "flex-start",
					padding: 24,
					paddingTop: 90,
				}}
			>
				<Pressable
					onPress={(event) => event.stopPropagation()}
					style={{
						backgroundColor: nativeTheme.panelRaised,
						borderColor: nativeTheme.border,
						borderRadius: 16,
						borderWidth: 1,
						maxHeight: 460,
						overflow: "hidden",
						width: "100%",
					}}
				>
					<TextInput
						accessibilityLabel="Search commands"
						autoFocus
						onChangeText={setQuery}
						placeholder="Type a command"
						placeholderTextColor={nativeTheme.muted}
						style={{
							borderBottomColor: nativeTheme.border,
							borderBottomWidth: 1,
							color: nativeTheme.text,
							fontSize: 16,
							padding: 14,
						}}
						value={query}
					/>
					<FlashList
						data={commands}
						keyExtractor={(item) => item.id}
						renderItem={({ item }) => (
							<Pressable
								onPress={() => {
									props.onClose();
									item.run();
								}}
								style={{ borderBottomColor: nativeTheme.border, borderBottomWidth: 1, padding: 14 }}
							>
								<Text selectable style={{ color: nativeTheme.text }}>
									{item.label}
								</Text>
							</Pressable>
						)}
					/>
					{commands.length === 0 ? (
						<View style={{ padding: 16 }}>
							<Text selectable style={{ color: nativeTheme.muted }}>
								No matching commands
							</Text>
						</View>
					) : null}
				</Pressable>
			</Pressable>
		</Modal>
	);
}
