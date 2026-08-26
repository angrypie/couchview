import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	ChevronLeft,
	FileCode2,
	GitBranch,
	GitCommitHorizontal,
	History,
	MoreHorizontal,
	RotateCcw,
	Search,
	Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { FileChange, RepositorySummary } from "../../../shared/contracts.ts";
import type { GitHistoryFile } from "../../../shared/git/index.ts";
import type { ResolvedTheme } from "../../../shared/theme.ts";
import { DiffViewer } from "../../DiffViewer.tsx";
import type { GitPendingAction, GitWorkspaceController } from "../../features/git/index.ts";
import type { useDisplayPreferences } from "../../features/settings/useDisplayPreferences.ts";
import { codeFontStack } from "../../typographyPreferences.ts";
import {
	Badge,
	Button,
	EmptyState,
	Heading,
	HStack,
	Icon,
	IconButton,
	ListItem,
	Sheet,
	Spinner,
	Text,
	Toolbar,
	VStack,
} from "../ui/index.ts";
import { GitActionConfirmation } from "./GitActionConfirmation.tsx";

interface GitHistoryPageProps {
	commandPaletteShortcut: string;
	controller: GitWorkspaceController;
	display: ReturnType<typeof useDisplayPreferences>;
	files: FileChange[];
	onBack(): void;
	onOpenCommandPalette(): void;
	repository: RepositorySummary | null;
	splitView: boolean;
	themeType: ResolvedTheme;
}

const commitDate = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

function formatCommitDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : commitDate.format(date);
}

function fileKindLabel(file: GitHistoryFile): string {
	return file.kind === "type-changed" ? "type" : file.kind;
}

function HistoricalDiff({
	controller,
	display,
	themeType,
}: Pick<GitHistoryPageProps, "controller" | "display" | "themeType">) {
	if (controller.diffBusy && !controller.diff) {
		return (
			<VStack align="center" className="flex-1 p-6" justify="center" space="sm">
				<Spinner />
				<Text tone="muted">Loading commit diff…</Text>
			</VStack>
		);
	}
	if (!controller.diff) {
		return (
			<EmptyState
				description="Select a changed file to preview its commit diff."
				icon={FileCode2}
				title="No file selected"
			/>
		);
	}
	if (controller.diff.binary) {
		return (
			<EmptyState
				description="A line-by-line preview is not available."
				icon={FileCode2}
				title="Binary file"
			/>
		);
	}
	if (controller.diff.hunks.length === 0) {
		return (
			<EmptyState
				description="This change has no textual hunks."
				icon={FileCode2}
				title="No textual changes"
			/>
		);
	}

	return (
		<View className="relative min-h-0 flex-1 overflow-hidden">
			<DiffViewer
				diff={controller.diff}
				fontFamily={codeFontStack(display.typography.diff.fontFamily)}
				fontSize={display.fontSize}
				interactive={false}
				lineHeightAdjustment={display.typography.diff.lineHeightAdjustment}
				lineNumbersVisible={display.lineNumbersVisible}
				lineWrapEnabled={display.lineWrapEnabled}
				onIdentifierClick={() => undefined}
				onVisibleLineChange={() => undefined}
				themeType={themeType}
				widthAdjustment={display.typography.diff.widthAdjustment}
			/>
			{controller.diffBusy ? (
				<HStack
					align="center"
					className="absolute right-2 top-2 rounded-full border border-border bg-popover px-2 py-1"
					space="xs"
				>
					<Spinner size="small" />
					<Text size="xs" tone="muted">
						Refreshing diff…
					</Text>
				</HStack>
			) : null}
		</View>
	);
}

interface HistoryPaneProps {
	controller: GitWorkspaceController;
}

function CommitHistoryPane({ controller }: HistoryPaneProps) {
	return (
		<View accessibilityLabel="Commit history" className="min-h-0 flex-1" role="region">
			<View className="mx-auto min-h-0 w-full max-w-3xl flex-1 border-border md:border-x">
				<HStack className="m-2 rounded-xl bg-muted p-1" space="xs">
					<Button
						className="flex-1"
						onPress={() => controller.setScope("current")}
						size="sm"
						variant={controller.scope === "current" ? "primary" : "ghost"}
					>
						Current
					</Button>
					<Button
						className="flex-1"
						onPress={() => controller.setScope("all")}
						size="sm"
						variant={controller.scope === "all" ? "primary" : "ghost"}
					>
						Branches &amp; tags
					</Button>
				</HStack>

				{controller.loading && controller.commits.length === 0 ? (
					<VStack align="center" className="flex-1" justify="center">
						<Spinner />
					</VStack>
				) : controller.commits.length === 0 ? (
					<EmptyState description="No commits in this scope." icon={History} title="No commits" />
				) : (
					<ScrollView className="min-h-0 flex-1" contentContainerClassName="gap-1 p-2">
						{controller.commits.map((commit) => (
							<Pressable
								accessibilityRole="button"
								className="flex-row items-start gap-3 rounded-xl border-l-2 border-transparent p-3 active:opacity-80 hover:bg-muted"
								key={commit.id}
								onPress={() => void controller.selectCommit(commit)}
							>
								<Icon as={GitCommitHorizontal} size={18} tone="primary" />
								<VStack className="min-w-0 flex-1" space="xs">
									<Text numberOfLines={2} size="sm">
										{commit.subject || "Untitled commit"}
									</Text>
									<Text numberOfLines={1} size="xs" tone="muted">
										{commit.shortId} · {commit.authorName} · {formatCommitDate(commit.authoredAt)}
									</Text>
									{commit.decorations.length ? (
										<HStack space="xs" wrap>
											{commit.decorations.map((decoration) => (
												<Badge key={decoration} variant="outline">
													{decoration}
												</Badge>
											))}
										</HStack>
									) : null}
								</VStack>
							</Pressable>
						))}
						{controller.nextCursor ? (
							<Button
								className="mt-2"
								loading={controller.loadMoreBusy}
								onPress={() => void controller.loadMore()}
								variant="outline"
							>
								Load more
							</Button>
						) : (
							<Text className="py-3 text-center" size="xs" tone="muted">
								End of history · {controller.commits.length}{" "}
								{controller.commits.length === 1 ? "commit" : "commits"}
							</Text>
						)}
					</ScrollView>
				)}
			</View>
		</View>
	);
}

interface FilesPaneProps extends HistoryPaneProps {
	onCheckout(): void;
	splitView: boolean;
	visible: boolean;
}

function CommitFilesPane({ controller, onCheckout, splitView, visible }: FilesPaneProps) {
	return (
		<View
			accessibilityLabel="Commit files"
			className={
				!visible
					? "hidden min-h-0 flex-1"
					: splitView
						? "flex min-h-0 w-[300px] shrink-0 border-r border-border bg-card"
						: "flex min-h-0 flex-1"
			}
			role="region"
		>
			<HStack align="center" className="min-h-14 border-b border-border px-2 py-2" space="sm">
				{splitView ? null : (
					<IconButton
						accessibilityLabel="Back to commits"
						icon={ChevronLeft}
						onPress={controller.showCommits}
						size="sm"
					/>
				)}
				<VStack className="min-w-0 flex-1" space="xs">
					<Text bold numberOfLines={1} size="sm">
						{controller.details?.commit.subject ?? "Commit changes"}
					</Text>
					{controller.details ? (
						<Text numberOfLines={1} size="xs" tone="muted">
							{controller.details.commit.shortId} · {controller.details.files.length} changed{" "}
							{controller.details.files.length === 1 ? "file" : "files"}
						</Text>
					) : null}
				</VStack>
				{controller.details ? (
					<Button disabled={Boolean(controller.actionBusy)} onPress={onCheckout} size="sm">
						Checkout
					</Button>
				) : null}
			</HStack>

			{controller.detailsBusy ? (
				<VStack align="center" className="flex-1" justify="center">
					<Spinner />
				</VStack>
			) : controller.details?.files.length ? (
				<ScrollView className="min-h-0 flex-1" contentContainerClassName="gap-1 p-2">
					{controller.details.files.map((file) => {
						const selected = controller.selectedFileId === file.id;
						return (
							<Pressable
								accessibilityRole="button"
								accessibilityState={{ selected }}
								className={
									selected
										? "flex-row items-start gap-3 rounded-xl border-l-2 border-primary bg-accent p-3 active:opacity-80"
										: "flex-row items-start gap-3 rounded-xl border-l-2 border-transparent p-3 active:opacity-80 hover:bg-muted"
								}
								key={file.id}
								onPress={() => void controller.selectFile(file.id)}
							>
								<Icon as={FileCode2} size={18} tone="primary" />
								<VStack className="min-w-0 flex-1" space="xs">
									<Text bold={selected} numberOfLines={2} size="sm">
										{file.path}
									</Text>
									<Text size="xs" tone="muted">
										{fileKindLabel(file)} · +{file.additions ?? "–"} −{file.deletions ?? "–"}
									</Text>
								</VStack>
							</Pressable>
						);
					})}
				</ScrollView>
			) : (
				<EmptyState
					description={
						controller.details
							? "This commit has no changed files."
							: "Select a commit to inspect its files."
					}
					icon={FileCode2}
					title={controller.details ? "No changed files" : "No commit selected"}
				/>
			)}
		</View>
	);
}

function HistoricalDiffPane({
	controller,
	display,
	splitView,
	themeType,
	visible,
}: Pick<GitHistoryPageProps, "controller" | "display" | "splitView" | "themeType"> & {
	visible: boolean;
}) {
	return (
		<View
			accessibilityLabel="Historical diff"
			className={visible ? "flex min-h-0 flex-1" : "hidden min-h-0 flex-1"}
			role="region"
		>
			<HStack align="center" className="min-h-14 border-b border-border px-2 py-2" space="sm">
				{splitView ? null : (
					<IconButton
						accessibilityLabel="Back to commit files"
						icon={ChevronLeft}
						onPress={controller.showFiles}
						size="sm"
					/>
				)}
				<VStack className="min-w-0 flex-1" space="xs">
					<Text bold numberOfLines={1} size="sm">
						{controller.diff?.path ?? "Commit diff"}
					</Text>
					{controller.diff ? (
						<Text size="xs" tone="muted">
							Read-only historical preview
						</Text>
					) : null}
				</VStack>
			</HStack>
			<HistoricalDiff controller={controller} display={display} themeType={themeType} />
		</View>
	);
}

interface RepositoryActionsProps {
	controller: GitWorkspaceController;
	files: FileChange[];
	onOpenChange(open: boolean): void;
	onRequestAction(pending: GitPendingAction): void;
	open: boolean;
	repository: RepositorySummary | null;
}

function RepositoryActions({
	controller,
	files,
	onOpenChange,
	onRequestAction,
	open,
	repository,
}: RepositoryActionsProps) {
	return (
		<Sheet onOpenChange={onOpenChange} open={open} title="Repository actions">
			<ListItem
				accessibilityRole="menuitem"
				disabled={files.length === 0}
				leading={<Icon as={Archive} tone="primary" />}
				onPress={() => onRequestAction({ action: "stash" })}
				title="Stash changes"
			/>
			<ListItem
				accessibilityRole="menuitem"
				disabled={!controller.status?.stashCount || files.length > 0}
				leading={<Icon as={ArchiveRestore} tone="primary" />}
				onPress={() => onRequestAction({ action: "restore-stash" })}
				subtitle={`${controller.status?.stashCount ?? 0} available`}
				title="Restore latest stash"
			/>
			<ListItem
				accessibilityRole="menuitem"
				disabled={!controller.status?.canUndoLastCommit}
				leading={<Icon as={RotateCcw} tone="primary" />}
				onPress={() => onRequestAction({ action: "undo-last-commit" })}
				title="Undo last commit"
			/>
			<ListItem
				accessibilityRole="menuitem"
				disabled={Boolean(repository?.unborn) || files.length === 0}
				leading={<Icon as={Trash2} tone="destructive" />}
				onPress={() => onRequestAction({ action: "clean" })}
				title="Clean repository"
				tone="destructive"
			/>
		</Sheet>
	);
}

export function GitHistoryPage({
	commandPaletteShortcut,
	controller,
	display,
	files,
	onBack,
	onOpenCommandPalette,
	repository,
	splitView,
	themeType,
}: GitHistoryPageProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const reviewingCommit = Boolean(controller.selectedCommitId);
	const requestAction = (pending: GitPendingAction) => {
		setMenuOpen(false);
		controller.requestAction(pending);
	};
	const back = () => {
		setMenuOpen(false);
		controller.requestAction(null);
		if (reviewingCommit) {
			controller.showCommits();
			return;
		}
		onBack();
	};

	return (
		<View
			accessibilityLabel="Git history and repository actions"
			className="min-h-0 flex-1 bg-background"
			role="main"
		>
			<Toolbar className="min-h-14" placement="top">
				<Button leftIcon={ArrowLeft} onPress={back} size="sm" variant="outline">
					{reviewingCommit ? "History" : "Review"}
				</Button>
				<VStack align="center" className="min-w-0 flex-1" space="xs">
					<Heading className="text-base" level={1} numberOfLines={1}>
						{reviewingCommit ? "Commit review" : "Git history"}
					</Heading>
					<HStack align="center" className="max-w-full" space="xs">
						<Icon as={reviewingCommit ? GitCommitHorizontal : GitBranch} size={12} tone="muted" />
						<Text numberOfLines={1} size="xs" tone="muted">
							{reviewingCommit
								? (controller.details?.commit.shortId ?? controller.selectedCommitId?.slice(0, 7))
								: (repository?.branch ?? `detached at ${repository?.head?.slice(0, 7) ?? "HEAD"}`)}
						</Text>
					</HStack>
				</VStack>
				<IconButton
					accessibilityHint={`Shortcut: ${commandPaletteShortcut}`}
					accessibilityLabel="Open command palette"
					icon={Search}
					onPress={onOpenCommandPalette}
				/>
				<IconButton
					accessibilityLabel="Repository actions"
					icon={MoreHorizontal}
					onPress={() => setMenuOpen(true)}
				/>
			</Toolbar>

			{!repository?.branch && controller.status?.previousBranch ? (
				<HStack
					align="center"
					className="border-b border-warning bg-warning/10 px-3 py-2"
					space="sm"
				>
					<Text className="min-w-0 flex-1" numberOfLines={2} size="sm" tone="warning">
						Detached HEAD · previous branch {controller.status.previousBranch}
					</Text>
					<Button
						disabled={Boolean(controller.actionBusy)}
						onPress={() =>
							files.length > 0
								? requestAction({ action: "return" })
								: void controller.returnToPreviousBranch()
						}
						size="sm"
						variant="outline"
					>
						Return
					</Button>
				</HStack>
			) : null}

			{reviewingCommit ? (
				<View className={splitView ? "min-h-0 flex-1 flex-row" : "min-h-0 flex-1"}>
					<CommitFilesPane
						controller={controller}
						onCheckout={() => {
							if (controller.details) {
								requestAction({ action: "checkout", commit: controller.details.commit });
							}
						}}
						splitView={splitView}
						visible={splitView || !controller.selectedFileId}
					/>
					<HistoricalDiffPane
						controller={controller}
						display={display}
						splitView={splitView}
						themeType={themeType}
						visible={splitView || Boolean(controller.selectedFileId)}
					/>
				</View>
			) : (
				<CommitHistoryPane controller={controller} />
			)}

			<RepositoryActions
				controller={controller}
				files={files}
				onOpenChange={setMenuOpen}
				onRequestAction={requestAction}
				open={menuOpen}
				repository={repository}
			/>
			<GitActionConfirmation
				busy={Boolean(controller.actionBusy)}
				files={files}
				onCancel={() => controller.requestAction(null)}
				onConfirm={() => void controller.performPendingAction()}
				onRequestStash={() => controller.requestAction({ action: "stash" })}
				pending={controller.pendingAction}
				repository={repository}
				status={controller.status}
			/>
		</View>
	);
}
