import { Check, FileCode2, FolderGit2, Search } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { FlatList, useWindowDimensions, View } from "react-native";
import type { QuickPickItem } from "../../features/quickPick/types.ts";
import { QUICK_PICKER_SEARCH_INPUT_ID } from "../../features/quickPick/types.ts";
import type { useQuickPickers } from "../../features/quickPick/useQuickPickers.ts";
import {
	Badge,
	Button,
	Dialog,
	EmptyState,
	Icon,
	Input,
	InputField,
	ListItem,
	Spinner,
	Text,
} from "../ui";

const ROW_HEIGHT = 56;

interface QuickPickerDialogProps {
	controller: ReturnType<typeof useQuickPickers>;
	onManageProjects: () => void;
}

function ResultRow({
	active,
	controller,
	current,
	item,
}: {
	active: boolean;
	controller: ReturnType<typeof useQuickPickers>;
	current: boolean;
	item: QuickPickItem;
}) {
	return (
		<ListItem
			accessibilityLabel={`${item.title}, ${item.subtitle}`}
			aria-selected={active}
			className="h-14 py-1"
			density="compact"
			leading={
				<Icon as={item.kind === "projects" ? FolderGit2 : FileCode2} size={17} tone="muted" />
			}
			onPress={() => controller.select(item.id)}
			selected={active}
			subtitle={item.subtitle}
			title={item.title}
			trailing={
				current ? (
					<Badge icon={Check} variant="outline">
						Current
					</Badge>
				) : null
			}
		/>
	);
}

function Results({
	controller,
	resultsHeight,
}: {
	controller: ReturnType<typeof useQuickPickers>;
	resultsHeight: number;
}) {
	const listRef = useRef<FlatList<QuickPickItem>>(null);
	useEffect(() => {
		if (controller.items.length === 0) return;
		listRef.current?.scrollToIndex({ animated: false, index: controller.activeIndex });
	}, [controller.activeIndex, controller.items.length, controller.query]);

	const mode = controller.mode ?? "files";
	const activeItem = controller.items[controller.activeIndex];
	return (
		<>
			<Input className="h-10">
				<View className="pl-1">
					<Icon as={Search} size={17} tone="muted" />
				</View>
				<InputField
					accessibilityLabel={mode === "projects" ? "Search projects" : "Search project files"}
					autoCapitalize="none"
					autoCorrect={false}
					autoFocus
					nativeID={QUICK_PICKER_SEARCH_INPUT_ID}
					onChangeText={controller.setQuery}
					onSubmitEditing={controller.selectActive}
					placeholder={mode === "projects" ? "Find a project…" : "Find a file…"}
					returnKeyType="go"
					value={controller.query}
				/>
			</Input>
			<FlatList
				accessibilityLabel={mode === "projects" ? "Project results" : "File results"}
				className="rounded-lg border border-border bg-background"
				data={controller.items}
				extraData={controller.activeIndex}
				getItemLayout={(_data, index) => ({
					index,
					length: ROW_HEIGHT,
					offset: ROW_HEIGHT * index,
				})}
				initialNumToRender={12}
				keyboardShouldPersistTaps="handled"
				keyExtractor={(item) => item.id}
				ListEmptyComponent={
					<View className="items-center justify-center" style={{ height: resultsHeight }}>
						<EmptyState
							icon={mode === "projects" ? FolderGit2 : FileCode2}
							title={controller.query ? "No matches" : `No ${mode} available`}
						/>
					</View>
				}
				maxToRenderPerBatch={16}
				onScrollToIndexFailed={({ index }) =>
					listRef.current?.scrollToOffset({ animated: false, offset: ROW_HEIGHT * index })
				}
				ref={listRef}
				renderItem={({ index, item }) => (
					<ResultRow
						active={index === controller.activeIndex}
						controller={controller}
						current={item.id === controller.currentItemId}
						item={item}
					/>
				)}
				testID="quick-picker-results"
				style={{ height: resultsHeight }}
				windowSize={5}
			/>
			<View accessibilityLiveRegion="polite" className="sr-only" role="status">
				<Text>
					{activeItem
						? `${activeItem.title}, ${activeItem.subtitle}, ${controller.activeIndex + 1} of ${controller.items.length}`
						: "No matching results"}
				</Text>
			</View>
		</>
	);
}

export function QuickPickerDialog({ controller, onManageProjects }: QuickPickerDialogProps) {
	const { height: viewportHeight } = useWindowDimensions();
	const resultsHeight = Math.max(112, Math.min(320, Math.floor(viewportHeight * 0.9) - 200));
	const projectMode = controller.mode === "projects";
	const footer = projectMode ? (
		<Button
			onPress={() => {
				controller.close();
				onManageProjects();
			}}
			size="sm"
			variant="ghost"
		>
			Manage projects…
		</Button>
	) : (
		<View className="h-8 flex-1 flex-row items-center justify-end gap-2">
			{controller.catalogBusy ? <Spinner accessibilityLabel="Refreshing project files" /> : null}
			{controller.catalogError ? (
				<Button onPress={controller.retryCatalog} size="sm" variant="ghost">
					Retry file list
				</Button>
			) : (
				<Text className="text-muted-foreground" size="xs">
					{controller.truncated
						? `Showing the first ${controller.fileCount} files`
						: `${controller.fileCount} files`}
				</Text>
			)}
		</View>
	);
	return (
		<Dialog
			animationType="none"
			description="Type to filter · Enter to open · Ctrl+C to close"
			footer={footer}
			onOpenChange={(open) => {
				if (!open) controller.close();
			}}
			open={controller.mode !== null}
			testID="quick-picker-dialog"
			title={projectMode ? "Projects" : "Files"}
		>
			<Results controller={controller} resultsHeight={resultsHeight} />
		</Dialog>
	);
}
