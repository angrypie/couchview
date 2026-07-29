import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RTCPeerConnection, type RTCDataChannel } from "werift";

import {
  API_ROUTES,
  REMOTE_BRIDGE_DATA_CHANNEL_LABEL,
  REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL,
  REMOTE_BRIDGE_PROTOCOL,
  REMOTE_BRIDGE_TICKET_PREFIX,
  type ApiErrorBody,
  type RemoteBridgeProfile,
  type RemoteBridgeTicketResponse,
} from "../shared/contracts.ts";

const CONFIG_VERSION = 1;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_TRANSPORT_BUFFER_BYTES = 1024 * 1024;
const MAX_STREAM_FRAME_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 20_000;

interface RemoteBridgeConfigFile {
  version: typeof CONFIG_VERSION;
  profiles: RemoteBridgeProfile[];
}

export interface RemoteBridgePaths {
  configDirectory: string;
  configFile: string;
  sshDirectory: string;
  sshConfigFile: string;
  managedSshConfigFile: string;
}

export interface PairRemoteBridgeOptions {
  origin: string;
  code: string;
  cloudflareAccess: boolean;
}

export interface CloudflareAccessTokenOptions {
  allowLogin?: boolean;
}

interface CloudflareTokenState {
  value: string | null;
}

export interface RemoteBridgeClientRuntime {
  fetch: typeof globalThis.fetch;
  createWebSocket(
    url: string,
    options: Bun.WebSocketOptions,
  ): WebSocket;
  createPeerConnection(
    iceServers: readonly { urls: string }[],
  ): RTCPeerConnection;
  cloudflareAccessToken(
    origin: string,
    options?: CloudflareAccessTokenOptions,
  ): Promise<string>;
  paths: RemoteBridgePaths;
  executableCommand: string;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream & { writableLength?: number };
  stderr(message: string): void;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The Couchview bridge URL must be an HTTP or HTTPS origin");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("The Couchview bridge URL must be an HTTP or HTTPS origin");
  }
  return url.origin;
}

export function resolveRemoteBridgePaths(
  environment: Record<string, string | undefined> = process.env,
  userHome = homedir(),
): RemoteBridgePaths {
  const configured = environment.XDG_CONFIG_HOME;
  const configHome = configured && path.isAbsolute(configured)
    ? configured
    : path.join(userHome, ".config");
  const configDirectory = path.join(configHome, "couchview");
  const sshDirectory = path.join(userHome, ".ssh");
  return {
    configDirectory,
    configFile: path.join(configDirectory, "remote-bridges.json"),
    sshDirectory,
    sshConfigFile: path.join(sshDirectory, "config"),
    managedSshConfigFile: path.join(sshDirectory, "couchview_config"),
  };
}

function profileIsValid(value: unknown): value is RemoteBridgeProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<RemoteBridgeProfile>;
  return typeof profile.id === "string" &&
    /^[A-Za-z0-9-]{8,128}$/.test(profile.id) &&
    typeof profile.origin === "string" &&
    typeof profile.repositoryId === "string" &&
    typeof profile.repositoryName === "string" &&
    typeof profile.repositoryRoot === "string" &&
    path.isAbsolute(profile.repositoryRoot) &&
    typeof profile.deviceId === "string" &&
    typeof profile.deviceToken === "string" &&
    /^[A-Za-z0-9_-]{32,128}$/.test(profile.deviceToken) &&
    typeof profile.deviceLabel === "string" &&
    typeof profile.sshAlias === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(profile.sshAlias) &&
    typeof profile.username === "string" &&
    /^[A-Za-z0-9._-]{1,255}$/.test(profile.username) &&
    typeof profile.cloudflareAccess === "boolean";
}

function validateProfile(value: unknown): RemoteBridgeProfile {
  if (!profileIsValid(value)) {
    throw new Error("The Couchview server returned an invalid remote bridge profile");
  }
  const origin = normalizeOrigin(value.origin);
  return { ...value, origin };
}

function emptyConfig(): RemoteBridgeConfigFile {
  return { version: CONFIG_VERSION, profiles: [] };
}

export async function readRemoteBridgeConfig(
  paths = resolveRemoteBridgePaths(),
): Promise<RemoteBridgeConfigFile> {
  if (!existsSync(paths.configFile)) return emptyConfig();
  const raw = await readFile(paths.configFile);
  if (raw.byteLength > MAX_CONFIG_BYTES) {
    throw new Error("The Couchview remote bridge config is unexpectedly large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`The Couchview remote bridge config is invalid: ${paths.configFile}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`The Couchview remote bridge config is invalid: ${paths.configFile}`);
  }
  const candidate = parsed as Partial<RemoteBridgeConfigFile>;
  if (
    candidate.version !== CONFIG_VERSION ||
    !Array.isArray(candidate.profiles) ||
    !candidate.profiles.every(profileIsValid)
  ) {
    throw new Error(`The Couchview remote bridge config is invalid: ${paths.configFile}`);
  }
  return {
    version: CONFIG_VERSION,
    profiles: candidate.profiles.map(validateProfile),
  };
}

async function writePrivateFile(filePath: string, contents: string): Promise<void> {
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function managedSshConfig(
  profiles: readonly RemoteBridgeProfile[],
  executableCommand: string,
): string {
  const blocks = [...profiles]
    .sort((left, right) => left.sshAlias.localeCompare(right.sshAlias))
    .map((profile) => [
      `Host ${profile.sshAlias}`,
      `  HostName ${profile.sshAlias}.invalid`,
      `  User ${profile.username}`,
      `  ProxyCommand ${executableCommand} bridge proxy --profile ${shellQuote(profile.id)}`,
      "  ConnectTimeout 20",
      "  ServerAliveInterval 15",
      "  ServerAliveCountMax 3",
    ].join("\n"));
  return [
    "# Managed by Couchview. Pair or revoke devices through Couchview instead of editing this file.",
    ...blocks,
    "",
  ].join("\n\n");
}

async function ensureSshInclude(paths: RemoteBridgePaths): Promise<void> {
  await mkdir(paths.sshDirectory, { recursive: true, mode: 0o700 });
  await chmod(paths.sshDirectory, 0o700);
  const current = await readFile(paths.sshConfigFile, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  const includePattern = /^\s*Include\s+"?~\/\.ssh\/couchview_config"?\s*$/im;
  if (includePattern.test(current)) {
    await chmod(paths.sshConfigFile, 0o600);
    return;
  }
  const include = "Include ~/.ssh/couchview_config";
  const updated = current ? `${include}\n\n${current}` : `${include}\n`;
  await writeFile(paths.sshConfigFile, updated, { mode: 0o600 });
  await chmod(paths.sshConfigFile, 0o600);
}

export async function storeRemoteBridgeProfile(
  profile: RemoteBridgeProfile,
  options: {
    paths?: RemoteBridgePaths;
    executableCommand?: string;
  } = {},
): Promise<void> {
  const validated = validateProfile(profile);
  const paths = options.paths ?? resolveRemoteBridgePaths();
  const executableCommand = options.executableCommand ?? defaultExecutableCommand();
  const current = await readRemoteBridgeConfig(paths);
  const profiles = [
    ...current.profiles.filter((candidate) =>
      candidate.id !== validated.id && candidate.sshAlias !== validated.sshAlias
    ),
    validated,
  ];
  await writePrivateFile(
    paths.managedSshConfigFile,
    managedSshConfig(profiles, executableCommand),
  );
  await ensureSshInclude(paths);
  await writePrivateFile(
    paths.configFile,
    `${JSON.stringify({ version: CONFIG_VERSION, profiles }, null, 2)}\n`,
  );
}

export function remoteBridgeZedUrl(profile: RemoteBridgeProfile): string {
  const encodedPath = profile.repositoryRoot
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `zed://ssh/${encodeURIComponent(profile.sshAlias)}${encodedPath}`;
}

function defaultExecutableCommand(): string {
  const executable = Bun.which("couchview");
  if (executable) return shellQuote(executable);
  const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
  return `${shellQuote(process.execPath)} run ${shellQuote(cliPath)}`;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Fall through to the status-only error.
  }
  return `HTTP ${response.status}`;
}

async function fetchWithTimeout(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out connecting to ${new URL(url).origin}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readCloudflareAccessToken(
  cloudflared: string,
  origin: string,
): Promise<{ token: string; detail: string | undefined; valid: boolean }> {
  const child = Bun.spawn(
    [cloudflared, "access", "token", `-app=${origin}`],
    {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 2 * 60_000,
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const token = stdout.trim();
  return {
    token,
    detail: stderr.trim().split("\n")[0]?.slice(0, 240),
    valid: exitCode === 0 && Boolean(token) && token.length <= 32_768 && !/\s/.test(token),
  };
}

export async function cloudflareAccessToken(
  origin: string,
  options: CloudflareAccessTokenOptions = {},
): Promise<string> {
  const cloudflared = Bun.which("cloudflared");
  if (!cloudflared) {
    throw new Error(
      "cloudflared is required for this Access-protected Couchview bridge; install it and try again",
    );
  }
  const normalizedOrigin = normalizeOrigin(origin);
  let attempt = await readCloudflareAccessToken(cloudflared, normalizedOrigin);
  if (!attempt.valid && options.allowLogin) {
    process.stderr.write(
      `Cloudflare Access sign-in required for ${normalizedOrigin}. Complete it in the browser.\n`,
    );
    const login = Bun.spawn(
      [cloudflared, "access", "login", "--quiet", normalizedOrigin],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        timeout: 5 * 60_000,
      },
    );
    if (await login.exited !== 0) {
      throw new Error("Cloudflare Access login failed");
    }
    attempt = await readCloudflareAccessToken(cloudflared, normalizedOrigin);
  }
  if (!attempt.valid) {
    throw new Error(
      `Cloudflare Access authentication failed${attempt.detail ? `: ${attempt.detail}` : ""}`,
    );
  }
  return attempt.token;
}

function defaultRuntime(): RemoteBridgeClientRuntime {
  const BunWebSocket = WebSocket as unknown as new (
    url: string,
    options?: Bun.WebSocketOptions,
  ) => WebSocket;
  return {
    fetch: globalThis.fetch,
    createWebSocket: (url, options) => new BunWebSocket(url, options),
    createPeerConnection: (iceServers) => new RTCPeerConnection({
      iceServers: iceServers.map(({ urls }) => ({ urls })),
    }),
    cloudflareAccessToken,
    paths: resolveRemoteBridgePaths(),
    executableCommand: defaultExecutableCommand(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (message) => process.stderr.write(`${message}\n`),
  };
}

async function accessHeaders(
  origin: string,
  enabled: boolean,
  state: CloudflareTokenState,
  runtime: RemoteBridgeClientRuntime,
  options: {
    allowLogin?: boolean;
    force?: boolean;
  } = {},
): Promise<Record<string, string>> {
  if (!enabled) return {};
  if (!state.value || options.force) {
    state.value = await runtime.cloudflareAccessToken(origin, {
      allowLogin: options.allowLogin ?? false,
    });
  }
  return { "cf-access-token": state.value };
}

export async function pairRemoteBridge(
  options: PairRemoteBridgeOptions,
  runtimeOverrides: Partial<RemoteBridgeClientRuntime> = {},
): Promise<RemoteBridgeProfile> {
  const runtime = { ...defaultRuntime(), ...runtimeOverrides };
  const origin = normalizeOrigin(options.origin);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(options.code)) {
    throw new Error("The Couchview remote bridge pairing code is invalid");
  }
  const tokenState: CloudflareTokenState = { value: null };
  const headers = await accessHeaders(
    origin,
    options.cloudflareAccess,
    tokenState,
    runtime,
    { allowLogin: true },
  );
  const response = await fetchWithTimeout(
    runtime.fetch,
    `${origin}${API_ROUTES.remoteBridgeClaim}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: options.code }),
    },
  );
  if (!response.ok) throw new Error(await responseError(response));
  const profile = validateProfile(await response.json());
  if (profile.origin !== origin) {
    throw new Error("The Couchview server returned a profile for a different origin");
  }
  await storeRemoteBridgeProfile(profile, {
    paths: runtime.paths,
    executableCommand: runtime.executableCommand,
  });
  return profile;
}

async function loadProfile(
  profileId: string,
  paths: RemoteBridgePaths,
): Promise<RemoteBridgeProfile> {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(profileId)) {
    throw new Error("The Couchview remote bridge profile ID is invalid");
  }
  const config = await readRemoteBridgeConfig(paths);
  const profile = config.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Remote bridge profile '${profileId}' was not found`);
  }
  return profile;
}

function webSocketUrl(profile: RemoteBridgeProfile): string {
  const url = new URL(API_ROUTES.remoteBridgeSocket(profile.repositoryId), profile.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function authenticatedBridgeRequest(
  profile: RemoteBridgeProfile,
  pathname: string,
  body: unknown,
  tokenState: CloudflareTokenState,
  runtime: RemoteBridgeClientRuntime,
): Promise<Response> {
  const perform = async (forceAccessRefresh: boolean): Promise<Response> => {
    const headers = await accessHeaders(
      profile.origin,
      profile.cloudflareAccess,
      tokenState,
      runtime,
      { force: forceAccessRefresh },
    );
    return fetchWithTimeout(runtime.fetch, `${profile.origin}${pathname}`, {
      method: "POST",
      headers: {
        ...headers,
        authorization: `Bearer ${profile.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };
  let response = await perform(false);
  if (profile.cloudflareAccess && (response.status === 401 || response.status === 403)) {
    response = await perform(true);
  }
  return response;
}

function ticketIsValid(value: unknown): value is RemoteBridgeTicketResponse {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Partial<RemoteBridgeTicketResponse>;
  return typeof ticket.ticket === "string" &&
    /^[A-Za-z0-9_-]{32,128}$/.test(ticket.ticket) &&
    typeof ticket.expiresAt === "string" &&
    ticket.protocol === REMOTE_BRIDGE_PROTOCOL &&
    typeof ticket.leaseRenewIntervalMs === "number" &&
    Number.isSafeInteger(ticket.leaseRenewIntervalMs) &&
    ticket.leaseRenewIntervalMs >= 5_000 &&
    ticket.leaseRenewIntervalMs <= 60_000 &&
    (ticket.webRtc === undefined || (
      Array.isArray(ticket.webRtc.iceServers) &&
      ticket.webRtc.iceServers.every((server) => typeof server.urls === "string") &&
      Number.isSafeInteger(ticket.webRtc.negotiationTimeoutMs) &&
      ticket.webRtc.negotiationTimeoutMs >= 1_000 &&
      ticket.webRtc.negotiationTimeoutMs <= 30_000
    ));
}

function sendFrames(
  bytes: Buffer<ArrayBufferLike>,
  send: (frame: Buffer<ArrayBufferLike>) => void,
): void {
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_STREAM_FRAME_BYTES) {
    send(bytes.subarray(offset, Math.min(bytes.byteLength, offset + MAX_STREAM_FRAME_BYTES)));
  }
}

export async function runRemoteBridgeProxy(
  profileId: string,
  runtimeOverrides: Partial<RemoteBridgeClientRuntime> = {},
): Promise<number> {
  const runtime = { ...defaultRuntime(), ...runtimeOverrides };
  const profile = await loadProfile(profileId, runtime.paths);
  const accessTokenState: CloudflareTokenState = { value: null };
  await accessHeaders(
    profile.origin,
    profile.cloudflareAccess,
    accessTokenState,
    runtime,
  );
  const connectionId = randomUUID();
  const ticketResponse = await authenticatedBridgeRequest(
    profile,
    API_ROUTES.remoteBridgeTickets(profile.repositoryId),
    { connectionId },
    accessTokenState,
    runtime,
  );
  if (!ticketResponse.ok) throw new Error(await responseError(ticketResponse));
  const rawTicket: unknown = await ticketResponse.json();
  if (!ticketIsValid(rawTicket)) {
    throw new Error("The Couchview server returned an invalid bridge ticket");
  }
  const ticket = rawTicket;
  const wsHeaders = await accessHeaders(
    profile.origin,
    profile.cloudflareAccess,
    accessTokenState,
    runtime,
  );
  const socket = runtime.createWebSocket(webSocketUrl(profile), {
    protocols: [REMOTE_BRIDGE_PROTOCOL, `${REMOTE_BRIDGE_TICKET_PREFIX}${ticket.ticket}`],
    headers: wsHeaders,
    perMessageDeflate: false,
  });
  socket.binaryType = "arraybuffer";

  return await new Promise<number>((resolve) => {
    let finished = false;
    let ready = false;
    let phase: "websocket" | "switching" | "webrtc" = "websocket";
    let peer: RTCPeerConnection | null = null;
    let channel: RTCDataChannel | null = null;
    let negotiationTimer: ReturnType<typeof setTimeout> | null = null;
    let leaseTimer: ReturnType<typeof setInterval> | null = null;
    let lastError: string | null = null;
    const inputBuffer: Buffer<ArrayBufferLike>[] = [];
    let inputBufferBytes = 0;

    const stopPeer = (): void => {
      if (negotiationTimer) clearTimeout(negotiationTimer);
      negotiationTimer = null;
      const closingPeer = peer;
      peer = null;
      channel = null;
      if (closingPeer) void closingPeer.close().catch(() => undefined);
    };

    const cleanup = (): void => {
      if (leaseTimer) clearInterval(leaseTimer);
      leaseTimer = null;
      clearTimeout(readyTimer);
      runtime.stdin.removeListener("data", onInput);
      stopPeer();
    };

    const finish = (exitCode: number): void => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(exitCode);
    };

    const closeWithError = (message: string): void => {
      if (!lastError) {
        lastError = message;
      }
      try {
        socket.close(1011, "remote_bridge_client_failed");
      } catch {
        runtime.stderr(`Couchview bridge: ${lastError}`);
        finish(1);
      }
    };

    const sendWebSocketBytes = (bytes: Buffer<ArrayBufferLike>): void => {
      if (socket.readyState !== WebSocket.OPEN) {
        closeWithError("The WebSocket fallback is no longer connected.");
        return;
      }
      sendFrames(bytes, (frame) => {
        if (socket.bufferedAmount + frame.byteLength > MAX_TRANSPORT_BUFFER_BYTES) {
          closeWithError("The WebSocket fallback could not keep up with SSH traffic.");
          return;
        }
        const payload = new Uint8Array(frame.byteLength);
        payload.set(frame);
        socket.send(payload);
      });
    };

    const sendWebRtcBytes = (bytes: Buffer<ArrayBufferLike>): void => {
      const activeChannel = channel;
      if (!activeChannel || activeChannel.readyState !== "open") {
        closeWithError("The direct bridge path was lost; SSH will reconnect.");
        return;
      }
      sendFrames(bytes, (frame) => {
        if (activeChannel.bufferedAmount + frame.byteLength > MAX_TRANSPORT_BUFFER_BYTES) {
          closeWithError("The direct bridge path could not keep up with SSH traffic.");
          return;
        }
        try {
          activeChannel.send(frame);
        } catch {
          closeWithError("The direct bridge path was lost; SSH will reconnect.");
        }
      });
    };

    function onInput(chunk: string | Buffer): void {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (phase === "switching") {
        if (inputBufferBytes + bytes.byteLength > MAX_TRANSPORT_BUFFER_BYTES) {
          closeWithError("The direct-path handoff exceeded its input buffer.");
          return;
        }
        const copy = Buffer.from(bytes);
        inputBuffer.push(copy);
        inputBufferBytes += copy.byteLength;
        return;
      }
      if (phase === "webrtc") sendWebRtcBytes(bytes);
      else sendWebSocketBytes(bytes);
    }

    const flushInputTo = (transport: "websocket" | "webrtc"): void => {
      const buffered = inputBuffer.splice(0);
      inputBufferBytes = 0;
      for (const bytes of buffered) {
        if (finished) return;
        if (transport === "webrtc") sendWebRtcBytes(bytes);
        else sendWebSocketBytes(bytes);
      }
    };

    const fallBackFromNegotiation = (message?: string): void => {
      if (phase === "webrtc") {
        closeWithError("The direct bridge path was lost; SSH will reconnect.");
        return;
      }
      stopPeer();
      const wasSwitching = phase === "switching";
      phase = "websocket";
      if (wasSwitching) flushInputTo("websocket");
      if (message) runtime.stderr(`Couchview bridge: ${message} Using WebSocket fallback.`);
    };

    const writeOutput = (bytes: Buffer<ArrayBufferLike>): void => {
      if ((runtime.stdout.writableLength ?? 0) + bytes.byteLength > MAX_TRANSPORT_BUFFER_BYTES) {
        closeWithError("The local SSH process stopped reading bridge output.");
        return;
      }
      runtime.stdout.write(bytes);
    };

    const startWebRtc = async (): Promise<void> => {
      if (!ticket.webRtc || finished || peer) return;
      try {
        const nextPeer = runtime.createPeerConnection(ticket.webRtc.iceServers);
        const nextChannel = nextPeer.createDataChannel(REMOTE_BRIDGE_DATA_CHANNEL_LABEL, {
          ordered: true,
          protocol: REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL,
        });
        peer = nextPeer;
        channel = nextChannel;
        nextChannel.onMessage.subscribe((message) => {
          if (typeof message === "string") {
            let control: Record<string, unknown>;
            try {
              control = JSON.parse(message) as Record<string, unknown>;
            } catch {
              closeWithError("The direct bridge sent invalid control data.");
              return;
            }
            if (control.type === "ready" && control.transport === "webrtc" && phase === "switching") {
              phase = "webrtc";
              flushInputTo("webrtc");
              runtime.stderr("Couchview bridge: direct WebRTC path active.");
              return;
            }
            if (control.type === "pong") return;
            closeWithError("The direct bridge sent unexpected control data.");
            return;
          }
          if (phase === "webrtc") writeOutput(message);
        });
        nextChannel.error.subscribe(() => fallBackFromNegotiation());
        nextChannel.stateChanged.subscribe((state) => {
          if (state === "closed") fallBackFromNegotiation();
        });
        nextPeer.connectionStateChange.subscribe((state) => {
          if (state === "failed" || state === "closed" || state === "disconnected") {
            fallBackFromNegotiation();
          }
        });
        const offer = await nextPeer.createOffer();
        await nextPeer.setLocalDescription(offer);
        if (peer !== nextPeer || finished) return;
        const local = nextPeer.localDescription;
        if (!local || local.type !== "offer") {
          throw new Error("WebRTC could not create a local offer.");
        }
        socket.send(JSON.stringify({
          type: "webrtc-offer",
          offer: { type: "offer", sdp: local.sdp },
        }));
        negotiationTimer = setTimeout(() => {
          fallBackFromNegotiation("No direct path was found in time.");
        }, ticket.webRtc.negotiationTimeoutMs);
      } catch (error) {
        fallBackFromNegotiation((error as Error).message);
      }
    };

    const renewLease = async (): Promise<void> => {
      const response = await authenticatedBridgeRequest(
        profile,
        API_ROUTES.remoteBridgeLease(profile.repositoryId),
        { connectionId },
        accessTokenState,
        runtime,
      );
      if (!response.ok) throw new Error(await responseError(response));
    };

    const handleControl = async (message: string): Promise<void> => {
      let control: Record<string, unknown>;
      try {
        control = JSON.parse(message) as Record<string, unknown>;
      } catch {
        closeWithError("The bridge server sent invalid control data.");
        return;
      }
      if (control.type === "ready") {
        if (ready) return;
        ready = true;
        clearTimeout(readyTimer);
        runtime.stdin.on("data", onInput);
        runtime.stdin.resume();
        leaseTimer = setInterval(() => {
          void renewLease().catch((error) => closeWithError((error as Error).message));
        }, ticket.leaseRenewIntervalMs);
        void startWebRtc();
        return;
      }
      if (control.type === "webrtc-answer" && peer && control.answer) {
        const answer = control.answer as { type?: unknown; sdp?: unknown };
        if (answer.type !== "answer" || typeof answer.sdp !== "string") {
          fallBackFromNegotiation("The server returned an invalid WebRTC answer.");
          return;
        }
        await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp }).catch((error) => {
          fallBackFromNegotiation((error as Error).message);
        });
        return;
      }
      if (control.type === "webrtc-switch" && channel?.readyState === "open") {
        phase = "switching";
        if (negotiationTimer) clearTimeout(negotiationTimer);
        negotiationTimer = null;
        socket.send(JSON.stringify({ type: "webrtc-activate" }));
        return;
      }
      if (control.type === "webrtc-unavailable") {
        fallBackFromNegotiation(
          typeof control.message === "string" ? control.message : "Direct WebRTC was unavailable.",
        );
        return;
      }
      if (control.type === "pong") return;
      if (control.type === "error") {
        closeWithError(
          typeof control.message === "string" ? control.message : "The bridge target failed.",
        );
        return;
      }
      closeWithError("The bridge server sent unexpected control data.");
    };

    const readyTimer = setTimeout(() => {
      closeWithError("Timed out waiting for the Mini's SSH service.");
    }, READY_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (socket.protocol !== REMOTE_BRIDGE_PROTOCOL) {
        closeWithError("The bridge server selected an incompatible protocol.");
      }
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        void handleControl(event.data).catch((error) => closeWithError((error as Error).message));
        return;
      }
      if (phase !== "webrtc") {
        const bytes = event.data instanceof ArrayBuffer
          ? Buffer.from(event.data)
          : Buffer.isBuffer(event.data)
            ? event.data
            : null;
        if (bytes) writeOutput(bytes);
        else closeWithError("The bridge server sent an unsupported binary frame.");
      }
    });
    socket.addEventListener("error", () => {
      lastError ??= "The bridge WebSocket could not connect.";
    });
    socket.addEventListener("close", (event) => {
      if (lastError) runtime.stderr(`Couchview bridge: ${lastError}`);
      finish(event.code === 1000 && ready ? 0 : 1);
    });
  });
}
