import {
	Archive,
	ChevronDown,
	ChevronUp,
	GitBranch,
	GitGraph,
	Link2,
	Menu,
	Minus,
	MonitorUp,
	Plus,
	Search,
	Settings2,
	SquareTerminal,
	WrapText,
} from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";

import type {
	FileChange,
	FileDiff,
	RemoteBridgeCapability,
	RepositorySummary,
	TerminalCapability,
} from "../../shared/contracts.ts";
import type { RepositoryConnectionState } from "../features/repositories/types.ts";
import { changeLabel, stageLabel } from "../features/staging/changeFiles.ts";
import { TYPOGRAPHY_LIMITS } from "../typographyPreferences.ts";
import { Badge, Button, Icon, IconButton, Text } from "./ui";

interface ReviewTopBarProps {
	activeFile: FileChange | null;
	activePath: string | null;
	canNavigateNextHunk: boolean;
	canNavigatePreviousHunk: boolean;
	commandPaletteShortcut: string;
	compactLandscape: boolean;
	connectionState: RepositoryConnectionState;
	diff: FileDiff | null;
	fileCount: number;
	fontSize: number;
	lineNumbersVisible: boolean;
	lineWrapEnabled: boolean;
	onFontSizeChange: (fontSize: number) => void;
	onLineNumbersChange: (visible: boolean) => void;
	onLineWrapChange: (enabled: boolean) => void;
	onCopyLink: () => void;
	onNavigateHunk: (direction: -1 | 1) => void;
	onOpenCommandPalette: () => void;
	onOpenDrawer: () => void;
	onOpenArtifacts: () => void;
	onOpenGitHistory: () => void;
	onOpenRemoteBridge: () => void;
	onOpenRepositoryPicker: () => void;
	onOpenSettings: () => void;
	onOpenTerminal: () => void;
	remoteBridgeCapability: RemoteBridgeCapability;
	readOnly: boolean;
	repository: RepositorySummary | null;
	repositoryId: string | null;
	reviewedCount: number;
	splitView: boolean;
	terminalActive: boolean;
	terminalCapability: TerminalCapability;
}

const connectionDotClass: Record<RepositoryConnectionState, string> = {
	connected: "size-2 rounded-full bg-success",
	offline: "size-2 rounded-full bg-destructive",
	reconnecting: "size-2 rounded-full bg-warning",
};

function connectionTitle(connectionState: RepositoryConnectionState): string {
	if (connectionState === "connected") return "Connected";
	if (connectionState === "reconnecting") return "Reconnecting to local server";
	return "Offline — local server unavailable";
}

function FileContext({
	activeFile,
	activePath,
	diff,
	readOnly,
}: {
	activeFile: FileChange | null;
	activePath: string | null;
	diff: FileDiff | null;
	readOnly: boolean;
}) {
	if (!activeFile) {
		if (activePath) {
			return (
				<View className="min-w-0 flex-1 gap-1">
					<Text className="font-mono text-sm" numberOfLines={1} selectable>
						{activePath}
					</Text>
					{readOnly ? <Badge variant="outline">read-only</Badge> : null}
				</View>
			);
		}
		return (
			<Text className="min-w-0 flex-1 text-sm text-muted-foreground" numberOfLines={1}>
				No changed file
			</Text>
		);
	}
	const staged = stageLabel(activeFile);
	return (
		<View className="min-w-0 flex-1 gap-1">
			<Text className="font-mono text-sm" numberOfLines={1} selectable>
				{activeFile.path}
			</Text>
			<View className="flex-row flex-wrap items-center gap-1">
				<Badge variant={activeFile.conflicted ? "destructive" : "outline"}>
					{changeLabel(activeFile)}
				</Badge>
				<Text className="text-xs font-semibold text-success">
					+{activeFile.additions ?? diff?.additions ?? 0}
				</Text>
				<Text className="text-xs font-semibold text-destructive">
					−{activeFile.deletions ?? diff?.deletions ?? 0}
				</Text>
				{activeFile.reviewed ? <Badge variant="success">reviewed</Badge> : null}
				{staged ? (
					<Badge
						variant={staged === "staged" ? "primary" : staged === "partial" ? "warning" : "neutral"}
					>
						{staged}
					</Badge>
				) : null}
			</View>
		</View>
	);
}

export function ReviewTopBar({
	activeFile,
	activePath,
	canNavigateNextHunk,
	canNavigatePreviousHunk,
	commandPaletteShortcut,
	compactLandscape,
	connectionState,
	diff,
	fileCount,
	fontSize,
	lineNumbersVisible,
	lineWrapEnabled,
	onFontSizeChange,
	onLineNumbersChange,
	onLineWrapChange,
	onCopyLink,
	onNavigateHunk,
	onOpenCommandPalette,
	onOpenDrawer,
	onOpenArtifacts,
	onOpenGitHistory,
	onOpenRemoteBridge,
	onOpenRepositoryPicker,
	onOpenSettings,
	onOpenTerminal,
	remoteBridgeCapability,
	readOnly,
	repository,
	repositoryId,
	reviewedCount,
	splitView,
	terminalActive,
	terminalCapability,
}: ReviewTopBarProps) {
	const hasRepository = Boolean(repositoryId && repository);
	const decreaseFont = () =>
		onFontSizeChange(
			Math.max(
				TYPOGRAPHY_LIMITS.diff.fontSize.min,
				fontSize - TYPOGRAPHY_LIMITS.diff.fontSize.step,
			),
		);
	const increaseFont = () =>
		onFontSizeChange(
			Math.min(
				TYPOGRAPHY_LIMITS.diff.fontSize.max,
				fontSize + TYPOGRAPHY_LIMITS.diff.fontSize.step,
			),
		);

	return (
		<View
			className={
				compactLandscape
					? "min-h-11 flex-row items-center gap-1 border-b border-border bg-card px-2 py-1 pt-safe"
					: "min-h-14 flex-row items-center gap-2 border-b border-border bg-card px-3 py-2 pt-safe"
			}
		>
			{!splitView ? (
				<IconButton
					accessibilityLabel="Open changed files"
					icon={Menu}
					onPress={onOpenDrawer}
					size={compactLandscape ? "sm" : "md"}
				/>
			) : null}
			{compactLandscape ? (
				<View
					accessibilityLabel="Current file"
					className="min-w-0 flex-1 flex-row items-center gap-2"
					role="region"
				>
					<Pressable
						accessibilityHint={`${repository?.name ?? "Couchview"}, ${repository?.branch ?? "detached"}`}
						accessibilityLabel="Select repository"
						accessibilityRole="button"
						className="max-w-36 flex-row items-center gap-1 rounded-lg px-1.5 py-1 active:bg-muted"
						onPress={onOpenRepositoryPicker}
					>
						<View
							accessibilityLabel={connectionTitle(connectionState)}
							className={connectionDotClass[connectionState]}
							testID="repository-connection-status"
						/>
						<Text className="min-w-0 text-xs font-semibold" numberOfLines={1}>
							{repository?.name ?? "Couchview"}
						</Text>
						<Icon as={ChevronDown} size={12} tone="muted" />
					</Pressable>
					<Text className="text-muted-foreground">/</Text>
					<FileContext
						activeFile={activeFile}
						activePath={activePath}
						diff={diff}
						readOnly={readOnly}
					/>
				</View>
			) : (
				<Pressable
					accessibilityHint={`${repository?.branch ?? "detached"}, ${reviewedCount} of ${fileCount} reviewed`}
					accessibilityLabel="Select repository"
					accessibilityRole="button"
					className="min-w-0 flex-1 flex-row items-center gap-2 rounded-lg px-1 py-1 active:bg-muted sm:max-w-64"
					onPress={onOpenRepositoryPicker}
				>
					<View
						accessibilityLabel={connectionTitle(connectionState)}
						className={connectionDotClass[connectionState]}
						testID="repository-connection-status"
					/>
					<View className="min-w-0 flex-1">
						<View className="flex-row items-center gap-1">
							<Text className="min-w-0 font-semibold" numberOfLines={1}>
								{repository?.name ?? "Couchview"}
							</Text>
							<Icon as={ChevronDown} size={13} tone="muted" />
						</View>
						<View className="flex-row items-center gap-1">
							<Icon as={GitBranch} size={11} tone="muted" />
							<Text className="text-xs text-muted-foreground" numberOfLines={1}>
								{repository?.branch ?? "detached"} · {reviewedCount}/{fileCount} reviewed
							</Text>
						</View>
					</View>
				</Pressable>
			)}
			<ScrollView
				contentContainerClassName="flex-row items-center gap-1"
				horizontal
				showsHorizontalScrollIndicator={false}
			>
				{compactLandscape ? (
					<View className="flex-row gap-1">
						<IconButton
							accessibilityLabel="Previous hunk"
							disabled={!canNavigatePreviousHunk}
							icon={ChevronUp}
							onPress={() => onNavigateHunk(-1)}
							size="sm"
						/>
						<IconButton
							accessibilityLabel="Next hunk"
							disabled={!canNavigateNextHunk}
							icon={ChevronDown}
							onPress={() => onNavigateHunk(1)}
							size="sm"
						/>
					</View>
				) : null}
				<IconButton
					accessibilityHint={`Shortcut: ${commandPaletteShortcut}`}
					accessibilityLabel="Open command palette"
					icon={Search}
					onPress={onOpenCommandPalette}
					size="sm"
				/>
				<IconButton
					accessibilityLabel="Open repository artifacts"
					disabled={!hasRepository}
					icon={Archive}
					onPress={onOpenArtifacts}
					size="sm"
				/>
				<IconButton
					accessibilityLabel="Open Git history"
					disabled={!hasRepository}
					icon={GitGraph}
					onPress={onOpenGitHistory}
					size="sm"
				/>
				<IconButton
					accessibilityHint={remoteBridgeCapability.reason ?? undefined}
					accessibilityLabel="Set up native IDE"
					disabled={!hasRepository}
					icon={MonitorUp}
					onPress={onOpenRemoteBridge}
					size="sm"
				/>
				<IconButton
					accessibilityHint={terminalCapability.reason ?? undefined}
					accessibilityLabel="Open tmux terminal"
					accessibilityState={{ selected: terminalActive }}
					disabled={!terminalCapability.available || !repositoryId}
					icon={SquareTerminal}
					onPress={onOpenTerminal}
					size="sm"
					variant={terminalActive ? "secondary" : "ghost"}
				/>
				{compactLandscape ? (
					<>
						<IconButton
							accessibilityLabel="Copy link to current line"
							disabled={!activePath}
							icon={Link2}
							onPress={onCopyLink}
							size="sm"
						/>
						<IconButton
							accessibilityLabel="Open settings"
							icon={Settings2}
							onPress={onOpenSettings}
							size="sm"
						/>
					</>
				) : null}
				<View accessibilityLabel="Diff display controls" className="flex-row items-center gap-1">
					<Button
						accessibilityLabel={lineNumbersVisible ? "Hide line numbers" : "Show line numbers"}
						accessibilityState={{ selected: lineNumbersVisible }}
						onPress={() => onLineNumbersChange(!lineNumbersVisible)}
						size="sm"
						variant={lineNumbersVisible ? "secondary" : "ghost"}
					>
						123
					</Button>
					<IconButton
						accessibilityLabel={lineWrapEnabled ? "Keep long lines on one line" : "Wrap long lines"}
						accessibilityState={{ selected: lineWrapEnabled }}
						icon={WrapText}
						onPress={() => onLineWrapChange(!lineWrapEnabled)}
						size="sm"
						variant={lineWrapEnabled ? "secondary" : "ghost"}
					/>
					<IconButton
						accessibilityLabel="Decrease diff font size"
						disabled={fontSize <= TYPOGRAPHY_LIMITS.diff.fontSize.min}
						icon={Minus}
						onPress={decreaseFont}
						size="sm"
					/>
					<Text className="min-w-10 text-center text-xs text-muted-foreground">{fontSize}px</Text>
					<IconButton
						accessibilityLabel="Increase diff font size"
						disabled={fontSize >= TYPOGRAPHY_LIMITS.diff.fontSize.max}
						icon={Plus}
						onPress={increaseFont}
						size="sm"
					/>
				</View>
			</ScrollView>
		</View>
	);
}
