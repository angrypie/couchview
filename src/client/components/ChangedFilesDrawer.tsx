import {
	CheckCircle2,
	Circle,
	GitCommitHorizontal,
	GitPullRequestArrow,
	ListFilter,
	LoaderCircle,
	Play,
	SquareTerminal,
	Undo2,
	X,
} from "lucide-react-native";
import { Modal, Pressable, ScrollView, View } from "react-native";

import type {
	FileChange,
	PackageRunSummary,
	PackageScriptDefinition,
	PackageScriptsPackage,
	PackageScriptsResponse,
} from "../../shared/contracts.ts";
import { packageLabel, runStatusLabel } from "../features/packages/packageRuns.ts";
import { changeLabel, stageLabel } from "../features/staging/changeFiles.ts";
import type {
	BulkStageScope,
	DrawerView,
	ReviewFilter,
	StageFilter,
} from "../features/staging/types.ts";
import { SpeechInput } from "./speech";
import { Badge, Button, EmptyState, Heading, Icon, IconButton, Select, Spinner, Text } from "./ui";

export type { DrawerView };

interface ChangedFilesDrawerProps {
	bulkStageBusy: BulkStageScope | null;
	bulkReviewBusy: boolean;
	changeTotals: { additions: number; deletions: number };
	commandsAvailable: boolean;
	commandsLoading: boolean;
	commitBusy: boolean;
	currentFileId: string | null;
	fileQuery: string;
	files: FileChange[];
	filteredFiles: FileChange[];
	onClose: () => void;
	onCommit: () => void;
	onFileQueryChange: (query: string) => void;
	onOpenRun: (run: PackageRunSummary) => void;
	onReviewFilterChange: (filter: ReviewFilter) => void;
	onSelectFile: (fileId: string) => void;
	onStageFilterChange: (filter: StageFilter) => void;
	onStageMultiple: (scope: BulkStageScope) => void;
	onUnreviewMultiple: () => void;
	onStartScript: (packageEntry: PackageScriptsPackage, script: PackageScriptDefinition) => void;
	onViewChange: (view: DrawerView) => void;
	open: boolean;
	packageRunBusy: string | null;
	packageRuns: PackageRunSummary[];
	packageScripts: PackageScriptsResponse;
	reviewFilter: ReviewFilter;
	filteredReviewedCount: number;
	splitView: boolean;
	stageBusy: boolean;
	stageFilter: StageFilter;
	stageableCount: number;
	stageableReviewedCount: number;
	stagedCount: number;
	view: DrawerView;
}

const reviewOptions = [
	{ label: "All", value: "all" },
	{ label: "Unreviewed", value: "unreviewed" },
	{ label: "Reviewed", value: "reviewed" },
] as const;

const stageOptions = [
	{ label: "Any", value: "all" },
	{ label: "Unstaged", value: "unstaged" },
	{ label: "Staged", value: "staged" },
] as const;

function FilePath({ path }: { path: string }) {
	const separatorIndex = path.lastIndexOf("/");
	const directory = separatorIndex >= 0 ? path.slice(0, separatorIndex + 1) : "";
	const name = path.slice(separatorIndex + 1);
	return (
		<Text accessibilityLabel={path} className="font-mono text-sm" numberOfLines={1}>
			{directory ? <Text className="text-muted-foreground">{directory}</Text> : null}
			<Text className="font-mono text-sm font-semibold">{name}</Text>
		</Text>
	);
}

function DrawerHeader({
	changeTotals,
	fileCount,
	onClose,
	packageCount,
	splitView,
	view,
}: {
	changeTotals: ChangedFilesDrawerProps["changeTotals"];
	fileCount: number;
	onClose: () => void;
	packageCount: number;
	splitView: boolean;
	view: DrawerView;
}) {
	const fileSummary = `${fileCount} changed ${fileCount === 1 ? "file" : "files"}, ${changeTotals.additions} ${changeTotals.additions === 1 ? "addition" : "additions"}, ${changeTotals.deletions} ${changeTotals.deletions === 1 ? "deletion" : "deletions"}`;
	return (
		<View className="min-h-14 flex-row items-center justify-between gap-2 border-b border-border px-3 py-2">
			<View className="min-w-0 flex-1 gap-1">
				<Heading className="text-base" level={2}>
					{view === "files" ? "Changed files" : "Package commands"}
				</Heading>
				{view === "files" ? (
					<View
						accessibilityLabel={fileSummary}
						className="flex-row flex-wrap items-center gap-1.5"
					>
						<Text className="text-xs text-muted-foreground">
							{fileCount} {fileCount === 1 ? "file" : "files"}
						</Text>
						<Text className="text-xs text-muted-foreground">·</Text>
						<Text className="text-xs font-semibold text-success">+{changeTotals.additions}</Text>
						<Text className="text-xs font-semibold text-destructive">
							−{changeTotals.deletions}
						</Text>
					</View>
				) : (
					<Text className="text-xs text-muted-foreground">
						{packageCount} {packageCount === 1 ? "package" : "packages"}
					</Text>
				)}
			</View>
			{splitView ? null : (
				<IconButton accessibilityLabel="Close changed files" icon={X} onPress={onClose} size="sm" />
			)}
		</View>
	);
}

function DrawerFilters({
	commandsAvailable,
	fileQuery,
	onFileQueryChange,
	onReviewFilterChange,
	onStageFilterChange,
	onViewChange,
	reviewFilter,
	stageFilter,
	view,
}: Pick<
	ChangedFilesDrawerProps,
	| "commandsAvailable"
	| "fileQuery"
	| "onFileQueryChange"
	| "onReviewFilterChange"
	| "onStageFilterChange"
	| "onViewChange"
	| "reviewFilter"
	| "stageFilter"
	| "view"
>) {
	return (
		<View className="gap-2 border-b border-border p-2.5">
			{commandsAvailable ? (
				<View accessibilityLabel="Project drawer views" className="flex-row gap-2">
					<Button
						accessibilityState={{ selected: view === "files" }}
						className="flex-1"
						onPress={() => onViewChange("files")}
						size="sm"
						variant={view === "files" ? "secondary" : "ghost"}
					>
						Files
					</Button>
					<Button
						accessibilityState={{ selected: view === "commands" }}
						className="flex-1"
						leftIcon={SquareTerminal}
						onPress={() => onViewChange("commands")}
						size="sm"
						variant={view === "commands" ? "secondary" : "ghost"}
					>
						Commands
					</Button>
				</View>
			) : null}
			{view === "files" ? (
				<>
					<SpeechInput
						accessibilityLabel="Filter changed files"
						autoCapitalize="none"
						autoCorrect={false}
						inputMode="search"
						onChangeText={onFileQueryChange}
						placeholder="Filter paths…"
						role="searchbox"
						value={fileQuery}
					/>
					<View className="flex-row gap-2">
						<View className="min-w-0 flex-1">
							<Select
								accessibilityLabel="Review filter"
								className="min-h-9"
								label="Review"
								onValueChange={(value) => onReviewFilterChange(value as ReviewFilter)}
								options={reviewOptions}
								value={reviewFilter}
							/>
						</View>
						<View className="min-w-0 flex-1">
							<Select
								accessibilityLabel="Stage filter"
								className="min-h-9"
								label="Stage"
								onValueChange={(value) => onStageFilterChange(value as StageFilter)}
								options={stageOptions}
								value={stageFilter}
							/>
						</View>
					</View>
				</>
			) : (
				<View className="rounded-lg border border-warning/40 bg-warning/10 p-3">
					<Text className="text-xs text-warning">
						Package scripts run on this computer as your user. Only run commands from repositories
						and networks you trust.
					</Text>
				</View>
			)}
		</View>
	);
}

function FileList({
	currentFileId,
	files,
	onSelectFile,
}: {
	currentFileId: string | null;
	files: FileChange[];
	onSelectFile: (fileId: string) => void;
}) {
	if (files.length === 0) {
		return (
			<EmptyState
				className="min-h-40"
				description="Try a different path, review, or staging filter."
				icon={ListFilter}
				title="No files match these filters"
			/>
		);
	}
	return (
		<View className="gap-1 p-2">
			{files.map((file) => {
				const change = changeLabel(file);
				const stage = stageLabel(file);
				const selected = file.id === currentFileId;
				return (
					<Pressable
						accessibilityLabel={file.path}
						accessibilityRole="button"
						accessibilityState={{ selected }}
						className={
							selected
								? "flex-row items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-2.5"
								: "flex-row items-start gap-2 rounded-lg border border-transparent p-2.5 active:bg-muted"
						}
						key={file.id}
						onPress={() => onSelectFile(file.id)}
					>
						<Icon
							as={file.reviewed ? CheckCircle2 : Circle}
							size={17}
							tone={file.reviewed ? "success" : "muted"}
						/>
						<View className="min-w-0 flex-1 gap-1">
							<FilePath path={file.path} />
							<View className="flex-row flex-wrap items-center gap-1.5">
								<Text className="text-xs text-muted-foreground">{change}</Text>
								{stage && stage !== change ? (
									<Text className="text-xs text-muted-foreground">{stage}</Text>
								) : null}
								{file.additions !== null ? (
									<Text className="text-xs font-semibold text-success">+{file.additions}</Text>
								) : null}
								{file.deletions !== null ? (
									<Text className="text-xs font-semibold text-destructive">−{file.deletions}</Text>
								) : null}
							</View>
						</View>
						{file.staged ? (
							<Icon accessibilityLabel="Staged" as={GitPullRequestArrow} size={14} tone="primary" />
						) : null}
					</Pressable>
				);
			})}
		</View>
	);
}

function runVariant(status: PackageRunSummary["status"]) {
	if (status === "failed") return "destructive" as const;
	if (status === "succeeded") return "success" as const;
	if (status === "running" || status === "stopping") return "warning" as const;
	return "neutral" as const;
}

function CommandList({
	commandsLoading,
	onOpenRun,
	onStartScript,
	packageRunBusy,
	packageRuns,
	packageScripts,
}: Pick<
	ChangedFilesDrawerProps,
	| "commandsLoading"
	| "onOpenRun"
	| "onStartScript"
	| "packageRunBusy"
	| "packageRuns"
	| "packageScripts"
>) {
	if (commandsLoading && packageScripts.packages.length === 0) {
		return (
			<View className="min-h-40 items-center justify-center gap-3 p-6">
				<Spinner accessibilityLabel="Finding package scripts" size="large" />
				<Text className="text-sm text-muted-foreground">Finding package scripts…</Text>
			</View>
		);
	}
	if (
		packageScripts.packages.length === 0 &&
		packageRuns.length === 0 &&
		packageScripts.warnings.length === 0
	) {
		return (
			<EmptyState
				className="min-h-40"
				description="Add a package.json script to run it from Couchview."
				icon={SquareTerminal}
				title="No package.json files were detected"
			/>
		);
	}
	return (
		<View className="gap-4 p-3">
			{packageRuns.length > 0 ? (
				<View accessibilityLabel="Recent package runs" className="gap-2">
					<Heading className="text-sm" level={3}>
						Active and recent runs
					</Heading>
					{packageRuns.map((run) => (
						<Pressable
							accessibilityRole="button"
							className="flex-row items-center gap-2 rounded-lg border border-border p-2.5 active:bg-muted"
							key={run.id}
							onPress={() => onOpenRun(run)}
						>
							<View className="min-w-0 flex-1 gap-0.5">
								<Text className="text-sm font-semibold" numberOfLines={1}>
									{run.scriptName}
								</Text>
								<Text className="font-mono text-xs text-muted-foreground" numberOfLines={2}>
									{run.directory} · {run.invocation}
								</Text>
							</View>
							<Badge variant={runVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
						</Pressable>
					))}
				</View>
			) : null}
			{packageScripts.packages.map((packageEntry) => (
				<View className="gap-2" key={packageEntry.packagePath}>
					<View className="gap-0.5 border-b border-border pb-2">
						<Heading className="text-sm" level={3}>
							{packageLabel(packageEntry)}
						</Heading>
						<Text className="font-mono text-xs text-muted-foreground" numberOfLines={1}>
							{packageEntry.directory}
						</Text>
					</View>
					{packageEntry.scripts.length > 0 ? (
						packageEntry.scripts.map((script) => {
							const busyKey = `${packageEntry.packagePath}\0${script.name}`;
							const active = packageRuns.some(
								(run) =>
									run.packagePath === packageEntry.packagePath &&
									run.scriptName === script.name &&
									["running", "stopping"].includes(run.status),
							);
							const busy = packageRunBusy === busyKey;
							return (
								<View
									className="flex-row items-center gap-2 rounded-lg border border-border p-2.5"
									key={script.name}
								>
									<View className="min-w-0 flex-1 gap-0.5">
										<Text className="text-sm font-semibold" numberOfLines={1}>
											{script.name}
										</Text>
										<Text className="font-mono text-xs text-muted-foreground" numberOfLines={2}>
											{script.command}
										</Text>
									</View>
									<IconButton
										accessibilityHint={active ? "This script is already running" : "Run script"}
										accessibilityLabel={`Run ${script.name} in ${packageEntry.directory}`}
										accessibilityState={{ busy, disabled: active || busy }}
										disabled={active || busy}
										icon={busy ? LoaderCircle : Play}
										onPress={() => onStartScript(packageEntry, script)}
										size="sm"
										variant="outline"
									/>
								</View>
							);
						})
					) : (
						<Text className="text-xs text-muted-foreground">No scripts in this package.</Text>
					)}
				</View>
			))}
			{packageScripts.warnings.map((warning) => (
				<View
					className="gap-1 rounded-lg border border-warning/40 bg-warning/10 p-3"
					key={`${warning.packagePath}:${warning.message}`}
				>
					<Text className="text-xs font-semibold text-warning">{warning.packagePath}</Text>
					<Text className="text-xs text-warning">{warning.message}</Text>
				</View>
			))}
		</View>
	);
}

function DrawerFooter({
	bulkReviewBusy,
	bulkStageBusy,
	commitBusy,
	filteredReviewedCount,
	onCommit,
	onStageMultiple,
	onUnreviewMultiple,
	stageBusy,
	stageableCount,
	stageableReviewedCount,
	stagedCount,
	view,
}: Pick<
	ChangedFilesDrawerProps,
	| "bulkReviewBusy"
	| "bulkStageBusy"
	| "commitBusy"
	| "filteredReviewedCount"
	| "onCommit"
	| "onStageMultiple"
	| "onUnreviewMultiple"
	| "stageBusy"
	| "stageableCount"
	| "stageableReviewedCount"
	| "stagedCount"
	| "view"
>) {
	if (view === "commands") {
		return (
			<View className="border-t border-border p-3 pb-safe">
				<Text className="text-xs text-muted-foreground">
					Commands keep running when this panel closes. Open a recent run to reconnect to its
					output.
				</Text>
			</View>
		);
	}
	const actionsVisible =
		filteredReviewedCount > 0 || stageableCount > 0 || stageableReviewedCount > 0;
	const stageActionsDisabled = stageBusy || bulkStageBusy !== null || bulkReviewBusy;
	return (
		<View className="gap-2 border-t border-border p-3 pb-safe">
			{actionsVisible ? (
				<View className="flex-row flex-wrap gap-2">
					{filteredReviewedCount > 0 ? (
						<Button
							accessibilityHint="Unreview files shown by the current filters"
							accessibilityLabel={`Unreview shown files (${filteredReviewedCount})`}
							className="min-w-24 flex-1"
							disabled={stageBusy || bulkStageBusy !== null}
							leftIcon={Undo2}
							loading={bulkReviewBusy}
							onPress={onUnreviewMultiple}
							size="sm"
							variant="secondary"
						>
							Unreview {filteredReviewedCount}
						</Button>
					) : null}
					{stageableCount > 0 ? (
						<Button
							accessibilityLabel={`Stage all files (${stageableCount})`}
							className="min-w-20 flex-1"
							disabled={stageActionsDisabled}
							leftIcon={GitPullRequestArrow}
							loading={bulkStageBusy === "all"}
							onPress={() => onStageMultiple("all")}
							size="sm"
							variant="secondary"
						>
							All {stageableCount}
						</Button>
					) : null}
					{stageableReviewedCount > 0 ? (
						<Button
							accessibilityLabel={`Stage reviewed files (${stageableReviewedCount})`}
							className="min-w-24 flex-1"
							disabled={stageActionsDisabled}
							leftIcon={CheckCircle2}
							loading={bulkStageBusy === "reviewed"}
							onPress={() => onStageMultiple("reviewed")}
							size="sm"
							variant="secondary"
						>
							Reviewed {stageableReviewedCount}
						</Button>
					) : null}
				</View>
			) : null}
			{stagedCount > 0 ? (
				<Button
					accessibilityLabel={`Commit ${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`}
					fullWidth
					leftIcon={GitCommitHorizontal}
					loading={commitBusy}
					onPress={onCommit}
				>
					Commit {stagedCount} staged {stagedCount === 1 ? "file" : "files"}
				</Button>
			) : (
				<View className="flex-row items-center justify-center gap-2 py-1">
					<Icon as={GitCommitHorizontal} size={16} tone="muted" />
					<Text className="text-xs text-muted-foreground">No staged changes</Text>
				</View>
			)}
		</View>
	);
}

function DrawerPanel(props: ChangedFilesDrawerProps) {
	return (
		<>
			<DrawerHeader
				changeTotals={props.changeTotals}
				fileCount={props.files.length}
				onClose={props.onClose}
				packageCount={props.packageScripts.packages.length}
				splitView={props.splitView}
				view={props.view}
			/>
			<DrawerFilters
				commandsAvailable={props.commandsAvailable}
				fileQuery={props.fileQuery}
				onFileQueryChange={props.onFileQueryChange}
				onReviewFilterChange={props.onReviewFilterChange}
				onStageFilterChange={props.onStageFilterChange}
				onViewChange={props.onViewChange}
				reviewFilter={props.reviewFilter}
				stageFilter={props.stageFilter}
				view={props.view}
			/>
			<ScrollView className="min-h-0 flex-1" keyboardShouldPersistTaps="handled">
				{props.view === "files" ? (
					<FileList
						currentFileId={props.currentFileId}
						files={props.filteredFiles}
						onSelectFile={props.onSelectFile}
					/>
				) : (
					<CommandList
						commandsLoading={props.commandsLoading}
						onOpenRun={props.onOpenRun}
						onStartScript={props.onStartScript}
						packageRunBusy={props.packageRunBusy}
						packageRuns={props.packageRuns}
						packageScripts={props.packageScripts}
					/>
				)}
			</ScrollView>
			<DrawerFooter
				bulkReviewBusy={props.bulkReviewBusy}
				bulkStageBusy={props.bulkStageBusy}
				commitBusy={props.commitBusy}
				filteredReviewedCount={props.filteredReviewedCount}
				onCommit={props.onCommit}
				onStageMultiple={props.onStageMultiple}
				onUnreviewMultiple={props.onUnreviewMultiple}
				stageBusy={props.stageBusy}
				stageableCount={props.stageableCount}
				stageableReviewedCount={props.stageableReviewedCount}
				stagedCount={props.stagedCount}
				view={props.view}
			/>
		</>
	);
}

export function ChangedFilesDrawer(props: ChangedFilesDrawerProps) {
	if (!props.open) return null;
	if (props.splitView) {
		return (
			<View
				accessibilityLabel="Changed files"
				className="w-[300px] shrink-0 overflow-hidden border-r border-border bg-card"
				role="complementary"
			>
				<DrawerPanel {...props} />
			</View>
		);
	}
	return (
		<Modal
			animationType="slide"
			onRequestClose={props.onClose}
			presentationStyle="overFullScreen"
			transparent
			visible={props.open}
		>
			<View className="flex-1">
				<Pressable
					accessibilityLabel="Close changed files"
					accessibilityRole="button"
					className="absolute inset-0 bg-scrim"
					onPress={props.onClose}
				/>
				<View
					accessibilityLabel="Changed files"
					accessibilityViewIsModal
					className="h-full w-[89%] max-w-sm overflow-hidden border-r border-border bg-card pt-safe shadow-lg"
					role="dialog"
				>
					<DrawerPanel {...props} />
				</View>
			</View>
		</Modal>
	);
}
