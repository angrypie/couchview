import { Save, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
	type ArtifactDefinition,
	type ArtifactDefinitionInput,
	type ArtifactProposalResponse,
	type CodexCapability,
	parseArtifactCommandLine,
	quoteArtifactInvocation,
} from "../../../shared/contracts.ts";

interface ArtifactDefinitionFormProps {
	busy: boolean;
	definition?: ArtifactDefinition;
	onCancel(): void;
	onPropose?(request: string): Promise<ArtifactProposalResponse | null>;
	onSave(input: ArtifactDefinitionInput): Promise<boolean>;
	proposalBusy?: boolean;
	proposalCapability?: CodexCapability;
	suggestOnOpen?: boolean;
}

interface ArtifactDraft {
	command: string;
	name: string;
	outputKind: "file" | "directory";
	outputPath: string;
	workingDirectory: string;
}

function draftFor(definition?: ArtifactDefinition): ArtifactDraft {
	return {
		command: definition ? quoteArtifactInvocation(definition.argv) : "",
		name: definition?.name ?? "",
		outputKind: definition?.outputKind ?? "file",
		outputPath: definition?.outputPath ?? "",
		workingDirectory: definition?.workingDirectory ?? ".",
	};
}

function draftForProposal(proposal: ArtifactDefinitionInput): ArtifactDraft {
	return {
		command: quoteArtifactInvocation(proposal.argv),
		name: proposal.name,
		outputKind: proposal.outputKind,
		outputPath: proposal.outputPath,
		workingDirectory: proposal.workingDirectory,
	};
}

function parsedCommand(command: string): { argv: string[]; error: string | null } {
	if (!command.trim()) return { argv: [], error: null };
	try {
		return { argv: parseArtifactCommandLine(command), error: null };
	} catch (error) {
		return {
			argv: [],
			error: error instanceof Error ? error.message : "Command is invalid",
		};
	}
}

export function ArtifactDefinitionForm({
	busy,
	definition,
	onCancel,
	onPropose,
	onSave,
	proposalBusy = false,
	proposalCapability = { available: false, reason: "Artifact suggestions are unavailable." },
	suggestOnOpen = false,
}: ArtifactDefinitionFormProps) {
	const [draft, setDraft] = useState(() => draftFor(definition));
	const [proposalOpen, setProposalOpen] = useState(suggestOnOpen);
	const [proposalRequest, setProposalRequest] = useState("");
	const [proposalResult, setProposalResult] = useState<ArtifactProposalResponse | null>(null);
	const command = useMemo(() => parsedCommand(draft.command), [draft.command]);
	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!draft.name || !draft.outputPath || command.argv.length === 0 || command.error) return;
		await onSave({
			name: draft.name,
			argv: command.argv,
			workingDirectory: draft.workingDirectory || ".",
			outputPath: draft.outputPath,
			outputKind: draft.outputKind,
		});
	};
	const propose = async () => {
		if (!onPropose || !proposalCapability.available || proposalBusy) return;
		const response = await onPropose(proposalRequest);
		if (!response) return;
		setDraft(draftForProposal(response.proposal));
		setProposalResult(response);
		setProposalOpen(false);
	};

	return (
		<form
			aria-label={definition ? `Edit ${definition.name} artifact` : "Create artifact"}
			className="artifact-form"
			onSubmit={(event) => void save(event)}
		>
			<header className="artifact-form-header">
				<div>
					<h2>{definition ? `Edit ${definition.name}` : "New artifact"}</h2>
					<p>Type a familiar command. Couchview parses exact arguments and never uses a shell.</p>
				</div>
				<div className="artifact-form-header-actions">
					<button
						className="text-button artifact-magic-button"
						disabled={!proposalCapability.available || proposalBusy}
						onClick={() => setProposalOpen((open) => !open)}
						title={proposalCapability.reason ?? "Suggest from repository configuration"}
						type="button"
					>
						<Sparkles size={14} /> {proposalBusy ? "Reading configs…" : "Suggest with Codex"}
					</button>
					<button
						aria-label="Cancel artifact editing"
						className="icon-button"
						onClick={onCancel}
						type="button"
					>
						<X size={17} />
					</button>
				</div>
			</header>
			{proposalOpen && (
				<section className="artifact-proposal" aria-label="Codex artifact suggestion">
					<label htmlFor="artifact-proposal-request">What should this artifact produce?</label>
					<div>
						<input
							autoFocus
							id="artifact-proposal-request"
							maxLength={2_000}
							onChange={(event) => setProposalRequest(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								void propose();
							}}
							placeholder="Optional · static build, or compile with Bun"
							value={proposalRequest}
						/>
						<button
							className="action-button"
							disabled={proposalBusy}
							onClick={() => void propose()}
							type="button"
						>
							<Sparkles size={14} /> {proposalBusy ? "Suggesting…" : "Fill form"}
						</button>
					</div>
					<p>
						Leave this empty for the project’s most useful default. Only recognized, shallow build
						configuration is read. Model and reasoning are controlled in Settings.
					</p>
				</section>
			)}
			{proposalResult && (
				<div className="artifact-proposal-result" role="status">
					<Sparkles size={14} />
					<div>
						<strong>Codex filled an editable suggestion</strong>
						<span>{proposalResult.summary}</span>
						<small>
							{proposalResult.configurationFiles.length
								? `Read ${proposalResult.configurationFiles.join(", ")}`
								: "No recognized build configuration was found"}
						</small>
					</div>
				</div>
			)}
			<div className="artifact-form-grid">
				<label>
					<span>Name</span>
					<input
						autoCapitalize="none"
						autoCorrect="off"
						maxLength={64}
						onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
						pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
						placeholder="couchview-cli"
						required
						value={draft.name}
					/>
				</label>
				<label>
					<span>Output kind</span>
					<select
						onChange={(event) =>
							setDraft((current) => ({
								...current,
								outputKind: event.target.value as ArtifactDraft["outputKind"],
							}))
						}
						value={draft.outputKind}
					>
						<option value="file">File</option>
						<option value="directory">Directory (.tar.gz)</option>
					</select>
				</label>
				<label className="artifact-command-field">
					<span>Command</span>
					<input
						aria-describedby={command.error ? "artifact-command-error" : undefined}
						aria-invalid={command.error ? true : undefined}
						autoCapitalize="none"
						autoCorrect="off"
						onChange={(event) =>
							setDraft((current) => ({ ...current, command: event.target.value }))
						}
						placeholder='bun build src/cli.ts --compile --outfile "dist/couchview"'
						required
						value={draft.command}
					/>
					{command.error && (
						<small className="artifact-field-error" id="artifact-command-error" role="alert">
							{command.error}
						</small>
					)}
				</label>
				<label>
					<span>Working directory</span>
					<input
						autoCapitalize="none"
						autoCorrect="off"
						onChange={(event) =>
							setDraft((current) => ({ ...current, workingDirectory: event.target.value }))
						}
						placeholder="."
						required
						value={draft.workingDirectory}
					/>
				</label>
				<label>
					<span>Exact output path</span>
					<input
						autoCapitalize="none"
						autoCorrect="off"
						onChange={(event) =>
							setDraft((current) => ({ ...current, outputPath: event.target.value }))
						}
						placeholder="dist/couchview"
						required
						value={draft.outputPath}
					/>
				</label>
			</div>
			<div className="artifact-invocation">
				<span>Parsed invocation</span>
				<code>
					{command.argv.length
						? quoteArtifactInvocation(command.argv)
						: command.error
							? "Fix the command above"
							: "Enter a command"}
				</code>
			</div>
			<footer className="artifact-form-actions">
				<button className="action-button secondary" onClick={onCancel} type="button">
					Cancel
				</button>
				<button
					className="action-button"
					disabled={busy || proposalBusy || Boolean(command.error)}
					type="submit"
				>
					<Save size={15} /> {busy ? "Saving…" : definition ? "Save changes" : "Create artifact"}
				</button>
			</footer>
		</form>
	);
}
