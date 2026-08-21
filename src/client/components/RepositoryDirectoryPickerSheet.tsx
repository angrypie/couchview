import { ArrowLeft, ChevronRight, Folder, MoveUp, Plus } from "lucide-react-native";
import { ScrollView, View } from "react-native";

import type { useRepositoryDirectoryBrowser } from "../features/repositories/useRepositoryDirectoryBrowser.ts";
import { Button, Icon, IconButton, ListItem, Sheet, Spinner, Text } from "./ui";

interface RepositoryDirectoryPickerSheetProps {
	addBusy: boolean;
	browser: ReturnType<typeof useRepositoryDirectoryBrowser>;
	onBack: () => void;
	onChoose: (path: string) => void;
	onClose: () => void;
}

export function RepositoryDirectoryPickerSheet({
	addBusy,
	browser,
	onBack,
	onChoose,
	onClose,
}: RepositoryDirectoryPickerSheetProps) {
	const listing = browser.listing;
	return (
		<Sheet
			description="Folders on the Couchview server"
			footer={
				<View className="w-full gap-2">
					{listing?.truncated ? (
						<Text className="text-muted-foreground" size="xs">
							Showing the first 500 folders.
						</Text>
					) : null}
					<Button
						disabled={!listing || browser.busy || addBusy}
						fullWidth
						leftIcon={Plus}
						loading={addBusy}
						onPress={() => listing && onChoose(listing.path)}
					>
						Add this project
					</Button>
				</View>
			}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
			open
			title="Choose project folder"
		>
			<View className="flex-row items-center gap-2">
				<IconButton accessibilityLabel="Back to add project" icon={ArrowLeft} onPress={onBack} />
				<Text className="min-w-0 flex-1 font-mono" numberOfLines={1} selectable size="xs">
					{listing?.path ?? "Opening server folders…"}
				</Text>
				{browser.busy ? <Spinner /> : null}
			</View>
			<ScrollView className="max-h-[52vh]" contentContainerClassName="gap-1">
				{listing?.parent ? (
					<ListItem
						disabled={browser.busy}
						leading={<Icon as={MoveUp} size={18} tone="muted" />}
						onPress={() => void browser.browse(listing.parent ?? undefined)}
						title="Parent folder"
						trailing={<Icon as={ChevronRight} size={16} tone="muted" />}
					/>
				) : null}
				{listing?.directories.map((directory) => (
					<ListItem
						disabled={browser.busy}
						key={directory.path}
						leading={<Icon as={Folder} size={18} tone="muted" />}
						onPress={() => void browser.browse(directory.path)}
						title={directory.name}
						trailing={<Icon as={ChevronRight} size={16} tone="muted" />}
					/>
				))}
				{listing && listing.directories.length === 0 ? (
					<Text className="py-8 text-center text-muted-foreground">No subfolders</Text>
				) : null}
			</ScrollView>
		</Sheet>
	);
}
