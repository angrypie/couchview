import type {
	CommitRequest,
	CreateRemoteBridgePairingRequest,
	ForgetRepositoryResponse,
	GenerateCommitMessageRequest,
	GenerateCommitMessageResponse,
	PackageRunResponse,
	PackageRunsResponse,
	PackageScriptsResponse,
	RemoteBridgeLeaseRequest,
	RemoteBridgeTicketRequest,
	StageFileRequest,
	StageFilesRequest,
	StartPackageRunRequest,
	TerminalAttachmentRequest,
	TerminalLeaseRequest,
} from "../shared/contracts.ts";
import { REMOTE_BRIDGE_NO_ORIGIN_ACCESS } from "../shared/contracts.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";
import { HttpError } from "./errors.ts";
import {
	decodeSegment,
	json,
	normalizeOrigin,
	normalizeRequestHost,
	readJsonObject,
	remoteBridgeDeviceToken,
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
		database,
		repositories,
		packageCommands,
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
	const fileRoute = /^files\/([^/]+)\/(diff|stage|review|comments)$/.exec(nestedPath);
	const packageRunRoute = /^package-runs\/([^/]+)(?:\/(stop|events))?$/.exec(nestedPath);

	if (nestedPath === "files" && request.method === "GET") {
		return json(await repository.changes());
	}
	if (nestedPath === "terminal" && request.method === "GET") {
		return json(await terminalSessions.status(repositoryId));
	}
	if (nestedPath === "terminal/attachments" && request.method === "POST") {
		const input = await readJsonObject<TerminalAttachmentRequest>(request);
		const origin = request.headers.get("origin");
		if (!origin) {
			throw new HttpError(403, "origin_required", "A same-origin browser request is required");
		}
		return json(
			await terminalSessions.issueAttachment(repositoryId, repository.root, input, {
				host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
				origin: normalizeOrigin(origin),
			}),
			{ status: 201 },
		);
	}
	if (nestedPath === "terminal/lease" && request.method === "POST") {
		const input = await readJsonObject<TerminalLeaseRequest>(request);
		const origin = request.headers.get("origin");
		if (!origin) {
			throw new HttpError(403, "origin_required", "A same-origin browser request is required");
		}
		return json(
			await terminalSessions.renewLease(repositoryId, input, {
				host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
				origin: normalizeOrigin(origin),
			}),
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
	if (nestedPath === "remote-bridge/tickets" && request.method === "POST") {
		const input = await readJsonObject<RemoteBridgeTicketRequest>(request);
		return json(
			remoteBridge.issueTicket(remoteBridgeDeviceToken(request), input, {
				host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
			}),
			{ status: 201 },
		);
	}
	if (nestedPath === "remote-bridge/lease" && request.method === "POST") {
		const input = await readJsonObject<RemoteBridgeLeaseRequest>(request);
		return json(
			remoteBridge.renewLease(remoteBridgeDeviceToken(request), input, {
				host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
			}),
		);
	}
	if (fileRoute?.[2] === "diff" && request.method === "GET") {
		return json(await repository.diff(decodeSegment(fileRoute[1] ?? "")));
	}
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
		const message = await commitMessages.generate(context, request.signal);
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
