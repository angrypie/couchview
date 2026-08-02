import { LoaderCircle, Square, X } from "lucide-react";
import type { RefObject } from "react";
import type { PackageRunSnapshot, PackageRunSummary } from "../../shared/contracts.ts";
import { runElapsed, runStatusLabel } from "../features/packages/packageRuns.ts";

interface PackageRunSheetProps {
	busyKey: string | null;
	clock: number;
	onClose: () => void;
	onStop: () => void;
	outputRef: RefObject<HTMLPreElement | null>;
	repositoryRoot?: string;
	run: PackageRunSummary | null;
	snapshot: PackageRunSnapshot | null;
}

export function PackageRunSheet({
	busyKey,
	clock,
	onClose,
	onStop,
	outputRef,
	repositoryRoot,
	run,
	snapshot,
}: PackageRunSheetProps) {
	if (!run) return null;
	const active = ["running", "stopping"].includes(run.status);

	return (
		<>
			<button
				aria-label="Close package command output"
				className="sheet-scrim"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-label="Package command output"
				aria-modal="true"
				className="bottom-sheet package-run-sheet"
				role="dialog"
			>
				<span className="sheet-grabber" />
				<header className="sheet-header">
					<div>
						<h2 className="sheet-title">
							{run.packageName ?? run.directory}
							<span className="command-title-separator"> / </span>
							{run.scriptName}
						</h2>
						<div className="repo-meta package-run-meta">
							<span className={`run-status ${run.status}`}>{runStatusLabel(run.status)}</span>
							<span>{runElapsed(run, clock)}</span>
							{run.exitCode !== null && <span>exit {run.exitCode}</span>}
						</div>
					</div>
					<button
						aria-label="Close package command output"
						className="icon-button"
						onClick={onClose}
						type="button"
					>
						<X size={19} />
					</button>
				</header>
				<div className="package-run-context">
					<div>
						<span>Working directory</span>
						<code>
							{run.directory === "." ? repositoryRoot : `${repositoryRoot}/${run.directory}`}
						</code>
					</div>
					<div>
						<span>Invocation</span>
						<code>{run.invocation}</code>
					</div>
					<div>
						<span>package.json script</span>
						<code>{run.command}</code>
					</div>
				</div>
				<pre className="package-output" ref={outputRef}>
					{run.outputTruncated && (
						<span className="package-output-notice">
							[Earlier output was truncated.]
							{"\n"}
						</span>
					)}
					{snapshot?.output.length ? (
						snapshot.output.map((chunk) => (
							<span className={`package-output-${chunk.stream}`} key={chunk.sequence}>
								{chunk.text}
							</span>
						))
					) : (
						<span className="package-output-empty">
							{active ? "Waiting for output…" : "The command produced no output."}
						</span>
					)}
				</pre>
				<footer className="sheet-footer package-run-actions">
					<button className="action-button secondary" onClick={onClose} type="button">
						Close
					</button>
					{active && (
						<button
							className="action-button danger-action"
							disabled={run.status === "stopping" || busyKey === run.id}
							onClick={onStop}
							type="button"
						>
							{busyKey === run.id ? (
								<LoaderCircle className="spinner" size={16} />
							) : (
								<Square size={14} />
							)}
							{run.status === "stopping" ? "Stopping…" : "Stop"}
						</button>
					)}
				</footer>
			</section>
		</>
	);
}
