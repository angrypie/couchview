import { randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import {
	type RegisterRepositoryResponse,
	type RestartCapability,
	remoteBridgeOriginAccessIdIsValid,
} from "../shared/contracts.ts";
import {
	type ArtifactProposalGenerator,
	CodexArtifactProposalService,
} from "./artifactProposal.ts";
import { ArtifactService } from "./artifactService.ts";
import { ArtifactStore } from "./artifactStore.ts";
import { CodexCommitMessageService, type CommitMessageGenerator } from "./commitMessage.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import { NativeClientService } from "./nativeClientService.ts";
import { PackageCommandService } from "./packageCommands.ts";
import { RemoteBridgeService, type RemoteBridgeSocketData } from "./remoteBridgeService.ts";
import { RepositoryManager } from "./repositories.ts";
import { GitRepository } from "./repository.ts";
import { RepositoryCommandRunner } from "./repositoryCommandRunner.ts";
import { ServerEventStreams } from "./serverEvents.ts";
import { normalizeOrigin } from "./serverHttp.ts";
import { handleRepositoryApi } from "./serverRepositoryRoutes.ts";
import { createRequestHandler } from "./serverRequestHandler.ts";
import { addSecurityHeaders, errorResponse } from "./serverResponses.ts";
import { authorizeApiRequest, handleSystemApi } from "./serverSystemRoutes.ts";
import { SpeechService, type SpeechServiceOptions } from "./speech/SpeechService.ts";
import { handleSpeechApi } from "./speech/speechRoute.ts";
import {
	TerminalSessionService,
	type TerminalSocketData,
	terminalAccessIsLoopback,
} from "./terminalSessions.ts";
import { VoiceCommandService } from "./voiceCommands/VoiceCommandService.ts";
import { handleVoiceCommandApi } from "./voiceCommands/voiceCommandRoute.ts";

const _encoder = new TextEncoder();
export const INSTANCE_PROTOCOL_VERSION = 7;
const APP_VERSION = packageJson.version;

export interface CouchviewAppOptions {
	root: string;
	host?: string;
	port?: number;
	staticDirectory?: string;
	allowedOrigins?: string[];
	stateDatabasePath?: string;
	instanceId?: string;
	controlToken?: string;
	version?: string;
	revisionPollIntervalMs?: number;
	restart?: RestartCapability & {
		request?(): Promise<void>;
	};
	commitMessages?: CommitMessageGenerator;
	artifactProposals?: ArtifactProposalGenerator;
	terminal?: {
		enabled: boolean;
		disabledReason?: string;
		namespaceSeed?: string;
		p2pEnabled?: boolean;
		stunUrls?: string[];
	};
	terminalSessions?: TerminalSessionService;
	remoteBridge?: {
		enabled: boolean;
		disabledReason?: string;
		p2pEnabled?: boolean;
		stunUrls?: string[];
		targetPort?: number;
		originAccess?: string;
	};
	remoteBridgeService?: RemoteBridgeService;
	nativeClientService?: NativeClientService;
	artifactStore?: ArtifactStore;
	speech?: SpeechServiceOptions;
	voiceCommandsEnabled?: boolean;
	voiceCommands?: VoiceCommandService;
}

export type CouchviewSocketData = TerminalSocketData | RemoteBridgeSocketData;

export interface CouchviewApp {
	repository: GitRepository;
	repositories: RepositoryManager;
	packageCommands: PackageCommandService;
	artifacts: ArtifactService;
	artifactProposals: ArtifactProposalGenerator;
	commitMessages: CommitMessageGenerator;
	terminalSessions: TerminalSessionService;
	remoteBridge: RemoteBridgeService;
	nativeClients: NativeClientService;
	speech: SpeechService;
	voiceCommands: VoiceCommandService;
	remoteBridgeOriginAccess: string;
	websocket: Bun.WebSocketHandler<CouchviewSocketData>;
	database: StateDatabase;
	csrfToken: string;
	controlToken: string;
	instanceId: string;
	version: string;
	protocolVersion: number;
	bindHost: string;
	port: number;
	accessOrigins: readonly string[];
	registerServerInstance(): void;
	fetch(request: Request): Promise<Response>;
	fetchWithServer(
		request: Request,
		server: Bun.Server<CouchviewSocketData>,
	): Promise<Response | undefined>;
	close(): void;
}

export function normalizeBindHost(value: string): string {
	if (!value || value !== value.trim()) {
		throw new Error("Host must be an IP address or hostname without a scheme, port, or path");
	}
	const bracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
	if (isIP(bracketed)) return bracketed;
	if (value.includes(":") || value.includes("/") || value.includes("@") || value.length > 253) {
		throw new Error("Host must be an IP address or hostname without a scheme, port, or path");
	}
	const hostname = value.endsWith(".") ? value.slice(0, -1) : value;
	const valid = hostname
		.split(".")
		.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
	if (!valid) {
		throw new Error("Host must be an IP address or hostname without a scheme, port, or path");
	}
	return hostname.toLowerCase();
}

export function hostForUrl(host: string): string {
	return isIP(host) === 6 ? `[${host}]` : host;
}

function interfaceAddresses(): string[] {
	return Object.values(networkInterfaces())
		.flatMap((entries) => entries ?? [])
		.map((entry) => entry.address)
		.filter((address) => isIP(address) !== 0 && !address.includes("%"));
}

export function accessOriginsForHost(
	bindHost: string,
	port: number,
	addresses: readonly string[] = interfaceAddresses(),
): string[] {
	const host = normalizeBindHost(bindHost);
	const hosts = new Set<string>();
	if (host === "0.0.0.0") {
		hosts.add(host).add("127.0.0.1").add("localhost");
		for (const address of addresses) {
			if (isIP(address) === 4) hosts.add(address);
		}
	} else if (host === "::") {
		hosts.add(host).add("::1").add("127.0.0.1").add("localhost");
		for (const address of addresses) {
			if (isIP(address)) hosts.add(address);
		}
	} else {
		hosts.add(host);
	}
	return [...hosts].map((candidate) => normalizeOrigin(`http://${hostForUrl(candidate)}:${port}`));
}

export async function createCouchviewApp(options: CouchviewAppOptions): Promise<CouchviewApp> {
	const host = normalizeBindHost(options.host ?? "127.0.0.1");
	const port = options.port ?? 4173;
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		throw new Error("Port must be between 1 and 65535");
	}

	const stateDatabasePath = path.resolve(options.stateDatabasePath ?? resolveStateDatabasePath());
	const database = await StateDatabase.open(stateDatabasePath);
	const repositories = new RepositoryManager(database);
	const commandRunner = new RepositoryCommandRunner();
	const packageCommands = new PackageCommandService({ commandRunner });
	const artifacts = await ArtifactService.create({
		database,
		repositories,
		runner: commandRunner,
		store: options.artifactStore ?? ArtifactStore.besideDatabase(stateDatabasePath),
	});
	const speech = new SpeechService(
		options.speech ?? {
			enabled: false,
			reason: "Start Couchview with --enable-speech to use host transcription.",
		},
	);
	const voiceCommands =
		options.voiceCommands ??
		new VoiceCommandService({
			enabled: options.voiceCommandsEnabled ?? false,
			storageDirectory: path.join(path.dirname(stateDatabasePath), "needle"),
		});
	const commitMessages = options.commitMessages ?? new CodexCommitMessageService();
	const artifactProposals = options.artifactProposals ?? new CodexArtifactProposalService();
	let initial: Awaited<ReturnType<RepositoryManager["register"]>>;
	let initialBackend: GitRepository;
	try {
		initial = await repositories.register(options.root);
		initialBackend = await repositories.get(initial.repository.id);
	} catch (error) {
		speech.close();
		voiceCommands.close();
		artifactProposals.close();
		commitMessages.close();
		packageCommands.close();
		artifacts.close();
		commandRunner.close();
		repositories.close();
		database.close();
		throw error;
	}

	const csrfToken = randomBytes(32).toString("base64url");
	const controlToken = options.controlToken ?? randomBytes(32).toString("base64url");
	const instanceId = options.instanceId ?? randomUUID();
	const version = options.version ?? APP_VERSION;
	const accessOrigins = [
		...new Set(
			[...accessOriginsForHost(host, port), ...(options.allowedOrigins ?? [])].map(normalizeOrigin),
		),
	];
	const allowedOrigins = new Set(accessOrigins);
	const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host));
	const autoTerminalEnabled = terminalAccessIsLoopback(host, [...allowedOrigins]);
	const terminalSessions =
		options.terminalSessions ??
		new TerminalSessionService({
			enabled: options.terminal?.enabled ?? autoTerminalEnabled,
			disabledReason:
				options.terminal?.disabledReason ??
				(autoTerminalEnabled
					? undefined
					: "Terminal access on non-loopback hosts requires --enable-terminal or COUCHVIEW_TERMINAL=1."),
			namespaceSeed: options.terminal?.namespaceSeed ?? `${stateDatabasePath}\0${host}\0${port}`,
			p2pEnabled: options.terminal?.p2pEnabled ?? false,
			stunUrls: options.terminal?.stunUrls,
		});
	const remoteBridge =
		options.remoteBridgeService ??
		new RemoteBridgeService({
			enabled: options.remoteBridge?.enabled ?? false,
			database,
			disabledReason: options.remoteBridge?.disabledReason,
			p2pEnabled: options.remoteBridge?.p2pEnabled ?? false,
			stunUrls: options.remoteBridge?.stunUrls,
			targetPort: options.remoteBridge?.targetPort,
		});
	const nativeClients =
		options.nativeClientService ?? new NativeClientService({ database: database.nativeClients });
	const remoteBridgeOriginAccess = options.remoteBridge?.originAccess ?? "auto";
	if (
		remoteBridgeOriginAccess !== "auto" &&
		!remoteBridgeOriginAccessIdIsValid(remoteBridgeOriginAccess)
	) {
		remoteBridge.close();
		terminalSessions.close();
		speech.close();
		voiceCommands.close();
		artifactProposals.close();
		commitMessages.close();
		packageCommands.close();
		artifacts.close();
		commandRunner.close();
		repositories.close();
		database.close();
		throw new Error("The native bridge origin-access provider is invalid");
	}
	const events = new ServerEventStreams(
		database,
		repositories,
		options.revisionPollIntervalMs ?? 1_500,
	);
	let defaultRepositoryId: string | null = initial.repository.id;
	let closed = false;
	const restart: RestartCapability & { request?(): Promise<void> } = options.restart ?? {
		available: false,
		reason: "Restart is unavailable for this Couchview process.",
	};

	const registerRepository = async (root: string): Promise<RegisterRepositoryResponse> => {
		if (typeof root !== "string" || !root.trim() || root.length > 32_768) {
			throw new HttpError(400, "invalid_repository", "Repository path is invalid");
		}
		const registered = await repositories.register(root);
		if (registered.added) events.emitCatalog();
		return { repository: registered.repository, added: registered.added };
	};

	const handleApi = async (request: Request, url: URL): Promise<Response> => {
		const nativeClient = authorizeApiRequest(
			request,
			url,
			controlToken,
			csrfToken,
			remoteBridge,
			nativeClients,
		);
		const systemResponse = await handleSystemApi(
			{
				controlToken,
				csrfToken,
				version,
				instanceId,
				protocolVersion: INSTANCE_PROTOCOL_VERSION,
				host,
				port,
				accessOrigins,
				remoteBridgeOriginAccess,
				nativeClients,
				database,
				artifacts,
				artifactProposals,
				repositories,
				commitMessages,
				terminalSessions,
				remoteBridge,
				speech,
				voiceCommands,
				restart,
				defaultRepositoryId: () => defaultRepositoryId,
				registerRepository,
				onNativeClientRevoked: (clientId) => terminalSessions.revokeNativeClient(clientId),
			},
			request,
			url,
		);
		if (systemResponse) return systemResponse;
		const speechResponse = await handleSpeechApi(speech, request, url);
		if (speechResponse) return speechResponse;
		const voiceCommandResponse = await handleVoiceCommandApi(voiceCommands, request, url);
		if (voiceCommandResponse) return voiceCommandResponse;
		return handleRepositoryApi(
			{
				nativeClient,
				database,
				artifacts,
				artifactProposals,
				repositories,
				packageCommands,
				commitMessages,
				terminalSessions,
				remoteBridge,
				remoteBridgeOriginAccess,
				events,
				defaultRepositoryId: () => defaultRepositoryId,
				setDefaultRepositoryId: (repositoryId) => {
					defaultRepositoryId = repositoryId;
				},
			},
			request,
			url,
		);
	};

	const handleRequest = createRequestHandler({
		staticDirectory: options.staticDirectory,
		allowedHosts,
		allowedOrigins,
		repositories,
		terminalSessions,
		remoteBridge,
		handleApi,
	});

	const websocket: Bun.WebSocketHandler<CouchviewSocketData> = {
		data: {} as CouchviewSocketData,
		maxPayloadLength: 64 * 1024,
		backpressureLimit: 1024 * 1024,
		closeOnBackpressureLimit: true,
		idleTimeout: 120,
		sendPings: true,
		open(socket) {
			if (socket.data.kind === "terminal") {
				terminalSessions.websocket.open?.(
					socket as unknown as Bun.ServerWebSocket<TerminalSocketData>,
				);
			} else {
				remoteBridge.websocket.open?.(
					socket as unknown as Bun.ServerWebSocket<RemoteBridgeSocketData>,
				);
			}
		},
		message(socket, message) {
			if (socket.data.kind === "terminal") {
				terminalSessions.websocket.message?.(
					socket as unknown as Bun.ServerWebSocket<TerminalSocketData>,
					message,
				);
			} else {
				remoteBridge.websocket.message?.(
					socket as unknown as Bun.ServerWebSocket<RemoteBridgeSocketData>,
					message,
				);
			}
		},
		close(socket, code, reason) {
			if (socket.data.kind === "terminal") {
				terminalSessions.websocket.close?.(
					socket as unknown as Bun.ServerWebSocket<TerminalSocketData>,
					code,
					reason,
				);
			} else {
				remoteBridge.websocket.close?.(
					socket as unknown as Bun.ServerWebSocket<RemoteBridgeSocketData>,
					code,
					reason,
				);
			}
		},
	};

	const app: CouchviewApp = {
		repository: initialBackend,
		repositories,
		packageCommands,
		artifacts,
		artifactProposals,
		commitMessages,
		terminalSessions,
		remoteBridge,
		nativeClients,
		speech,
		voiceCommands,
		remoteBridgeOriginAccess,
		websocket,
		database,
		csrfToken,
		controlToken,
		instanceId,
		version,
		protocolVersion: INSTANCE_PROTOCOL_VERSION,
		bindHost: host,
		port,
		accessOrigins,
		registerServerInstance(): void {
			database.registerServerInstance({
				instanceId,
				bindHost: host,
				port,
				pid: process.pid,
				version,
				protocolVersion: INSTANCE_PROTOCOL_VERSION,
				controlToken,
				accessOrigins: [...accessOrigins],
				startedAt: new Date().toISOString(),
			});
		},
		async fetch(request: Request): Promise<Response> {
			const response = await handleRequest(request);
			return (
				response ??
				addSecurityHeaders(
					errorResponse(
						new HttpError(
							426,
							"websocket_required",
							"The current server cannot upgrade this request",
						),
					),
				)
			);
		},
		fetchWithServer(
			request: Request,
			server: Bun.Server<CouchviewSocketData>,
		): Promise<Response | undefined> {
			return handleRequest(request, server);
		},
		close(): void {
			if (closed) return;
			closed = true;
			events.close();
			database.removeServerInstance(instanceId);
			terminalSessions.close();
			remoteBridge.close();
			speech.close();
			voiceCommands.close();
			artifactProposals.close();
			commitMessages.close();
			packageCommands.close();
			artifacts.close();
			commandRunner.close();
			repositories.close();
			database.close();
		},
	};
	return app;
}
