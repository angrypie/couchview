#!/usr/bin/env bun

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_ROUTES,
  type ApiErrorBody,
  type InstanceResponse,
  type RegisterRepositoryResponse,
} from "../shared/contracts.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";
import {
  createCouchviewApp,
  hostForUrl,
  INSTANCE_PROTOCOL_VERSION,
  normalizeBindHost,
} from "./server.ts";

interface CliOptions {
  root: string;
  host: string;
  port: number;
}

interface RunningRegistration {
  instance: InstanceResponse;
  registration: RegisterRepositoryResponse;
}

interface StartServerRuntime {
  fetch: typeof globalThis.fetch;
  serve: typeof Bun.serve;
}

export function parseCli(argv: string[]): CliOptions {
  let root = Bun.env.COUCHVIEW_ROOT ?? Bun.env.COUCH_REVIEW_ROOT ?? process.cwd();
  let host = Bun.env.COUCHVIEW_HOST ?? Bun.env.COUCH_REVIEW_HOST ?? "0.0.0.0";
  let port = Number(Bun.env.PORT ?? 4173);
  let explicitRoot = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Repository path is required");
      if (explicitRoot) throw new Error("Repository path may only be provided once");
      root = value;
      explicitRoot = true;
      index += 1;
    } else if (argument === "--port") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Port must be between 1 and 65535");
      port = Number(value);
      index += 1;
    } else if (argument === "--host") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Host is required");
      host = value;
      index += 1;
    } else if (argument && !argument.startsWith("-")) {
      if (explicitRoot) throw new Error("Repository path may only be provided once");
      root = argument;
      explicitRoot = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!root) throw new Error("Repository path is required");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }
  return { root: path.resolve(root), host: normalizeBindHost(host), port };
}

function probeHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "::1";
  return host;
}

function probeOrigin(options: CliOptions): string {
  return `http://${hostForUrl(probeHost(options.host))}:${options.port}`;
}

function requestedHostIsCompatible(requested: string, existing: string): boolean {
  if (requested === existing) return true;
  if (existing === "0.0.0.0") {
    return requested === "localhost" || requested === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(requested);
  }
  if (existing === "::") return true;
  return false;
}

async function fetchWithTimeout(
  url: string,
  fetchImplementation: typeof globalThis.fetch,
  init?: RequestInit,
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isInstanceResponse(value: unknown): value is InstanceResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InstanceResponse>;
  return candidate.service === "couchview" &&
    typeof candidate.protocolVersion === "number" &&
    typeof candidate.version === "string" &&
    typeof candidate.instanceId === "string" &&
    typeof candidate.bindHost === "string" &&
    typeof candidate.port === "number" &&
    Array.isArray(candidate.accessOrigins) &&
    candidate.accessOrigins.every((origin) => typeof origin === "string");
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error.message;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function registerWithRunningServer(
  options: CliOptions,
  explicitHost: boolean,
  fetchImplementation: typeof globalThis.fetch,
): Promise<RunningRegistration | null> {
  const origin = probeOrigin(options);
  const instanceResponse = await fetchWithTimeout(
    `${origin}${API_ROUTES.instance}`,
    fetchImplementation,
  );
  if (!instanceResponse) return null;
  if (!instanceResponse.ok) {
    throw new Error(
      `Port ${options.port} is occupied by a service that is not a compatible Couchview server`,
    );
  }
  const rawInstance: unknown = await instanceResponse.json().catch(() => null);
  if (!isInstanceResponse(rawInstance)) {
    throw new Error(
      `Port ${options.port} is occupied by a service that is not a compatible Couchview server`,
    );
  }
  if (rawInstance.protocolVersion !== INSTANCE_PROTOCOL_VERSION) {
    throw new Error(
      `Couchview ${rawInstance.version} uses control protocol ${rawInstance.protocolVersion}; use another port or stop it first`,
    );
  }
  if (explicitHost && !requestedHostIsCompatible(options.host, rawInstance.bindHost)) {
    throw new Error(
      `Couchview is already using port ${options.port} on ${rawInstance.bindHost}, which does not satisfy --host ${options.host}`,
    );
  }

  const database = await StateDatabase.open(resolveStateDatabasePath());
  try {
    const stored = database.serverInstance(rawInstance.instanceId);
    if (!stored) {
      throw new Error(
        "The running Couchview server uses a different XDG data directory; use the matching XDG_DATA_HOME or another port",
      );
    }
    const response = await fetchWithTimeout(
      `${origin}${API_ROUTES.controlRepositories}`,
      fetchImplementation,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${stored.controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ root: options.root }),
      },
    );
    if (!response) throw new Error("The running Couchview server stopped responding");
    if (!response.ok) throw new Error(await responseError(response));
    return {
      instance: rawInstance,
      registration: (await response.json()) as RegisterRepositoryResponse,
    };
  } finally {
    database.close();
  }
}

function projectOrigins(origins: readonly string[], repositoryId: string): string[] {
  return origins
    .filter((origin) => !origin.includes("//0.0.0.0:") && !origin.includes("//[::]:"))
    .sort((left, right) => {
      const leftLoopback = /\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(left);
      const rightLoopback = /\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(right);
      return Number(leftLoopback) - Number(rightLoopback) || left.localeCompare(right);
    })
    .map((origin) => {
      const url = new URL(origin);
      url.searchParams.set("repo", repositoryId);
      return url.toString();
    });
}

export function printServerAccess(
  origins: readonly string[],
  repositoryId: string,
  repositoryRoot: string,
  bindHost: string,
): void {
  const copyableOrigins = projectOrigins(origins, repositoryId);
  console.log(copyableOrigins.length === 1 ? "Couchview URL:" : "Couchview URLs:");
  for (const origin of copyableOrigins) console.log(`  ${origin}`);
  console.log(`Repository: ${repositoryRoot}`);
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    console.warn("LAN access is enabled. Use a non-loopback URL above on your phone.");
  }
}

function addressInUse(error: unknown): boolean {
  return /EADDRINUSE|address already in use/i.test((error as Error).message);
}

async function retryRunningRegistration(
  options: CliOptions,
  explicitHost: boolean,
  fetchImplementation: typeof globalThis.fetch,
): Promise<RunningRegistration | null> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await registerWithRunningServer(
      options,
      explicitHost,
      fetchImplementation,
    );
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function startServer(
  argv = process.argv.slice(2),
  runtimeOverrides: Partial<StartServerRuntime> = {},
) {
  const runtime: StartServerRuntime = {
    fetch: runtimeOverrides.fetch ?? globalThis.fetch,
    serve: runtimeOverrides.serve ?? Bun.serve,
  };
  const options = parseCli(argv);
  const explicitHost =
    argv.includes("--host") ||
    Bun.env.COUCHVIEW_HOST !== undefined ||
    Bun.env.COUCH_REVIEW_HOST !== undefined;
  const reuseEnabled =
    (Bun.env.COUCHVIEW_DISABLE_REUSE ?? Bun.env.COUCH_REVIEW_DISABLE_REUSE) !== "1";
  if (reuseEnabled) {
    const running = await registerWithRunningServer(options, explicitHost, runtime.fetch);
    if (running) {
      console.log(
        running.registration.added
          ? "Repository added to the running Couchview server."
          : "Repository is already available in the running Couchview server.",
      );
      printServerAccess(
        running.instance.accessOrigins,
        running.registration.repository.id,
        running.registration.repository.root,
        running.instance.bindHost,
      );
      return { registered: running } as const;
    }
  }

  const defaultStaticDirectory = fileURLToPath(new URL("../../dist/", import.meta.url));
  const allowedOrigins = (Bun.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (Bun.env.NODE_ENV === "development") {
    allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
  }
  const app = await createCouchviewApp({
    root: options.root,
    host: options.host,
    port: options.port,
    staticDirectory: path.resolve(Bun.env.STATIC_DIR ?? defaultStaticDirectory),
    allowedOrigins,
  });

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = runtime.serve({
      hostname: options.host,
      port: options.port,
      // EventSource connections stay open for the review session. The app
      // emits SSE heartbeats, while this avoids Bun's 10-second default.
      idleTimeout: 255,
      fetch: app.fetch,
    });
  } catch (error) {
    app.close();
    if (reuseEnabled && addressInUse(error)) {
      const running = await retryRunningRegistration(options, explicitHost, runtime.fetch);
      if (running) {
        console.log(
          running.registration.added
            ? "Repository added to the running Couchview server."
            : "Repository is already available in the running Couchview server.",
        );
        printServerAccess(
          running.instance.accessOrigins,
          running.registration.repository.id,
          running.registration.repository.root,
          running.instance.bindHost,
        );
        return { registered: running } as const;
      }
    }
    throw error;
  }

  try {
    app.registerServerInstance();
  } catch (error) {
    void server.stop();
    app.close();
    throw error;
  }
  printServerAccess(
    app.accessOrigins,
    app.repository.id,
    app.repository.root,
    options.host,
  );

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    app.close();
    void server.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { app, server, stop } as const;
}

if (import.meta.main) {
  startServer().catch((error) => {
    console.error(`Couchview could not start: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
