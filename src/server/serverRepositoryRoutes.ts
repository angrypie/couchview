import type {
	ArtifactDefinitionResponse,
	ArtifactProposalRequest,
	ArtifactProposalResponse,
	ArtifactRunResponse,
	CommitRequest,
	CreateArtifactDefinitionRequest,
	CreateRemoteBridgePairingRequest,
	ForgetRepositoryResponse,
	GenerateCommitMessageRequest,
	GenerateCommitMessageResponse,
	PackageRunResponse,
	PackageRunsResponse,
	PackageScriptsResponse,
	StageFileRequest,
	StageFilesRequest,
	StartPackageRunRequest,
	TerminalAttachmentRequest,
	TerminalLeaseRequest,
	UpdateArtifactDefinitionRequest,
} from "../shared/contracts.ts";
import {
	DEFAULT_CODEX_GENERATION_PREFERENCES,
	parseArtifactProposalRequest,
	parseCodexGenerationPreferences,
	REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
} from "../shared/contracts.ts";
import { artifactDownloadResponse } from "./artifactDownload.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";
import { HttpError } from "./errors.ts";
import { handleGitWorkspaceRoute } from "./git/index.ts";
import { openArtifactRunEvents } from "./serverArtifactRunEvents.ts";
import {
	decodeSegment,
	json,
	normalizeOrigin,
	normalizeRequestHost,
	readJsonObject,
} from "./serverHttp.ts";
import { openPackageRunEvents } from "./serverPackageRunEvents.ts";
import { handleRepositoryCollaborationRoutes } from "./serverRepositoryCollaborationRoutes.ts";
import type { RepositoryRouteContext } from "./serverRouteContext.ts";

export async function handleRepositoryApi(
	context: RepositoryRouteContext,
	request: Request,
	url: URL,
): Promise<Response> {
	const {
		nativeClient,
		database,
		repositories,
		packageCommands,
		artifacts,
		artifactProposals,
		commitMessages,
		terminalSessions,
		remoteBridge,
		remoteBridgeOriginAccess,
		events,
	} = context;

	const repositoryRoute = /^\/api\/repositories\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
	if (!repositoryRoute) {
		throw new HttpError(404, "route_not_found", "API route not found");
	}
	const repositoryId = decodeSegment(repositoryRoute[1] ?? "");
	const nestedPath = repositoryRoute[2] ?? "";

	if (!nestedPath && request.method === "DELETE") {
		const terminalStatus = await terminalSessions.status(repositoryId);
		if (terminalStatus.running) await terminalSessions.end(repositoryId);
		remoteBridge.closeRepository(repositoryId);
		packageCommands.stopRepository(repositoryId);
		await artifacts.forgetRepository(repositoryId);
		repositories.forget(repositoryId);
		if (context.defaultRepositoryId() === repositoryId) {
			context.setDefaultRepositoryId(
				(await repositories.list()).find((item) => item.available)?.id ?? null,
			);
		}
		events.emitCatalog();
		const response: ForgetRepositoryResponse = { deletedId: repositoryId };
		return json(response);
	}

	const repository = await repositories.get(repositoryId);
	const fileRoute = /^files\/([^/]+)\/(diff|stage|review)$/.exec(nestedPath);
	const packageRunRoute = /^package-runs\/([^/]+)(?:\/(stop|events))?$/.exec(nestedPath);
	const artifactRoute = /^artifacts\/([^/]+)$/.exec(nestedPath);
	const artifactRunRoute = /^artifacts\/([^/]+)\/runs(?:\/([^/]+)\/(stop|events))?$/.exec(
		nestedPath,
	);
	const artifactDownloadRoute = /^artifacts\/([^/]+)\/builds\/([^/]+)\/download$/.exec(nestedPath);

	if (nestedPath === "artifacts" && request.method === "GET") {
		return json(artifacts.catalog(repositoryId));
	}
	if (nestedPath === "artifacts" && request.method === "POST") {
		const input = await readJsonObject<CreateArtifactDefinitionRequest>(request);
		const response: ArtifactDefinitionResponse = {
			definition: artifacts.createDefinition(repositoryId, input),
		};
		return json(response, { status: 201 });
	}
	if (nestedPath === "artifacts/proposal" && request.method === "POST") {
		const value = await readJsonObject<ArtifactProposalRequest>(request);
		let input: Required<ArtifactProposalRequest>;
		try {
			input = parseArtifactProposalRequest(value);
		} catch (error) {
			throw new HttpError(
				400,
				"artifact_proposal_invalid",
				error instanceof Error ? error.message : "Artifact proposal request is invalid",
			);
		}
		const response: ArtifactProposalResponse = await artifactProposals.propose(
			repository.root,
			input,
			artifacts.catalog(repositoryId).artifacts.map((item) => item.definition.name),
			request.signal,
		);
		return json(response);
	}
	if (artifactRoute && request.method === "PUT") {
		const artifactId = decodeSegment(artifactRoute[1] ?? "");
		const input = await readJsonObject<UpdateArtifactDefinitionRequest>(request);
		const response: ArtifactDefinitionResponse = {
			definition: artifacts.updateDefinition(
				repositoryId,
				artifactId,
				input,
				input.expectedRevision,
			),
		};
		return json(response);
	}
	if (artifactRoute && request.method === "DELETE") {
		await artifacts.deleteDefinition(repositoryId, decodeSegment(artifactRoute[1] ?? ""));
		return new Response(null, { status: 204 });
	}
	if (artifactRunRoute && !artifactRunRoute[2] && request.method === "POST") {
		const response: ArtifactRunResponse = {
			run: await artifacts.start(repositoryId, decodeSegment(artifactRunRoute[1] ?? "")),
		};
		return json(response, { status: 201 });
	}
	if (artifactRunRoute?.[3] === "stop" && request.method === "POST") {
		const response: ArtifactRunResponse = {
			run: artifacts.stop(
				repositoryId,
				decodeSegment(artifactRunRoute[1] ?? ""),
				decodeSegment(artifactRunRoute[2] ?? ""),
			),
		};
		return json(response);
	}
	if (artifactRunRoute?.[3] === "events" && request.method === "GET") {
		return openArtifactRunEvents(
			request,
			artifacts,
			repositoryId,
			decodeSegment(artifactRunRoute[1] ?? ""),
			decodeSegment(artifactRunRoute[2] ?? ""),
		);
	}
	if (artifactDownloadRoute && (request.method === "GET" || request.method === "HEAD")) {
		const artifactId = decodeSegment(artifactDownloadRoute[1] ?? "");
		const build = artifacts.build(
			repositoryId,
			artifactId,
			decodeSegment(artifactDownloadRoute[2] ?? ""),
		);
		const payload = artifacts.store.payloadPath(build);
		if (!(await Bun.file(payload).exists())) {
			throw new HttpError(404, "artifact_payload_missing", "Artifact payload is unavailable");
		}
		return artifactDownloadResponse(request, build, payload);
	}

	if (nestedPath === "files" && request.method === "GET") {
		return json(await repository.changes());
	}
	if (nestedPath === "project-files" && request.method === "GET") {
		return json(await repository.projectFiles());
	}
	if (nestedPath === "terminal/attachments" && request.method === "POST") {
		const input = await readJsonObject<TerminalAttachmentRequest>(request);
		const origin = request.headers.get("origin");
		if (!origin && !nativeClient) {
			throw new HttpError(403, "origin_required", "A same-origin browser request is required");
		}
		return json(
			await terminalSessions.issueAttachment(
				repositoryId,
				repository.root,
				input,
				nativeClient
					? {
							host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
							nativeClientId: nativeClient.id,
						}
					: {
							host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
							origin: normalizeOrigin(origin ?? ""),
						},
			),
			{ status: 201 },
		);
	}
	if (nestedPath === "terminal/lease" && request.method === "POST") {
		const input = await readJsonObject<TerminalLeaseRequest>(request);
		const origin = request.headers.get("origin");
		if (!origin && !nativeClient) {
			throw new HttpError(403, "origin_required", "A same-origin browser request is required");
		}
		return json(
			await terminalSessions.renewLease(
				repositoryId,
				input,
				nativeClient
					? {
							host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
							nativeClientId: nativeClient.id,
						}
					: {
							host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
							origin: normalizeOrigin(origin ?? ""),
						},
			),
		);
	}
	if (nestedPath === "terminal/end" && request.method === "POST") {
		return json(await terminalSessions.end(repositoryId));
	}
	if (nestedPath === "remote-bridge/pairings" && request.method === "GET") {
		return json(remoteBridge.listDevices());
	}
	if (nestedPath === "remote-bridge/pairings" && request.method === "POST") {
		const origin = request.headers.get("origin");
		if (!origin) {
			throw new HttpError(403, "origin_required", "A same-origin browser request is required");
		}
		const storedRepository = database.repository(repositoryId);
		if (!storedRepository) {
			throw new HttpError(404, "repository_not_found", "Repository is not registered");
		}
		const input = await readJsonObject<CreateRemoteBridgePairingRequest>(request);
		return json(
			remoteBridge.createPairing(
				{
					id: repositoryId,
					name: storedRepository.name,
					root: repository.root,
				},
				input,
				{
					origin: normalizeOrigin(origin),
					originAccess:
						remoteBridgeOriginAccess === "auto"
							? request.headers.has("cf-access-jwt-assertion")
								? CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID
								: REMOTE_BRIDGE_NO_ORIGIN_ACCESS
							: remoteBridgeOriginAccess,
				},
			),
			{ status: 201 },
		);
	}
	const remoteBridgePairingRoute = /^remote-bridge\/pairings\/([^/]+)$/.exec(nestedPath);
	if (remoteBridgePairingRoute && request.method === "DELETE") {
		remoteBridge.revokeDevice(decodeSegment(remoteBridgePairingRoute[1] ?? ""));
		return new Response(null, { status: 204 });
	}
	if (fileRoute?.[2] === "diff" && request.method === "GET") {
		return json(await repository.diff(decodeSegment(fileRoute[1] ?? "")));
	}
	const gitResponse = await handleGitWorkspaceRoute({
		nestedPath,
		onMutation: (operationRevision) =>
			events.emitRepository(repositoryId, "changes", operationRevision),
		repository,
		request,
		url,
	});
	if (gitResponse) return gitResponse;
	if (nestedPath === "search" && request.method === "GET") {
		return json(
			await repository.search(
				url.searchParams.get("q") ?? "",
				url.searchParams.get("currentPath") ?? "",
			),
		);
	}
	if (nestedPath === "source" && request.method === "GET") {
		return json(
			await repository.source(
				url.searchParams.get("path") ?? "",
				Number(url.searchParams.get("line") ?? 1),
				Number(url.searchParams.get("context") ?? 4),
			),
		);
	}
	if (nestedPath === "source-file" && request.method === "GET") {
		return json(
			await repository.sourceFile(
				url.searchParams.get("path") ?? "",
				Number(url.searchParams.get("line") ?? 1),
			),
		);
	}
	if (fileRoute?.[2] === "stage" && request.method === "POST") {
		const fileId = decodeSegment(fileRoute[1] ?? "");
		const input = await readJsonObject<StageFileRequest>(request);
		if (input.fileId !== fileId) {
			throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
		}
		const result = await repository.stage(input);
		await events.emitRepository(repositoryId, "changes", result.operationRevision);
		return json(result);
	}
	if (nestedPath === "files/stage" && request.method === "POST") {
		const input = await readJsonObject<StageFilesRequest>(request);
		const result = await repository.stageFiles(input);
		await events.emitRepository(repositoryId, "changes", result.operationRevision);
		return json(result);
	}
	if (nestedPath === "commit" && request.method === "POST") {
		const input = await readJsonObject<CommitRequest>(request);
		const result = await repository.commit(input);
		await events.emitRepository(repositoryId, "changes", result.operationRevision);
		return json(result, { status: 201 });
	}
	if (nestedPath === "commit-message" && request.method === "POST") {
		const input = await readJsonObject<GenerateCommitMessageRequest>(request);
		const context = await repository.commitMessageContext(input);
		let preferences;
		try {
			preferences = parseCodexGenerationPreferences(
				input.codex ?? DEFAULT_CODEX_GENERATION_PREFERENCES,
			);
		} catch (error) {
			throw new HttpError(
				400,
				"codex_preferences_invalid",
				error instanceof Error ? error.message : "Codex preferences are invalid",
			);
		}
		const message = await commitMessages.generate(context, preferences, request.signal);
		await repository.assertCommitMessageRevision(input.operationRevision);
		const response: GenerateCommitMessageResponse = {
			message,
			operationRevision: input.operationRevision,
		};
		return json(response);
	}
	if (nestedPath === "package-scripts" && request.method === "GET") {
		const response: PackageScriptsResponse = await packageCommands.discover(repository.root);
		return json(response);
	}
	if (nestedPath === "package-runs" && request.method === "GET") {
		const response: PackageRunsResponse = {
			runs: packageCommands.runs(repositoryId),
		};
		return json(response);
	}
	if (nestedPath === "package-runs" && request.method === "POST") {
		const input = await readJsonObject<StartPackageRunRequest>(request);
		const response: PackageRunResponse = {
			run: await packageCommands.start(repositoryId, repository.root, input),
		};
		return json(response, { status: 201 });
	}
	if (packageRunRoute?.[2] === "stop" && request.method === "POST") {
		const runId = decodeSegment(packageRunRoute[1] ?? "");
		const response: PackageRunResponse = {
			run: packageCommands.stop(repositoryId, runId),
		};
		return json(response);
	}
	if (packageRunRoute?.[2] === "events" && request.method === "GET") {
		return openPackageRunEvents(
			request,
			packageCommands,
			repositoryId,
			decodeSegment(packageRunRoute[1] ?? ""),
		);
	}

	const collaborationResponse = await handleRepositoryCollaborationRoutes(
		context,
		request,
		url,
		repositoryId,
		nestedPath,
		repository,
	);
	if (collaborationResponse) return collaborationResponse;
	throw new HttpError(404, "route_not_found", "API route not found");
}
