import { Archive, ArrowLeft, Plus, RefreshCw, Search, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import type { RepositorySummary } from "../../../shared/contracts.ts";
import type { ArtifactsController } from "../../features/artifacts/index.ts";
import {
	Button,
	Card,
	CardContent,
	EmptyState,
	Heading,
	HStack,
	Icon,
	IconButton,
	Select,
	Spinner,
	Text,
	Toolbar,
	VStack,
} from "../ui/index.ts";
import { ArtifactCard } from "./ArtifactCard.tsx";
import { ArtifactDefinitionForm } from "./ArtifactDefinitionForm.tsx";

interface ArtifactsPageProps {
	commandPaletteShortcut: string;
	controller: ArtifactsController;
	onBack(): void;
	onOpenCommandPalette(): void;
	onOpenPairing(): void;
	repository: RepositorySummary | null;
	repositoryId: string | null;
}

export function ArtifactsPage({
	commandPaletteShortcut,
	controller,
	onBack,
	onOpenCommandPalette,
	onOpenPairing,
	repository,
	repositoryId,
}: ArtifactsPageProps) {
	const [creationMode, setCreationMode] = useState<"manual" | "suggest" | null>(null);
	const creating = creationMode !== null;
	const [editingId, setEditingId] = useState<string | null>(null);
	const selectedDevice =
		controller.devices.find((device) => device.id === controller.selectedDeviceId) ?? null;
	const closeEditor = () => {
		setCreationMode(null);
		setEditingId(null);
	};
	const startCreation = (mode: "manual" | "suggest") => {
		setEditingId(null);
		setCreationMode(mode);
	};

	return (
		<View
			accessibilityLabel="Repository artifacts"
			className="min-h-0 flex-1 bg-background"
			role="main"
		>
			<Toolbar className="min-h-14" placement="top">
				<Button leftIcon={ArrowLeft} onPress={onBack} size="sm" variant="outline">
					Review
				</Button>
				<HStack align="center" className="min-w-0 flex-1" space="sm">
					<Icon as={Archive} size={18} tone="primary" />
					<VStack className="min-w-0" space="xs">
						<Heading className="text-base" level={1} numberOfLines={1}>
							Artifacts
						</Heading>
						<Text numberOfLines={1} size="xs" tone="muted">
							{repository?.name ?? "Repository"}
						</Text>
					</VStack>
				</HStack>
				<IconButton
					accessibilityHint={`Shortcut: ${commandPaletteShortcut}`}
					accessibilityLabel="Open command palette"
					icon={Search}
					onPress={onOpenCommandPalette}
				/>
				<IconButton
					accessibilityHint={controller.proposalCapability.reason ?? "Suggest artifact with Codex"}
					accessibilityLabel="Suggest artifact with Codex"
					disabled={!repositoryId || creating || !controller.proposalCapability.available}
					icon={Sparkles}
					onPress={() => startCreation("suggest")}
				/>
				<Button
					disabled={!repositoryId || creating}
					leftIcon={Plus}
					onPress={() => startCreation("manual")}
					size="sm"
				>
					New
				</Button>
			</Toolbar>

			<ScrollView
				className="min-h-0 flex-1"
				contentContainerClassName="mx-auto w-full max-w-5xl gap-4 p-4 pb-safe"
				contentInsetAdjustmentBehavior="automatic"
			>
				<Card>
					<CardContent>
						<View className="gap-4 md:flex-row md:items-center md:justify-between">
							<VStack className="min-w-0 flex-1" space="sm">
								<Heading level={2}>Build once, download anywhere</Heading>
								<Text className="leading-5" tone="muted">
									Couchview runs an exact command in this repository, snapshots one output, and
									retains the latest two successful builds. Installation remains up to the
									downloader.
								</Text>
							</VStack>
							<View className="min-w-64">
								{controller.devices.length ? (
									<Select
										label="CLI device"
										onValueChange={controller.setSelectedDeviceId}
										options={controller.devices.map((device) => ({
											label: `${device.label} · ${device.sshAlias}`,
											value: device.id,
										}))}
										value={controller.selectedDeviceId ?? undefined}
									/>
								) : (
									<Button onPress={onOpenPairing} variant="outline">
										Pair a device for CLI pulls
									</Button>
								)}
							</View>
						</View>
					</CardContent>
				</Card>

				{controller.error ? (
					<HStack
						accessibilityRole="alert"
						align="center"
						className="rounded-xl border border-destructive bg-destructive/10 p-3"
						space="sm"
					>
						<Text className="min-w-0 flex-1" tone="destructive">
							{controller.error}
						</Text>
						<Button
							leftIcon={RefreshCw}
							onPress={() => void controller.refresh()}
							size="sm"
							variant="outline"
						>
							Retry
						</Button>
					</HStack>
				) : null}

				{creating ? (
					<ArtifactDefinitionForm
						busy={controller.busy.new === "create"}
						onCancel={closeEditor}
						onPropose={controller.propose}
						onSave={async (input) => {
							const saved = await controller.create(input);
							if (saved) closeEditor();
							return saved;
						}}
						proposalBusy={controller.proposalBusy}
						proposalCapability={controller.proposalCapability}
						suggestOnOpen={creationMode === "suggest"}
					/>
				) : null}

				{controller.loading && !controller.artifacts.length ? (
					<VStack
						accessibilityRole="progressbar"
						align="center"
						className="min-h-40"
						justify="center"
						space="sm"
					>
						<Spinner />
						<Text tone="muted">Loading artifact definitions…</Text>
					</VStack>
				) : controller.artifacts.length ? (
					<VStack space="md">
						{controller.artifacts.map((item) =>
							editingId === item.definition.id ? (
								<ArtifactDefinitionForm
									busy={controller.busy[item.definition.id] === "update"}
									definition={item.definition}
									key={item.definition.id}
									onCancel={closeEditor}
									onPropose={controller.propose}
									onSave={async (input) => {
										const saved = await controller.update(item.definition, input);
										if (saved) closeEditor();
										return saved;
									}}
									proposalBusy={controller.proposalBusy}
									proposalCapability={controller.proposalCapability}
								/>
							) : (
								<ArtifactCard
									busyAction={controller.busy[item.definition.id] ?? null}
									item={item}
									key={item.definition.id}
									onBuild={() => void controller.build(item.definition.id)}
									onCopy={() => void controller.copyCommand(item.definition)}
									onDelete={() => void controller.remove(item.definition.id)}
									onEdit={() => {
										setCreationMode(null);
										setEditingId(item.definition.id);
									}}
									onPair={onOpenPairing}
									onStop={(runId) => void controller.stop(item.definition.id, runId)}
									repositoryId={repositoryId ?? item.definition.repositoryId}
									selectedDevice={selectedDevice}
									snapshot={controller.snapshots[item.definition.id]}
								/>
							),
						)}
					</VStack>
				) : !creating && !controller.error ? (
					<EmptyState
						action={
							<HStack space="sm" wrap>
								<Button leftIcon={Plus} onPress={() => startCreation("manual")}>
									Create artifact
								</Button>
								<Button
									disabled={!controller.proposalCapability.available}
									leftIcon={Sparkles}
									onPress={() => startCreation("suggest")}
									variant="outline"
								>
									Suggest with Codex
								</Button>
							</HStack>
						}
						description="Define a build command and the exact file or directory it produces."
						icon={Archive}
						title="No artifacts yet"
					/>
				) : null}
			</ScrollView>
		</View>
	);
}
