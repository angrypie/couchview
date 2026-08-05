import {
	type ArtifactRepositoryResolveRequest,
	parseArtifactRepositoryResolveRequest,
} from "../shared/artifacts.ts";
import {
	API_ROUTES,
	type BootstrapResponse,
	type ClaimRemoteBridgePairingRequest,
	type CreateSettingsProfileRequest,
	CSRF_HEADER,
	type InstanceResponse,
	NATIVE_CLIENT_TOKEN_HEADER,
	type NativeClientDevice,
	REMOTE_BRIDGE_DEVICE_TOKEN_HEADER,
	type RegisterRepositoryRequest,
	type RegisterRepositoryResponse,
	type RemoteBridgeLeaseRequest,
	type RemoteBridgeTicketRequest,
	type RestartCapability,
	type RestartResponse,
	type UpdateSettingsProfileRequest,
} from "../shared/contracts.ts";
import {
	DEFAULT_SETTINGS_PROFILE_ID,
	normalizeSettingsProfileName,
	parseSettingsProfileData,
} from "../shared/settings.ts";
import type { ArtifactProposalGenerator } from "./artifactProposal.ts";
import type { ArtifactService } from "./artifactService.ts";
import type { CodexAppServerService } from "./codexAppServer.ts";
import type { CommitMessageGenerator } from "./commitMessage.ts";
import type { StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import type { NativeClientService } from "./nativeClientService.ts";
import type { RemoteBridgeService } from "./remoteBridgeService.ts";
import type { RepositoryManager } from "./repositories.ts";
import { listRepositoryDirectories } from "./repositoryDirectories.ts";
import {
	bearerToken,
	decodeSegment,
	isMutation,
	json,
	normalizeRequestHost,
	readJsonObject,
	remoteBridgeDeviceToken,
	tokenMatches,
} from "./serverHttp.ts";
import { handleNativeClientApi } from "./serverNativeClientRoutes.ts";
import type { TerminalSessionService } from "./terminalSessions.ts";

interface SystemRouteContext {
	controlToken: string;
	csrfToken: string;
	version: string;
	instanceId: string;
	protocolVersion: number;
	host: string;
	port: number;
	accessOrigins: readonly string[];
	remoteBridgeOriginAccess: string;
	nativeClients: NativeClientService;
	database: StateDatabase;
	artifacts: ArtifactService;
	artifactProposals: ArtifactProposalGenerator;
	repositories: RepositoryManager;
	commitMessages: CommitMessageGenerator;
	codex: CodexAppServerService;
	terminalSessions: TerminalSessionService;
	remoteBridge: RemoteBridgeService;
	restart: RestartCapability & { request?(): Promise<void> };
	defaultRepositoryId: () => string | null;
	registerRepository(root: string): Promise<RegisterRepositoryResponse>;
	onNativeClientRevoked(clientId: string): void;
}

function isControlRegistration(request: Request, url: URL): boolean {
	return url.pathname === API_ROUTES.controlRepositories && request.method === "POST";
}

function isControlRestart(request: Request, url: URL): boolean {
	return url.pathname === API_ROUTES.controlRestart && request.method === "POST";
}

function isArtifactCredentialMutation(request: Request, url: URL): boolean {
	if (request.method !== "POST") return false;
	return (
		url.pathname === API_ROUTES.artifactRepositoryResolve ||
		/^\/api\/repositories\/[^/]+\/artifacts\/[^/]+\/runs(?:\/[^/]+\/stop)?$/.test(url.pathname)
	);
}

function isArtifactRequest(url: URL): boolean {
	return (
		url.pathname === API_ROUTES.artifactRepositoryResolve ||
		/^\/api\/repositories\/[^/]+\/artifacts(?:\/.*)?$/.test(url.pathname)
	);
}

export function authorizeApiRequest(
	request: Request,
	url: URL,
	controlToken: string,
	csrfToken: string,
	remoteBridge: RemoteBridgeService,
	nativeClients: NativeClientService,
): NativeClientDevice | null {
	const suppliedNativeToken = request.headers.get(NATIVE_CLIENT_TOKEN_HEADER);
	if (suppliedNativeToken !== null) return nativeClients.authenticate(suppliedNativeToken);
	const controlRequest = isControlRegistration(request, url) || isControlRestart(request, url);
	const remoteBridgeClaim =
		url.pathname === API_ROUTES.remoteBridgeClaim && request.method === "POST";
	const remoteBridgeCredentialMutation =
		request.method === "POST" &&
		(url.pathname === API_ROUTES.remoteBridgeHostTickets ||
			url.pathname === API_ROUTES.remoteBridgeHostLease ||
			/^\/api\/repositories\/[^/]+\/remote-bridge\/(?:tickets|lease)$/.test(url.pathname));
	if (isArtifactRequest(url) && request.headers.has(REMOTE_BRIDGE_DEVICE_TOKEN_HEADER)) {
		remoteBridge.authenticateDevice(request.headers.get(REMOTE_BRIDGE_DEVICE_TOKEN_HEADER));
	}
	if (controlRequest) {
		if (!tokenMatches(bearerToken(request), controlToken)) {
			throw new HttpError(403, "control_token_failed", "CLI control request is not authorized");
		}
		return null;
	}
	if (isArtifactCredentialMutation(request, url) && !request.headers.get("origin")) {
		if (tokenMatches(bearerToken(request), controlToken)) return null;
		remoteBridge.authenticateDevice(remoteBridgeDeviceToken(request));
		return null;
	}
	const nativeClientClaim =
		url.pathname === API_ROUTES.nativeClientPairingClaim && request.method === "POST";
	if (
		isMutation(request.method) &&
		!nativeClientClaim &&
		!remoteBridgeClaim &&
		!remoteBridgeCredentialMutation
	) {
		if (!request.headers.get("origin")) {
			throw new HttpError(403, "origin_required", "A same-origin browser request is required");
		}
		if (!tokenMatches(request.headers.get(CSRF_HEADER), csrfToken)) {
			throw new HttpError(403, "csrf_failed", "The local session token is missing or invalid");
		}
	}
	return null;
}

export async function handleSystemApi(
	context: SystemRouteContext,
	request: Request,
	url: URL,
): Promise<Response | null> {
	const nativeClientResponse = await handleNativeClientApi(
		{
			nativeClients: context.nativeClients,
			onRevoked: context.onNativeClientRevoked,
		},
		request,
		url,
	);
	if (nativeClientResponse) return nativeClientResponse;
	if (url.pathname === API_ROUTES.repositoryDirectories && request.method === "GET") {
		return json(await listRepositoryDirectories(url.searchParams.get("path")));
	}
	if (url.pathname === API_ROUTES.artifactRepositoryResolve && request.method === "POST") {
		const value = await readJsonObject<ArtifactRepositoryResolveRequest>(request);
		let input: ArtifactRepositoryResolveRequest;
		try {
			input = parseArtifactRepositoryResolveRequest(value);
		} catch (error) {
			throw new HttpError(
				400,
				"artifact_repository_selection_invalid",
				error instanceof Error ? error.message : "Repository selection is invalid",
			);
		}
		return json(await context.artifacts.resolveRepository(input));
	}
	if (url.pathname === API_ROUTES.accessRefresh && request.method === "GET") {
		const repositoryId = url.searchParams.get("repo");
		const location = new URL("/", url);
		if (repositoryId && repositoryId.length <= 512) {
			location.searchParams.set("repo", repositoryId);
		}
		location.searchParams.set("access_refresh", "1");
		return new Response(null, {
			status: 302,
			headers: {
				"Cache-Control": "no-store",
				Location: `${location.pathname}${location.search}`,
			},
		});
	}
	if (url.pathname === API_ROUTES.accessLogout && request.method === "GET") {
		return new Response(null, {
			status: 302,
			headers: {
				"Cache-Control": "no-store",
				Location: "/cdn-cgi/access/logout",
			},
		});
	}
	if (url.pathname === API_ROUTES.remoteBridgeClaim && request.method === "POST") {
		const input = await readJsonObject<ClaimRemoteBridgePairingRequest>(request);
		return json(context.remoteBridge.claimPairing(input), { status: 201 });
	}
	if (url.pathname === API_ROUTES.remoteBridgeHostTickets && request.method === "POST") {
		const input = await readJsonObject<RemoteBridgeTicketRequest>(request);
		return json(
			context.remoteBridge.issueTicket(remoteBridgeDeviceToken(request), input, {
				host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
			}),
			{ status: 201 },
		);
	}
	if (url.pathname === API_ROUTES.remoteBridgeHostLease && request.method === "POST") {
		const input = await readJsonObject<RemoteBridgeLeaseRequest>(request);
		return json(
			context.remoteBridge.renewLease(remoteBridgeDeviceToken(request), input, {
				host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
			}),
		);
	}
	if (url.pathname === API_ROUTES.instance && request.method === "GET") {
		const response: InstanceResponse = {
			service: "couchview",
			protocolVersion: context.protocolVersion,
			version: context.version,
			serverId: context.nativeClients.serverId(),
			instanceId: context.instanceId,
			bindHost: context.host,
			port: context.port,
			accessOrigins: [...context.accessOrigins],
			terminalEnabled: context.terminalSessions.enabled,
			terminalP2pEnabled: context.terminalSessions.p2pEnabled,
			terminalStunUrls: [...context.terminalSessions.stunUrls],
			remoteBridgeEnabled: context.remoteBridge.enabled,
			remoteBridgeP2pEnabled: context.remoteBridge.p2pEnabled,
			remoteBridgeStunUrls: [...context.remoteBridge.stunUrls],
			remoteBridgeTargetPort: context.remoteBridge.targetPort,
			remoteBridgeOriginAccess: context.remoteBridgeOriginAccess,
		};
		return json(response);
	}
	if (url.pathname === API_ROUTES.bootstrap && request.method === "GET") {
		const response: BootstrapResponse = {
			csrfToken: context.csrfToken,
			repositories: await context.repositories.list(),
			defaultRepositoryId: context.defaultRepositoryId(),
			catalogRevision: context.database.catalogRevision(),
			settingsProfiles: context.database.settingsProfiles(),
			restart: {
				available: context.restart.available,
				reason: context.restart.reason,
			},
			commitMessage: context.commitMessages.capability,
			artifactProposal: context.artifactProposals.capability,
			codex: context.codex.capabilityFor(),
			terminal: context.terminalSessions.capability,
			remoteBridge: context.remoteBridge.capability,
		};
		return json(response);
	}
	if (
		(url.pathname === API_ROUTES.restart || isControlRestart(request, url)) &&
		request.method === "POST"
	) {
		if (!context.restart.available || !context.restart.request) {
			throw new HttpError(
				409,
				"restart_unavailable",
				context.restart.reason ?? "Restart is unavailable for this Couchview process.",
			);
		}
		await context.restart.request();
		const response: RestartResponse = {
			status: "restarting",
			previousInstanceId: context.instanceId,
		};
		return json(response, { status: 202 });
	}
	if (url.pathname === API_ROUTES.repositories && request.method === "GET") {
		return json({
			repositories: await context.repositories.list(),
			catalogRevision: context.database.catalogRevision(),
		});
	}
	if (url.pathname === API_ROUTES.settingsProfiles && request.method === "GET") {
		return json({ profiles: context.database.settingsProfiles() });
	}
	if (url.pathname === API_ROUTES.settingsProfiles && request.method === "POST") {
		const input = await readJsonObject<CreateSettingsProfileRequest>(request);
		if (
			input.sourceProfileId !== undefined &&
			(typeof input.sourceProfileId !== "string" || input.sourceProfileId.length > 512)
		) {
			throw new HttpError(400, "invalid_settings_profile", "Source profile is invalid");
		}
		try {
			const name = normalizeSettingsProfileName(input.name);
			const profile = context.database.createSettingsProfile(name, input.sourceProfileId);
			return json({ profile }, { status: 201 });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Settings profile is invalid";
			if (/UNIQUE constraint failed/i.test(message)) {
				throw new HttpError(
					409,
					"settings_profile_name_conflict",
					"That profile name is already in use",
				);
			}
			if (/does not exist/i.test(message)) {
				throw new HttpError(404, "settings_profile_not_found", message);
			}
			throw new HttpError(400, "invalid_settings_profile", message);
		}
	}
	const profileRoute = /^\/api\/settings\/profiles\/([^/]+)$/.exec(url.pathname);
	if (profileRoute) {
		const profileId = decodeSegment(profileRoute[1] ?? "");
		if (request.method === "PUT") {
			const input = await readJsonObject<UpdateSettingsProfileRequest>(request);
			if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
				throw new HttpError(400, "invalid_settings_profile", "Profile revision is invalid");
			}
			try {
				const name =
					profileId === DEFAULT_SETTINGS_PROFILE_ID
						? "Default"
						: normalizeSettingsProfileName(input.name);
				const result = context.database.updateSettingsProfile(
					profileId,
					name,
					parseSettingsProfileData(input.data),
					input.expectedRevision,
				);
				if (result.status === "missing") {
					throw new HttpError(404, "settings_profile_not_found", "Settings profile not found");
				}
				if (result.status === "stale") {
					throw new HttpError(
						409,
						"stale_settings_profile",
						"This profile changed in another browser. Reload it before saving.",
					);
				}
				return json({ profile: result.profile });
			} catch (error) {
				if (error instanceof HttpError) throw error;
				const message = error instanceof Error ? error.message : "Settings profile is invalid";
				if (/UNIQUE constraint failed/i.test(message)) {
					throw new HttpError(
						409,
						"settings_profile_name_conflict",
						"That profile name is already in use",
					);
				}
				throw new HttpError(400, "invalid_settings_profile", message);
			}
		}
		if (request.method === "DELETE") {
			if (profileId === DEFAULT_SETTINGS_PROFILE_ID) {
				throw new HttpError(
					409,
					"default_profile_required",
					"The Default profile cannot be deleted",
				);
			}
			if (!context.database.deleteSettingsProfile(profileId)) {
				throw new HttpError(404, "settings_profile_not_found", "Settings profile not found");
			}
			return new Response(null, { status: 204 });
		}
	}
	if (
		(request.method === "POST" && url.pathname === API_ROUTES.repositories) ||
		isControlRegistration(request, url)
	) {
		const input = await readJsonObject<RegisterRepositoryRequest>(request);
		const result = await context.registerRepository(input.root);
		return json(result, { status: result.added ? 201 : 200 });
	}
	return null;
}
