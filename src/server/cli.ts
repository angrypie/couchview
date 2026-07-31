#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_ROUTES,
  CSRF_HEADER,
  remoteBridgeOriginAccessIdIsValid,
  type ApiErrorBody,
  type BootstrapResponse,
  type InstanceResponse,
  type RegisterRepositoryResponse,
  type RemoteBridgeProfile,
  type RestartCapability,
  type RestartResponse,
} from "../shared/contracts.ts";
import {
  CLI_VERSION,
  CliPromptInterrupted,
  CliUsageError,
  type CompletionShell,
  createInteractivePrompter,
  fishCompletionPath,
  type InteractivePrompter,
  parseCliInvocation,
  parseRestartArguments,
  parseServeArguments,
  promptForServeArguments,
  renderCliHelp,
  renderCompletion,
} from "./cliCommand.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import {
  pairRemoteBridge,
  remoteBridgeZedUrl,
  runRemoteBridgeProxy,
} from "./remoteBridgeClient.ts";
import { runRemoteCodex } from "./remoteCodexClient.ts";
import {
  createCouchviewApp,
  hostForUrl,
  INSTANCE_PROTOCOL_VERSION,
  normalizeBindHost,
} from "./server.ts";
import { terminalAccessIsLoopback } from "./terminalSessions.ts";

export type TerminalMode = "auto" | "enabled" | "disabled";
export type TerminalP2pMode = "auto" | "enabled" | "disabled";
export type RemoteBridgeMode = "auto" | "enabled" | "disabled";
export type RemoteBridgeP2pMode = "auto" | "enabled" | "disabled";

export const DEFAULT_TERMINAL_STUN_URLS = ["stun:stun.cloudflare.com:3478"] as const;
export const DEFAULT_REMOTE_BRIDGE_STUN_URLS = ["stun:stun.cloudflare.com:3478"] as const;

interface CliOptions {
  root: string;
  host: string;
  port: number;
  terminalMode: TerminalMode;
  terminalP2pMode: TerminalP2pMode;
  terminalStunUrls: string[];
  remoteBridgeMode: RemoteBridgeMode;
  remoteBridgeP2pMode: RemoteBridgeP2pMode;
  remoteBridgeStunUrls: string[];
  remoteBridgePort: number;
  remoteBridgeOriginAccess: string;
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

interface RunCliRuntime {
  supervise(argv: string[]): Promise<number>;
  start(argv: string[]): Promise<unknown>;
  restart(argv: string[]): Promise<unknown>;
  pairBridge(options: {
    origin: string;
    code: string;
    originAccess: string;
  }): Promise<RemoteBridgeProfile>;
  proxyBridge(profileId: string): Promise<number>;
  codexBridge(options: {
    profileSelector: string | null;
    codexArgs: string[];
  }): Promise<number>;
  installCompletion(shell: CompletionShell): Promise<string>;
  createPrompter(): InteractivePrompter;
  stdout(message: string): void;
  stderr(message: string): void;
  supervisedWorker: boolean;
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
  return parseCliState(argv).options;
}

function parseCliState(argv: string[]): {
  options: CliOptions;
  parsed: ReturnType<typeof parseServeArguments>;
} {
  const parsed = parseServeArguments(argv);
  const root = parsed.repo ??
    Bun.env.COUCHVIEW_ROOT ??
    Bun.env.COUCH_REVIEW_ROOT ??
    process.cwd();
  const host = parsed.host ??
    Bun.env.COUCHVIEW_HOST ??
    Bun.env.COUCH_REVIEW_HOST ??
    "127.0.0.1";
  const port = Number(parsed.port ?? Bun.env.PORT ?? 4173);
  const terminalEnvironment = Bun.env.COUCHVIEW_TERMINAL;
  let environmentTerminalMode: TerminalMode = "auto";
  if (terminalEnvironment !== undefined) {
    if (terminalEnvironment === "1") environmentTerminalMode = "enabled";
    else if (terminalEnvironment === "0") environmentTerminalMode = "disabled";
    else throw new Error("COUCHVIEW_TERMINAL must be 1 or 0");
  }
  const terminalP2pEnvironment = Bun.env.COUCHVIEW_TERMINAL_P2P;
  let environmentTerminalP2pMode: TerminalP2pMode = "auto";
  if (terminalP2pEnvironment !== undefined) {
    if (terminalP2pEnvironment === "1") environmentTerminalP2pMode = "enabled";
    else if (terminalP2pEnvironment === "0") environmentTerminalP2pMode = "disabled";
    else throw new Error("COUCHVIEW_TERMINAL_P2P must be 1 or 0");
  }
  const terminalStunUrls = parseTerminalStunUrls(Bun.env.COUCHVIEW_TERMINAL_STUN);
  const remoteBridgeEnvironment = Bun.env.COUCHVIEW_REMOTE_BRIDGE;
  let environmentRemoteBridgeMode: RemoteBridgeMode = "auto";
  if (remoteBridgeEnvironment !== undefined) {
    if (remoteBridgeEnvironment === "1") environmentRemoteBridgeMode = "enabled";
    else if (remoteBridgeEnvironment === "0") environmentRemoteBridgeMode = "disabled";
    else throw new Error("COUCHVIEW_REMOTE_BRIDGE must be 1 or 0");
  }
  const remoteBridgeP2pEnvironment = Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
  let environmentRemoteBridgeP2pMode: RemoteBridgeP2pMode = "auto";
  if (remoteBridgeP2pEnvironment !== undefined) {
    if (remoteBridgeP2pEnvironment === "1") environmentRemoteBridgeP2pMode = "enabled";
    else if (remoteBridgeP2pEnvironment === "0") environmentRemoteBridgeP2pMode = "disabled";
    else throw new Error("COUCHVIEW_REMOTE_BRIDGE_P2P must be 1 or 0");
  }
  const remoteBridgeStunUrls = parseRemoteBridgeStunUrls(
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN,
  );
  const remoteBridgePort = Number(Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT ?? 22);
  const environmentRemoteBridgeOriginAccess =
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS ?? "auto";
  if (environmentRemoteBridgeOriginAccess !== "auto" &&
    !remoteBridgeOriginAccessIdIsValid(environmentRemoteBridgeOriginAccess)) {
    throw new Error(
      "COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS must be auto or a lowercase provider ID",
    );
  }
  if (!root) throw new Error("Repository path is required");
  if (!host) throw new Error("Host is required");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }
  if (
    !Number.isSafeInteger(remoteBridgePort) ||
    remoteBridgePort < 1 ||
    remoteBridgePort > 65_535
  ) {
    throw new Error("COUCHVIEW_REMOTE_BRIDGE_PORT must be between 1 and 65535");
  }
  return {
    parsed,
    options: {
      root: path.resolve(root),
      host: normalizeBindHost(host),
      port,
      terminalMode: parsed.terminalMode ?? environmentTerminalMode,
      terminalP2pMode: parsed.terminalP2pMode ?? environmentTerminalP2pMode,
      terminalStunUrls,
      remoteBridgeMode: parsed.remoteBridgeMode ?? environmentRemoteBridgeMode,
      remoteBridgeP2pMode:
        parsed.remoteBridgeP2pMode ?? environmentRemoteBridgeP2pMode,
      remoteBridgeStunUrls,
      remoteBridgePort,
      remoteBridgeOriginAccess:
        parsed.remoteBridgeOriginAccess ?? environmentRemoteBridgeOriginAccess,
    },
  };
}

function parseStunUrls(
  value: string | undefined,
  environmentName: string,
  defaults: readonly string[],
): string[] {
  const urls = value === undefined
    ? [...defaults]
    : value.split(",").map((candidate) => candidate.trim());
  if (urls.length < 1 || urls.length > 4 || urls.some((candidate) => !candidate)) {
    throw new Error(`${environmentName} must contain between 1 and 4 STUN URLs`);
  }
  for (const candidate of urls) {
    const match = /^stun:(\[[0-9A-Fa-f:.]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(candidate);
    const rawHost = match?.[1] ?? "";
    const host = rawHost.startsWith("[") ? rawHost.slice(1, -1) : rawHost;
    const validHost = rawHost.startsWith("[")
      ? isIP(host) === 6
      : isIP(host) === 4 || (
          host.length <= 253 &&
          host.split(".").every((label) =>
            /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
          )
        );
    const explicitPort = match?.[2];
    if (
      !match ||
      !validHost ||
      (explicitPort !== undefined && (Number(explicitPort) < 1 || Number(explicitPort) > 65_535))
    ) {
      throw new Error(
        `${environmentName} entries must use stun:host or stun:host:port`,
      );
    }
  }
  return [...new Set(urls)];
}

export function parseTerminalStunUrls(value: string | undefined): string[] {
  return parseStunUrls(value, "COUCHVIEW_TERMINAL_STUN", DEFAULT_TERMINAL_STUN_URLS);
}

export function parseRemoteBridgeStunUrls(value: string | undefined): string[] {
  return parseStunUrls(
    value,
    "COUCHVIEW_REMOTE_BRIDGE_STUN",
    DEFAULT_REMOTE_BRIDGE_STUN_URLS,
  );
}

function parseRestartCli(argv: string[]): RestartCliOptions {
  const parsed = parseRestartArguments(argv);
  const host = parsed.host ??
    Bun.env.COUCHVIEW_HOST ??
    Bun.env.COUCH_REVIEW_HOST ??
    "127.0.0.1";
  const port = Number(parsed.port ?? Bun.env.PORT ?? 4173);
  if (!host) throw new Error("Host is required");
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

function parseInstanceResponse(value: unknown): InstanceResponse | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<InstanceResponse>;
  const valid = candidate.service === "couchview" &&
    typeof candidate.protocolVersion === "number" &&
    typeof candidate.version === "string" &&
    typeof candidate.instanceId === "string" &&
    typeof candidate.bindHost === "string" &&
    typeof candidate.port === "number" &&
    Array.isArray(candidate.accessOrigins) &&
    candidate.accessOrigins.every((origin) => typeof origin === "string") &&
    typeof candidate.terminalEnabled === "boolean" &&
    typeof candidate.terminalP2pEnabled === "boolean" &&
    Array.isArray(candidate.terminalStunUrls) &&
    candidate.terminalStunUrls.every((url) => typeof url === "string") &&
    typeof candidate.remoteBridgeEnabled === "boolean" &&
    typeof candidate.remoteBridgeP2pEnabled === "boolean" &&
    Array.isArray(candidate.remoteBridgeStunUrls) &&
    candidate.remoteBridgeStunUrls.every((url) => typeof url === "string") &&
    typeof candidate.remoteBridgeTargetPort === "number" &&
    (candidate.remoteBridgeOriginAccess === undefined ||
      typeof candidate.remoteBridgeOriginAccess === "string");
  if (!valid) return null;
  return {
    ...candidate,
    remoteBridgeOriginAccess: candidate.remoteBridgeOriginAccess ?? "auto",
  } as InstanceResponse;
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
  const rawInstance = parseInstanceResponse(
    await instanceResponse.json().catch(() => null),
  );
  if (!rawInstance) {
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
    const candidate = parseInstanceResponse(
      await candidateResponse.json().catch(() => null),
    );
    if (
      candidate &&
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
  const rawInstance = parseInstanceResponse(
    await instanceResponse.json().catch(() => null),
  );
  if (!rawInstance) {
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
  if (options.terminalP2pMode === "enabled" && !rawInstance.terminalP2pEnabled) {
    throw new Error(
      `Couchview is already using port ${options.port} with terminal P2P disabled; stop it or choose another port`,
    );
  }
  if (options.terminalP2pMode === "disabled" && rawInstance.terminalP2pEnabled) {
    throw new Error(
      `Couchview is already using port ${options.port} with terminal P2P enabled; stop it or choose another port`,
    );
  }
  if (
    options.terminalP2pMode === "enabled" &&
    options.terminalStunUrls.join(",") !== rawInstance.terminalStunUrls.join(",")
  ) {
    throw new Error(
      `Couchview is already using port ${options.port} with different terminal STUN servers; stop it or choose another port`,
    );
  }
  if (options.remoteBridgeMode === "enabled" && !rawInstance.remoteBridgeEnabled) {
    throw new Error(
      `Couchview is already using port ${options.port} with the native bridge disabled; stop it or choose another port`,
    );
  }
  if (options.remoteBridgeMode === "disabled" && rawInstance.remoteBridgeEnabled) {
    throw new Error(
      `Couchview is already using port ${options.port} with the native bridge enabled; stop it or choose another port`,
    );
  }
  if (
    options.remoteBridgeP2pMode === "enabled" &&
    !rawInstance.remoteBridgeP2pEnabled
  ) {
    throw new Error(
      `Couchview is already using port ${options.port} with native bridge P2P disabled; stop it or choose another port`,
    );
  }
  if (
    options.remoteBridgeP2pMode === "disabled" &&
    rawInstance.remoteBridgeP2pEnabled
  ) {
    throw new Error(
      `Couchview is already using port ${options.port} with native bridge P2P enabled; stop it or choose another port`,
    );
  }
  if (
    options.remoteBridgeP2pMode === "enabled" &&
    options.remoteBridgeStunUrls.join(",") !== rawInstance.remoteBridgeStunUrls.join(",")
  ) {
    throw new Error(
      `Couchview is already using port ${options.port} with different native bridge STUN servers; stop it or choose another port`,
    );
  }
  if (
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT !== undefined &&
    options.remoteBridgePort !== rawInstance.remoteBridgeTargetPort
  ) {
    throw new Error(
      `Couchview is already using port ${options.port} with a different loopback SSH port; stop it or choose another port`,
    );
  }
  if (
    options.remoteBridgeOriginAccess !== "auto" &&
    options.remoteBridgeOriginAccess !== rawInstance.remoteBridgeOriginAccess
  ) {
    throw new Error(
      `Couchview is already using port ${options.port} with native bridge origin access '${rawInstance.remoteBridgeOriginAccess}'; stop it or choose another port`,
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
  const { options, parsed } = parseCliState(argv);
  const explicitHost =
    parsed.explicit.host ||
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
  const terminalP2pEnabled = options.terminalP2pMode === "enabled";
  if (terminalP2pEnabled && !terminalEnabled) {
    throw new Error(
      "Terminal P2P requires terminal access; add --enable-terminal or remove --enable-terminal-p2p",
    );
  }
  const terminalDisabledReason = options.terminalMode === "disabled"
    ? "Terminal access was disabled by configuration."
    : "Terminal access on non-loopback hosts requires --enable-terminal or COUCHVIEW_TERMINAL=1.";
  const remoteBridgeEnabled = options.remoteBridgeMode === "enabled";
  const remoteBridgeP2pEnabled = options.remoteBridgeP2pMode === "enabled";
  if (remoteBridgeP2pEnabled && !remoteBridgeEnabled) {
    throw new Error(
      "Native bridge P2P requires the native bridge; add --enable-remote-bridge or remove --enable-remote-bridge-p2p",
    );
  }
  const remoteBridgeDisabledReason = options.remoteBridgeMode === "disabled"
    ? "Native remote development was disabled by configuration."
    : "Native remote development requires --enable-remote-bridge or COUCHVIEW_REMOTE_BRIDGE=1.";
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
      p2pEnabled: terminalP2pEnabled,
      stunUrls: options.terminalStunUrls,
    },
    remoteBridge: {
      enabled: remoteBridgeEnabled,
      disabledReason: remoteBridgeEnabled ? undefined : remoteBridgeDisabledReason,
      p2pEnabled: remoteBridgeP2pEnabled,
      stunUrls: options.remoteBridgeStunUrls,
      targetPort: options.remoteBridgePort,
      originAccess: options.remoteBridgeOriginAccess,
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
  if (terminalP2pEnabled) {
    console.warn(
      "Direct terminal P2P is enabled. Authorized peers can learn this host's network addresses, and terminal payloads bypass Cloudflare after signaling; Access and the tunnel still protect signaling, authorization renewal, and WebSocket fallback.",
    );
  }
  if (remoteBridgeEnabled) {
    console.warn(
      `Native IDE bridge access is enabled for paired devices and can reach SSH only on 127.0.0.1:${options.remoteBridgePort}. Protect exposed Couchview origins with trusted access control.`,
    );
  }
  if (remoteBridgeP2pEnabled) {
    console.warn(
      "Direct native bridge P2P is enabled. Paired devices can learn this host's network addresses, and SSH payloads bypass Cloudflare after signaling; Access and the tunnel still protect signaling, lease renewal, and WebSocket fallback.",
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
          ...(options.terminalP2pMode === "enabled"
            ? ["--enable-terminal-p2p"]
            : options.terminalP2pMode === "disabled"
              ? ["--disable-terminal-p2p"]
              : []),
          ...(options.remoteBridgeMode === "enabled"
            ? ["--enable-remote-bridge"]
            : options.remoteBridgeMode === "disabled"
              ? ["--disable-remote-bridge"]
              : []),
          ...(options.remoteBridgeP2pMode === "enabled"
            ? ["--enable-remote-bridge-p2p"]
            : options.remoteBridgeP2pMode === "disabled"
              ? ["--disable-remote-bridge-p2p"]
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

function validateInteractivePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }
  return port;
}

function validateServeInvocation(argv: string[]): CliOptions {
  try {
    return parseCli(argv);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError((error as Error).message, "serve");
  }
}

function validateRestartInvocation(argv: string[]): RestartCliOptions {
  try {
    return parseRestartCli(argv);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError((error as Error).message, "restart");
  }
}

async function installCompletion(shell: CompletionShell): Promise<string> {
  if (shell !== "fish") {
    throw new CliUsageError(
      "Automatic completion installation currently supports Fish only.",
      "completion",
    );
  }
  const destination = fishCompletionPath();
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${renderCompletion(shell)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return destination;
}

export async function runCli(
  argv = process.argv.slice(2),
  runtimeOverrides: Partial<RunCliRuntime> = {},
): Promise<number> {
  const runtime: RunCliRuntime = {
    supervise: runtimeOverrides.supervise ?? superviseServer,
    start: runtimeOverrides.start ?? startServer,
    restart: runtimeOverrides.restart ?? restartRunningServer,
    pairBridge: runtimeOverrides.pairBridge ?? pairRemoteBridge,
    proxyBridge: runtimeOverrides.proxyBridge ?? runRemoteBridgeProxy,
    codexBridge: runtimeOverrides.codexBridge ?? ((options) =>
      runRemoteCodex(options)),
    installCompletion: runtimeOverrides.installCompletion ?? installCompletion,
    createPrompter: runtimeOverrides.createPrompter ?? createInteractivePrompter,
    stdout: runtimeOverrides.stdout ?? ((message) => process.stdout.write(`${message}\n`)),
    stderr: runtimeOverrides.stderr ?? ((message) => process.stderr.write(`${message}\n`)),
    supervisedWorker: runtimeOverrides.supervisedWorker ??
      Bun.env[supervisedWorkerEnvironment] === "1",
  };
  let action = argv[0] === "restart"
    ? "restart"
    : argv[0] === "bridge"
      ? "run the native bridge"
      : "start";
  try {
    const invocation = parseCliInvocation(argv);
    if (invocation.kind === "help") {
      runtime.stdout(renderCliHelp(invocation.command));
      return 0;
    }
    if (invocation.kind === "version") {
      runtime.stdout(`couchview ${CLI_VERSION}`);
      return 0;
    }
    if (invocation.kind === "completion") {
      if (invocation.install) {
        action = "install completion";
        const destination = await runtime.installCompletion(invocation.shell);
        runtime.stdout(`Installed Fish completion at ${destination}.`);
        return 0;
      }
      runtime.stdout(renderCompletion(invocation.shell));
      return 0;
    }
    if (invocation.kind === "bridge-pair") {
      action = "pair the native bridge";
      const profile = await runtime.pairBridge({
        origin: invocation.origin,
        code: invocation.code,
        originAccess: invocation.originAccess,
      });
      runtime.stdout(`Paired '${profile.deviceLabel}' as SSH host ${profile.sshAlias}.`);
      runtime.stdout(`Open in Zed: ${remoteBridgeZedUrl(profile)}`);
      runtime.stdout(
        `Open in Codex CLI: couchview bridge codex --profile ${profile.id}`,
      );
      return 0;
    }
    if (invocation.kind === "bridge-proxy") {
      action = "run the native bridge proxy";
      return await runtime.proxyBridge(invocation.profileId);
    }
    if (invocation.kind === "bridge-codex") {
      action = "connect Codex through the native bridge";
      return await runtime.codexBridge({
        profileSelector: invocation.profileSelector,
        codexArgs: invocation.codexArgs,
      });
    }
    if (invocation.kind === "restart") {
      action = "restart";
      validateRestartInvocation(invocation.argv);
      await runtime.restart(invocation.argv);
      return 0;
    }

    let serveArgv = invocation.argv;
    const options = validateServeInvocation(serveArgv);
    if (invocation.parsed.interactive) {
      const prompter = runtime.createPrompter();
      try {
        serveArgv = await promptForServeArguments(
          invocation.parsed,
          options,
          prompter,
          {
            root(value) {
              if (!value) throw new Error("Repository path is required");
              return path.resolve(value);
            },
            host(value) {
              if (!value) throw new Error("Host is required");
              return normalizeBindHost(value);
            },
            port: validateInteractivePort,
          },
        );
      } finally {
        prompter.close();
      }
      validateServeInvocation(serveArgv);
    }

    if (runtime.supervisedWorker) {
      await runtime.start(serveArgv);
      return 0;
    }
    return await runtime.supervise(serveArgv);
  } catch (error) {
    if (error instanceof CliPromptInterrupted) {
      runtime.stderr(error.message);
      return 130;
    }
    if (error instanceof CliUsageError) {
      const help = error.helpCommand
        ? `couchview help ${error.helpCommand}`
        : "couchview --help";
      runtime.stderr(`error: ${error.message}\nTry '${help}' for more information.`);
      return 2;
    }
    runtime.stderr(`Couchview could not ${action}: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
