import { Copy, Download, Pencil, Play, Square, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import {
	API_ROUTES,
	type ArtifactBuild,
	type ArtifactCatalogItem,
	type ArtifactRun,
	type ArtifactRunSnapshot,
	quoteArtifactInvocation,
	type RemoteBridgeDevice,
} from "../../../shared/contracts.ts";
import { downloadArtifact } from "../../lib/artifactDownload";
import {
	Badge,
	type BadgeProps,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Dialog,
	Divider,
	HStack,
	Text,
	VStack,
} from "../ui/index.ts";

interface ArtifactCardProps {
	busyAction: string | null;
	item: ArtifactCatalogItem;
	onBuild(): void;
	onCopy(): void;
	onDelete(): void;
	onEdit(): void;
	onPair(): void;
	onStop(runId: string): void;
	repositoryId: string;
	selectedDevice: RemoteBridgeDevice | null;
	snapshot: ArtifactRunSnapshot | undefined;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

function formatDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatSize(bytes: number): string {
	if (bytes < 1_024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
	if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
	return `${(bytes / 1_073_741_824).toFixed(2)} GiB`;
}

function runVariant(status: ArtifactRun["status"]): BadgeProps["variant"] {
	switch (status) {
		case "succeeded":
			return "success";
		case "failed":
		case "stopped":
			return "destructive";
		case "capturing":
		case "stopping":
			return "warning";
		case "running":
			return "primary";
	}
}

interface DefinitionDatumProps {
	label: string;
	value: string;
}

function DefinitionDatum({ label, value }: DefinitionDatumProps) {
	return (
		<VStack className="min-w-0 flex-1 rounded-xl bg-muted p-3" space="xs">
			<Text className="font-medium uppercase tracking-wide" size="xs" tone="muted">
				{label}
			</Text>
			<Text className="font-mono leading-5" selectable size="sm">
				{value}
			</Text>
		</VStack>
	);
}

interface BuildRowProps {
	build: ArtifactBuild;
	downloading: boolean;
	label: string;
	onDownload(): void;
}

function BuildRow({ build, downloading, label, onDownload }: BuildRowProps) {
	return (
		<HStack align="center" className="rounded-xl border border-border p-3" space="md" wrap>
			<VStack className="min-w-0 flex-1" space="xs">
				<HStack align="center" space="sm" wrap>
					<Text bold size="sm">
						{label}
					</Text>
					<Text size="xs" tone="muted">
						{formatDate(build.createdAt)}
					</Text>
					<Text size="xs" tone="muted">
						{formatSize(build.sizeBytes)}
					</Text>
				</HStack>
				<Text
					accessibilityHint={`Full checksum ${build.sha256}`}
					className="font-mono"
					numberOfLines={1}
					size="xs"
					tone="muted"
				>
					sha256:{build.sha256.slice(0, 12)}…
				</Text>
			</VStack>
			<Button
				disabled={downloading}
				leftIcon={Download}
				loading={downloading}
				onPress={onDownload}
				size="sm"
				variant="outline"
			>
				Download
			</Button>
		</HStack>
	);
}

export function ArtifactCard({
	busyAction,
	item,
	onBuild,
	onCopy,
	onDelete,
	onEdit,
	onPair,
	onStop,
	repositoryId,
	selectedDevice,
	snapshot,
}: ArtifactCardProps) {
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [downloadError, setDownloadError] = useState<string | null>(null);
	const [downloadingBuildId, setDownloadingBuildId] = useState<string | null>(null);
	const { definition } = item;
	const run = snapshot?.run ?? item.activeRun ?? item.recentRun;
	const active = Boolean(run && ["running", "stopping", "capturing"].includes(run.status));
	const output = snapshot && snapshot.run.id === run?.id ? snapshot.output : [];
	const startDownload = async (build: ArtifactBuild) => {
		setDownloadError(null);
		setDownloadingBuildId(build.id);
		try {
			await downloadArtifact({
				downloadName: build.downloadName,
				mediaType: build.mediaType,
				path: API_ROUTES.artifactDownload(repositoryId, definition.id, build.id),
			});
		} catch (error) {
			setDownloadError(
				error instanceof Error ? error.message : "The artifact could not be downloaded.",
			);
		} finally {
			setDownloadingBuildId(null);
		}
	};

	return (
		<Card role="article">
			<CardHeader>
				<HStack align="start" justify="between" space="md" wrap>
					<HStack align="center" className="min-w-0 flex-1" space="sm" wrap>
						<CardTitle>{definition.name}</CardTitle>
						<Badge variant="outline">{definition.outputKind}</Badge>
					</HStack>
					<HStack space="xs">
						<Button
							disabled={active || busyAction !== null}
							leftIcon={Pencil}
							onPress={onEdit}
							size="sm"
							variant="ghost"
						>
							Edit
						</Button>
						<Button
							disabled={busyAction !== null}
							leftIcon={Trash2}
							onPress={() => setDeleteOpen(true)}
							size="sm"
							variant="ghost"
						>
							Delete
						</Button>
					</HStack>
				</HStack>
			</CardHeader>

			<CardContent>
				<View className="gap-2 md:flex-row">
					<DefinitionDatum label="Command" value={quoteArtifactInvocation(definition.argv)} />
					<DefinitionDatum label="From" value={definition.workingDirectory} />
					<DefinitionDatum label="Output" value={definition.outputPath} />
				</View>

				<Divider />

				<VStack accessibilityLabel={`${definition.name} build status`} role="region" space="md">
					<HStack align="center" justify="between" space="md" wrap>
						<VStack className="min-w-0 flex-1" space="xs">
							<Text bold>Build</Text>
							{run ? (
								<HStack align="center" space="sm" wrap>
									<Badge variant={runVariant(run.status)}>{run.status}</Badge>
									<Text size="xs" tone="muted">
										{formatDate(run.startedAt)}
									</Text>
									{run.exitCode !== null ? (
										<Text size="xs" tone="muted">
											exit {run.exitCode}
										</Text>
									) : null}
								</HStack>
							) : (
								<Text size="sm" tone="muted">
									Not built in this session.
								</Text>
							)}
						</VStack>
						{active && run ? (
							<Button
								disabled={run.status === "stopping" || busyAction !== null}
								leftIcon={Square}
								loading={busyAction === "stop"}
								onPress={() => onStop(run.id)}
								variant="destructive"
							>
								{run.status === "stopping" ? "Stopping…" : "Stop"}
							</Button>
						) : (
							<Button
								disabled={busyAction !== null}
								leftIcon={Play}
								loading={busyAction === "build"}
								onPress={onBuild}
							>
								{busyAction === "build" ? "Starting…" : "Build"}
							</Button>
						)}
					</HStack>

					{run ? (
						<VStack space="sm">
							<ScrollView
								accessibilityLabel={`${definition.name} build output`}
								className="max-h-64 rounded-xl bg-muted"
								contentContainerClassName="p-3"
							>
								<Text className="font-mono leading-5" selectable size="xs">
									{run.outputTruncated ? "[Earlier output was truncated.]\n" : ""}
									{output.length
										? output.map((chunk) => (
												<Text
													key={chunk.sequence}
													tone={chunk.stream === "stderr" ? "destructive" : "foreground"}
												>
													{chunk.text}
												</Text>
											))
										: active
											? "Waiting for output…"
											: "The command produced no retained output."}
								</Text>
							</ScrollView>
							{run.error ? (
								<Text accessibilityRole="alert" size="sm" tone="destructive">
									{run.error}
								</Text>
							) : null}
						</VStack>
					) : null}
				</VStack>

				<Divider />

				<VStack accessibilityLabel={`${definition.name} downloads`} role="region" space="md">
					<HStack align="center" justify="between" space="md" wrap>
						<VStack className="min-w-0 flex-1" space="xs">
							<Text bold>Downloads</Text>
							<Text size="sm" tone="muted">
								The latest two successful snapshots are retained.
							</Text>
						</VStack>
						<Button
							leftIcon={selectedDevice ? Copy : undefined}
							onPress={selectedDevice ? onCopy : onPair}
							size="sm"
							variant="ghost"
						>
							{selectedDevice ? "Copy CLI command" : "Pair a device"}
						</Button>
					</HStack>
					{item.builds.length ? (
						<VStack space="sm">
							{item.builds.map((build, index) => (
								<BuildRow
									build={build}
									downloading={downloadingBuildId === build.id}
									key={build.id}
									label={index === 0 ? "Latest" : "Previous"}
									onDownload={() => void startDownload(build)}
								/>
							))}
						</VStack>
					) : (
						<Text size="sm" tone="muted">
							A successful build will appear here.
						</Text>
					)}
					{downloadError ? (
						<Text accessibilityRole="alert" size="sm" tone="destructive">
							{downloadError}
						</Text>
					) : null}
				</VStack>
			</CardContent>

			<Dialog
				footer={
					<HStack justify="end" space="sm">
						<Button onPress={() => setDeleteOpen(false)} variant="secondary">
							Cancel
						</Button>
						<Button
							loading={busyAction === "delete"}
							onPress={() => {
								setDeleteOpen(false);
								onDelete();
							}}
							variant="destructive"
						>
							Delete artifact
						</Button>
					</HStack>
				}
				onOpenChange={setDeleteOpen}
				open={deleteOpen}
				title={`Delete ${definition.name}?`}
			>
				<Text className="leading-5">
					This removes the definition and both retained artifact snapshots. This action cannot be
					undone.
				</Text>
			</Dialog>
		</Card>
	);
}
