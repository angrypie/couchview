#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_ROUTES,
  CSRF_HEADER,
  type ApiErrorBody,
  type BootstrapResponse,
  type InstanceResponse,
  type RegisterRepositoryResponse,
  type RestartCapability,
  type RestartResponse,
} from "../shared/contracts.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import {
  createCouchviewApp,
  hostForUrl,
  INSTANCE_PROTOCOL_VERSION,
  normalizeBindHost,
} from "./server.ts";
import { terminalAccessIsLoopback } from "./terminalSessions.ts";

export type TerminalMode = "auto" | "enabled" | "disabled";

interface CliOptions {
  root: string;
  host: string;
  port: number;
  terminalMode: TerminalMode;
}

interface RunningRegistration {
  instance: InstanceResponse;
  registration: RegisterRepositoryResponse;
}

interface StartServerRuntime {
  fetch: typeof globalThis.fetch;
  serve: typeof Bun.serve;
}

interface RestartCliOptions {
  host: string;
  port: number;
}

interface RestartCliRuntime {
  fetch: typeof globalThis.fetch;
  now(): number;
  wait(milliseconds: number): Promise<void>;
}

interface SupervisedChild {
  exited: Promise<number>;
  kill(signal: NodeJS.Signals): void;
}

interface SupervisorSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: "inherit";
  stdout: "inherit";
  stderr: "inherit";
}

interface SupervisorRuntime {
  spawn(command: string[], options: SupervisorSpawnOptions): SupervisedChild;
  onSignal(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  offSignal(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
}

const restartDelayMs = 250;
const supervisedWorkerEnvironment = "COUCHVIEW_SUPERVISED_WORKER";
export const SUPERVISOR_RESTART_EXIT_CODE = 75;

export async function superviseServer(
  argv: string[] = [],
  runtimeOverrides: Partial<SupervisorRuntime> = {},
): Promise<number> {
  const runtime: SupervisorRuntime = {
    spawn: runtimeOverrides.spawn ?? ((command, options) =>
      Bun.spawn(command, options) as SupervisedChild),
    onSignal: runtimeOverrides.onSignal ?? ((signal, listener) =>
      process.on(signal, listener)),
    offSignal: runtimeOverrides.offSignal ?? ((signal, listener) =>
      process.off(signal, listener)),
  };
  const cliPath = fileURLToPath(import.meta.url);
  let child: SupervisedChild | null = null;
  let stopping = false;
  let restarting = false;
  const forward = (signal: "SIGINT" | "SIGTERM") => {
    stopping = true;
    try {
      child?.kill(signal);
    } catch {
      // The worker may already have exited after the signal reached its process group.
    }
  };
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  runtime.onSignal("SIGINT", interrupt);
  runtime.onSignal("SIGTERM", terminate);
  try {
    while (!stopping) {
      child = runtime.spawn(
        [process.execPath, "run", cliPath, ...argv],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            [supervisedWorkerEnvironment]: "1",
            ...(restarting ? { COUCHVIEW_DISABLE_REUSE: "1" } : {}),
          },
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      const exitCode = await child.exited;
      child = null;
      if (stopping || exitCode !== SUPERVISOR_RESTART_EXIT_CODE) {
        return exitCode;
      }
      restarting = true;
      console.log("Restarting Couchview server worker...");
    }
    return 0;
  } finally {
    runtime.offSignal("SIGINT", interrupt);
    runtime.offSignal("SIGTERM", terminate);
  }
}

export function restartCapability(
  environment: NodeJS.ProcessEnv = process.env,
): RestartCapability {
  if (environment.NODE_ENV === "development") {
    return {
      available: false,
      reason: "Development mode reloads source changes automatically.",
    };
  }
  if (environment.STATIC_DIR) {
    return {
      available: false,
      reason: "Restart is unavailable when Couchview uses a custom STATIC_DIR.",
    };
  }
  return { available: true, reason: null };
}

function fileMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function replaceStaticBuild(
  candidateDirectory: string,
  staticDirectory: string,
): Promise<void> {
  const backupDirectory = `${staticDirectory}.previous-${randomUUID()}`;
  let previousBuildMoved = false;
  try {
    await rename(staticDirectory, backupDirectory);
    previousBuildMoved = true;
  } catch (error) {
    if (!fileMissing(error)) throw error;
  }
  try {
    await rename(candidateDirectory, staticDirectory);
  } catch (error) {
    if (previousBuildMoved) {
      try {
        await rename(backupDirectory, staticDirectory);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Could not install the new Couchview build or restore the previous build",
        );
      }
    }
    throw error;
  }
  if (previousBuildMoved) {
    try {
      await rm(backupDirectory, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `Couchview could not remove the previous build backup: ${(error as Error).message}`,
      );
    }
  }
}

export function parseCli(argv: string[]): CliOptions {
  let root = Bun.env.COUCHVIEW_ROOT ?? Bun.env.COUCH_REVIEW_ROOT ?? process.cwd();
  let host = Bun.env.COUCHVIEW_HOST ?? Bun.env.COUCH_REVIEW_HOST ?? "127.0.0.1";
  let port = Number(Bun.env.PORT ?? 4173);
  const terminalEnvironment = Bun.env.COUCHVIEW_TERMINAL;
  let environmentTerminalMode: TerminalMode = "auto";
  if (terminalEnvironment !== undefined) {
    if (terminalEnvironment === "1") environmentTerminalMode = "enabled";
    else if (terminalEnvironment === "0") environmentTerminalMode = "disabled";
    else throw new Error("COUCHVIEW_TERMINAL must be 1 or 0");
  }
  let terminalFlag: Exclude<TerminalMode, "auto"> | null = null;
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
    } else if (argument === "--enable-terminal" || argument === "--disable-terminal") {
      const mode = argument === "--enable-terminal" ? "enabled" : "disabled";
      if (terminalFlag && terminalFlag !== mode) {
        throw new Error("--enable-terminal and --disable-terminal cannot be used together");
      }
      terminalFlag = mode;
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
  return {
    root: path.resolve(root),
    host: normalizeBindHost(host),
    port,
    terminalMode: terminalFlag ?? environmentTerminalMode,
  };
}

function parseRestartCli(argv: string[]): RestartCliOptions {
  let host = Bun.env.COUCHVIEW_HOST ?? Bun.env.COUCH_REVIEW_HOST ?? "127.0.0.1";
  let port = Number(Bun.env.PORT ?? 4173);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--port") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Port must be between 1 and 65535");
      port = Number(value);
      index += 1;
    } else if (argument === "--host") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Host is required");
      host = value;
      index += 1;
    } else {
      throw new Error(`Unknown restart option: ${argument}`);
    }
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }
  return {
    host: normalizeBindHost(host),
    port,
  };
}

function probeHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "::1";
  return host;
}

function probeOrigin(options: Pick<CliOptions, "host" | "port">): string {
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
  timeoutMs = 500,
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    candidate.accessOrigins.every((origin) => typeof origin === "string") &&
    typeof candidate.terminalEnabled === "boolean";
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error.message;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function responseErrorDetails(
  response: Response,
): Promise<{ code: string | null; message: string }> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return {
      code: body.error.code,
      message: body.error.message,
    };
  } catch {
    return { code: null, message: `HTTP ${response.status}` };
  }
}

function isRestartResponse(value: unknown): value is RestartResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RestartResponse>;
  return candidate.status === "restarting" &&
    typeof candidate.previousInstanceId === "string";
}

async function requestRunningRestart(
  origin: string,
  controlToken: string,
  fetchImplementation: typeof globalThis.fetch,
): Promise<RestartResponse> {
  const requestTimeoutMs = 5 * 60_000 + 10_000;
  let response = await fetchWithTimeout(
    `${origin}${API_ROUTES.controlRestart}`,
    fetchImplementation,
    {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}` },
    },
    requestTimeoutMs,
  );
  if (!response) throw new Error("The running Couchview server stopped responding");

  if (!response.ok) {
    const error = await responseErrorDetails(response);
    const legacyControlRoute = response.status === 404 ||
      error.code === "route_not_found" ||
      error.code === "origin_required";
    if (!legacyControlRoute) throw new Error(error.message);

    const bootstrapResponse = await fetchWithTimeout(
      `${origin}${API_ROUTES.bootstrap}`,
      fetchImplementation,
    );
    if (!bootstrapResponse?.ok) {
      throw new Error("The running Couchview server stopped responding");
    }
    const bootstrap = (await bootstrapResponse.json().catch(() => null)) as
      | Partial<BootstrapResponse>
      | null;
    if (!bootstrap || typeof bootstrap.csrfToken !== "string") {
      throw new Error("The running Couchview server returned invalid control data");
    }
    response = await fetchWithTimeout(
      `${origin}${API_ROUTES.restart}`,
      fetchImplementation,
      {
        method: "POST",
        headers: {
          origin,
          [CSRF_HEADER]: bootstrap.csrfToken,
        },
      },
      requestTimeoutMs,
    );
    if (!response) throw new Error("The running Couchview server stopped responding");
  }

  if (!response.ok) throw new Error(await responseError(response));
  const result: unknown = await response.json().catch(() => null);
  if (!isRestartResponse(result)) {
    throw new Error("The running Couchview server returned an invalid restart response");
  }
  return result;
}

export async function restartRunningServer(
  argv: string[] = [],
  runtimeOverrides: Partial<RestartCliRuntime> = {},
): Promise<{ previous: InstanceResponse; replacement: InstanceResponse }> {
  const runtime: RestartCliRuntime = {
    fetch: runtimeOverrides.fetch ?? globalThis.fetch,
    now: runtimeOverrides.now ?? Date.now,
    wait: runtimeOverrides.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
  };
  const options = parseRestartCli(argv);
  const origin = probeOrigin(options);
  const instanceResponse = await fetchWithTimeout(
    `${origin}${API_ROUTES.instance}`,
    runtime.fetch,
  );
  if (!instanceResponse) throw new Error(`No Couchview server is running at ${origin}`);
  if (!instanceResponse.ok) {
    throw new Error(`The service at ${origin} is not a compatible Couchview server`);
  }
  const rawInstance: unknown = await instanceResponse.json().catch(() => null);
  if (!isInstanceResponse(rawInstance)) {
    throw new Error(`The service at ${origin} is not a compatible Couchview server`);
  }
  if (rawInstance.protocolVersion !== INSTANCE_PROTOCOL_VERSION) {
    throw new Error(
      `Couchview ${rawInstance.version} uses control protocol ${rawInstance.protocolVersion}; update the CLI or server before restarting`,
    );
  }

  const database = await StateDatabase.open(resolveStateDatabasePath());
  let controlToken: string;
  try {
    const stored = database.serverInstance(rawInstance.instanceId);
    if (!stored) {
      throw new Error(
        "The running Couchview server uses a different XDG data directory; use the matching XDG_DATA_HOME",
      );
    }
    controlToken = stored.controlToken;
  } finally {
    database.close();
  }

  console.log(`Requesting rebuild and restart from Couchview at ${origin}...`);
  const restart = await requestRunningRestart(origin, controlToken, runtime.fetch);
  if (restart.previousInstanceId !== rawInstance.instanceId) {
    throw new Error("The Couchview server changed before the restart request completed");
  }

  const deadline = runtime.now() + 60_000;
  while (runtime.now() < deadline) {
    await runtime.wait(250);
    const candidateResponse = await fetchWithTimeout(
      `${origin}${API_ROUTES.instance}`,
      runtime.fetch,
    );
    if (!candidateResponse?.ok) continue;
    const candidate: unknown = await candidateResponse.json().catch(() => null);
    if (
      isInstanceResponse(candidate) &&
      candidate.protocolVersion === INSTANCE_PROTOCOL_VERSION &&
      candidate.instanceId !== rawInstance.instanceId
    ) {
      console.log(`Couchview restarted successfully at ${origin}.`);
      return { previous: rawInstance, replacement: candidate };
    }
  }
  throw new Error(
    "Couchview did not come back within 60 seconds. Check the owner process logs.",
  );
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
  if (options.terminalMode === "enabled" && !rawInstance.terminalEnabled) {
    throw new Error(
      `Couchview is already using port ${options.port} with terminal access disabled; stop it or choose another port`,
    );
  }
  if (options.terminalMode === "disabled" && rawInstance.terminalEnabled) {
    throw new Error(
      `Couchview is already using port ${options.port} with terminal access enabled; stop it or choose another port`,
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
  const staticDirectory = path.resolve(Bun.env.STATIC_DIR ?? defaultStaticDirectory);
  const appRoot = fileURLToPath(new URL("../../", import.meta.url));
  const cliPath = fileURLToPath(import.meta.url);
  const allowedOrigins = [
    Bun.env.COUCHVIEW_ALLOWED_ORIGINS,
    Bun.env.ALLOWED_ORIGINS,
  ]
    .filter((value): value is string => Boolean(value))
    .join(",")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (Bun.env.NODE_ENV === "development") {
    allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
  }
  const terminalLoopbackOnly = terminalAccessIsLoopback(options.host, allowedOrigins);
  const terminalEnabled = options.terminalMode === "enabled" ||
    (options.terminalMode === "auto" && terminalLoopbackOnly);
  const terminalDisabledReason = options.terminalMode === "disabled"
    ? "Terminal access was disabled by configuration."
    : "Terminal access on non-loopback hosts requires --enable-terminal or COUCHVIEW_TERMINAL=1.";
  const capability = restartCapability();
  let restartInProgress = false;
  let relaunch: () => void = () => undefined;
  const app = await createCouchviewApp({
    root: options.root,
    host: options.host,
    port: options.port,
    staticDirectory,
    allowedOrigins,
    terminal: {
      enabled: terminalEnabled,
      disabledReason: terminalEnabled ? undefined : terminalDisabledReason,
    },
    restart: {
      ...capability,
      request: capability.available
        ? async () => {
            if (restartInProgress) {
              throw new HttpError(
                409,
                "restart_in_progress",
                "Couchview is already rebuilding.",
              );
            }
            restartInProgress = true;
            console.log("Rebuilding Couchview before restart...");
            const candidateDirectory = path.join(
              appRoot,
              `.couchview-build-${randomUUID()}`,
            );
            let exitCode: number;
            try {
              const build = Bun.spawn(
                [
                  process.execPath,
                  "run",
                  "build",
                  "--outDir",
                  candidateDirectory,
                ],
                {
                  cwd: appRoot,
                  env: process.env,
                  stdin: "ignore",
                  stdout: "inherit",
                  stderr: "inherit",
                  timeout: 5 * 60_000,
                },
              );
              exitCode = await build.exited;
            } catch (error) {
              restartInProgress = false;
              await rm(candidateDirectory, { recursive: true, force: true });
              console.error(`Couchview build could not start: ${(error as Error).message}`);
              throw new HttpError(
                500,
                "restart_build_failed",
                "The Couchview build could not start. Check the server terminal for details.",
              );
            }
            if (exitCode !== 0) {
              restartInProgress = false;
              await rm(candidateDirectory, { recursive: true, force: true });
              throw new HttpError(
                500,
                "restart_build_failed",
                "The Couchview build failed. Check the server terminal for details.",
              );
            }
            try {
              await replaceStaticBuild(candidateDirectory, staticDirectory);
            } catch (error) {
              restartInProgress = false;
              await rm(candidateDirectory, { recursive: true, force: true });
              console.error(`Couchview could not install its new build: ${(error as Error).message}`);
              throw new HttpError(
                500,
                "restart_build_install_failed",
                "The new Couchview build could not replace the current build. Check the server terminal for details.",
              );
            }
            console.log("Couchview build finished. Restarting...");
            setTimeout(relaunch, restartDelayMs);
          }
        : undefined,
    },
  });

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = runtime.serve({
      hostname: options.host,
      port: options.port,
      // EventSource connections stay open for the review session. The app
      // emits SSE heartbeats, while this avoids Bun's 10-second default.
      idleTimeout: 255,
      fetch: (request, bunServer) => app.fetchWithServer(request, bunServer),
      websocket: app.websocket,
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
  if (terminalEnabled && !terminalLoopbackOnly) {
    console.warn(
      "Browser terminal access is enabled beyond loopback. tmux and its programs run with your OS-user permissions; protect every exposed origin with trusted access control.",
    );
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    app.close();
    void server.stop();
  };
  relaunch = () => {
    if (stopped) return;
    const repositoryRoot = app.repository.root;
    stopped = true;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    app.close();
    server.stop(true);
    if (Bun.env[supervisedWorkerEnvironment] === "1") {
      process.exit(SUPERVISOR_RESTART_EXIT_CODE);
    }
    try {
      const replacement = Bun.spawn(
        [
          process.execPath,
          "run",
          cliPath,
          "--repo",
          repositoryRoot,
          "--host",
          options.host,
          "--port",
          String(options.port),
          ...(options.terminalMode === "enabled"
            ? ["--enable-terminal"]
            : options.terminalMode === "disabled"
              ? ["--disable-terminal"]
              : []),
        ],
        {
          cwd: appRoot,
          env: {
            ...process.env,
            COUCHVIEW_DISABLE_REUSE: "1",
          },
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      replacement.unref();
    } catch (error) {
      console.error(`Couchview could not relaunch: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { app, server, stop } as const;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const restarting = argv[0] === "restart";
  const command = restarting
    ? restartRunningServer(argv.slice(1))
    : Bun.env[supervisedWorkerEnvironment] === "1"
      ? startServer(argv)
      : superviseServer(argv).then((exitCode) => {
          process.exitCode = exitCode;
        });
  command.catch((error) => {
    console.error(
      `Couchview could not ${restarting ? "restart" : "start"}: ${(error as Error).message}`,
    );
    process.exitCode = 1;
  });
}
