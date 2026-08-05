import BottomSheet, { BottomSheetView } from "@expo/ui/community/bottom-sheet";
import { FlashList } from "@shopify/flash-list";
import { Link, useRouter } from "expo-router";
import { Check, FileText, ListTree, Menu, MessageSquarePlus } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	Pressable,
	Text,
	TextInput,
	useWindowDimensions,
	View,
} from "react-native";

import type { ChangeFile, FileDiff, RepositoryCatalogEntry } from "../../../shared/contracts.ts";
import { useNativePreferences } from "../../features/nativePreferences/NativePreferencesProvider.tsx";
import { useNativeServer } from "../../features/nativeServers/NativeServerProvider.tsx";
import type { NativeCommentAnchor } from "../../features/nativeServers/useNativeWorkspace.ts";
import { selectWorkbenchLayout } from "../../lib/workbenchLayout.ts";
import { type NativeCommand, NativeCommandPalette } from "./NativeCommandPalette.tsx";
import NativeDiffSurface from "./NativeDiffSurface.tsx";
import { nativeTheme } from "./nativeTheme.ts";

function ActionButton(props: {
	label: string;
	onPress(): void;
	active?: boolean;
	icon?: typeof Check;
	disabled?: boolean;
}) {
	const Icon = props.icon;
	return (
		<Pressable
			accessibilityLabel={props.label}
			disabled={props.disabled}
			onPress={props.onPress}
			style={{
				alignItems: "center",
				backgroundColor: props.active ? nativeTheme.accentStrong : nativeTheme.panelRaised,
				borderColor: nativeTheme.border,
				borderRadius: 9,
				borderWidth: 1,
				flexDirection: "row",
				gap: 6,
				opacity: props.disabled ? 0.5 : 1,
				paddingHorizontal: 10,
				paddingVertical: 8,
			}}
		>
			{Icon ? <Icon color={nativeTheme.text} size={15} /> : null}
			<Text style={{ color: nativeTheme.text, fontSize: 12, fontWeight: "600" }}>
				{props.label}
			</Text>
		</Pressable>
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
		<View style={{ backgroundColor: nativeTheme.panel, flex: 1, minWidth: 250 }}>
			<View style={{ borderBottomColor: nativeTheme.border, borderBottomWidth: 1, padding: 8 }}>
				<Text style={{ color: nativeTheme.muted, fontSize: 11, fontWeight: "700" }}>
					REPOSITORIES
				</Text>
				{props.repositories.map((repository) => (
					<Pressable
						disabled={!repository.available}
						key={repository.id}
						onPress={() => props.onSelectRepository(repository.id)}
						style={{
							backgroundColor:
								repository.id === props.repositoryId ? nativeTheme.panelRaised : "transparent",
							borderRadius: 8,
							opacity: repository.available ? 1 : 0.45,
							paddingHorizontal: 8,
							paddingVertical: 7,
						}}
					>
						<Text numberOfLines={1} style={{ color: nativeTheme.text, fontSize: 12 }}>
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
						onPress={() => props.onSelect(item.id)}
						style={{
							backgroundColor:
								item.id === props.selectedFileId ? nativeTheme.panelRaised : "transparent",
							borderBottomColor: nativeTheme.border,
							borderBottomWidth: 1,
							gap: 3,
							paddingHorizontal: 12,
							paddingVertical: 10,
						}}
					>
						<Text numberOfLines={1} style={{ color: nativeTheme.text, fontSize: 13 }}>
							{item.path}
						</Text>
						<Text style={{ color: nativeTheme.muted, fontSize: 11 }}>
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
			<BottomSheetView
				style={{ backgroundColor: nativeTheme.background, flex: 1, gap: 14, padding: 18 }}
			>
				<Text selectable style={{ color: nativeTheme.text, fontSize: 20, fontWeight: "700" }}>
					Add comment
				</Text>
				<TextInput
					accessibilityLabel="Comment"
					autoFocus
					multiline
					onChangeText={setBody}
					placeholder="What should change?"
					placeholderTextColor={nativeTheme.muted}
					style={{
						backgroundColor: nativeTheme.panelRaised,
						borderColor: nativeTheme.border,
						borderRadius: 12,
						borderWidth: 1,
						color: nativeTheme.text,
						minHeight: 160,
						padding: 12,
					}}
					value={body}
				/>
				<View style={{ flexDirection: "row", gap: 8 }}>
					<ActionButton label="Cancel" onPress={props.onClose} />
					<ActionButton
						disabled={!body.trim()}
						label="Save comment"
						onPress={() => props.onSave(body.trim())}
					/>
				</View>
			</BottomSheetView>
		</BottomSheet>
	);
}

export function NativeWorkbench() {
	const { profiles, workspace } = useNativeServer();
	const { preferences } = useNativePreferences();
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
			<View
				style={{
					alignItems: "center",
					backgroundColor: nativeTheme.background,
					flex: 1,
					justifyContent: "center",
				}}
			>
				<ActivityIndicator color={nativeTheme.accent} />
			</View>
		);
	}
	if (!profiles.activeProfile) {
		return (
			<View
				style={{
					backgroundColor: nativeTheme.background,
					flex: 1,
					gap: 14,
					justifyContent: "center",
					padding: 24,
				}}
			>
				<Text selectable style={{ color: nativeTheme.text, fontSize: 24, fontWeight: "700" }}>
					Pair your first server
				</Text>
				<Text selectable style={{ color: nativeTheme.muted }}>
					Couchview keeps server profiles on this device and stores each credential separately.
				</Text>
				<Link href="/servers" asChild>
					<Pressable style={{ alignSelf: "flex-start" }}>
						<Text style={{ color: nativeTheme.accent }}>Open server manager</Text>
					</Pressable>
				</Link>
			</View>
		);
	}
	if (workspace.phase === "error" && !workspace.changes) {
		return (
			<View
				style={{
					backgroundColor: nativeTheme.background,
					flex: 1,
					gap: 12,
					justifyContent: "center",
					padding: 24,
				}}
			>
				<Text accessibilityRole="alert" selectable style={{ color: nativeTheme.red }}>
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
		<View style={{ flexDirection: "row", gap: 8 }}>
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
		<View style={{ backgroundColor: nativeTheme.background, flex: 1 }}>
			<View
				style={{
					alignItems: "center",
					borderBottomColor: nativeTheme.border,
					borderBottomWidth: 1,
					flexDirection: "row",
					gap: 8,
					minHeight: 48,
					paddingHorizontal: 10,
				}}
			>
				<ActionButton icon={ListTree} label="Files" onPress={() => setFileSheetOpen(true)} />
				<Text
					numberOfLines={1}
					selectable
					style={{ color: nativeTheme.text, flex: 1, fontWeight: "600" }}
				>
					{selectedFile?.path ?? selectedRepository?.name ?? "Couchview"}
				</Text>
				<Text
					style={{
						color:
							workspace.connectionState === "connected" ? nativeTheme.green : nativeTheme.warning,
						fontSize: 11,
					}}
				>
					{workspace.connectionState}
				</Text>
				<ActionButton icon={Menu} label="Commands" onPress={() => setPaletteOpen(true)} />
			</View>
			<View style={{ flex: 1, flexDirection: "row" }}>
				{layout !== "compact" ? (
					<View style={{ borderRightColor: nativeTheme.border, borderRightWidth: 1, width: 280 }}>
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
				<View style={{ flex: 1 }}>
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
						/>
					) : (
						<View style={{ alignItems: "center", flex: 1, justifyContent: "center" }}>
							<FileText color={nativeTheme.muted} size={28} />
							<Text selectable style={{ color: nativeTheme.muted, padding: 12 }}>
								Choose a changed file
							</Text>
						</View>
					)}
					{workspace.diffLoading &&
					(selectedFile?.id !== workspace.diff?.fileId ||
						selectedFile?.contentRevision !== workspace.diff?.contentRevision) ? (
						<View
							style={{
								backgroundColor: "rgba(11,13,16,.82)",
								padding: 6,
								position: "absolute",
								right: 8,
								top: 8,
							}}
						>
							<Text style={{ color: nativeTheme.muted }}>Loading next diff…</Text>
						</View>
					) : null}
				</View>
				{layout === "contextual" ? (
					<View
						style={{
							borderLeftColor: nativeTheme.border,
							borderLeftWidth: 1,
							gap: 12,
							padding: 12,
							width: 260,
						}}
					>
						<Text selectable style={{ color: nativeTheme.text, fontWeight: "600" }}>
							Review
						</Text>
						{reviewActions}
						<Text selectable style={{ color: nativeTheme.muted }}>
							{comments.length} comment{comments.length === 1 ? "" : "s"}
						</Text>
					</View>
				) : null}
			</View>
			{layout === "compact" ? (
				<View
					style={{
						borderTopColor: nativeTheme.border,
						borderTopWidth: 1,
						flexDirection: "row",
						gap: 8,
						justifyContent: "space-between",
						padding: 8,
					}}
				>
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
				<BottomSheetView
					style={{ backgroundColor: nativeTheme.background, flex: 1, paddingTop: 16 }}
				>
					<FileRail
						files={files}
						onSelect={selectFile}
						onSelectRepository={selectRepository}
						repositories={workspace.repositories}
						repositoryId={workspace.repositoryId}
						selectedFileId={workspace.selectedFileId}
					/>
				</BottomSheetView>
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
