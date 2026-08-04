import { Copy, Download, LoaderCircle, Pencil, Play, Square, Trash2 } from "lucide-react";

import {
	API_ROUTES,
	type ArtifactCatalogItem,
	type ArtifactRunSnapshot,
	quoteArtifactInvocation,
	type RemoteBridgeDevice,
} from "../../../shared/contracts.ts";

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
	const { definition } = item;
	const run = snapshot?.run ?? item.activeRun ?? item.recentRun;
	const active = Boolean(run && ["running", "stopping", "capturing"].includes(run.status));
	const output = snapshot && snapshot.run.id === run?.id ? snapshot.output : [];
	const deleteArtifact = () => {
		if (
			window.confirm(
				`Delete ${definition.name} and both retained artifact snapshots? This cannot be undone.`,
			)
		) {
			onDelete();
		}
	};

	return (
		<article className="artifact-card">
			<header className="artifact-card-header">
				<div className="artifact-card-title">
					<h2>{definition.name}</h2>
					<span className={`artifact-kind ${definition.outputKind}`}>{definition.outputKind}</span>
				</div>
				<div className="artifact-card-actions">
					<button
						className="text-button"
						disabled={active || busyAction !== null}
						onClick={onEdit}
						type="button"
					>
						<Pencil size={13} /> Edit
					</button>
					<button
						className="text-button danger"
						disabled={busyAction !== null}
						onClick={deleteArtifact}
						type="button"
					>
						<Trash2 size={13} /> Delete
					</button>
				</div>
			</header>
			<div className="artifact-definition-summary">
				<div>
					<span>Command</span>
					<code>{quoteArtifactInvocation(definition.argv)}</code>
				</div>
				<div>
					<span>From</span>
					<code>{definition.workingDirectory}</code>
				</div>
				<div>
					<span>Output</span>
					<code>{definition.outputPath}</code>
				</div>
			</div>

			<section className="artifact-run-panel" aria-label={`${definition.name} build status`}>
				<div className="artifact-section-heading">
					<div>
						<h3>Build</h3>
						{run ? (
							<p>
								<span className={`artifact-run-status ${run.status}`}>{run.status}</span>
								<span>{formatDate(run.startedAt)}</span>
								{run.exitCode !== null && <span>exit {run.exitCode}</span>}
							</p>
						) : (
							<p>Not built in this browser session.</p>
						)}
					</div>
					{active && run ? (
						<button
							className="action-button danger-action"
							disabled={run.status === "stopping" || busyAction !== null}
							onClick={() => onStop(run.id)}
							type="button"
						>
							{busyAction === "stop" ? (
								<LoaderCircle className="spinner" size={15} />
							) : (
								<Square size={13} />
							)}
							{run.status === "stopping" ? "Stopping…" : "Stop"}
						</button>
					) : (
						<button
							className="action-button"
							disabled={busyAction !== null}
							onClick={onBuild}
							type="button"
						>
							{busyAction === "build" ? (
								<LoaderCircle className="spinner" size={15} />
							) : (
								<Play size={14} />
							)}
							{busyAction === "build" ? "Starting…" : "Build"}
						</button>
					)}
				</div>
				{run && (
					<>
						<pre className="artifact-output" aria-label={`${definition.name} build output`}>
							{run.outputTruncated && "[Earlier output was truncated.]\n"}
							{output.length
								? output.map((chunk) => (
										<span className={`artifact-output-${chunk.stream}`} key={chunk.sequence}>
											{chunk.text}
										</span>
									))
								: active
									? "Waiting for output…"
									: "The command produced no retained output."}
						</pre>
						{run.error && <p className="artifact-run-error">{run.error}</p>}
					</>
				)}
			</section>

			<section className="artifact-builds" aria-label={`${definition.name} downloads`}>
				<div className="artifact-section-heading">
					<div>
						<h3>Downloads</h3>
						<p>The latest two successful snapshots are retained.</p>
					</div>
					{selectedDevice ? (
						<button className="text-button" onClick={onCopy} type="button">
							<Copy size={13} /> Copy CLI command
						</button>
					) : (
						<button className="text-button" onClick={onPair} type="button">
							Pair a device
						</button>
					)}
				</div>
				{item.builds.length ? (
					<ul className="artifact-build-list">
						{item.builds.map((build, index) => (
							<li key={build.id}>
								<div className="artifact-build-metadata">
									<strong>{index === 0 ? "Latest" : "Previous"}</strong>
									<span>{formatDate(build.createdAt)}</span>
									<span>{formatSize(build.sizeBytes)}</span>
									<code title={build.sha256}>sha256:{build.sha256.slice(0, 12)}…</code>
								</div>
								<a
									className="action-button secondary artifact-download"
									download={build.downloadName}
									href={API_ROUTES.artifactDownload(repositoryId, definition.id, build.id)}
								>
									<Download size={14} /> Download
								</a>
							</li>
						))}
					</ul>
				) : (
					<p className="artifact-empty-copy">A successful build will appear here.</p>
				)}
			</section>
		</article>
	);
}
