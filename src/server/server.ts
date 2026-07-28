import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import {
  API_ROUTES,
  CSRF_HEADER,
  type ApiErrorBody,
  type ApiErrorDiagnostic,
  type BootstrapResponse,
  type CodexApprovalRequest,
  type CodexThreadsResponse,
  type CodexThreadResponse,
  type CodexEvent,
  type CodexTurnResponse,
  type CommitRequest,
  type GenerateCommitMessageRequest,
  type GenerateCommitMessageResponse,
  type CreateCommentRequest,
  type DeleteCommentRequest,
  type ForgetRepositoryResponse,
  type InstanceResponse,
  type PackageRunEvent,
  type PackageRunResponse,
  type PackageRunsResponse,
  type PackageScriptsResponse,
  type RegisterRepositoryRequest,
  type RegisterRepositoryResponse,
  type RestartCapability,
  type RestartResponse,
  type ServerEvent,
  type ServerEventType,
  type SetReviewRequest,
  type StartPackageRunRequest,
  type StageFileRequest,
  type StageFilesRequest,
  type TerminalAttachmentRequest,
  type TerminalLeaseRequest,
  type UpdateCommentRequest,
} from "../shared/contracts.ts";
import {
  CodexCommitMessageService,
  type CommitMessageGenerator,
} from "./commitMessage.ts";
import { CodexAppServerService, codexPrompt } from "./codexAppServer.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import { GitCommandError } from "./git.ts";
import { PackageCommandService } from "./packageCommands.ts";
import { RepositoryManager } from "./repositories.ts";
import { GitRepository } from "./repository.ts";
import {
  TerminalSessionService,
  type TerminalSocketData,
  TERMINAL_PROTOCOL,
  terminalAccessIsLoopback,
} from "./terminalSessions.ts";

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 64 * 1024;
export const INSTANCE_PROTOCOL_VERSION = 4;
export const APP_VERSION = packageJson.version;

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
  codex?: CodexAppServerService;
  terminal?: {
    enabled: boolean;
    disabledReason?: string;
    namespaceSeed?: string;
    p2pEnabled?: boolean;
    stunUrls?: string[];
  };
  terminalSessions?: TerminalSessionService;
}

export interface CouchviewApp {
  repository: GitRepository;
  repositories: RepositoryManager;
  packageCommands: PackageCommandService;
  commitMessages: CommitMessageGenerator;
  codex: CodexAppServerService;
  terminalSessions: TerminalSessionService;
  websocket: Bun.WebSocketHandler<TerminalSocketData>;
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
    server: Bun.Server<TerminalSocketData>,
  ): Promise<Response | undefined>;
  close(): void;
}

interface StreamState {
  controller: ReadableStreamDefaultController<Uint8Array>;
  repositoryId: string;
  operationRevision: string;
  stateRevision: number;
  catalogRevision: number;
  ready: boolean;
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function tokenMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

async function readJsonObject<T extends object>(request: Request): Promise<T> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (type.split(";", 1)[0]?.trim() !== "application/json") {
    throw new HttpError(415, "json_required", "Request body must be JSON");
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    throw new HttpError(413, "body_too_large", "Request body is too large");
  }
  if (!request.body) {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "body_too_large", "Request body is too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "invalid_request", "Request body must be a JSON object");
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
    return json(body, { status: error.status });
  }
  if (error instanceof GitCommandError) {
    const diagnosticId = randomUUID().slice(0, 8);
    const detail = cleanDiagnosticText(error.stderr || error.message);
    const firstLine = detail.split("\n").find(Boolean)?.slice(0, 240) ?? "No details returned";
    const locked = /index\.lock|another git process/i.test(detail);
    let status = 500;
    let code = "git_failed";
    let message = `Git ${error.operation} failed`;
    let retryable = false;

    if (locked) {
      status = 423;
      code = "git_index_locked";
      message = "The Git index is busy; try again shortly";
      retryable = true;
    } else if (error.kind === "timeout") {
      status = 504;
      code = "git_timeout";
      message = `Git ${error.operation} stopped responding after ${Math.ceil(
        (error.timeoutMs ?? 0) / 1_000,
      )} seconds`;
      retryable = true;
    } else if (error.kind === "spawn") {
      status = 503;
      code = "git_unavailable";
      message = `Git ${error.operation} could not start: ${firstLine}`;
      retryable = true;
    } else if (error.kind === "capture") {
      status = 502;
      code = "git_output_capture";
      message = `Git ${error.operation} returned data that Couchview could not capture safely`;
      retryable = true;
    } else if (error.kind === "output_limit") {
      status = 502;
      code = "git_output_limit";
      message = `Git ${error.operation} returned more data than Couchview can safely process`;
    } else if (error.kind === "empty_output") {
      status = 503;
      code = "git_empty_output";
      message = "Git diff returned no data for a changed file after two attempts";
      retryable = true;
    } else {
      const exit = error.exitCode >= 0 ? ` (exit ${error.exitCode})` : "";
      message = `Git ${error.operation} failed${exit}: ${firstLine}`;
    }

    const diagnostic: ApiErrorDiagnostic = {
      id: diagnosticId,
      source: "git",
      operation: error.operation,
      kind: error.kind,
      exitCode: error.exitCode >= 0 ? error.exitCode : null,
      stderr: detail,
      retryable,
      timeoutMs: error.timeoutMs,
    };
    console.error(
      `[git:${diagnosticId}] operation=${error.operation} kind=${error.kind} ` +
        `exit=${error.exitCode} ${detail || "No stderr returned"}`,
    );
    const body: ApiErrorBody = {
      error: {
        code,
        message,
        diagnostic,
      },
    };
    return json(body, {
      status,
      headers: { "X-Couchview-Diagnostic": diagnosticId },
    });
  }
  console.error(error);
  const body: ApiErrorBody = {
    error: { code: "internal_error", message: "The local review server encountered an error" },
  };
  return json(body, { status: 500 });
}

function cleanDiagnosticText(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll("\0", "�")
    .trim()
    .slice(0, 4_000);
}

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'none'",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
  const valid = hostname.split(".").every((label) =>
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
  );
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
  return [...hosts].map((candidate) =>
    normalizeOrigin(`http://${hostForUrl(candidate)}:${port}`)
  );
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    !/^https?:\/\/[^/?#]+$/i.test(value)
  ) {
    throw new Error("Origin must be an exact HTTP or HTTPS origin");
  }
  return url.origin;
}

function normalizeRequestHost(value: string): string {
  if (!value || value !== value.trim() || /[/?#@]/.test(value)) {
    throw new Error("Invalid Host header");
  }
  const url = new URL(`http://${value}`);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid Host header");
  }
  return url.host;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "invalid_path", "API path is invalid");
  }
}

export async function createCouchviewApp(
  options: CouchviewAppOptions,
): Promise<CouchviewApp> {
  const host = normalizeBindHost(options.host ?? "127.0.0.1");
  const port = options.port ?? 4173;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }

  const stateDatabasePath = path.resolve(
    options.stateDatabasePath ?? resolveStateDatabasePath(),
  );
  const database = await StateDatabase.open(stateDatabasePath);
  const repositories = new RepositoryManager(database);
  const packageCommands = new PackageCommandService();
  const commitMessages =
    options.commitMessages ?? new CodexCommitMessageService();
  const codex = options.codex ?? new CodexAppServerService();
  let initial: Awaited<ReturnType<RepositoryManager["register"]>>;
  let initialBackend: GitRepository;
  try {
    initial = await repositories.register(options.root);
    initialBackend = await repositories.get(initial.repository.id);
  } catch (error) {
    commitMessages.close();
    codex.close();
    packageCommands.close();
    repositories.close();
    database.close();
    throw error;
  }

  const csrfToken = randomBytes(32).toString("base64url");
  const controlToken = options.controlToken ?? randomBytes(32).toString("base64url");
  const instanceId = options.instanceId ?? randomUUID();
  const version = options.version ?? APP_VERSION;
  const accessOrigins = accessOriginsForHost(host, port);
  const allowedOrigins = new Set(
    [...accessOrigins, ...(options.allowedOrigins ?? [])].map(normalizeOrigin),
  );
  const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host));
  const autoTerminalEnabled = terminalAccessIsLoopback(host, [...allowedOrigins]);
  const terminalSessions = options.terminalSessions ?? new TerminalSessionService({
    enabled: options.terminal?.enabled ?? autoTerminalEnabled,
    disabledReason: options.terminal?.disabledReason ??
      (autoTerminalEnabled
        ? undefined
        : "Terminal access on non-loopback hosts requires --enable-terminal or COUCHVIEW_TERMINAL=1."),
    namespaceSeed: options.terminal?.namespaceSeed ??
      `${stateDatabasePath}\0${host}\0${port}`,
    p2pEnabled: options.terminal?.p2pEnabled ?? false,
    stunUrls: options.terminal?.stunUrls,
  });
  const streams = new Set<StreamState>();
  const subscriptions = new Map<string, () => void>();
  let defaultRepositoryId: string | null = initial.repository.id;
  let pollInFlight = false;
  let closed = false;

  const sendEvent = (
    stream: StreamState,
    type: ServerEventType,
    values: Partial<Pick<ServerEvent, "operationRevision" | "stateRevision" | "catalogRevision">> = {},
  ): void => {
    const event: ServerEvent = {
      type,
      repositoryId: stream.repositoryId,
      operationRevision: values.operationRevision ?? stream.operationRevision,
      stateRevision: values.stateRevision ?? stream.stateRevision,
      catalogRevision: values.catalogRevision ?? stream.catalogRevision,
      at: new Date().toISOString(),
    };
    stream.operationRevision = event.operationRevision;
    stream.stateRevision = event.stateRevision;
    stream.catalogRevision = event.catalogRevision;
    try {
      stream.controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      streams.delete(stream);
      if (![...streams].some((candidate) => candidate.repositoryId === stream.repositoryId)) {
        subscriptions.get(stream.repositoryId)?.();
        subscriptions.delete(stream.repositoryId);
      }
    }
  };

  const emitRepository = async (
    repositoryId: string,
    type: ServerEventType,
    operationRevision?: string,
  ): Promise<void> => {
    const matching = [...streams].filter((stream) => stream.repositoryId === repositoryId);
    if (matching.length === 0) return;
    const resolvedOperation = operationRevision ??
      (await (await repositories.get(repositoryId)).changes()).operationRevision;
    const stateRevision = database.stateRevision(repositoryId) ?? 0;
    const catalogRevision = database.catalogRevision();
    for (const stream of matching) {
      if (
        (type === "changes" && stream.operationRevision === resolvedOperation) ||
        (type === "state" && stream.stateRevision === stateRevision)
      ) {
        continue;
      }
      sendEvent(stream, type, {
        operationRevision: resolvedOperation,
        stateRevision,
        catalogRevision,
      });
    }
  };

  const emitCatalog = (): void => {
    const catalogRevision = database.catalogRevision();
    for (const stream of streams) sendEvent(stream, "repositories", { catalogRevision });
  };

  const ensureSubscription = (repositoryId: string): void => {
    if (subscriptions.has(repositoryId)) return;
    subscriptions.set(
      repositoryId,
      repositories.subscribe(repositoryId, (operationRevision) => {
        void emitRepository(repositoryId, "changes", operationRevision).catch(() => undefined);
      }),
    );
  };

  const releaseSubscription = (repositoryId: string): void => {
    if ([...streams].some((stream) => stream.repositoryId === repositoryId)) return;
    subscriptions.get(repositoryId)?.();
    subscriptions.delete(repositoryId);
  };

  const removeStream = (stream: StreamState): void => {
    streams.delete(stream);
    releaseSubscription(stream.repositoryId);
  };

  const poller = setInterval(() => {
    if (streams.size === 0 || pollInFlight) return;
    pollInFlight = true;
    const catalogRevision = database.catalogRevision();
    for (const stream of streams) {
      if (stream.ready && catalogRevision !== stream.catalogRevision) {
        sendEvent(stream, "repositories", { catalogRevision });
      }
    }
    const repositoryIds = [...new Set([...streams].filter((stream) => stream.ready).map(
      (stream) => stream.repositoryId,
    ))];
    void Promise.all(repositoryIds.map(async (repositoryId) => {
      const repository = await repositories.get(repositoryId);
      const changes = await repository.changes();
      const stateRevision = database.stateRevision(repositoryId) ?? 0;
      for (const stream of streams) {
        if (!stream.ready || stream.repositoryId !== repositoryId) continue;
        if (changes.operationRevision !== stream.operationRevision) {
          sendEvent(stream, "changes", { operationRevision: changes.operationRevision });
        }
        if (stateRevision !== stream.stateRevision) {
          sendEvent(stream, "state", { stateRevision });
        }
      }
    }))
      .catch(() => undefined)
      .finally(() => {
        pollInFlight = false;
      });
  }, options.revisionPollIntervalMs ?? 1_500);

  const keepAlive = setInterval(() => {
    const bytes = encoder.encode(": keep-alive\n\n");
    for (const stream of streams) {
      try {
        stream.controller.enqueue(bytes);
      } catch {
        removeStream(stream);
      }
    }
  }, 5_000);
  const restart: RestartCapability & { request?(): Promise<void> } =
    options.restart ?? {
      available: false,
      reason: "Restart is unavailable for this Couchview process.",
    };

  const registerRepository = async (
    root: string,
  ): Promise<RegisterRepositoryResponse> => {
    if (typeof root !== "string" || !root.trim() || root.length > 32_768) {
      throw new HttpError(400, "invalid_repository", "Repository path is invalid");
    }
    const registered = await repositories.register(root);
    if (registered.added) emitCatalog();
    return { repository: registered.repository, added: registered.added };
  };

  const handleApi = async (request: Request, url: URL): Promise<Response> => {
    const controlRegistration =
      url.pathname === API_ROUTES.controlRepositories && request.method === "POST";
    const controlRestart =
      url.pathname === API_ROUTES.controlRestart && request.method === "POST";
    if (controlRegistration || controlRestart) {
      if (!tokenMatches(bearerToken(request), controlToken)) {
        throw new HttpError(403, "control_token_failed", "CLI control request is not authorized");
      }
    } else if (isMutation(request.method)) {
      if (!request.headers.get("origin")) {
        throw new HttpError(403, "origin_required", "A same-origin browser request is required");
      }
      if (!tokenMatches(request.headers.get(CSRF_HEADER), csrfToken)) {
        throw new HttpError(403, "csrf_failed", "The local session token is missing or invalid");
      }
    }

    if (url.pathname === API_ROUTES.accessRefresh && request.method === "GET") {
      // Keeping this entry point under /api makes every shipped service worker
      // send the navigation to the network, where Access can show its login UI.
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
      // Cloudflare handles this reserved path at the edge. The /api entry point
      // prevents an installed service worker from serving the app shell first.
      return new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "no-store",
          Location: "/cdn-cgi/access/logout",
        },
      });
    }
    if (url.pathname === API_ROUTES.instance && request.method === "GET") {
      const response: InstanceResponse = {
        service: "couchview",
        protocolVersion: INSTANCE_PROTOCOL_VERSION,
        version,
        instanceId,
        bindHost: host,
        port,
        accessOrigins: [...accessOrigins],
        terminalEnabled: terminalSessions.enabled,
        terminalP2pEnabled: terminalSessions.p2pEnabled,
        terminalStunUrls: [...terminalSessions.stunUrls],
      };
      return json(response);
    }
    if (url.pathname === API_ROUTES.bootstrap && request.method === "GET") {
      const response: BootstrapResponse = {
        csrfToken,
        repositories: await repositories.list(),
        defaultRepositoryId,
        catalogRevision: database.catalogRevision(),
        restart: {
          available: restart.available,
          reason: restart.reason,
        },
        commitMessage: commitMessages.capability,
        codex: codex.capabilityFor(),
        terminal: terminalSessions.capability,
      };
      return json(response);
    }
    if (
      (url.pathname === API_ROUTES.restart || controlRestart) &&
      request.method === "POST"
    ) {
      if (!restart.available || !restart.request) {
        throw new HttpError(
          409,
          "restart_unavailable",
          restart.reason ?? "Restart is unavailable for this Couchview process.",
        );
      }
      await restart.request();
      const response: RestartResponse = {
        status: "restarting",
        previousInstanceId: instanceId,
      };
      return json(response, { status: 202 });
    }
    if (url.pathname === API_ROUTES.repositories && request.method === "GET") {
      return json({
        repositories: await repositories.list(),
        catalogRevision: database.catalogRevision(),
      });
    }
    if (controlRegistration) {
      const input = await readJsonObject<RegisterRepositoryRequest>(request);
      const result = await registerRepository(input.root);
      return json(result, { status: result.added ? 201 : 200 });
    }

    const repositoryRoute = /^\/api\/repositories\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!repositoryRoute) {
      throw new HttpError(404, "route_not_found", "API route not found");
    }
    const repositoryId = decodeSegment(repositoryRoute[1] ?? "");
    const nestedPath = repositoryRoute[2] ?? "";

    if (!nestedPath && request.method === "DELETE") {
      const terminalStatus = await terminalSessions.status(repositoryId);
      if (terminalStatus.running) await terminalSessions.end(repositoryId);
      packageCommands.stopRepository(repositoryId);
      repositories.forget(repositoryId);
      if (defaultRepositoryId === repositoryId) {
        defaultRepositoryId = (await repositories.list()).find((item) => item.available)?.id ?? null;
      }
      emitCatalog();
      const response: ForgetRepositoryResponse = { deletedId: repositoryId };
      return json(response);
    }

    const repository = await repositories.get(repositoryId);
    const fileRoute = /^files\/([^/]+)\/(diff|stage|review|comments)$/.exec(nestedPath);
    const commentRoute = /^comments\/([^/]+)$/.exec(nestedPath);
    const codexThreadRoute = /^codex\/threads\/([^/]+)(?:\/(turns|events|approvals)(?:\/([^/]+))?(?:\/(interrupt))?)?$/.exec(
      nestedPath,
    );
    const packageRunRoute = /^package-runs\/([^/]+)(?:\/(stop|events))?$/.exec(
      nestedPath,
    );

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
        await terminalSessions.issueAttachment(
          repositoryId,
          repository.root,
          input,
          {
            host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
            origin: normalizeOrigin(origin),
          },
        ),
        { status: 201 },
      );
    }
    if (nestedPath === "terminal/lease" && request.method === "POST") {
      const input = await readJsonObject<TerminalLeaseRequest>(request);
      const origin = request.headers.get("origin");
      if (!origin) {
        throw new HttpError(403, "origin_required", "A same-origin browser request is required");
      }
      return json(await terminalSessions.renewLease(repositoryId, input, {
        host: normalizeRequestHost(request.headers.get("host") ?? new URL(request.url).host),
        origin: normalizeOrigin(origin),
      }));
    }
    if (nestedPath === "terminal/end" && request.method === "POST") {
      return json(await terminalSessions.end(repositoryId));
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
      await emitRepository(repositoryId, "changes", result.operationRevision);
      return json(result);
    }
    if (nestedPath === "files/stage" && request.method === "POST") {
      const input = await readJsonObject<StageFilesRequest>(request);
      const result = await repository.stageFiles(input);
      await emitRepository(repositoryId, "changes", result.operationRevision);
      return json(result);
    }
    if (nestedPath === "commit" && request.method === "POST") {
      const input = await readJsonObject<CommitRequest>(request);
      const result = await repository.commit(input);
      await emitRepository(repositoryId, "changes", result.operationRevision);
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
      const response: PackageScriptsResponse = await packageCommands.discover(
        repository.root,
      );
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
      const runId = decodeSegment(packageRunRoute[1] ?? "");
      let cleanup: () => void = () => undefined;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: PackageRunEvent): void => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(event)}\n\n`,
                ),
              );
            } catch {
              closed = true;
              cleanup();
              if (keepAlive) clearInterval(keepAlive);
            }
          };
          const subscription = packageCommands.subscribe(
            repositoryId,
            runId,
            send,
          );
          cleanup = subscription.unsubscribe;
          send({ type: "snapshot", snapshot: subscription.snapshot });
          keepAlive = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            } catch {
              closed = true;
              cleanup();
              if (keepAlive) clearInterval(keepAlive);
            }
          }, 5_000);
        },
        cancel() {
          closed = true;
          cleanup();
          if (keepAlive) clearInterval(keepAlive);
        },
      });
      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          cleanup();
          if (keepAlive) clearInterval(keepAlive);
        },
        { once: true },
      );
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (nestedPath === "comments" && request.method === "GET") {
      return json(await repository.reviewState());
    }

    if (nestedPath === "codex/threads" && request.method === "GET") {
      const limitValue = Number(url.searchParams.get("limit") ?? 40);
      const limit = Number.isSafeInteger(limitValue) && limitValue > 0
        ? Math.min(limitValue, 100)
        : 40;
      const result = await codex.listThreads(
        repository.root,
        url.searchParams.get("cursor"),
        limit,
      );
      const response: CodexThreadsResponse = {
        threads: result.threads.map(({ cwd: _cwd, ...thread }) => thread),
        nextCursor: result.nextCursor,
      };
      return json(response);
    }
    if (nestedPath === "codex/threads" && request.method === "POST") {
      const thread = await codex.startThread(repository.root);
      const { cwd: _cwd, ...summary } = thread;
      const response: CodexThreadResponse = { thread: summary };
      return json(response, { status: 201 });
    }
    if (codexThreadRoute) {
      const threadId = decodeSegment(codexThreadRoute[1] ?? "");
      const resource = codexThreadRoute[2] ?? "";
      const resourceId = codexThreadRoute[3]
        ? decodeSegment(codexThreadRoute[3])
        : null;
      const action = codexThreadRoute[4] ?? "";
      if (!resource && request.method === "GET") {
        const thread = await codex.readThread(threadId);
        if (thread.cwd !== repository.root) {
          throw new HttpError(404, "codex_thread_not_found", "Codex thread is not part of this repository");
        }
        const { cwd: _cwd, ...summary } = thread;
        return json({ thread: summary } satisfies CodexThreadResponse);
      }
      if (resource === "turns" && action === "interrupt" && request.method === "POST") {
        if (!resourceId) throw new HttpError(400, "codex_turn_required", "Codex turn ID is required");
        const thread = await codex.readThread(threadId);
        if (thread.cwd !== repository.root) {
          throw new HttpError(404, "codex_thread_not_found", "Codex thread is not part of this repository");
        }
        await codex.interruptTurn(threadId, resourceId);
        return json({ status: "interrupting" });
      }
      if (resource === "turns" && !resourceId && request.method === "POST") {
        const thread = await codex.readThread(threadId);
        if (thread.cwd !== repository.root) {
          throw new HttpError(404, "codex_thread_not_found", "Codex thread is not part of this repository");
        }
        if (thread.status === "active") {
          throw new HttpError(409, "codex_thread_in_use", "This Codex thread is currently active in another client");
        }
        const reviewState = await repository.reviewState();
        const currentComments = reviewState.comments.filter((comment) => !comment.stale);
        if (currentComments.length === 0) {
          throw new HttpError(409, "codex_no_comments", "There are no current review comments to send");
        }
        if (thread.status === "notLoaded") await codex.resumeThread(threadId);
        const response: CodexTurnResponse = await codex.startTurn(
          threadId,
          codexPrompt(currentComments),
        );
        return json(response, { status: 202 });
      }
      if (resource === "events" && request.method === "GET") {
        const thread = await codex.readThread(threadId);
        if (thread.cwd !== repository.root) {
          throw new HttpError(404, "codex_thread_not_found", "Codex thread is not part of this repository");
        }
        const turnId = resourceId ?? url.searchParams.get("turnId");
        if (!turnId) throw new HttpError(400, "codex_turn_required", "Codex turn ID is required");
        const afterValue = Number(url.searchParams.get("after") ?? 0);
        const after = Number.isSafeInteger(afterValue) && afterValue >= 0 ? afterValue : 0;
        const available = codex.events(threadId, turnId, after);
        if (!available.found) {
          throw new HttpError(404, "codex_turn_not_found", "Codex turn is not available");
        }
        let closed = false;
        let cleanup: () => void = () => undefined;
        let keepAlive: ReturnType<typeof setInterval> | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: CodexEvent): void => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              } catch {
                closed = true;
                cleanup();
                if (keepAlive) clearInterval(keepAlive);
              }
            };
            const subscription = codex.events(threadId, turnId, after, send);
            cleanup = subscription.unsubscribe;
            for (const event of subscription.events) send(event);
            keepAlive = setInterval(() => {
              if (!closed) {
                try {
                  controller.enqueue(encoder.encode(": keep-alive\n\n"));
                } catch {
                  closed = true;
                  cleanup();
                  if (keepAlive) clearInterval(keepAlive);
                }
              }
            }, 5_000);
          },
          cancel() {
            closed = true;
            cleanup();
            if (keepAlive) clearInterval(keepAlive);
          },
        });
        request.signal.addEventListener("abort", () => {
          closed = true;
          cleanup();
          if (keepAlive) clearInterval(keepAlive);
        }, { once: true });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      }
      if (resource === "approvals" && request.method === "POST") {
        if (!resourceId) throw new HttpError(400, "codex_approval_required", "Codex approval ID is required");
        const thread = await codex.readThread(threadId);
        if (thread.cwd !== repository.root) {
          throw new HttpError(404, "codex_thread_not_found", "Codex thread is not part of this repository");
        }
        const input = await readJsonObject<CodexApprovalRequest>(request);
        await codex.respondApproval(threadId, resourceId, input.decision);
        return json({ status: "submitted" });
      }
    }
    if (fileRoute?.[2] === "review" && request.method === "PUT") {
      const fileId = decodeSegment(fileRoute[1] ?? "");
      const input = await readJsonObject<SetReviewRequest>(request);
      if (input.fileId !== fileId) {
        throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
      }
      const result = await repository.setReview(input);
      await emitRepository(repositoryId, "state");
      return json(result);
    }
    if (fileRoute?.[2] === "comments" && request.method === "POST") {
      const fileId = decodeSegment(fileRoute[1] ?? "");
      const input = await readJsonObject<CreateCommentRequest>(request);
      if (input.fileId !== fileId) {
        throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
      }
      const result = await repository.createComment(input);
      await emitRepository(repositoryId, "state");
      return json(result, { status: 201 });
    }
    if (commentRoute && request.method === "PUT") {
      const commentId = decodeSegment(commentRoute[1] ?? "");
      const input = await readJsonObject<UpdateCommentRequest>(request);
      if (input.id !== commentId) {
        throw new HttpError(400, "comment_mismatch", "Request comment does not match the API path");
      }
      const result = await repository.updateComment(input.id, input.body);
      await emitRepository(repositoryId, "state");
      return json(result);
    }
    if (commentRoute && request.method === "DELETE") {
      const commentId = decodeSegment(commentRoute[1] ?? "");
      const input = await readJsonObject<DeleteCommentRequest>(request);
      if (input.id !== commentId) {
        throw new HttpError(400, "comment_mismatch", "Request comment does not match the API path");
      }
      const result = await repository.deleteComment(input.id);
      await emitRepository(repositoryId, "state");
      return json(result);
    }
    if (nestedPath === "events" && request.method === "GET") {
      let streamState: StreamState | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamState = {
            controller,
            repositoryId,
            operationRevision: "",
            stateRevision: database.stateRevision(repositoryId) ?? 0,
            catalogRevision: database.catalogRevision(),
            ready: false,
          };
          streams.add(streamState);
          ensureSubscription(repositoryId);
          void repository
            .changes()
            .then((state) => {
              if (!streamState || !streams.has(streamState)) return;
              streamState.ready = true;
              sendEvent(streamState, "ready", {
                operationRevision: state.operationRevision,
                stateRevision: database.stateRevision(repositoryId) ?? 0,
                catalogRevision: database.catalogRevision(),
              });
            })
            .catch((error) => {
              if (!streamState) return;
              removeStream(streamState);
              try {
                controller.error(error);
              } catch {
                // The request may already have been cancelled.
              }
            });
        },
        cancel() {
          if (streamState) removeStream(streamState);
        },
      });
      request.signal.addEventListener(
        "abort",
        () => {
          if (!streamState) return;
          removeStream(streamState);
          try {
            streamState.controller.close();
          } catch {
            // The stream may already have been cancelled.
          }
        },
        { once: true },
      );
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    throw new HttpError(404, "route_not_found", "API route not found");
  };

  const serveStatic = async (url: URL): Promise<Response> => {
    if (!options.staticDirectory) {
      throw new HttpError(404, "not_found", "Frontend build not found");
    }
    const staticRoot = path.resolve(options.staticDirectory);
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
        throw new HttpError(403, "asset_outside_root", "Asset resolves outside the static directory");
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
    server?: Bun.Server<TerminalSocketData>,
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
          throw new HttpError(426, "websocket_required", "This terminal route requires a WebSocket upgrade");
        }
        if (!server) {
          throw new HttpError(426, "websocket_required", "The current server cannot upgrade this request");
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
          throw new HttpError(400, "websocket_upgrade_failed", "The terminal WebSocket upgrade failed");
        }
        return undefined;
      }

      response = url.pathname === "/api" || url.pathname.startsWith("/api/")
        ? await handleApi(request, url)
        : await serveStatic(url);
    } catch (error) {
      response = errorResponse(error);
    }
    return addSecurityHeaders(response);
  };

  const app: CouchviewApp = {
    repository: initialBackend,
    repositories,
    packageCommands,
    commitMessages,
    codex,
    terminalSessions,
    websocket: terminalSessions.websocket,
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
      return response ?? addSecurityHeaders(errorResponse(
        new HttpError(426, "websocket_required", "The current server cannot upgrade this request"),
      ));
    },
    fetchWithServer(
      request: Request,
      server: Bun.Server<TerminalSocketData>,
    ): Promise<Response | undefined> {
      return handleRequest(request, server);
    },
    close(): void {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      clearInterval(poller);
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
      for (const stream of streams) {
        try {
          stream.controller.close();
        } catch {
          // Ignore already-closed streams during shutdown.
        }
      }
      streams.clear();
      database.removeServerInstance(instanceId);
      terminalSessions.close();
      commitMessages.close();
      codex.close();
      packageCommands.close();
      repositories.close();
      database.close();
    },
  };
  return app;
}
