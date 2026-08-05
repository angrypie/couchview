import {
	type CodexGenerationPreferences,
	DEFAULT_CODEX_GENERATION_PREFERENCES,
	parseCodexGenerationPreferences,
} from "./codexGeneration.ts";

export const ARTIFACT_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const ARTIFACT_RETAINED_BUILDS = 2;
export const ARTIFACT_MAX_LOG_BYTES = 2 * 1024 * 1024;
export const ARTIFACT_EXECUTABLE_HEADER = "X-Couchview-Executable";

export type ArtifactOutputKind = "file" | "directory";

export interface ArtifactDefinitionInput {
	name: string;
	argv: string[];
	workingDirectory: string;
	outputPath: string;
	outputKind: ArtifactOutputKind;
}

export interface ArtifactDefinition extends ArtifactDefinitionInput {
	id: string;
	repositoryId: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
}

export type CreateArtifactDefinitionRequest = ArtifactDefinitionInput;

export interface UpdateArtifactDefinitionRequest extends ArtifactDefinitionInput {
	expectedRevision: number;
}

export interface ArtifactDefinitionResponse {
	definition: ArtifactDefinition;
}

export interface ArtifactBuild {
	id: string;
	repositoryId: string;
	artifactId: string;
	definitionRevision: number;
	downloadName: string;
	mediaType: string;
	sizeBytes: number;
	sha256: string;
	executable: boolean;
	createdAt: string;
}

export type ArtifactRunStatus =
	| "running"
	| "stopping"
	| "capturing"
	| "succeeded"
	| "failed"
	| "stopped";

export interface ArtifactRun {
	id: string;
	repositoryId: string;
	artifactId: string;
	artifactName: string;
	definitionRevision: number;
	argv: string[];
	invocation: string;
	workingDirectory: string;
	status: ArtifactRunStatus;
	exitCode: number | null;
	startedAt: string;
	finishedAt: string | null;
	outputTruncated: boolean;
	error: string | null;
	buildId: string | null;
}

export interface ArtifactRunOutputChunk {
	sequence: number;
	stream: "stdout" | "stderr";
	text: string;
}

export interface ArtifactRunSnapshot {
	run: ArtifactRun;
	output: ArtifactRunOutputChunk[];
}

export type ArtifactRunEvent =
	| { type: "snapshot"; snapshot: ArtifactRunSnapshot }
	| { type: "output"; chunk: ArtifactRunOutputChunk }
	| { type: "status"; run: ArtifactRun };

export interface ArtifactCatalogItem {
	definition: ArtifactDefinition;
	builds: ArtifactBuild[];
	activeRun: ArtifactRun | null;
	recentRun: ArtifactRun | null;
}

export interface ArtifactCatalogResponse {
	artifacts: ArtifactCatalogItem[];
}

export interface ArtifactRunResponse {
	run: ArtifactRun;
}

export interface ArtifactRepositoryResolveRequest {
	fingerprints?: string[];
	repository?: string;
}

export interface ArtifactRepositorySelection {
	id: string;
	name: string;
}

export interface ArtifactRepositoryResolveResponse {
	repository: ArtifactRepositorySelection | null;
	repositories: ArtifactRepositorySelection[];
}

export interface ArtifactDownloadMetadata {
	buildId: string;
	downloadName: string;
	sizeBytes: number;
	sha256: string;
	mediaType: string;
	executable: boolean;
}

export interface ArtifactProposalRequest {
	request: string;
	codex?: CodexGenerationPreferences;
}

export interface ArtifactProposalResponse {
	proposal: ArtifactDefinitionInput;
	summary: string;
	configurationFiles: string[];
}

const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function normalizeRelativePath(value: unknown, field: string, allowDot: boolean): string {
	if (typeof value !== "string" || !value || value.length > 4_096 || value.includes("\0")) {
		throw new Error(`${field} is invalid`);
	}
	const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
	if ((allowDot && normalized === ".") || normalized === "") return ".";
	if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
		throw new Error(`${field} must be repository-relative`);
	}
	const parts = normalized.split("/");
	if (parts.some((part) => !part || part === "." || part === ".." || part === ".git")) {
		throw new Error(`${field} contains an unsafe path segment`);
	}
	return parts.join("/");
}

export function parseArtifactDefinitionInput(value: unknown): ArtifactDefinitionInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Artifact definition must be an object");
	}
	const input = value as Record<string, unknown>;
	if (typeof input.name !== "string" || !ARTIFACT_NAME_PATTERN.test(input.name)) {
		throw new Error("Artifact name must use 1-64 letters, numbers, dots, underscores, or hyphens");
	}
	if (
		!Array.isArray(input.argv) ||
		input.argv.length < 1 ||
		input.argv.length > 256 ||
		typeof input.argv[0] !== "string" ||
		input.argv[0].length < 1 ||
		!input.argv.every(
			(argument) =>
				typeof argument === "string" && argument.length <= 8_192 && !argument.includes("\0"),
		)
	) {
		throw new Error("Artifact command must contain an executable and valid arguments");
	}
	if (input.outputKind !== "file" && input.outputKind !== "directory") {
		throw new Error("Artifact output kind must be file or directory");
	}
	return {
		name: input.name,
		argv: [...input.argv],
		workingDirectory: normalizeRelativePath(input.workingDirectory, "Working directory", true),
		outputPath: normalizeRelativePath(input.outputPath, "Output path", false),
		outputKind: input.outputKind,
	};
}

export function parseArtifactProposalRequest(value: unknown): Required<ArtifactProposalRequest> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Artifact proposal request must be an object");
	}
	const input = value as Partial<ArtifactProposalRequest>;
	if (
		typeof input.request !== "string" ||
		input.request.length > 2_000 ||
		input.request.includes("\0")
	) {
		throw new Error("Artifact proposal request must contain at most 2,000 characters");
	}
	return {
		request: input.request.trim(),
		codex:
			input.codex === undefined
				? { ...DEFAULT_CODEX_GENERATION_PREFERENCES }
				: parseCodexGenerationPreferences(input.codex),
	};
}

const UNSUPPORTED_UNQUOTED_COMMAND_CHARACTERS = new Set(["|", "&", ";", "<", ">", "`", "$"]);

export function parseArtifactCommandLine(value: string): string[] {
	if (typeof value !== "string" || value.length > 64 * 1024 || value.includes("\0")) {
		throw new Error("Command is invalid");
	}
	const argv: string[] = [];
	let argument = "";
	let argumentStarted = false;
	let quote: "single" | "double" | null = null;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index]!;
		if (quote === "single") {
			if (character === "'") quote = null;
			else argument += character;
			continue;
		}
		if (quote === "double") {
			if (character === '"') {
				quote = null;
				continue;
			}
			if (character === "\\") {
				const escaped = value[index + 1];
				if (escaped === undefined) throw new Error("Command ends with an unfinished escape");
				argument += escaped;
				index += 1;
				continue;
			}
			if (character === "$" || character === "`") {
				throw new Error("Command substitutions and variable expansion are not supported");
			}
			argument += character;
			continue;
		}

		if (/\s/.test(character)) {
			if (argumentStarted) {
				argv.push(argument);
				argument = "";
				argumentStarted = false;
			}
			continue;
		}
		argumentStarted = true;
		if (character === "'") {
			quote = "single";
			continue;
		}
		if (character === '"') {
			quote = "double";
			continue;
		}
		if (character === "\\") {
			const escaped = value[index + 1];
			if (escaped === undefined) throw new Error("Command ends with an unfinished escape");
			argument += escaped;
			index += 1;
			continue;
		}
		if (UNSUPPORTED_UNQUOTED_COMMAND_CHARACTERS.has(character)) {
			throw new Error(
				"Shell operators, redirects, substitutions, and variable expansion are not supported",
			);
		}
		argument += character;
	}

	if (quote) throw new Error(`Command has an unterminated ${quote} quote`);
	if (argumentStarted) argv.push(argument);
	if (argv.length === 0 || argv[0] === "") {
		throw new Error("Command must contain an executable");
	}
	if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]!)) {
		throw new Error("Environment assignments are not supported in artifact commands");
	}
	if (argv.length > 256 || argv.some((entry) => entry.length > 8_192)) {
		throw new Error("Command contains too many or overly long arguments");
	}
	return argv;
}

export function parseArtifactRepositoryResolveRequest(
	value: unknown,
): ArtifactRepositoryResolveRequest {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Repository selection must be an object");
	}
	const input = value as Record<string, unknown>;
	const fingerprints = input.fingerprints;
	if (
		fingerprints !== undefined &&
		(!Array.isArray(fingerprints) ||
			fingerprints.length > 32 ||
			!fingerprints.every(
				(fingerprint) => typeof fingerprint === "string" && FINGERPRINT_PATTERN.test(fingerprint),
			))
	) {
		throw new Error("Repository fingerprints are invalid");
	}
	if (
		input.repository !== undefined &&
		(typeof input.repository !== "string" ||
			!input.repository.trim() ||
			input.repository.length > 512 ||
			input.repository.includes("\0"))
	) {
		throw new Error("Repository selector is invalid");
	}
	return {
		...(fingerprints === undefined ? {} : { fingerprints: [...fingerprints] as string[] }),
		...(input.repository === undefined ? {} : { repository: input.repository.trim() }),
	};
}

export function quoteArtifactInvocation(argv: readonly string[]): string {
	return argv
		.map((argument) =>
			/^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
				? argument
				: `'${argument.replaceAll("'", `'\\''`)}'`,
		)
		.join(" ");
}
