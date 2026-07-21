import { randomBytes, timingSafeEqual } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";

import {
  API_ROUTES,
  CSRF_HEADER,
  type ApiErrorBody,
  type CreateCommentRequest,
  type DeleteCommentRequest,
  type ServerEvent,
  type SetReviewRequest,
  type StageFileRequest,
  type UpdateCommentRequest,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { GitCommandError } from "./git.ts";
import { GitRepository } from "./repository.ts";

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 64 * 1024;

export interface CouchReviewAppOptions {
  root: string;
  host?: string;
  port?: number;
  staticDirectory?: string;
  allowedOrigins?: string[];
}

export interface CouchReviewApp {
  repository: GitRepository;
  csrfToken: string;
  accessOrigins: readonly string[];
  fetch(request: Request): Promise<Response>;
  close(): void;
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

async function readJsonObject<T extends object>(request: Request): Promise<T> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (type.split(";", 1)[0]?.trim() !== "application/json") {
    throw new HttpError(415, "json_required", "Request body must be JSON");
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "Request body is too large");
  if (!request.body) throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
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
    const locked = /index\.lock|another git process/i.test(error.stderr);
    const body: ApiErrorBody = {
      error: {
        code: locked ? "git_index_locked" : "git_failed",
        message: locked ? "The Git index is busy; try again shortly" : "Git could not complete the operation",
      },
    };
    return json(body, { status: locked ? 423 : 500 });
  }
  console.error(error);
  const body: ApiErrorBody = {
    error: { code: "internal_error", message: "The local review server encountered an error" },
  };
  return json(body, { status: 500 });
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
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'none'",
  );
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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

function hostForUrl(host: string): string {
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

export async function createCouchReviewApp(options: CouchReviewAppOptions): Promise<CouchReviewApp> {
  const host = normalizeBindHost(options.host ?? "127.0.0.1");
  const port = options.port ?? 4173;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }
  const repository = await GitRepository.open(options.root);
  const csrfToken = randomBytes(32).toString("base64url");
  const accessOrigins = accessOriginsForHost(host, port);
  const allowedOrigins = new Set(
    [...accessOrigins, ...(options.allowedOrigins ?? [])].map(normalizeOrigin),
  );
  const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host));
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let lastChangeRevision = "";
  let pollInFlight = false;

  const emit = (event: ServerEvent): void => {
    if (event.type === "changes" || event.type === "ready") {
      lastChangeRevision = event.operationRevision;
    }
    const data = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const stream of streams) {
      try {
        stream.enqueue(data);
      } catch {
        streams.delete(stream);
      }
    }
  };

  const emitCurrent = async (type: ServerEvent["type"]): Promise<void> => {
    const state = await repository.changes();
    emit({ type, operationRevision: state.operationRevision, at: new Date().toISOString() });
  };

  repository.startWatching((operationRevision) => {
    if (operationRevision !== lastChangeRevision) {
      emit({ type: "changes", operationRevision, at: new Date().toISOString() });
    }
  });

  const poller = setInterval(() => {
    if (streams.size === 0 || pollInFlight) return;
    pollInFlight = true;
    void repository
      .changes()
      .then((state) => {
        if (state.operationRevision !== lastChangeRevision) {
          emit({
            type: "changes",
            operationRevision: state.operationRevision,
            at: new Date().toISOString(),
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        pollInFlight = false;
      });
  }, 1_500);

  const keepAlive = setInterval(() => {
    const bytes = encoder.encode(": keep-alive\n\n");
    for (const stream of streams) {
      try {
        stream.enqueue(bytes);
      } catch {
        streams.delete(stream);
      }
    }
  }, 5_000);

  const handleApi = async (request: Request, url: URL): Promise<Response> => {
    if (isMutation(request.method)) {
      if (!request.headers.get("origin")) {
        throw new HttpError(403, "origin_required", "A same-origin browser request is required");
      }
      if (!tokenMatches(request.headers.get(CSRF_HEADER), csrfToken)) {
        throw new HttpError(403, "csrf_failed", "The local session token is missing or invalid");
      }
    }

    const fileRoute = /^\/api\/files\/([^/]+)\/(diff|stage|review|comments)$/.exec(
      url.pathname,
    );
    const commentRoute = /^\/api\/comments\/([^/]+)$/.exec(url.pathname);
    const decodeSegment = (value: string): string => {
      try {
        return decodeURIComponent(value);
      } catch {
        throw new HttpError(400, "invalid_path", "API path is invalid");
      }
    };

    if (url.pathname === API_ROUTES.bootstrap && request.method === "GET") {
      return json(await repository.bootstrap(csrfToken));
    }
    if (url.pathname === API_ROUTES.files && request.method === "GET") {
      return json(await repository.changes());
    }
    if (fileRoute?.[2] === "diff" && request.method === "GET") {
      return json(await repository.diff(decodeSegment(fileRoute[1] ?? "")));
    }
    if (url.pathname === API_ROUTES.search && request.method === "GET") {
      return json(
        await repository.search(
          url.searchParams.get("q") ?? "",
          url.searchParams.get("currentPath") ?? "",
        ),
      );
    }
    if (url.pathname === API_ROUTES.source && request.method === "GET") {
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
      emit({ type: "changes", operationRevision: result.operationRevision, at: new Date().toISOString() });
      return json(result);
    }
    if (url.pathname === API_ROUTES.comments && request.method === "GET") {
      return json(await repository.reviewState());
    }
    if (fileRoute?.[2] === "review" && request.method === "PUT") {
      const fileId = decodeSegment(fileRoute[1] ?? "");
      const input = await readJsonObject<SetReviewRequest>(request);
      if (input.fileId !== fileId) {
        throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
      }
      const result = await repository.setReview(input);
      await emitCurrent("reviews");
      return json(result);
    }
    if (fileRoute?.[2] === "comments" && request.method === "POST") {
      const fileId = decodeSegment(fileRoute[1] ?? "");
      const input = await readJsonObject<CreateCommentRequest>(request);
      if (input.fileId !== fileId) {
        throw new HttpError(400, "file_mismatch", "Request file does not match the API path");
      }
      const result = await repository.createComment(input);
      await emitCurrent("comments");
      return json(result, { status: 201 });
    }
    if (commentRoute && request.method === "PUT") {
      const commentId = decodeSegment(commentRoute[1] ?? "");
      const input = await readJsonObject<UpdateCommentRequest>(request);
      if (input.id !== commentId) {
        throw new HttpError(400, "comment_mismatch", "Request comment does not match the API path");
      }
      const result = await repository.updateComment(input.id, input.body);
      await emitCurrent("comments");
      return json(result);
    }
    if (commentRoute && request.method === "DELETE") {
      const commentId = decodeSegment(commentRoute[1] ?? "");
      const input = await readJsonObject<DeleteCommentRequest>(request);
      if (input.id !== commentId) {
        throw new HttpError(400, "comment_mismatch", "Request comment does not match the API path");
      }
      const result = await repository.deleteComment(input.id);
      await emitCurrent("comments");
      return json(result);
    }
    if (url.pathname === API_ROUTES.events && request.method === "GET") {
      let ownController: ReadableStreamDefaultController<Uint8Array> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const initializesRevision = streams.size === 0;
          ownController = controller;
          streams.add(controller);
          void repository
            .changes()
            .then((state) => {
              if (!streams.has(controller)) return;
              // Only the first connected client can initialize the shared
              // poll baseline. A later client's ready snapshot must not hide
              // a repository change from clients that were already present.
              if (initializesRevision) lastChangeRevision = state.operationRevision;
              const event: ServerEvent = {
                type: "ready",
                operationRevision: state.operationRevision,
                at: new Date().toISOString(),
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            })
            .catch((error) => {
              streams.delete(controller);
              try {
                controller.error(error);
              } catch {
                // The request may already have been cancelled.
              }
            });
        },
        cancel() {
          if (ownController) streams.delete(ownController);
        },
      });
      request.signal.addEventListener(
        "abort",
        () => {
          if (!ownController) return;
          streams.delete(ownController);
          try {
            ownController.close();
          } catch {
            // The stream may already have been cancelled by the browser.
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
    if (!options.staticDirectory) throw new HttpError(404, "not_found", "Frontend build not found");
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
    if (!target && !path.extname(relative)) {
      target = await resolveStaticFile("index.html");
    }
    if (!target) throw new HttpError(404, "not_found", "Asset not found");
    const file = Bun.file(target);
    const immutable = relative.startsWith("assets/") && /-[A-Za-z0-9_-]{8,}\./.test(relative);
    return new Response(file, {
      headers: {
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  };

  return {
    repository,
    csrfToken,
    accessOrigins,
    async fetch(request: Request): Promise<Response> {
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
        if (origin) {
          let normalizedOrigin: string;
          try {
            normalizedOrigin = normalizeOrigin(origin);
          } catch {
            throw new HttpError(403, "origin_rejected", "Origin is not allowed by the local server");
          }
          if (!allowedOrigins.has(normalizedOrigin)) {
            throw new HttpError(403, "origin_rejected", "Origin is not allowed by the local server");
          }
        }
        response = url.pathname === "/api" || url.pathname.startsWith("/api/")
          ? await handleApi(request, url)
          : await serveStatic(url);
      } catch (error) {
        response = errorResponse(error);
      }
      return addSecurityHeaders(response);
    },
    close(): void {
      clearInterval(keepAlive);
      clearInterval(poller);
      for (const stream of streams) {
        try {
          stream.close();
        } catch {
          // Ignore already-closed streams during shutdown.
        }
      }
      streams.clear();
      repository.close();
    },
  };
}
