import { Archive, ArrowLeft, Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import type { RepositorySummary } from "../../../shared/contracts.ts";
import type { ArtifactsController } from "../../features/artifacts/index.ts";
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

	return (
		<main aria-label="Repository artifacts" className="artifacts-page">
			<header className="artifacts-toolbar">
				<button
					aria-label="Review"
					className="terminal-toolbar-button"
					onClick={onBack}
					type="button"
				>
					<ArrowLeft size={16} /> <span>Review</span>
				</button>
				<div className="artifacts-heading">
					<Archive size={16} />
					<div>
						<strong>Artifacts</strong>
						<span>{repository?.name ?? "Repository"}</span>
					</div>
				</div>
				<div className="artifacts-toolbar-actions">
					<button
						aria-label="Open command palette"
						className="terminal-toolbar-button command-palette-trigger"
						onClick={onOpenCommandPalette}
						title={`Open command palette (${commandPaletteShortcut})`}
						type="button"
					>
						<Search size={15} />
						<span className="workspace-command-label">Commands</span>
						<kbd className="workspace-command-shortcut">{commandPaletteShortcut}</kbd>
					</button>
					<button
						className="action-button artifacts-new-button"
						disabled={!repositoryId || creating}
						onClick={() => {
							setEditingId(null);
							setCreationMode("manual");
						}}
						type="button"
					>
						<Plus size={15} /> New artifact
					</button>
					<button
						aria-label="Suggest artifact with Codex"
						className="terminal-toolbar-button artifacts-suggest-button"
						disabled={!repositoryId || creating || !controller.proposalCapability.available}
						onClick={() => {
							setEditingId(null);
							setCreationMode("suggest");
						}}
						title={controller.proposalCapability.reason ?? "Suggest artifact with Codex"}
						type="button"
					>
						<Sparkles size={15} /> <span>Suggest</span>
					</button>
				</div>
			</header>
			<div className="artifacts-scroll">
				<section className="artifacts-intro">
					<div>
						<h1>Build once, download anywhere</h1>
						<p>
							Couchview runs an exact command in this repository, snapshots one output, and retains
							the latest two successful builds. Installation remains up to the downloader.
						</p>
					</div>
					<div className="artifact-device-picker">
						{controller.devices.length ? (
							<>
								<label htmlFor="artifact-cli-device">CLI device</label>
								<select
									id="artifact-cli-device"
									onChange={(event) => controller.setSelectedDeviceId(event.target.value)}
									value={controller.selectedDeviceId ?? ""}
								>
									{controller.devices.map((device) => (
										<option key={device.id} value={device.id}>
											{device.label} · {device.sshAlias}
										</option>
									))}
								</select>
							</>
						) : (
							<button className="text-button" onClick={onOpenPairing} type="button">
								Pair a device for CLI pulls
							</button>
						)}
					</div>
				</section>

				{controller.error && (
					<div className="artifact-error" role="alert">
						<span>{controller.error}</span>
						<button className="text-button" onClick={() => void controller.refresh()} type="button">
							<RefreshCw size={13} /> Retry
						</button>
					</div>
				)}

				{creating && (
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
				)}

				{controller.loading && !controller.artifacts.length ? (
					<div className="artifacts-state" role="status">
						<span className="spinner" /> Loading artifact definitions…
					</div>
				) : controller.artifacts.length ? (
					<div className="artifact-list">
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
					</div>
				) : !creating && !controller.error ? (
					<div className="artifacts-state empty">
						<Archive size={28} />
						<h2>No artifacts yet</h2>
						<p>Define a build command and the exact file or directory it produces.</p>
						<div className="artifacts-empty-actions">
							<button
								className="action-button"
								onClick={() => setCreationMode("manual")}
								type="button"
							>
								<Plus size={15} /> Create artifact
							</button>
							<button
								className="action-button secondary"
								disabled={!controller.proposalCapability.available}
								onClick={() => setCreationMode("suggest")}
								type="button"
							>
								<Sparkles size={15} /> Suggest with Codex
							</button>
						</div>
					</div>
				) : null}
			</div>
		</main>
	);
}
