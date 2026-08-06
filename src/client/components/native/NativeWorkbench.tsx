import BottomSheet, { BottomSheetView } from "@expo/ui/community/bottom-sheet";
import { FlashList } from "@shopify/flash-list";
import { Link, useRouter } from "expo-router";
import { Check, FileText, ListTree, Menu, MessageSquarePlus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, useWindowDimensions, View } from "react-native";
import { withUniwind } from "uniwind";

import type { ChangeFile, FileDiff, RepositoryCatalogEntry } from "../../../shared/contracts.ts";
import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import {
	type NativeCommentAnchor,
	useNativeWorkspace,
} from "../../features/nativeServers/useNativeWorkspace.ts";
import { selectWorkbenchLayout } from "../../lib/workbenchLayout.ts";
import { Button, ButtonIcon, ButtonText } from "../ui/button";
import { Input, InputField } from "../ui/input";
import { Text } from "../ui/text";
import { type NativeCommand, NativeCommandPalette } from "./NativeCommandPalette.tsx";
import NativeDiffSurface from "./NativeDiffSurface.tsx";

const ThemedBottomSheetView = withUniwind(BottomSheetView);
const ThemedFileText = withUniwind(FileText);

function ActionButton(props: {
	label: string;
	onPress(): void;
	active?: boolean;
	icon?: typeof Check;
	disabled?: boolean;
}) {
	const Icon = props.icon;
	return (
		<Button
			accessibilityLabel={props.label}
			disabled={props.disabled}
			onPress={props.onPress}
			size="sm"
			variant={props.active ? "default" : "secondary"}
		>
			{Icon ? <ButtonIcon as={Icon} /> : null}
			<ButtonText>{props.label}</ButtonText>
		</Button>
	);
}

function FileRail(props: {
	files: readonly ChangeFile[];
	repositories: readonly RepositoryCatalogEntry[];
	repositoryId: string | null;
	selectedFileId: string | null;
	onSelectRepository(repositoryId: string): void;
	onSelect(fileId: string): void;
}) {
	return (
		<View className="min-w-[250px] flex-1 bg-card">
			<View className="border-b border-border p-2">
				<Text bold className="text-muted-foreground" size="xs">
					REPOSITORIES
				</Text>
				{props.repositories.map((repository) => (
					<Pressable
						className={
							repository.id === props.repositoryId
								? "rounded-lg bg-muted px-2 py-[7px] disabled:opacity-50"
								: "rounded-lg bg-transparent px-2 py-[7px] active:bg-muted disabled:opacity-50"
						}
						disabled={!repository.available}
						key={repository.id}
						onPress={() => props.onSelectRepository(repository.id)}
					>
						<Text numberOfLines={1} size="xs">
							{repository.name}
						</Text>
					</Pressable>
				))}
			</View>
			<FlashList
				data={props.files}
				keyExtractor={(file) => file.id}
				renderItem={({ item }) => (
					<Pressable
						className={
							item.id === props.selectedFileId
								? "gap-[3px] border-b border-border bg-muted px-3 py-2.5"
								: "gap-[3px] border-b border-border bg-transparent px-3 py-2.5 active:bg-muted"
						}
						onPress={() => props.onSelect(item.id)}
					>
						<Text numberOfLines={1} size="sm">
							{item.path}
						</Text>
						<Text className="text-muted-foreground" size="xs">
							{item.kind} · +{item.additions ?? 0} −{item.deletions ?? 0}
							{item.reviewed ? " · reviewed" : ""}
						</Text>
					</Pressable>
				)}
			/>
		</View>
	);
}

function firstCommentAnchor(diff: FileDiff): NativeCommentAnchor | null {
	for (const hunk of diff.hunks) {
		for (const line of hunk.lines) {
			if (line.newLine !== null) return anchorForLine(diff, line.newLine, "new");
			if (line.oldLine !== null) return anchorForLine(diff, line.oldLine, "old");
		}
	}
	return null;
}

function anchorForLine(
	diff: FileDiff,
	lineNumber: number,
	side: "old" | "new",
): NativeCommentAnchor {
	for (const hunk of diff.hunks) {
		const line = hunk.lines.find((candidate) =>
			side === "new" ? candidate.newLine === lineNumber : candidate.oldLine === lineNumber,
		);
		if (!line) continue;
		return {
			fileId: diff.fileId,
			contentRevision: diff.contentRevision,
			side,
			startLine: lineNumber,
			endLine: lineNumber,
			...(line.oldLine === null ? {} : { oldStartLine: line.oldLine, oldEndLine: line.oldLine }),
			...(line.newLine === null ? {} : { newStartLine: line.newLine, newEndLine: line.newLine }),
			hunkHeader: hunk.header,
			excerpt: [line.text],
		};
	}
	throw new Error("That line is no longer present in the current diff");
}

function CommentComposer(props: {
	anchor: NativeCommentAnchor | null;
	onClose(): void;
	onSave(body: string): void;
}) {
	const [body, setBody] = useState("");
	return (
		<BottomSheet
			enablePanDownToClose
			index={props.anchor ? 0 : -1}
			onClose={props.onClose}
			snapPoints={["80%"]}
		>
			<ThemedBottomSheetView className="flex-1 gap-3.5 bg-background p-[18px]">
				<Text bold selectable size="xl">
					Add comment
				</Text>
				<Input className="min-h-40 items-start">
					<InputField
						accessibilityLabel="Comment"
						autoFocus
						className="min-h-[158px] py-3"
						multiline
						onChangeText={setBody}
						placeholder="What should change?"
						textAlignVertical="top"
						value={body}
					/>
				</Input>
				<View className="flex-row gap-2">
					<ActionButton label="Cancel" onPress={props.onClose} />
					<ActionButton
						disabled={!body.trim()}
						label="Save comment"
						onPress={() => props.onSave(body.trim())}
					/>
				</View>
			</ThemedBottomSheetView>
		</BottomSheet>
	);
}

export function NativeWorkbench() {
	const { profiles } = useNativeServer();
	const workspace = useNativeWorkspace(profiles.activeProfile, profiles.update);
	const { preferences, resolvedTheme } = useNativePreferences();
	const router = useRouter();
	const { width, height } = useWindowDimensions();
	const layout = selectWorkbenchLayout(width, height);
	const [fileSheetOpen, setFileSheetOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [commentAnchor, setCommentAnchor] = useState<NativeCommentAnchor | null>(null);
	const files = workspace.changes?.files ?? [];
	const selectedFile = files.find(({ id }) => id === workspace.selectedFileId) ?? null;
	const selectedRepository = workspace.repositories.find(({ id }) => id === workspace.repositoryId);
	const comments = workspace.reviewState.comments.filter(
		({ fileId }) => fileId === workspace.selectedFileId,
	);
	const commands = useMemo<NativeCommand[]>(
		() => [
			{ id: "files", label: "Choose changed file", run: () => setFileSheetOpen(true) },
			{ id: "servers", label: "Manage servers", run: () => router.push("/servers") },
			{ id: "terminal", label: "Open terminal", run: () => router.push("/terminal") },
			{ id: "settings", label: "Open settings", run: () => router.push("/settings") },
		],
		[router],
	);

	if (!profiles.hydrated || (workspace.phase === "loading" && !workspace.changes)) {
		return (
			<View className="flex-1 items-center justify-center bg-background">
				<ActivityIndicator colorClassName="accent-primary" />
			</View>
		);
	}
	if (!profiles.activeProfile) {
		return (
			<View className="flex-1 justify-center gap-3.5 bg-background p-6">
				<Text bold selectable size="2xl">
					Pair your first server
				</Text>
				<Text className="text-muted-foreground" selectable>
					Couchview keeps server profiles on this device and stores each credential separately.
				</Text>
				<Link href="/servers" asChild>
					<Pressable className="self-start rounded-md py-2 active:opacity-70">
						<Text className="text-primary">Open server manager</Text>
					</Pressable>
				</Link>
			</View>
		);
	}
	if (workspace.phase === "error" && !workspace.changes) {
		return (
			<View className="flex-1 justify-center gap-3 bg-background p-6">
				<Text accessibilityRole="alert" className="text-destructive" selectable>
					{workspace.error}
				</Text>
				<ActionButton label="Retry" onPress={workspace.retry} />
				<ActionButton label="Manage servers" onPress={() => router.push("/servers")} />
			</View>
		);
	}

	const selectFile = (fileId: string) => {
		workspace.selectFile(fileId);
		setFileSheetOpen(false);
	};
	const selectRepository = (repositoryId: string) => {
		setFileSheetOpen(false);
		void workspace.selectRepository(repositoryId);
	};
	const reviewActions = selectedFile ? (
		<View className="flex-row gap-2">
			<ActionButton
				active={selectedFile.reviewed}
				disabled={workspace.mutationBusy}
				icon={Check}
				label={selectedFile.reviewed ? "Reviewed" : "Review"}
				onPress={() => void workspace.toggleReview(selectedFile)}
			/>
			<ActionButton
				active={selectedFile.staged}
				disabled={workspace.mutationBusy}
				label={selectedFile.staged ? "Unstage" : "Stage"}
				onPress={() => void workspace.toggleStage(selectedFile)}
			/>
		</View>
	) : null;

	return (
		<View className="flex-1 bg-background">
			<View className="min-h-12 flex-row items-center gap-2 border-b border-border px-2.5">
				<ActionButton icon={ListTree} label="Files" onPress={() => setFileSheetOpen(true)} />
				<Text className="flex-1" numberOfLines={1} selectable bold>
					{selectedFile?.path ?? selectedRepository?.name ?? "Couchview"}
				</Text>
				<Text
					className={workspace.connectionState === "connected" ? "text-success" : "text-warning"}
					size="xs"
				>
					{workspace.connectionState}
				</Text>
				<ActionButton icon={Menu} label="Commands" onPress={() => setPaletteOpen(true)} />
			</View>
			<View className="flex-1 flex-row">
				{layout !== "compact" ? (
					<View className="w-[280px] border-r border-border">
						<FileRail
							files={files}
							onSelect={selectFile}
							onSelectRepository={selectRepository}
							repositories={workspace.repositories}
							repositoryId={workspace.repositoryId}
							selectedFileId={workspace.selectedFileId}
						/>
					</View>
				) : null}
				<View className="flex-1">
					{workspace.diff ? (
						<NativeDiffSurface
							comments={comments}
							diff={workspace.diff}
							fontSize={preferences.diffFontSize}
							lineNumbersVisible={preferences.lineNumbersVisible}
							lineWrapEnabled={preferences.lineWrapEnabled}
							dom={{
								contentInsetAdjustmentBehavior: "never",
								scrollEnabled: true,
								style: { flex: 1 },
							}}
							onCommentOpen={async (commentId) => {
								const comment = comments.find(({ id }) => id === commentId);
								if (comment) Alert.alert("Review comment", comment.body);
							}}
							onLinePress={async (lineNumber, side) => {
								try {
									setCommentAnchor(anchorForLine(workspace.diff!, lineNumber, side));
								} catch (lineError) {
									console.warn(lineError);
								}
							}}
							scrollTarget={null}
							theme={resolvedTheme}
						/>
					) : (
						<View className="flex-1 items-center justify-center">
							<ThemedFileText colorClassName="accent-muted-foreground" size={28} />
							<Text className="p-3 text-muted-foreground" selectable>
								Choose a changed file
							</Text>
						</View>
					)}
					{workspace.diffLoading &&
					(selectedFile?.id !== workspace.diff?.fileId ||
						selectedFile?.contentRevision !== workspace.diff?.contentRevision) ? (
						<View className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5">
							<Text className="text-muted-foreground" size="sm">
								Loading next diff…
							</Text>
						</View>
					) : null}
				</View>
				{layout === "contextual" ? (
					<View className="w-[260px] gap-3 border-l border-border p-3">
						<Text bold selectable>
							Review
						</Text>
						{reviewActions}
						<Text className="text-muted-foreground" selectable size="sm">
							{comments.length} comment{comments.length === 1 ? "" : "s"}
						</Text>
					</View>
				) : null}
			</View>
			{layout === "compact" ? (
				<View className="flex-row justify-between gap-2 border-t border-border p-2">
					{reviewActions}
					<ActionButton
						icon={MessageSquarePlus}
						label="Comment"
						onPress={() => workspace.diff && setCommentAnchor(firstCommentAnchor(workspace.diff))}
					/>
				</View>
			) : null}

			<BottomSheet
				enablePanDownToClose
				index={fileSheetOpen ? 0 : -1}
				onClose={() => setFileSheetOpen(false)}
				snapPoints={["88%"]}
			>
				<ThemedBottomSheetView className="flex-1 bg-background pt-4">
					<FileRail
						files={files}
						onSelect={selectFile}
						onSelectRepository={selectRepository}
						repositories={workspace.repositories}
						repositoryId={workspace.repositoryId}
						selectedFileId={workspace.selectedFileId}
					/>
				</ThemedBottomSheetView>
			</BottomSheet>
			<CommentComposer
				key={commentAnchor ? `${commentAnchor.fileId}:${commentAnchor.startLine}` : "closed"}
				anchor={commentAnchor}
				onClose={() => setCommentAnchor(null)}
				onSave={(body) => {
					if (commentAnchor) void workspace.createComment(commentAnchor, body);
					setCommentAnchor(null);
				}}
			/>
			<NativeCommandPalette
				commands={commands}
				onClose={() => setPaletteOpen(false)}
				open={paletteOpen}
			/>
		</View>
	);
}
