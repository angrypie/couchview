import { Save, Sparkles, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";

import {
	type ArtifactDefinition,
	type ArtifactDefinitionInput,
	type ArtifactProposalResponse,
	type CodexCapability,
	parseArtifactCommandLine,
	quoteArtifactInvocation,
} from "../../../shared/contracts.ts";
import {
	Button,
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
	HStack,
	Icon,
	IconButton,
	Input,
	InputField,
	type InputFieldProps,
	Select,
	Text,
	VStack,
} from "../ui/index.ts";

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

interface ArtifactFieldProps extends Omit<InputFieldProps, "onChangeText" | "value"> {
	error?: string | null;
	label: string;
	onChangeText(value: string): void;
	value: string;
}

const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function ArtifactField({ error, label, onChangeText, value, ...props }: ArtifactFieldProps) {
	return (
		<VStack space="xs">
			<Text className="font-medium" size="sm">
				{label}
			</Text>
			<Input className={error ? "border-destructive" : undefined}>
				<InputField
					accessibilityLabel={label}
					onChangeText={onChangeText}
					value={value}
					{...props}
				/>
			</Input>
			{error ? (
				<Text accessibilityRole="alert" size="xs" tone="destructive">
					{error}
				</Text>
			) : null}
		</VStack>
	);
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
	const nameError =
		draft.name && !ARTIFACT_NAME_PATTERN.test(draft.name)
			? "Use letters, numbers, dots, underscores, or hyphens."
			: null;
	const canSave = Boolean(
		draft.name &&
			draft.outputPath &&
			draft.workingDirectory &&
			command.argv.length &&
			!command.error &&
			!nameError,
	);
	const save = async () => {
		if (!canSave) return;
		await onSave({
			argv: command.argv,
			name: draft.name,
			outputKind: draft.outputKind,
			outputPath: draft.outputPath,
			workingDirectory: draft.workingDirectory || ".",
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
		<Card
			accessibilityLabel={definition ? `Edit ${definition.name} artifact` : "Create artifact"}
			role="form"
		>
			<CardHeader>
				<HStack align="start" space="sm">
					<VStack className="min-w-0 flex-1" space="xs">
						<CardTitle>{definition ? `Edit ${definition.name}` : "New artifact"}</CardTitle>
						<Text className="leading-5" size="sm" tone="muted">
							Type a familiar command. Couchview parses exact arguments and never uses a shell.
						</Text>
					</VStack>
					<IconButton
						accessibilityLabel="Cancel artifact editing"
						icon={X}
						onPress={onCancel}
						size="sm"
					/>
				</HStack>
				<Button
					disabled={!proposalCapability.available || proposalBusy}
					leftIcon={Sparkles}
					loading={proposalBusy}
					onPress={() => setProposalOpen((open) => !open)}
					size="sm"
					variant="outline"
				>
					{proposalBusy ? "Reading configs…" : "Suggest with Codex"}
				</Button>
				{proposalCapability.reason ? (
					<Text size="xs" tone="muted">
						{proposalCapability.reason}
					</Text>
				) : null}
			</CardHeader>

			<CardContent>
				{proposalOpen ? (
					<VStack className="rounded-xl border border-primary/30 bg-accent p-3" space="sm">
						<Text bold size="sm">
							What should this artifact produce?
						</Text>
						<Input>
							<InputField
								accessibilityLabel="What should this artifact produce?"
								autoFocus
								maxLength={2_000}
								onChangeText={setProposalRequest}
								onSubmitEditing={() => void propose()}
								placeholder="Optional · static build, or compile with Bun"
								returnKeyType="go"
								value={proposalRequest}
							/>
						</Input>
						<Button
							disabled={proposalBusy}
							leftIcon={Sparkles}
							loading={proposalBusy}
							onPress={() => void propose()}
						>
							Fill form
						</Button>
						<Text className="leading-5" size="xs" tone="muted">
							Leave this empty for the project’s most useful default. Only recognized, shallow build
							configuration is read. Model and reasoning are controlled in Settings.
						</Text>
					</VStack>
				) : null}

				{proposalResult ? (
					<HStack
						accessibilityRole="summary"
						align="start"
						className="rounded-xl border border-success/30 bg-success/10 p-3"
						space="sm"
					>
						<Icon as={Sparkles} size={16} tone="success" />
						<VStack className="min-w-0 flex-1" space="xs">
							<Text bold size="sm">
								Codex filled an editable suggestion
							</Text>
							<Text size="sm">{proposalResult.summary}</Text>
							<Text size="xs" tone="muted">
								{proposalResult.configurationFiles.length
									? `Read ${proposalResult.configurationFiles.join(", ")}`
									: "No recognized build configuration was found"}
							</Text>
						</VStack>
					</HStack>
				) : null}

				<View className="gap-4">
					<ArtifactField
						autoCapitalize="none"
						autoCorrect={false}
						error={nameError}
						label="Name"
						maxLength={64}
						onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
						placeholder="couchview-cli"
						value={draft.name}
					/>
					<VStack space="xs">
						<Text className="font-medium" size="sm">
							Output kind
						</Text>
						<Select
							accessibilityLabel="Output kind"
							onValueChange={(outputKind) =>
								setDraft((current) => ({
									...current,
									outputKind: outputKind as ArtifactDraft["outputKind"],
								}))
							}
							options={[
								{ label: "File", value: "file" },
								{ label: "Directory (.tar.gz)", value: "directory" },
							]}
							value={draft.outputKind}
						/>
					</VStack>
					<View>
						<ArtifactField
							autoCapitalize="none"
							autoCorrect={false}
							error={command.error}
							label="Command"
							onChangeText={(nextCommand) =>
								setDraft((current) => ({ ...current, command: nextCommand }))
							}
							placeholder={'bun build src/cli.ts --compile --outfile "dist/couchview"'}
							value={draft.command}
						/>
					</View>
					<ArtifactField
						autoCapitalize="none"
						autoCorrect={false}
						label="Working directory"
						onChangeText={(workingDirectory) =>
							setDraft((current) => ({ ...current, workingDirectory }))
						}
						placeholder="."
						value={draft.workingDirectory}
					/>
					<ArtifactField
						autoCapitalize="none"
						autoCorrect={false}
						label="Exact output path"
						onChangeText={(outputPath) => setDraft((current) => ({ ...current, outputPath }))}
						placeholder="dist/couchview"
						value={draft.outputPath}
					/>
				</View>

				<VStack className="rounded-xl bg-muted p-3" space="xs">
					<Text className="font-medium uppercase tracking-wide" size="xs" tone="muted">
						Parsed invocation
					</Text>
					<Text className="font-mono leading-5" selectable size="sm">
						{command.argv.length
							? quoteArtifactInvocation(command.argv)
							: command.error
								? "Fix the command above"
								: "Enter a command"}
					</Text>
				</VStack>
			</CardContent>

			<CardFooter className="justify-end">
				<Button disabled={busy} onPress={onCancel} variant="secondary">
					Cancel
				</Button>
				<Button
					disabled={busy || proposalBusy || !canSave}
					leftIcon={Save}
					loading={busy}
					onPress={() => void save()}
				>
					{definition ? "Save changes" : "Create artifact"}
				</Button>
			</CardFooter>
		</Card>
	);
}
