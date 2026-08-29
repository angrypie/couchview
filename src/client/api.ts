import {
	API_ROUTES,
	type ApiErrorBody,
	type ApiErrorDiagnostic,
	type ArtifactCatalogResponse,
	type ArtifactDefinitionInput,
	type ArtifactDefinitionResponse,
	type ArtifactProposalRequest,
	type ArtifactProposalResponse,
	type ArtifactRunResponse,
	type BootstrapResponse,
	type ChangesResponse,
	type CommitRequest,
	type CommitResponse,
	type CreateRemoteBridgePairingRequest,
	type CreateSettingsProfileRequest,
	CSRF_HEADER,
	type DiffResponse,
	type ForgetRepositoryResponse,
	type GenerateCommitMessageRequest,
	type GenerateCommitMessageResponse,
	type InstanceResponse,
	type NativeClientPairingResponse,
	type NativeClientsResponse,
	type PackageRunResponse,
	type PackageRunsResponse,
	type PackageScriptsResponse,
	type ProjectFilesResponse,
	type RegisterRepositoryRequest,
	type RegisterRepositoryResponse,
	type RemoteBridgeDevicesResponse,
	type RemoteBridgePairingResponse,
	type RepositoryCatalogResponse,
	type ResolveVoiceCommandsRequest,
	type ResolveVoiceCommandsResponse,
	type RestartResponse,
	type ReviewStateResponse,
	type SearchResponse,
	type SetReviewRequest,
	type SetReviewResponse,
	type SetReviewsRequest,
	type SetReviewsResponse,
	type SettingsProfileResponse,
	type SettingsProfilesResponse,
	type SourceFileResponse,
	type SpeechLanguageHint,
	type SpeechTranscriptionResponse,
	type StageFileRequest,
	type StageFileResponse,
	type StageFilesRequest,
	type StageFilesResponse,
	type StartPackageRunRequest,
	type TerminalAttachmentRequest,
	type TerminalAttachmentResponse,
	type TerminalEndResponse,
	type TerminalLeaseRequest,
	type TerminalLeaseResponse,
	type UpdateArtifactDefinitionRequest,
	type UpdateSettingsProfileRequest,
	type VoiceCommandCapability,
} from "../shared/contracts.ts";
import type { RepositoryDirectoryListing } from "../shared/repositoryDirectories.ts";
import type { FetchResponseLike } from "./lib/api/fetchTypes.ts";
import { fetchApi } from "./lib/api/runtime.ts";

export {
	absoluteApiDownloadUrl,
	absoluteApiHttpUrl,
	absoluteApiWebSocketUrl,
	apiRequestHeaders,
	apiRequestUrl,
	configureApiRuntime,
	resetApiRuntime,
} from "./lib/api/runtime.ts";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly diagnostic?: ApiErrorDiagnostic;

	constructor(
		message: string,
		status: number,
		code = "request_failed",
		diagnostic?: ApiErrorDiagnostic,
	) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.diagnostic = diagnostic;
	}
}

export async function request<T>(path: string, init?: RequestInit, csrfToken?: string): Promise<T> {
	const headers = new Headers(init?.headers);
	headers.set("Accept", "application/json");
	// Cloudflare Access returns a usable 401 for expired AJAX sessions only
	// when this header is present. Otherwise its login redirect looks offline
	// to fetch after the redirect crosses origins.
	headers.set("X-Requested-With", "XMLHttpRequest");
	if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	if (csrfToken) headers.set(CSRF_HEADER, csrfToken);

	let response: FetchResponseLike;
	try {
		response = await fetchApi(path, {
			...init,
			headers,
			// A missing Cloudflare Access cookie can produce a cross-origin login
			// redirect instead of the documented AJAX 401. Keeping the redirect
			// opaque lets the app identify it without attempting a blocked CORS load.
			redirect: "manual",
		});
	} catch {
		if (init?.signal?.aborted) {
			throw new DOMException("The request was aborted.", "AbortError");
		}
		throw new ApiError("Could not reach Couchview.", 0, "disconnected");
	}

	if (response.status === 401 || response.type === "opaqueredirect") {
		throw new ApiError("Your secure sign-in session has expired.", 401, "authentication_required");
	}

	if (!response.ok) {
		let message = `Request failed (${response.status})`;
		let code = "request_failed";
		let diagnostic: ApiErrorDiagnostic | undefined;
		try {
			const body = (await response.json()) as ApiErrorBody;
			message = body.error.message;
			code = body.error.code;
			diagnostic = body.error.diagnostic;
		} catch {
			// Keep the useful HTTP fallback when the response is not JSON.
		}
		throw new ApiError(message, response.status, code, diagnostic);
	}

	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export function withQuery(
	path: string,
	values: Record<string, string | number | null | undefined>,
): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== null) params.set(key, String(value));
	}
	const query = params.toString();
	return query ? `${path}?${query}` : path;
}

export interface SpeechTranscriptionOptions {
	language?: SpeechLanguageHint;
	signal?: AbortSignal;
}

export const api = {
	bootstrap(signal?: AbortSignal) {
		return request<BootstrapResponse>(API_ROUTES.bootstrap, { signal });
	},

	instance(signal?: AbortSignal) {
		return request<InstanceResponse>(API_ROUTES.instance, { signal });
	},

	transcribeSpeech(body: BodyInit, csrfToken: string, options: SpeechTranscriptionOptions = {}) {
		return request<SpeechTranscriptionResponse>(
			withQuery(API_ROUTES.speechTranscriptions, { language: options.language }),
			{
				method: "POST",
				headers: { "Content-Type": "audio/wav" },
				body,
				signal: options.signal,
			},
			csrfToken,
		);
	},

	resolveVoiceCommands(body: ResolveVoiceCommandsRequest, csrfToken: string, signal?: AbortSignal) {
		return request<ResolveVoiceCommandsResponse>(
			API_ROUTES.voiceCommandResolve,
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	retryVoiceCommands(csrfToken: string, signal?: AbortSignal) {
		return request<VoiceCommandCapability>(
			API_ROUTES.voiceCommandRetry,
			{ method: "POST", signal },
			csrfToken,
		);
	},

	nativeClients(signal?: AbortSignal) {
		return request<NativeClientsResponse>(API_ROUTES.nativeClients, { signal });
	},

	createNativeClientPairing(csrfToken: string, signal?: AbortSignal) {
		return request<NativeClientPairingResponse>(
			API_ROUTES.nativeClientPairings,
			{ method: "POST", signal },
			csrfToken,
		);
	},

	revokeNativeClient(clientId: string, csrfToken: string, signal?: AbortSignal) {
		return request<void>(
			API_ROUTES.nativeClient(clientId),
			{ method: "DELETE", signal },
			csrfToken,
		);
	},

	restart(csrfToken: string, signal?: AbortSignal) {
		return request<RestartResponse>(
			API_ROUTES.restart,
			{
				method: "POST",
				signal,
			},
			csrfToken,
		);
	},

	repositories(signal?: AbortSignal) {
		return request<RepositoryCatalogResponse>(API_ROUTES.repositories, { signal });
	},

	repositoryDirectories(path?: string, signal?: AbortSignal) {
		return request<RepositoryDirectoryListing>(
			withQuery(API_ROUTES.repositoryDirectories, { path }),
			{ signal },
		);
	},

	registerRepository(body: RegisterRepositoryRequest, csrfToken: string, signal?: AbortSignal) {
		return request<RegisterRepositoryResponse>(
			API_ROUTES.repositories,
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	settingsProfiles(signal?: AbortSignal) {
		return request<SettingsProfilesResponse>(API_ROUTES.settingsProfiles, { signal });
	},

	createSettingsProfile(
		body: CreateSettingsProfileRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<SettingsProfileResponse>(
			API_ROUTES.settingsProfiles,
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	updateSettingsProfile(
		profileId: string,
		body: UpdateSettingsProfileRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<SettingsProfileResponse>(
			API_ROUTES.settingsProfile(profileId),
			{ method: "PUT", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	deleteSettingsProfile(profileId: string, csrfToken: string, signal?: AbortSignal) {
		return request<void>(
			API_ROUTES.settingsProfile(profileId),
			{ method: "DELETE", signal },
			csrfToken,
		);
	},

	remoteBridgeDevices(repositoryId: string, signal?: AbortSignal) {
		return request<RemoteBridgeDevicesResponse>(API_ROUTES.remoteBridgePairings(repositoryId), {
			signal,
		});
	},

	createRemoteBridgePairing(
		repositoryId: string,
		body: CreateRemoteBridgePairingRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<RemoteBridgePairingResponse>(
			API_ROUTES.remoteBridgePairings(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	revokeRemoteBridgeDevice(
		repositoryId: string,
		deviceId: string,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<void>(
			API_ROUTES.remoteBridgePairing(repositoryId, deviceId),
			{ method: "DELETE", signal },
			csrfToken,
		);
	},

	changes(repositoryId: string, signal?: AbortSignal) {
		return request<ChangesResponse>(API_ROUTES.files(repositoryId), { signal });
	},

	projectFiles(repositoryId: string, signal?: AbortSignal) {
		return request<ProjectFilesResponse>(API_ROUTES.projectFiles(repositoryId), { signal });
	},

	diff(repositoryId: string, fileId: string, signal?: AbortSignal) {
		return request<DiffResponse>(API_ROUTES.fileDiff(repositoryId, fileId), { signal });
	},

	reviews(repositoryId: string, signal?: AbortSignal) {
		return request<ReviewStateResponse>(API_ROUTES.fileReviews(repositoryId), { signal });
	},

	packageScripts(repositoryId: string, signal?: AbortSignal) {
		return request<PackageScriptsResponse>(API_ROUTES.packageScripts(repositoryId), { signal });
	},

	artifacts(repositoryId: string, signal?: AbortSignal) {
		return request<ArtifactCatalogResponse>(API_ROUTES.artifacts(repositoryId), { signal });
	},

	proposeArtifact(
		repositoryId: string,
		body: ArtifactProposalRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<ArtifactProposalResponse>(
			API_ROUTES.artifactProposal(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	createArtifact(
		repositoryId: string,
		body: ArtifactDefinitionInput,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<ArtifactDefinitionResponse>(
			API_ROUTES.artifacts(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	updateArtifact(
		repositoryId: string,
		artifactId: string,
		body: UpdateArtifactDefinitionRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<ArtifactDefinitionResponse>(
			API_ROUTES.artifact(repositoryId, artifactId),
			{ method: "PUT", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	deleteArtifact(
		repositoryId: string,
		artifactId: string,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<void>(
			API_ROUTES.artifact(repositoryId, artifactId),
			{ method: "DELETE", signal },
			csrfToken,
		);
	},

	startArtifactRun(
		repositoryId: string,
		artifactId: string,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<ArtifactRunResponse>(
			API_ROUTES.artifactRuns(repositoryId, artifactId),
			{ method: "POST", body: JSON.stringify({}), signal },
			csrfToken,
		);
	},

	stopArtifactRun(
		repositoryId: string,
		artifactId: string,
		runId: string,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<ArtifactRunResponse>(
			API_ROUTES.artifactRunStop(repositoryId, artifactId, runId),
			{ method: "POST", body: JSON.stringify({}), signal },
			csrfToken,
		);
	},

	createTerminalAttachment(
		repositoryId: string,
		body: TerminalAttachmentRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<TerminalAttachmentResponse>(
			API_ROUTES.terminalAttachments(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	renewTerminalLease(
		repositoryId: string,
		body: TerminalLeaseRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<TerminalLeaseResponse>(
			API_ROUTES.terminalLease(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	endTerminal(repositoryId: string, csrfToken: string, signal?: AbortSignal) {
		return request<TerminalEndResponse>(
			API_ROUTES.terminalEnd(repositoryId),
			{ method: "POST", signal },
			csrfToken,
		);
	},

	packageRuns(repositoryId: string, signal?: AbortSignal) {
		return request<PackageRunsResponse>(API_ROUTES.packageRuns(repositoryId), { signal });
	},

	search(repositoryId: string, query: string, currentPath: string, signal?: AbortSignal) {
		return request<SearchResponse>(
			withQuery(API_ROUTES.search(repositoryId), { q: query, currentPath }),
			{ signal },
		);
	},

	sourceFile(repositoryId: string, path: string, line: number, signal?: AbortSignal) {
		return request<SourceFileResponse>(
			withQuery(API_ROUTES.sourceFile(repositoryId), { path, line }),
			{ signal },
		);
	},

	setReviewed(
		repositoryId: string,
		body: SetReviewRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<SetReviewResponse>(
			API_ROUTES.fileReview(repositoryId, body.fileId),
			{ method: "PUT", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	setReviewedFiles(
		repositoryId: string,
		body: SetReviewsRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<SetReviewsResponse>(
			API_ROUTES.fileReviews(repositoryId),
			{ method: "PUT", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	stage(repositoryId: string, body: StageFileRequest, csrfToken: string, signal?: AbortSignal) {
		return request<StageFileResponse>(
			API_ROUTES.fileStage(repositoryId, body.fileId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	stageFiles(
		repositoryId: string,
		body: StageFilesRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<StageFilesResponse>(
			API_ROUTES.fileStages(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	commit(repositoryId: string, body: CommitRequest, csrfToken: string, signal?: AbortSignal) {
		return request<CommitResponse>(
			API_ROUTES.commit(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	generateCommitMessage(
		repositoryId: string,
		body: GenerateCommitMessageRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<GenerateCommitMessageResponse>(
			API_ROUTES.commitMessage(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	startPackageRun(
		repositoryId: string,
		body: StartPackageRunRequest,
		csrfToken: string,
		signal?: AbortSignal,
	) {
		return request<PackageRunResponse>(
			API_ROUTES.packageRuns(repositoryId),
			{ method: "POST", body: JSON.stringify(body), signal },
			csrfToken,
		);
	},

	stopPackageRun(repositoryId: string, runId: string, csrfToken: string, signal?: AbortSignal) {
		return request<PackageRunResponse>(
			API_ROUTES.packageRunStop(repositoryId, runId),
			{ method: "POST", body: JSON.stringify({}), signal },
			csrfToken,
		);
	},

	forgetRepository(repositoryId: string, csrfToken: string, signal?: AbortSignal) {
		return request<ForgetRepositoryResponse>(
			API_ROUTES.repository(repositoryId),
			{ method: "DELETE", body: JSON.stringify({ repositoryId }), signal },
			csrfToken,
		);
	},
};
