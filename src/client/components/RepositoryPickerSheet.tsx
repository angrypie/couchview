import {
	Check,
	FileCode2,
	FolderOpen,
	MonitorUp,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";

import type { RepositoryCatalogEntry, RestartCapability } from "../../shared/contracts.ts";
import type { useRepositoryDirectoryBrowser } from "../features/repositories/useRepositoryDirectoryBrowser.ts";
import { RepositoryDirectoryPickerSheet } from "./RepositoryDirectoryPickerSheet.tsx";
import type { RestartPhase } from "./RestartOverlay.tsx";
import {
	Badge,
	Button,
	EmptyState,
	Icon,
	IconButton,
	Input,
	InputField,
	ListItem,
	Sheet,
	Spinner,
	Text,
} from "./ui";

interface RepositoryPickerSheetProps {
	addBusy: boolean;
	addRoot: string;
	currentRepositoryId: string | null;
	directoryBrowser: ReturnType<typeof useRepositoryDirectoryBrowser>;
	forgetBusy: string | null;
	nativeSetupAvailable: boolean;
	onClose: () => void;
	onAdd: () => void;
	onAddDirectory: (path: string) => void;
	onAddRootChange: (root: string) => void;
	onForget: (repository: RepositoryCatalogEntry) => void;
	onOpenNativeSetup: () => void;
	onRebuild: () => void;
	onSelect: (repository: RepositoryCatalogEntry) => void;
	open: boolean;
	repositories: RepositoryCatalogEntry[];
	restart: RestartCapability | null;
	restartPhase: RestartPhase;
}

export function RepositoryPickerSheet({
	addBusy,
	addRoot,
	currentRepositoryId,
	directoryBrowser,
	forgetBusy,
	nativeSetupAvailable,
	onAdd,
	onAddDirectory,
	onAddRootChange,
	onClose,
	onForget,
	onOpenNativeSetup,
	onRebuild,
	onSelect,
	open,
	repositories,
	restart,
	restartPhase,
}: RepositoryPickerSheetProps) {
	const close = () => {
		directoryBrowser.close();
		onClose();
	};
	if (open && directoryBrowser.active) {
		return (
			<RepositoryDirectoryPickerSheet
				addBusy={addBusy}
				browser={directoryBrowser}
				onBack={directoryBrowser.close}
				onChoose={onAddDirectory}
				onClose={close}
			/>
		);
	}

	return (
		<Sheet
			description="Switch projects without restarting the server"
			footer={
				<View className="w-full gap-2">
					{restart ? (
						<>
							<Button
								disabled={!restart.available || restartPhase !== null}
								fullWidth
								leftIcon={RefreshCw}
								loading={restartPhase === "building"}
								onPress={onRebuild}
								variant="secondary"
							>
								Rebuild & restart Couchview
							</Button>
							<Text className="text-muted-foreground" size="xs">
								{restart.available
									? "Builds this Couchview checkout, then reloads the current review."
									: restart.reason}
							</Text>
						</>
					) : null}
					{nativeSetupAvailable ? (
						<Button fullWidth leftIcon={MonitorUp} onPress={onOpenNativeSetup} variant="secondary">
							Native IDE setup
						</Button>
					) : null}
				</View>
			}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) close();
			}}
			open={open}
			title="Repositories"
		>
			<View className="gap-2">
				<Text bold size="sm">
					Project path on this server
				</Text>
				<View className="flex-row items-center gap-2">
					<Input className="min-w-0 flex-1">
						<InputField
							accessibilityLabel="Project path on this server"
							autoCapitalize="none"
							autoCorrect={false}
							editable={!addBusy}
							onChangeText={onAddRootChange}
							placeholder="/absolute/path/to/project"
							value={addRoot}
						/>
					</Input>
					<IconButton
						accessibilityLabel="Browse server folders"
						disabled={addBusy}
						icon={FolderOpen}
						onPress={() => directoryBrowser.open(addRoot.trim() || undefined)}
						variant="outline"
					/>
					<Button
						disabled={addBusy || !addRoot.trim()}
						leftIcon={Plus}
						loading={addBusy}
						onPress={onAdd}
						size="sm"
					>
						Add
					</Button>
				</View>
			</View>
			<ScrollView className="max-h-[45vh]" contentContainerClassName="gap-1">
				{repositories.length ? (
					repositories.map((entry) => {
						const current = entry.id === currentRepositoryId;
						return (
							<View className="flex-row items-center gap-1" key={entry.id}>
								<ListItem
									accessibilityLabel={`${entry.name}, ${entry.root}${entry.available ? "" : ", unavailable"}`}
									className="min-w-0 flex-1"
									disabled={!entry.available}
									leading={current ? <Icon as={Check} size={18} tone="success" /> : null}
									onPress={() => onSelect(entry)}
									selected={current}
									subtitle={entry.root}
									title={entry.name}
									trailing={!entry.available ? <Badge>Unavailable</Badge> : null}
								/>
								<Pressable
									accessibilityLabel={`Forget ${entry.name}`}
									accessibilityRole="button"
									className="size-10 items-center justify-center rounded-lg active:bg-muted disabled:opacity-50"
									disabled={forgetBusy !== null}
									onPress={() => onForget(entry)}
								>
									{forgetBusy === entry.id ? (
										<Spinner />
									) : (
										<Icon as={Trash2} size={17} tone="destructive" />
									)}
								</Pressable>
							</View>
						);
					})
				) : (
					<EmptyState icon={FileCode2} title="No saved repositories" />
				)}
			</ScrollView>
		</Sheet>
	);
}
