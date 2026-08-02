import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { API_ROUTES, REMOTE_BRIDGE_PROTOCOL } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import type { RemoteBridgeService, RemoteBridgeSocketData } from "./remoteBridgeService.ts";
import type { RepositoryManager } from "./repositories.ts";
import { decodeSegment, normalizeOrigin, normalizeRequestHost } from "./serverHttp.ts";
import { addSecurityHeaders, errorResponse } from "./serverResponses.ts";
import {
	TERMINAL_PROTOCOL,
	type TerminalSessionService,
	type TerminalSocketData,
} from "./terminalSessions.ts";

export type ServerSocketData = TerminalSocketData | RemoteBridgeSocketData;

interface RequestHandlerContext {
	staticDirectory?: string;
	allowedHosts: ReadonlySet<string>;
	allowedOrigins: ReadonlySet<string>;
	repositories: RepositoryManager;
	terminalSessions: TerminalSessionService;
	remoteBridge: RemoteBridgeService;
	handleApi(request: Request, url: URL): Promise<Response>;
}

export function createRequestHandler(context: RequestHandlerContext) {
	const {
		staticDirectory,
		allowedHosts,
		allowedOrigins,
		repositories,
		terminalSessions,
		remoteBridge,
		handleApi,
	} = context;

	const serveStatic = async (url: URL): Promise<Response> => {
		if (!staticDirectory) {
			throw new HttpError(404, "not_found", "Frontend build not found");
		}
		const staticRoot = path.resolve(staticDirectory);
		const canonicalStaticRoot = await realpath(staticRoot).catch(() => null);
		if (!canonicalStaticRoot) {
			throw new HttpError(404, "not_found", "Frontend build not found");
		}
		let pathname: string;
		try {
			pathname = decodeURIComponent(url.pathname);
		} catch {
			throw new HttpError(400, "invalid_path", "URL path is invalid");
		}
		const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
		const resolveStaticFile = async (candidate: string): Promise<string | null> => {
			const lexicalTarget = path.resolve(staticRoot, candidate);
			if (lexicalTarget !== staticRoot && !lexicalTarget.startsWith(`${staticRoot}${path.sep}`)) {
				throw new HttpError(400, "invalid_path", "URL path escapes the static directory");
			}
			const canonicalTarget = await realpath(lexicalTarget).catch(() => null);
			if (!canonicalTarget) return null;
			if (
				canonicalTarget !== canonicalStaticRoot &&
				!canonicalTarget.startsWith(`${canonicalStaticRoot}${path.sep}`)
			) {
				throw new HttpError(
					403,
					"asset_outside_root",
					"Asset resolves outside the static directory",
				);
			}
			const metadata = await stat(canonicalTarget).catch(() => null);
			return metadata?.isFile() ? canonicalTarget : null;
		};

		let target = await resolveStaticFile(relative);
		if (!target && !path.extname(relative)) target = await resolveStaticFile("index.html");
		if (!target) throw new HttpError(404, "not_found", "Asset not found");
		const file = Bun.file(target);
		const immutable = relative.startsWith("assets/") && /-[A-Za-z0-9_-]{8,}\./.test(relative);
		return new Response(file, {
			headers: {
				"Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
			},
		});
	};

	const handleRequest = async (
		request: Request,
		server?: Bun.Server<ServerSocketData>,
	): Promise<Response | undefined> => {
		const url = new URL(request.url);
		const hostHeader = request.headers.get("host") ?? url.host;
		const origin = request.headers.get("origin");
		let response: Response;
		try {
			let normalizedHost: string;
			try {
				normalizedHost = normalizeRequestHost(hostHeader);
			} catch {
				throw new HttpError(403, "host_rejected", "Host is not allowed by the local server");
			}
			if (!allowedHosts.has(normalizedHost)) {
				throw new HttpError(403, "host_rejected", "Host is not allowed by the local server");
			}
			let normalizedOrigin: string | null = null;
			if (origin) {
				try {
					normalizedOrigin = normalizeOrigin(origin);
				} catch {
					throw new HttpError(403, "origin_rejected", "Origin is not allowed by the local server");
				}
				if (!allowedOrigins.has(normalizedOrigin)) {
					throw new HttpError(403, "origin_rejected", "Origin is not allowed by the local server");
				}
			}

			const terminalSocketRoute = /^\/api\/repositories\/([^/]+)\/terminal\/socket$/.exec(
				url.pathname,
			);
			if (terminalSocketRoute && request.method === "GET") {
				if (!normalizedOrigin) {
					throw new HttpError(403, "origin_required", "A same-origin browser request is required");
				}
				if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
					throw new HttpError(
						426,
						"websocket_required",
						"This terminal route requires a WebSocket upgrade",
					);
				}
				if (!server) {
					throw new HttpError(
						426,
						"websocket_required",
						"The current server cannot upgrade this request",
					);
				}
				const repositoryId = decodeSegment(terminalSocketRoute[1] ?? "");
				await repositories.get(repositoryId);
				const data = terminalSessions.consumeUpgrade(repositoryId, request, {
					host: normalizedHost,
					origin: normalizedOrigin,
				});
				const upgraded = server.upgrade(request, {
					data,
					headers: { "Sec-WebSocket-Protocol": TERMINAL_PROTOCOL },
				});
				if (!upgraded) {
					throw new HttpError(
						400,
						"websocket_upgrade_failed",
						"The terminal WebSocket upgrade failed",
					);
				}
				return undefined;
			}

			const legacyRemoteBridgeSocketRoute =
				/^\/api\/repositories\/([^/]+)\/remote-bridge\/socket$/.exec(url.pathname);
			const remoteBridgeHostSocket = url.pathname === API_ROUTES.remoteBridgeHostSocket;
			if ((remoteBridgeHostSocket || legacyRemoteBridgeSocketRoute) && request.method === "GET") {
				if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
					throw new HttpError(
						426,
						"websocket_required",
						"This native bridge route requires a WebSocket upgrade",
					);
				}
				if (!server) {
					throw new HttpError(
						426,
						"websocket_required",
						"The current server cannot upgrade this request",
					);
				}
				if (legacyRemoteBridgeSocketRoute) {
					const repositoryId = decodeSegment(legacyRemoteBridgeSocketRoute[1] ?? "");
					await repositories.get(repositoryId);
				}
				const data = remoteBridge.consumeUpgrade(request, {
					host: normalizedHost,
				});
				const upgraded = server.upgrade(request, {
					data,
					headers: { "Sec-WebSocket-Protocol": REMOTE_BRIDGE_PROTOCOL },
				});
				if (!upgraded) {
					throw new HttpError(
						400,
						"websocket_upgrade_failed",
						"The native bridge WebSocket upgrade failed",
					);
				}
				return undefined;
			}

			response =
				url.pathname === "/api" || url.pathname.startsWith("/api/")
					? await handleApi(request, url)
					: await serveStatic(url);
		} catch (error) {
			response = errorResponse(error);
		}
		return addSecurityHeaders(response);
	};

	return handleRequest;
}
