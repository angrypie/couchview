import type { CodexGenerationPreferences } from "./codexGeneration.ts";
import type { SettingsProfile } from "./settings.ts";
import type { VoiceActionId } from "./voiceCommands.ts";

export * from "./artifacts.ts";
export * from "./codexGeneration.ts";
export * from "./nativeClients.ts";

export type {
	CommandId,
	CreateSettingsProfileRequest,
	DisplayPreferences,
	KeyboardLayout,
	KeyboardPreferences,
	SettingsProfile,
	SettingsProfileData,
	SettingsProfileResponse,
	SettingsProfilesResponse,
	ShortcutModifier,
	ShortcutSequence,
	ShortcutStroke,
	UpdateSettingsProfileRequest,
	VoicePreferences,
} from "./settings.ts";

export * from "./voiceCommands.ts";

const repositoryApiPath = (repositoryId: string) =>
	`/api/repositories/${encodeURIComponent(repositoryId)}`;
const repositoryFilesApiPath = (repositoryId: string) => `${repositoryApiPath(repositoryId)}/files`;

export const API_ROUTES = {
	bootstrap: "/api/bootstrap",
	accessLogout: "/api/access/logout",
	accessRefresh: "/api/access/refresh",
	instance: "/api/instance",
	nativeClients: "/api/native-clients",
	nativeClient: (clientId: string) => `/api/native-clients/${encodeURIComponent(clientId)}`,
	nativeClientPairings: "/api/native-clients/pairings",
	nativeClientPairingClaim: "/api/native-clients/pairings/claim",
	restart: "/api/restart",
	speechTranscriptions: "/api/speech/transcriptions",
	voiceCommandResolve: "/api/voice-commands/resolve",
	voiceCommandRetry: "/api/voice-commands/retry",
	repositories: "/api/repositories",
	repositoryDirectories: "/api/repository-directories",
	settingsProfiles: "/api/settings/profiles",
	settingsProfile: (profileId: string) => `/api/settings/profiles/${encodeURIComponent(profileId)}`,
	controlRepositories: "/api/control/repositories",
	controlRestart: "/api/control/restart",
	artifactRepositoryResolve: "/api/artifacts/repositories/resolve",
	repository: repositoryApiPath,
	artifacts: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/artifacts`,
	artifact: (repositoryId: string, artifactId: string) =>
		`${repositoryApiPath(repositoryId)}/artifacts/${encodeURIComponent(artifactId)}`,
	artifactProposal: (repositoryId: string) =>
		`${repositoryApiPath(repositoryId)}/artifacts/proposal`,
	artifactRuns: (repositoryId: string, artifactId: string) =>
		`${repositoryApiPath(repositoryId)}/artifacts/${encodeURIComponent(artifactId)}/runs`,
	artifactRunStop: (repositoryId: string, artifactId: string, runId: string) =>
		`${repositoryApiPath(repositoryId)}/artifacts/${encodeURIComponent(artifactId)}/runs/${encodeURIComponent(runId)}/stop`,
	artifactRunEvents: (repositoryId: string, artifactId: string, runId: string) =>
		`${repositoryApiPath(repositoryId)}/artifacts/${encodeURIComponent(artifactId)}/runs/${encodeURIComponent(runId)}/events`,
	artifactDownload: (repositoryId: string, artifactId: string, buildId: string) =>
		`${repositoryApiPath(repositoryId)}/artifacts/${encodeURIComponent(artifactId)}/builds/${encodeURIComponent(buildId)}/download`,
	files: repositoryFilesApiPath,
	projectFiles: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/project-files`,
	fileDiff: (repositoryId: string, fileId: string) =>
		`${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/diff`,
	fileStage: (repositoryId: string, fileId: string) =>
		`${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/stage`,
	fileStages: (repositoryId: string) => `${repositoryFilesApiPath(repositoryId)}/stage`,
	fileReviews: (repositoryId: string) => `${repositoryFilesApiPath(repositoryId)}/review`,
	fileReview: (repositoryId: string, fileId: string) =>
		`${repositoryFilesApiPath(repositoryId)}/${encodeURIComponent(fileId)}/review`,
	search: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/search`,
	source: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/source`,
	sourceFile: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/source-file`,
	commit: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/commit`,
	commitMessage: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/commit-message`,
	packageScripts: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/package-scripts`,
	packageRuns: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/package-runs`,
	packageRunStop: (repositoryId: string, runId: string) =>
		`${repositoryApiPath(repositoryId)}/package-runs/${encodeURIComponent(runId)}/stop`,
	packageRunEvents: (repositoryId: string, runId: string) =>
		`${repositoryApiPath(repositoryId)}/package-runs/${encodeURIComponent(runId)}/events`,
	events: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/events`,
	terminalAttachments: (repositoryId: string) =>
		`${repositoryApiPath(repositoryId)}/terminal/attachments`,
	terminalLease: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/terminal/lease`,
	terminalEnd: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/terminal/end`,
	terminalSocket: (repositoryId: string) => `${repositoryApiPath(repositoryId)}/terminal/socket`,
	remoteBridgePairings: (repositoryId: string) =>
		`${repositoryApiPath(repositoryId)}/remote-bridge/pairings`,
	remoteBridgePairing: (repositoryId: string, deviceId: string) =>
		`${repositoryApiPath(repositoryId)}/remote-bridge/pairings/${encodeURIComponent(deviceId)}`,
	remoteBridgeClaim: "/api/remote-bridge/pairings/claim",
	remoteBridgeHostTickets: "/api/remote-bridge/tickets",
	remoteBridgeHostLease: "/api/remote-bridge/lease",
	remoteBridgeHostSocket: "/api/remote-bridge/socket",
} as const;

export const CSRF_HEADER = "x-couchview-csrf";
export const TERMINAL_PROTOCOL = "couchview-terminal-v1";
export const TERMINAL_TICKET_PREFIX = "couchview-ticket.";
export const TERMINAL_ENDED_CLOSE_CODE = 4002;
export const TERMINAL_P2P_FAILED_CLOSE_CODE = 4004;
export const TERMINAL_LEASE_EXPIRED_CLOSE_CODE = 4005;
export const TERMINAL_DATA_CHANNEL_LABEL = "couchview-terminal";
export const TERMINAL_DATA_CHANNEL_PROTOCOL = "couchview-terminal-data-v1";
export const REMOTE_BRIDGE_PROTOCOL = "couchview-remote-bridge-v1";
export const REMOTE_BRIDGE_TICKET_PREFIX = "couchview-bridge-ticket.";
export const REMOTE_BRIDGE_DEVICE_TOKEN_HEADER = "x-couchview-bridge-token";
export const REMOTE_BRIDGE_DATA_CHANNEL_LABEL = "couchview-remote-bridge";
export const REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL = "couchview-remote-bridge-data-v1";
export const REMOTE_BRIDGE_P2P_FAILED_CLOSE_CODE = 4014;
export const REMOTE_BRIDGE_LEASE_EXPIRED_CLOSE_CODE = 4015;
export const REMOTE_BRIDGE_NO_ORIGIN_ACCESS = "none";
export function remoteBridgeOriginAccessIdIsValid(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

export type ChangeKind =
	| "added"
	| "copied"
	| "deleted"
	| "modified"
	| "renamed"
	| "type-changed"
	| "unmerged"
	| "untracked"
	| "unknown";

export type DiffLineKind = "addition" | "context" | "deletion" | "metadata";
export type DiffSide = "new" | "old" | "mixed";

export interface RepositorySummary {
	id: string;
	name: string;
	root: string;
	branch: string | null;
	head: string | null;
	unborn: boolean;
}

export interface RepositoryCatalogEntry {
	id: string;
	name: string;
	root: string;
	available: boolean;
	addedAt: string;
}

export interface FileChange {
	id: string;
	path: string;
	previousPath: string | null;
	kind: ChangeKind;
	indexStatus: string;
	worktreeStatus: string;
	staged: boolean;
	unstaged: boolean;
	conflicted: boolean;
	binary: boolean | null;
	additions: number | null;
	deletions: number | null;
	contentRevision: string;
	reviewed: boolean;
}

export interface BootstrapResponse {
	csrfToken: string;
	repositories: RepositoryCatalogEntry[];
	defaultRepositoryId: string | null;
	catalogRevision: number;
	settingsProfiles: SettingsProfile[];
	restart: RestartCapability;
	commitMessage: CommitMessageCapability;
	artifactProposal: CodexCapability;
	terminal: TerminalCapability;
	remoteBridge: RemoteBridgeCapability;
	speech: SpeechCapability;
	voiceCommands: VoiceCommandCapability;
}

export interface InstanceResponse {
	service: "couchview";
	protocolVersion: number;
	version: string;
	serverId: string;
	instanceId: string;
	bindHost: string;
	port: number;
	accessOrigins: string[];
	terminalEnabled: boolean;
	terminalP2pEnabled: boolean;
	terminalStunUrls: string[];
	remoteBridgeEnabled: boolean;
	remoteBridgeP2pEnabled: boolean;
	remoteBridgeStunUrls: string[];
	remoteBridgeTargetPort: number;
	remoteBridgeOriginAccess: string;
	speechEnabled: boolean;
	voiceCommandsEnabled: boolean;
}

export interface RestartCapability {
	available: boolean;
	reason: string | null;
}

export interface RestartResponse {
	status: "restarting";
	previousInstanceId: string;
}

export interface CommitMessageCapability {
	available: boolean;
	reason: string | null;
}

export interface CodexCapability {
	available: boolean;
	reason: string | null;
}

export interface SpeechCapability {
	enabled: boolean;
	ready: boolean;
	model: string;
	maxDurationMs: number;
	maxUploadBytes: number;
	reason: string | null;
}

export const SPEECH_LANGUAGE_HINTS = ["en"] as const;
export type SpeechLanguageHint = (typeof SPEECH_LANGUAGE_HINTS)[number];

export function isSpeechLanguageHint(value: unknown): value is SpeechLanguageHint {
	return SPEECH_LANGUAGE_HINTS.some((language) => language === value);
}

export type SpeechErrorCode =
	| "speech_aborted"
	| "speech_audio_invalid"
	| "speech_audio_too_large"
	| "speech_audio_too_long"
	| "speech_audio_too_short"
	| "speech_busy"
	| "speech_content_type_invalid"
	| "speech_language_invalid"
	| "speech_service_failed"
	| "speech_timeout"
	| "speech_unavailable";

export interface SpeechErrorResponse {
	error: {
		code: SpeechErrorCode;
		message: string;
	};
}

export interface SpeechTranscriptionResponse {
	text: string;
	language: string | null;
	durationMs: number;
	inferenceMs: number;
}

export type VoiceCommandRuntimeState = "disabled" | "installing" | "ready" | "failed";

export interface VoiceCommandCapability {
	enabled: boolean;
	ready: boolean;
	state: VoiceCommandRuntimeState;
	model: string;
	reason: string | null;
	requiredFlags: string[];
	canRetry: boolean;
}

export interface ResolveVoiceCommandsRequest {
	transcript: string;
}

export interface ResolvedVoiceCommand {
	actionId: VoiceActionId;
}

export interface ResolveVoiceCommandsResponse {
	commands: ResolvedVoiceCommand[];
	confidence: number;
	reasoning: string | null;
	model: string;
	inferenceMs: number;
}

export interface TerminalProfileSummary {
	id: string;
	label: string;
	available: boolean;
	reason: string | null;
}

export interface TerminalCapability {
	available: boolean;
	reason: string | null;
	persistence: "tmux";
	profiles: TerminalProfileSummary[];
}

export interface TerminalSessionStatus {
	profileId: "tmux";
	running: boolean;
	controllerConnected: boolean;
}

export interface TerminalAttachmentRequest {
	clientId: string;
	profileId: "tmux";
	cols: number;
	rows: number;
	takeover: boolean;
}

export interface TerminalAttachmentResponse {
	ticket: string;
	expiresAt: string;
	protocol: "couchview-terminal-v1";
	session: TerminalSessionStatus;
	webRtc?: TerminalWebRtcConfiguration;
}

export interface TerminalIceServer {
	urls: string;
}

export interface TerminalWebRtcConfiguration {
	iceServers: TerminalIceServer[];
	negotiationTimeoutMs: number;
	leaseRenewIntervalMs: number;
}

export interface TerminalLeaseRequest {
	clientId: string;
}

export interface TerminalLeaseResponse {
	expiresAt: string;
}

export interface TerminalEndResponse {
	status: "ended";
}

export interface RemoteBridgeCapability {
	available: boolean;
	reason: string | null;
	p2pEnabled: boolean;
}

export interface RemoteBridgeDevice {
	id: string;
	repositoryId: string;
	label: string;
	sshAlias: string;
	createdAt: string;
	lastUsedAt: string | null;
}

export interface RemoteBridgeDevicesResponse {
	devices: RemoteBridgeDevice[];
}

export interface CreateRemoteBridgePairingRequest {
	label: string;
}

export interface RemoteBridgePairingResponse {
	command: string;
	expiresAt: string;
	sshAlias: string;
}

export interface ClaimRemoteBridgePairingRequest {
	code: string;
}

export interface RemoteBridgeProfile {
	id: string;
	origin: string;
	repositoryId: string;
	repositoryName: string;
	repositoryRoot: string;
	deviceId: string;
	deviceToken: string;
	deviceLabel: string;
	sshAlias: string;
	username: string;
	originAccess: string;
}

export interface RemoteBridgeTicketRequest {
	connectionId: string;
}

export interface RemoteBridgeTicketResponse {
	ticket: string;
	expiresAt: string;
	protocol: typeof REMOTE_BRIDGE_PROTOCOL;
	leaseRenewIntervalMs: number;
	webRtc?: TerminalWebRtcConfiguration;
}

export interface RemoteBridgeLeaseRequest {
	connectionId: string;
}

export interface RemoteBridgeLeaseResponse {
	expiresAt: string;
}

export interface RegisterRepositoryRequest {
	root: string;
}

export interface RegisterRepositoryResponse {
	repository: RepositoryCatalogEntry;
	added: boolean;
}

export interface RepositoryCatalogResponse {
	repositories: RepositoryCatalogEntry[];
	catalogRevision: number;
}

export interface ForgetRepositoryResponse {
	deletedId: string;
}

export interface ChangesResponse {
	repository: RepositorySummary;
	files: FileChange[];
	operationRevision: string;
}

export interface ProjectFileEntry {
	path: string;
}

export interface ProjectFilesResponse {
	repositoryId: string;
	operationRevision: string;
	files: ProjectFileEntry[];
	truncated: boolean;
}

export interface DiffLine {
	id: string;
	kind: DiffLineKind;
	text: string;
	oldLine: number | null;
	newLine: number | null;
	noNewline: boolean;
}

export interface DiffHunk {
	id: string;
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

export interface FileDiff {
	fileId: string;
	path: string;
	previousPath: string | null;
	kind: ChangeKind;
	contentRevision: string;
	operationRevision: string;
	binary: boolean;
	tooLarge: boolean;
	header: string[];
	/**
	 * A full-context patch used only for rendering complete modified files.
	 * The compact hunks remain the source of truth for navigation.
	 * Null means the complete file exceeded the diff response limits.
	 */
	fullFilePatch?: string | null;
	hunks: DiffHunk[];
	additions: number;
	deletions: number;
}

export interface DiffResponse {
	diff: FileDiff;
}

export interface SearchMatch {
	path: string;
	line: number;
	column: number;
	preview: string;
}

export interface SearchGroups {
	currentFile: SearchMatch[];
	otherFiles: SearchMatch[];
}

export interface SearchResponse extends SearchGroups {
	query: string;
	currentPath: string;
	truncated: boolean;
}

export interface SourceLine {
	line: number;
	text: string;
}

export interface SourcePreviewResponse {
	path: string;
	focusLine: number;
	startLine: number;
	endLine: number;
	lines: SourceLine[];
	truncated: boolean;
}

/**
 * A revision-stamped, bounded source document for the main file viewer.
 * The returned lines are contiguous and always include `focusLine` when the
 * source is non-empty, even when row or response-size limits truncate it.
 */
export interface SourceFileResponse extends SourcePreviewResponse {
	repositoryId: string;
	operationRevision: string;
	contentRevision: string;
	totalLines: number;
}

export interface ReviewRecord {
	fileId: string;
	path: string;
	contentRevision: string;
	reviewed: boolean;
	updatedAt: string;
}

export interface ReviewStateResponse {
	reviews: ReviewRecord[];
	revision: number;
}

export interface SetReviewRequest {
	fileId: string;
	contentRevision: string;
	reviewed: boolean;
	operationRevision?: string;
	expectedReviewRevision?: number;
}

export interface SetReviewResponse {
	review: ReviewRecord;
	operationRevision: string;
	reviewRevision: number;
}

export interface ReviewTarget {
	fileId: string;
	contentRevision: string;
}

export interface SetReviewsRequest {
	files: ReviewTarget[];
	reviewed: boolean;
}

export interface SetReviewsResponse {
	reviews: ReviewRecord[];
	reviewRevision: number;
}

export interface StageFileTarget {
	fileId: string;
	contentRevision: string;
}

export interface StageFileRequest extends StageFileTarget {
	operationRevision: string;
	staged?: boolean;
}

export interface StageFilesRequest {
	files: StageFileTarget[];
	operationRevision: string;
}

export interface FileChangeDelta {
	upserted: FileChange[];
	removedFileIds: string[];
	orderedFileIds: string[];
}

export interface StageFileResponse {
	file: FileChange | null;
	changes: FileChangeDelta;
	operationRevision: string;
}

export interface StageFilesResponse {
	files: FileChange[];
	changes: FileChangeDelta;
	operationRevision: string;
}

export interface CommitRequest {
	message: string;
	operationRevision: string;
}

export interface CommitResponse {
	commit: string;
	operationRevision: string;
}

export interface GenerateCommitMessageRequest {
	operationRevision: string;
	codex?: CodexGenerationPreferences;
}

export interface GenerateCommitMessageResponse {
	message: string;
	operationRevision: string;
}

export type PackageRunner = "bun" | "npm" | "pnpm" | "yarn";

export interface PackageScriptDefinition {
	name: string;
	command: string;
}

export interface PackageScriptsPackage {
	packagePath: string;
	directory: string;
	name: string | null;
	manifestRevision: string;
	runner: PackageRunner;
	scripts: PackageScriptDefinition[];
}

export interface PackageScriptWarning {
	packagePath: string;
	message: string;
}

export interface PackageScriptsResponse {
	packages: PackageScriptsPackage[];
	warnings: PackageScriptWarning[];
}

export interface StartPackageRunRequest {
	packagePath: string;
	scriptName: string;
	manifestRevision: string;
}

export type PackageRunStatus = "running" | "stopping" | "succeeded" | "failed" | "stopped";

export interface PackageRunSummary {
	id: string;
	repositoryId: string;
	packagePath: string;
	packageName: string | null;
	directory: string;
	scriptName: string;
	command: string;
	runner: PackageRunner;
	invocation: string;
	status: PackageRunStatus;
	exitCode: number | null;
	startedAt: string;
	finishedAt: string | null;
	outputTruncated: boolean;
}

export interface PackageRunsResponse {
	runs: PackageRunSummary[];
}

export interface PackageRunResponse {
	run: PackageRunSummary;
}

export interface PackageRunOutputChunk {
	sequence: number;
	stream: "stdout" | "stderr";
	text: string;
}

export interface PackageRunSnapshot {
	run: PackageRunSummary;
	output: PackageRunOutputChunk[];
}

export type PackageRunEvent =
	| { type: "snapshot"; snapshot: PackageRunSnapshot }
	| { type: "output"; chunk: PackageRunOutputChunk }
	| { type: "status"; run: PackageRunSummary };

export type ServerEventType = "changes" | "state" | "repositories" | "ready";

export interface ServerEvent {
	type: ServerEventType;
	repositoryId: string;
	operationRevision: string;
	stateRevision: number;
	catalogRevision: number;
	at: string;
}

export interface ApiErrorDiagnostic {
	id: string;
	source: "git";
	operation: string;
	kind: "exit" | "timeout" | "spawn" | "capture" | "output_limit" | "empty_output";
	exitCode: number | null;
	stderr: string;
	retryable: boolean;
	timeoutMs: number | null;
}

export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
		diagnostic?: ApiErrorDiagnostic;
	};
}
