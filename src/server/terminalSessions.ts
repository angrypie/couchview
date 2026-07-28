import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { RTCPeerConnection } from "werift";

import {
  TERMINAL_DATA_CHANNEL_LABEL,
  TERMINAL_DATA_CHANNEL_PROTOCOL,
  TERMINAL_ENDED_CLOSE_CODE,
  TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
  TERMINAL_P2P_FAILED_CLOSE_CODE,
  type TerminalAttachmentRequest,
  type TerminalAttachmentResponse,
  type TerminalCapability,
  type TerminalEndResponse,
  type TerminalLeaseRequest,
  type TerminalLeaseResponse,
  type TerminalSessionStatus,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";

export const TERMINAL_PROTOCOL = "couchview-terminal-v1";
export const TERMINAL_TICKET_PREFIX = "couchview-ticket.";

const TICKET_LIFETIME_MS = 30_000;
const MAX_TICKETS = 256;
const COMMAND_TIMEOUT_MS = 5_000;
export const TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS = 10_000;
export const TERMINAL_P2P_LEASE_RENEW_INTERVAL_MS = 30_000;
export const TERMINAL_P2P_LEASE_TTL_MS = 120_000;
const MAX_TERMINAL_CONTROL_BYTES = 48 * 1024;
const MAX_TERMINAL_TRANSPORT_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_STUN_URLS = ["stun:stun.cloudflare.com:3478"];

export interface TerminalSocketData {
  kind: "terminal";
  repositoryId: string;
  repositoryRoot: string;
  clientId: string;
  profileId: "tmux";
  cols: number;
  rows: number;
  takeover: boolean;
  host: string;
  origin: string;
}

export interface TerminalDependencies {
  terminalAvailable: boolean;
  tmuxPath: string | null;
  tmux256Color: boolean;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type TerminalCommandRunner = (
  argv: readonly string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<CommandResult>;

interface StoredTicket extends TerminalSocketData {
  expiresAt: number;
}

export interface TerminalEvent<T extends unknown[]> {
  subscribe(handler: (...args: T) => void): { unSubscribe(): void };
}

export interface TerminalDataChannel {
  readonly label: string;
  readonly protocol: string;
  readonly ordered: boolean;
  readonly maxRetransmits?: number | null;
  readonly maxPacketLifeTime?: number | null;
  readonly readyState: "open" | "closed" | "connecting" | "closing";
  readonly bufferedAmount: number;
  readonly stateChanged: TerminalEvent<["open" | "closed" | "connecting" | "closing"]>;
  readonly onMessage: TerminalEvent<[string | Buffer<ArrayBufferLike>]>;
  readonly error: TerminalEvent<[Error]>;
  send(data: Buffer<ArrayBufferLike> | string): void;
  close(): void;
}

export interface TerminalPeerConnection {
  readonly onDataChannel: TerminalEvent<[TerminalDataChannel]>;
  readonly connectionStateChange: TerminalEvent<[
    "disconnected" | "closed" | "new" | "connected" | "connecting" | "failed"
  ]>;
  readonly localDescription?: { type: "offer" | "answer"; sdp: string };
  setRemoteDescription(description: { type: "offer"; sdp: string }): Promise<void>;
  createAnswer(): Promise<{ type: "answer"; sdp: string }>;
  setLocalDescription(description: { type: "answer"; sdp: string }): Promise<unknown>;
  close(): Promise<void>;
}

interface TerminalWebRtcState {
  peer: TerminalPeerConnection;
  channel: TerminalDataChannel | null;
  negotiationTimer: ReturnType<typeof setTimeout> | null;
  outputBuffer: Buffer<ArrayBuffer>[];
  outputBufferBytes: number;
}

interface TerminalAttachment {
  socket: Bun.ServerWebSocket<TerminalSocketData>;
  terminal: Bun.Terminal;
  process: ReturnType<typeof Bun.spawn>;
  clientId: string;
  host: string;
  origin: string;
  transport: "websocket" | "switching" | "webrtc";
  webRtc: TerminalWebRtcState | null;
  leaseExpiresAt: number | null;
  leaseTimer: ReturnType<typeof setTimeout> | null;
}

export interface TerminalSessionServiceOptions {
  enabled: boolean;
  disabledReason?: string;
  namespaceSeed: string;
  dependencies?: TerminalDependencies;
  commandRunner?: TerminalCommandRunner;
  now?: () => number;
  tokenFactory?: () => string;
  runtimeDirectory?: string;
  userTmuxConfigPath?: string | null;
  terminalFactory?: (options: Bun.TerminalOptions) => Bun.Terminal;
  terminalSpawner?: (
    argv: readonly string[],
    options: {
      cwd: string;
      env: Record<string, string | undefined>;
      terminal: Bun.Terminal;
    },
  ) => ReturnType<typeof Bun.spawn>;
  p2pEnabled?: boolean;
  stunUrls?: readonly string[];
  peerConnectionFactory?: (iceServers: readonly string[]) => TerminalPeerConnection;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanCommandError(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll("\0", "�")
    .trim()
    .split("\n")[0]
    ?.slice(0, 240) || "The command did not return details";
}

async function runCommand(
  argv: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  try {
    const subprocess = Bun.spawn([...argv], {
      cwd: options.cwd,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    });
    const stdoutPromise = new Response(subprocess.stdout).text();
    const stderrPromise = new Response(subprocess.stderr).text();
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      stdoutPromise,
      stderrPromise,
    ]);
    return { exitCode, stdout, stderr };
  } catch (error) {
    return {
      exitCode: -1,
      stdout: "",
      stderr: (error as Error).message,
    };
  }
}

function probeDependencies(): TerminalDependencies {
  const tmuxPath = Bun.which("tmux");
  const infocmp = Bun.which("infocmp");
  const tmux256Color = Boolean(
    infocmp && Bun.spawnSync([infocmp, "tmux-256color"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0,
  );
  return {
    terminalAvailable: typeof Bun.Terminal === "function",
    tmuxPath,
    tmux256Color,
  };
}

export function resolveUserTmuxConfigPath(
  environment: Record<string, string | undefined> = process.env,
  homeDirectory = homedir(),
  exists: (candidate: string) => boolean = existsSync,
): string | null {
  const candidates = [
    ...(environment.XDG_CONFIG_HOME
      ? [path.join(environment.XDG_CONFIG_HOME, "tmux", "tmux.conf")]
      : []),
    path.join(homeDirectory, ".config", "tmux", "tmux.conf"),
    path.join(homeDirectory, ".tmux.conf"),
  ];
  return [...new Set(candidates)].find(exists) ?? null;
}

function tmuxQuoted(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")}"`;
}

function capabilityFor(
  enabled: boolean,
  disabledReason: string | undefined,
  dependencies: TerminalDependencies,
): TerminalCapability {
  let reason: string | null = null;
  if (!enabled) {
    reason = disabledReason ?? "Browser terminal access is disabled.";
  } else if (process.platform === "win32") {
    reason = "The browser tmux terminal currently requires macOS or Linux.";
  } else if (!dependencies.terminalAvailable) {
    reason = "This Bun runtime does not provide Bun.Terminal.";
  } else if (!dependencies.tmuxPath) {
    reason = "Install tmux on the Couchview host to use persistent terminal sessions.";
  }
  const profileAvailable = reason === null;
  return {
    available: profileAvailable,
    reason,
    persistence: "tmux",
    profiles: [
      {
        id: "tmux",
        label: "tmux",
        available: profileAvailable,
        reason,
      },
    ],
  };
}

function validDimensions(cols: number, rows: number): boolean {
  return Number.isSafeInteger(cols) && cols >= 2 && cols <= 500 &&
    Number.isSafeInteger(rows) && rows >= 1 && rows <= 300;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4 && octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

export function terminalAccessIsLoopback(
  bindHost: string,
  allowedOrigins: readonly string[],
): boolean {
  if (!isLoopbackHostname(bindHost)) return false;
  return allowedOrigins.every((origin) => {
    try {
      return isLoopbackHostname(new URL(origin).hostname);
    } catch {
      return false;
    }
  });
}

export class TerminalSessionService {
  readonly capability: TerminalCapability;
  readonly enabled: boolean;
  readonly p2pEnabled: boolean;
  readonly stunUrls: readonly string[];
  readonly websocket: Bun.WebSocketHandler<TerminalSocketData>;

  private readonly dependencies: TerminalDependencies;
  private readonly commandRunner: TerminalCommandRunner;
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly namespace: string;
  private readonly runtimeDirectory: string;
  private readonly userTmuxConfigPath: string | null;
  private readonly tickets = new Map<string, StoredTicket>();
  private readonly attachments = new Map<string, TerminalAttachment>();
  private readonly starts = new Map<string, Promise<void>>();
  private readonly terminalFactory: (options: Bun.TerminalOptions) => Bun.Terminal;
  private readonly terminalSpawner: NonNullable<TerminalSessionServiceOptions["terminalSpawner"]>;
  private readonly peerConnectionFactory: NonNullable<
    TerminalSessionServiceOptions["peerConnectionFactory"]
  >;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private serverConfiguration: Promise<void> | null = null;
  private serverConfigured = false;
  private closed = false;

  constructor(options: TerminalSessionServiceOptions) {
    this.enabled = options.enabled;
    this.p2pEnabled = options.p2pEnabled ?? false;
    if (this.p2pEnabled && !this.enabled) {
      throw new Error("Terminal P2P requires terminal access to be enabled");
    }
    this.stunUrls = [...(options.stunUrls ?? DEFAULT_STUN_URLS)];
    this.dependencies = options.dependencies ?? probeDependencies();
    this.capability = capabilityFor(
      options.enabled,
      options.disabledReason,
      this.dependencies,
    );
    this.commandRunner = options.commandRunner ?? runCommand;
    this.now = options.now ?? Date.now;
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
    const namespaceHash = hash(options.namespaceSeed).slice(0, 12);
    this.namespace = `couchview-${namespaceHash}`;
    const uid = typeof process.getuid === "function" ? process.getuid() : "user";
    this.runtimeDirectory = options.runtimeDirectory ??
      path.join("/tmp", `couchview-${uid}-${namespaceHash}`);
    this.userTmuxConfigPath = options.userTmuxConfigPath === undefined
      ? resolveUserTmuxConfigPath()
      : options.userTmuxConfigPath;
    this.terminalFactory = options.terminalFactory ?? ((terminalOptions) =>
      new Bun.Terminal(terminalOptions));
    this.terminalSpawner = options.terminalSpawner ?? ((argv, spawnOptions) =>
      Bun.spawn([...argv], {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
        terminal: spawnOptions.terminal,
      }));
    this.peerConnectionFactory = options.peerConnectionFactory ?? ((iceServers) =>
      new RTCPeerConnection({
        iceServers: iceServers.map((urls) => ({ urls })),
      }) as unknown as TerminalPeerConnection);
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.websocket = {
      data: {} as TerminalSocketData,
      maxPayloadLength: 64 * 1024,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 120,
      sendPings: true,
      open: (socket) => this.openSocket(socket),
      message: (socket, message) => this.message(socket, message),
      close: (socket) => this.closeSocket(socket),
    };
  }

  private assertAvailable(): void {
    if (!this.enabled) {
      throw new HttpError(403, "terminal_disabled", this.capability.reason ?? "Terminal access is disabled");
    }
    if (!this.capability.available) {
      throw new HttpError(503, "terminal_unavailable", this.capability.reason ?? "tmux is unavailable");
    }
    if (this.closed) {
      throw new HttpError(503, "terminal_unavailable", "The terminal service is shutting down");
    }
  }

  private tmuxArgs(...args: string[]): string[] {
    const tmuxPath = this.dependencies.tmuxPath;
    if (!tmuxPath) throw new HttpError(503, "terminal_unavailable", "tmux is unavailable");
    return [tmuxPath, "-f", this.tmuxConfigPath(), "-L", this.namespace, ...args];
  }

  private sessionName(repositoryId: string): string {
    // Preserve the original internal name so upgrades keep existing sessions reachable.
    return `nvim-${hash(repositoryId).slice(0, 16)}`;
  }

  private tmuxConfigPath(): string {
    return path.join(this.runtimeDirectory, "tmux.conf");
  }

  private async ensureRuntimeDirectory(): Promise<void> {
    await mkdir(this.runtimeDirectory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.runtimeDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new HttpError(500, "terminal_runtime_unsafe", "The terminal runtime path is not a safe directory");
    }
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      throw new HttpError(500, "terminal_runtime_unsafe", "The terminal runtime directory belongs to another user");
    }
    await chmod(this.runtimeDirectory, 0o700);
    const terminalName = this.dependencies.tmux256Color ? "tmux-256color" : "screen-256color";
    const configuration = [
      ...(this.userTmuxConfigPath
        ? [`source-file ${tmuxQuoted(this.userTmuxConfigPath)}`]
        : []),
      "set-option -s escape-time 0",
      "set-option -g focus-events on",
      "set-option -g mouse on",
      "set-option -g destroy-unattached off",
      "set-option -g remain-on-exit off",
      `set-option -g default-terminal ${terminalName}`,
      ...(this.dependencies.tmux256Color
        ? ["set-option -as terminal-features ,xterm-256color:RGB"]
        : []),
      "",
    ].join("\n");
    await writeFile(this.tmuxConfigPath(), configuration, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.tmuxConfigPath(), 0o600);
  }

  private async hasSession(repositoryId: string): Promise<boolean> {
    if (!this.dependencies.tmuxPath) return false;
    const result = await this.commandRunner(
      this.tmuxArgs("has-session", "-t", this.sessionName(repositoryId)),
      { timeoutMs: COMMAND_TIMEOUT_MS },
    );
    return result.exitCode === 0;
  }

  private async hasTmuxServer(): Promise<boolean> {
    if (!this.dependencies.tmuxPath) return false;
    const result = await this.commandRunner(
      this.tmuxArgs("list-sessions"),
      { timeoutMs: COMMAND_TIMEOUT_MS },
    );
    return result.exitCode === 0;
  }

  async status(repositoryId: string): Promise<TerminalSessionStatus> {
    return {
      profileId: "tmux",
      running: await this.hasSession(repositoryId),
      controllerConnected: this.attachments.has(repositoryId),
    };
  }

  private async configureTmux(): Promise<void> {
    const commands: string[][] = [
      ["set-option", "-s", "escape-time", "0"],
      ["set-option", "-g", "focus-events", "on"],
      ["set-option", "-g", "mouse", "on"],
      ["set-option", "-g", "destroy-unattached", "off"],
      ["set-option", "-g", "remain-on-exit", "off"],
      [
        "set-option",
        "-g",
        "default-terminal",
        this.dependencies.tmux256Color ? "tmux-256color" : "screen-256color",
      ],
    ];
    if (this.dependencies.tmux256Color) {
      commands.push(["set-option", "-as", "terminal-features", ",xterm-256color:RGB"]);
    }
    for (const command of commands) {
      await this.commandRunner(this.tmuxArgs(...command), { timeoutMs: COMMAND_TIMEOUT_MS });
    }
  }

  private async configureExistingTmuxServer(): Promise<void> {
    if (this.serverConfigured) return;
    if (this.serverConfiguration) return this.serverConfiguration;
    const configuration = (async () => {
      if (this.userTmuxConfigPath) {
        const result = await this.commandRunner(
          this.tmuxArgs("source-file", this.userTmuxConfigPath),
          { timeoutMs: COMMAND_TIMEOUT_MS },
        );
        if (result.exitCode !== 0) {
          throw new HttpError(
            503,
            "terminal_config_failed",
            `The host tmux config could not load: ${cleanCommandError(result.stderr)}`,
          );
        }
      }
      await this.configureTmux();
      this.serverConfigured = true;
    })().finally(() => {
      if (this.serverConfiguration === configuration) this.serverConfiguration = null;
    });
    this.serverConfiguration = configuration;
    return configuration;
  }

  private async startSession(repositoryId: string, repositoryRoot: string): Promise<void> {
    await this.ensureRuntimeDirectory();
    const result = await this.commandRunner(
      this.tmuxArgs(
        "new-session",
        "-d",
        "-s",
        this.sessionName(repositoryId),
        "-c",
        repositoryRoot,
      ),
      { cwd: repositoryRoot, timeoutMs: COMMAND_TIMEOUT_MS },
    );
    if (result.exitCode !== 0) {
      throw new HttpError(
        503,
        "terminal_start_failed",
        `The tmux session could not start: ${cleanCommandError(result.stderr)}`,
      );
    }
    await this.configureTmux();
    this.serverConfigured = true;
  }

  private async ensureSession(repositoryId: string, repositoryRoot: string): Promise<void> {
    this.assertAvailable();
    const sessionRunning = await this.hasSession(repositoryId);
    if (sessionRunning || await this.hasTmuxServer()) {
      await this.configureExistingTmuxServer();
    }
    if (sessionRunning) return;
    const existing = this.starts.get(repositoryId);
    if (existing) return existing;
    const start = this.startSession(repositoryId, repositoryRoot).finally(() => {
      if (this.starts.get(repositoryId) === start) this.starts.delete(repositoryId);
    });
    this.starts.set(repositoryId, start);
    await start;
  }

  private cleanExpiredTickets(): void {
    const now = this.now();
    for (const [ticketHash, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(ticketHash);
    }
    while (this.tickets.size >= MAX_TICKETS) {
      const oldest = this.tickets.keys().next().value;
      if (!oldest) break;
      this.tickets.delete(oldest);
    }
  }

  private clearTickets(repositoryId: string): void {
    for (const [ticketHash, ticket] of this.tickets) {
      if (ticket.repositoryId === repositoryId) this.tickets.delete(ticketHash);
    }
  }

  async issueAttachment(
    repositoryId: string,
    repositoryRoot: string,
    request: TerminalAttachmentRequest,
    binding: { host: string; origin: string },
  ): Promise<TerminalAttachmentResponse> {
    this.assertAvailable();
    if (request.profileId !== "tmux") {
      throw new HttpError(400, "terminal_profile_invalid", "The requested terminal profile is unavailable");
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(request.clientId)) {
      throw new HttpError(400, "terminal_client_invalid", "Terminal client ID is invalid");
    }
    if (!validDimensions(request.cols, request.rows)) {
      throw new HttpError(400, "terminal_size_invalid", "Terminal dimensions are outside the supported range");
    }
    if (typeof request.takeover !== "boolean") {
      throw new HttpError(400, "terminal_takeover_invalid", "Terminal takeover mode is invalid");
    }
    const current = this.attachments.get(repositoryId);
    if (current && current.clientId !== request.clientId && !request.takeover) {
      throw new HttpError(409, "terminal_in_use", "The tmux terminal is controlled by another browser tab");
    }
    await this.ensureSession(repositoryId, repositoryRoot);
    this.cleanExpiredTickets();
    for (const [ticketHash, ticket] of this.tickets) {
      if (ticket.repositoryId === repositoryId && ticket.clientId === request.clientId) {
        this.tickets.delete(ticketHash);
      }
    }
    const ticket = this.tokenFactory();
    const expiresAt = this.now() + TICKET_LIFETIME_MS;
    this.tickets.set(hash(ticket), {
      kind: "terminal",
      repositoryId,
      repositoryRoot,
      clientId: request.clientId,
      profileId: "tmux",
      cols: request.cols,
      rows: request.rows,
      takeover: request.takeover,
      expiresAt,
      host: binding.host,
      origin: binding.origin,
    });
    return {
      ticket,
      expiresAt: new Date(expiresAt).toISOString(),
      protocol: TERMINAL_PROTOCOL,
      session: await this.status(repositoryId),
      ...(this.p2pEnabled
        ? { webRtc: {
            iceServers: this.stunUrls.map((urls) => ({ urls })),
            negotiationTimeoutMs: TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS,
            leaseRenewIntervalMs: TERMINAL_P2P_LEASE_RENEW_INTERVAL_MS,
          } }
        : {}),
    };
  }

  consumeUpgrade(
    repositoryId: string,
    request: Request,
    binding: { host: string; origin: string },
  ): TerminalSocketData {
    this.assertAvailable();
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!protocols.includes(TERMINAL_PROTOCOL)) {
      throw new HttpError(400, "terminal_protocol_invalid", "The terminal WebSocket protocol is unsupported");
    }
    const ticketProtocol = protocols.find((value) => value.startsWith(TERMINAL_TICKET_PREFIX));
    const rawTicket = ticketProtocol?.slice(TERMINAL_TICKET_PREFIX.length) ?? "";
    const ticketHash = rawTicket ? hash(rawTicket) : "";
    const ticket = this.tickets.get(ticketHash);
    if (ticketHash) this.tickets.delete(ticketHash);
    if (
      !ticket ||
      ticket.expiresAt <= this.now() ||
      ticket.repositoryId !== repositoryId ||
      ticket.host !== binding.host ||
      ticket.origin !== binding.origin
    ) {
      throw new HttpError(403, "terminal_ticket_invalid", "The terminal connection ticket is invalid or expired");
    }
    const { expiresAt: _expiresAt, ...data } = ticket;
    return data;
  }

  private sendJson(
    socket: Bun.ServerWebSocket<TerminalSocketData>,
    value: unknown,
  ): void {
    socket.sendText(JSON.stringify(value), false);
  }

  private sendDataChannelJson(channel: TerminalDataChannel, value: unknown): void {
    channel.send(JSON.stringify(value));
  }

  private disposeWebRtc(attachment: TerminalAttachment): void {
    const state = attachment.webRtc;
    attachment.webRtc = null;
    attachment.transport = "websocket";
    if (attachment.leaseTimer !== null) {
      this.clearTimer(attachment.leaseTimer);
      attachment.leaseTimer = null;
    }
    attachment.leaseExpiresAt = null;
    if (!state) return;
    if (state.negotiationTimer !== null) this.clearTimer(state.negotiationTimer);
    try {
      state.channel?.close();
    } catch {
      // A failed SCTP association may already have closed the channel.
    }
    void state.peer.close().catch(() => undefined);
  }

  private destroyAttachment(
    repositoryId: string,
    attachment: TerminalAttachment,
    closeSocket?: { code: number; reason: string },
  ): void {
    if (this.attachments.get(repositoryId) === attachment) {
      this.attachments.delete(repositoryId);
    }
    this.disposeWebRtc(attachment);
    if (closeSocket) attachment.socket.close(closeSocket.code, closeSocket.reason);
    try {
      attachment.terminal.close();
    } catch {
      // The PTY can already be closed after its exit callback.
    }
    try {
      attachment.process.kill();
    } catch {
      // The detached tmux client may already have exited.
    }
  }

  private sendWebSocketOutput(attachment: TerminalAttachment, bytes: Buffer<ArrayBuffer>): void {
    const sent = attachment.socket.sendBinary(bytes, false);
    if (sent === 0) {
      attachment.socket.close(1013, "terminal_backpressure");
    }
  }

  private failActiveP2p(repositoryId: string, attachment: TerminalAttachment, reason: string): void {
    if (this.attachments.get(repositoryId) !== attachment) return;
    this.destroyAttachment(repositoryId, attachment, {
      code: TERMINAL_P2P_FAILED_CLOSE_CODE,
      reason,
    });
  }

  private fallbackNegotiation(
    repositoryId: string,
    attachment: TerminalAttachment,
    message: string,
  ): void {
    if (this.attachments.get(repositoryId) !== attachment) return;
    const buffered = attachment.webRtc?.outputBuffer ?? [];
    this.disposeWebRtc(attachment);
    this.sendJson(attachment.socket, { type: "webrtc-unavailable", message });
    for (const bytes of buffered) this.sendWebSocketOutput(attachment, bytes);
  }

  private routeTerminalOutput(
    repositoryId: string,
    attachment: TerminalAttachment,
    source: Uint8Array<ArrayBufferLike>,
  ): void {
    if (this.attachments.get(repositoryId) !== attachment) return;
    const bytes = Buffer.from(source) as Buffer<ArrayBuffer>;
    if (attachment.transport === "websocket") {
      this.sendWebSocketOutput(attachment, bytes);
      return;
    }
    const state = attachment.webRtc;
    if (!state) {
      this.failActiveP2p(repositoryId, attachment, "terminal_p2p_state_lost");
      return;
    }
    if (attachment.transport === "switching") {
      if (state.outputBufferBytes + bytes.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES) {
        this.fallbackNegotiation(
          repositoryId,
          attachment,
          "The direct-path handoff exceeded its output buffer.",
        );
        return;
      }
      state.outputBuffer.push(bytes);
      state.outputBufferBytes += bytes.byteLength;
      return;
    }
    const channel = state.channel;
    if (
      !channel ||
      channel.readyState !== "open" ||
      channel.bufferedAmount + bytes.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES
    ) {
      this.failActiveP2p(repositoryId, attachment, "terminal_p2p_backpressure");
      return;
    }
    try {
      channel.send(bytes);
    } catch {
      this.failActiveP2p(repositoryId, attachment, "terminal_p2p_send_failed");
    }
  }

  private validDataChannel(channel: TerminalDataChannel): boolean {
    return channel.label === TERMINAL_DATA_CHANNEL_LABEL &&
      channel.protocol === TERMINAL_DATA_CHANNEL_PROTOCOL &&
      channel.ordered === true &&
      channel.maxRetransmits == null &&
      channel.maxPacketLifeTime == null;
  }

  private validateOffer(value: unknown): { type: "offer"; sdp: string } {
    if (!value || typeof value !== "object") {
      throw new Error("The WebRTC offer is missing.");
    }
    const offer = value as { type?: unknown; sdp?: unknown };
    if (offer.type !== "offer" || typeof offer.sdp !== "string") {
      throw new Error("The WebRTC offer is malformed.");
    }
    if (Buffer.byteLength(offer.sdp, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
      throw new Error("The WebRTC offer is too large.");
    }
    const mediaLines = offer.sdp.split(/\r?\n/).filter((line) => line.startsWith("m="));
    if (mediaLines.length !== 1 || !mediaLines[0]?.startsWith("m=application ")) {
      throw new Error("Only an application DataChannel is allowed.");
    }
    return { type: "offer", sdp: offer.sdp };
  }

  private scheduleLeaseExpiry(repositoryId: string, attachment: TerminalAttachment): void {
    if (attachment.leaseTimer !== null) this.clearTimer(attachment.leaseTimer);
    const expiresAt = attachment.leaseExpiresAt;
    if (expiresAt === null) return;
    attachment.leaseTimer = this.setTimer(() => {
      attachment.leaseTimer = null;
      if (this.attachments.get(repositoryId) !== attachment) return;
      if (attachment.leaseExpiresAt !== null && attachment.leaseExpiresAt > this.now()) {
        this.scheduleLeaseExpiry(repositoryId, attachment);
        return;
      }
      this.destroyAttachment(repositoryId, attachment, {
        code: TERMINAL_LEASE_EXPIRED_CLOSE_CODE,
        reason: "terminal_lease_expired",
      });
    }, Math.max(0, expiresAt - this.now()));
  }

  private activateWebRtc(repositoryId: string, attachment: TerminalAttachment): void {
    const state = attachment.webRtc;
    const channel = state?.channel;
    if (
      this.attachments.get(repositoryId) !== attachment ||
      attachment.transport !== "switching" ||
      !state ||
      !channel ||
      channel.readyState !== "open"
    ) {
      this.fallbackNegotiation(repositoryId, attachment, "The direct path was not ready.");
      return;
    }
    if (state.negotiationTimer !== null) {
      this.clearTimer(state.negotiationTimer);
      state.negotiationTimer = null;
    }
    attachment.transport = "webrtc";
    attachment.leaseExpiresAt = this.now() + TERMINAL_P2P_LEASE_TTL_MS;
    this.scheduleLeaseExpiry(repositoryId, attachment);
    try {
      this.sendDataChannelJson(channel, {
        type: "ready",
        transport: "webrtc",
        leaseExpiresAt: new Date(attachment.leaseExpiresAt).toISOString(),
      });
      for (const bytes of state.outputBuffer) {
        if (channel.bufferedAmount + bytes.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES) {
          throw new Error("terminal_p2p_backpressure");
        }
        channel.send(bytes);
      }
      state.outputBuffer = [];
      state.outputBufferBytes = 0;
    } catch {
      this.failActiveP2p(repositoryId, attachment, "terminal_p2p_handoff_failed");
    }
  }

  private handleTransportControl(
    repositoryId: string,
    attachment: TerminalAttachment,
    control: Record<string, unknown>,
    transport: "websocket" | "webrtc",
  ): boolean {
    if (control.type === "ping") {
      const { id } = control;
      if (!Number.isSafeInteger(id) || (id as number) < 1) return false;
      if (transport === "websocket") {
        this.sendJson(attachment.socket, { type: "pong", id });
      } else {
        const channel = attachment.webRtc?.channel;
        if (!channel) return false;
        this.sendDataChannelJson(channel, { type: "pong", id });
      }
      return true;
    }
    if (control.type !== "resize") return false;
    const { cols, rows } = control;
    if (typeof cols !== "number" || typeof rows !== "number" || !validDimensions(cols, rows)) {
      return false;
    }
    attachment.terminal.resize(cols, rows);
    return true;
  }

  private handleDataChannelMessage(
    repositoryId: string,
    attachment: TerminalAttachment,
    state: TerminalWebRtcState,
    message: string | Buffer<ArrayBufferLike>,
  ): void {
    if (
      this.attachments.get(repositoryId) !== attachment ||
      attachment.webRtc !== state ||
      attachment.transport !== "webrtc"
    ) return;
    if (typeof message !== "string") {
      if (message.byteLength > MAX_TERMINAL_TRANSPORT_BUFFER_BYTES) {
        this.failActiveP2p(repositoryId, attachment, "terminal_p2p_message_too_large");
        return;
      }
      attachment.terminal.write(message);
      return;
    }
    if (Buffer.byteLength(message, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
      this.failActiveP2p(repositoryId, attachment, "terminal_p2p_control_too_large");
      return;
    }
    try {
      const control = JSON.parse(message) as Record<string, unknown>;
      if (!control || typeof control !== "object" ||
        !this.handleTransportControl(repositoryId, attachment, control, "webrtc")) {
        throw new Error("invalid control");
      }
    } catch {
      this.failActiveP2p(repositoryId, attachment, "terminal_p2p_control_invalid");
    }
  }

  private acceptDataChannel(
    repositoryId: string,
    attachment: TerminalAttachment,
    state: TerminalWebRtcState,
    channel: TerminalDataChannel,
  ): void {
    if (
      this.attachments.get(repositoryId) !== attachment ||
      attachment.webRtc !== state ||
      state.channel
    ) {
      channel.close();
      return;
    }
    if (!this.validDataChannel(channel)) {
      channel.close();
      this.fallbackNegotiation(
        repositoryId,
        attachment,
        "The direct terminal channel did not match the required reliable protocol.",
      );
      return;
    }
    state.channel = channel;
    channel.onMessage.subscribe((message) => {
      this.handleDataChannelMessage(repositoryId, attachment, state, message);
    });
    channel.error.subscribe(() => {
      if (attachment.webRtc !== state) return;
      if (attachment.transport === "webrtc") {
        this.failActiveP2p(repositoryId, attachment, "terminal_p2p_channel_failed");
      } else {
        this.fallbackNegotiation(repositoryId, attachment, "The direct terminal channel failed.");
      }
    });
    const opened = () => {
      if (
        this.attachments.get(repositoryId) !== attachment ||
        attachment.webRtc !== state ||
        attachment.transport !== "websocket"
      ) return;
      attachment.transport = "switching";
      this.sendJson(attachment.socket, { type: "webrtc-switch" });
    };
    channel.stateChanged.subscribe((readyState) => {
      if (attachment.webRtc !== state) return;
      if (readyState === "open") {
        opened();
      } else if (readyState === "closed") {
        if (attachment.transport === "webrtc") {
          this.failActiveP2p(repositoryId, attachment, "terminal_p2p_channel_closed");
        } else {
          this.fallbackNegotiation(repositoryId, attachment, "The direct terminal channel closed.");
        }
      }
    });
    if (channel.readyState === "open") opened();
  }

  private async negotiateWebRtc(
    repositoryId: string,
    attachment: TerminalAttachment,
    rawOffer: unknown,
  ): Promise<void> {
    if (!this.p2pEnabled) {
      this.sendJson(attachment.socket, {
        type: "webrtc-unavailable",
        message: "Direct terminal transport is disabled on this server.",
      });
      return;
    }
    if (attachment.webRtc) {
      this.sendJson(attachment.socket, {
        type: "webrtc-unavailable",
        message: "A direct-path negotiation is already running.",
      });
      return;
    }
    let offer: { type: "offer"; sdp: string };
    try {
      offer = this.validateOffer(rawOffer);
    } catch (error) {
      this.sendJson(attachment.socket, {
        type: "webrtc-unavailable",
        message: (error as Error).message,
      });
      return;
    }
    let peer: TerminalPeerConnection;
    try {
      peer = this.peerConnectionFactory(this.stunUrls);
    } catch (error) {
      this.sendJson(attachment.socket, {
        type: "webrtc-unavailable",
        message: (error as Error).message,
      });
      return;
    }
    const state: TerminalWebRtcState = {
      peer,
      channel: null,
      negotiationTimer: null,
      outputBuffer: [],
      outputBufferBytes: 0,
    };
    attachment.webRtc = state;
    state.negotiationTimer = this.setTimer(() => {
      if (attachment.webRtc === state && attachment.transport !== "webrtc") {
        this.fallbackNegotiation(
          repositoryId,
          attachment,
          "No direct path was found within 10 seconds.",
        );
      }
    }, TERMINAL_P2P_NEGOTIATION_TIMEOUT_MS);
    peer.onDataChannel.subscribe((channel) => {
      this.acceptDataChannel(repositoryId, attachment, state, channel);
    });
    peer.connectionStateChange.subscribe((connectionState) => {
      if (attachment.webRtc !== state) return;
      if (connectionState !== "failed" && connectionState !== "closed" &&
        connectionState !== "disconnected") return;
      if (attachment.transport === "webrtc") {
        this.failActiveP2p(repositoryId, attachment, "terminal_p2p_connection_lost");
      } else if (attachment.webRtc === state) {
        this.fallbackNegotiation(repositoryId, attachment, "The direct path could not connect.");
      }
    });
    try {
      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (this.attachments.get(repositoryId) !== attachment || attachment.webRtc !== state) return;
      const localDescription = peer.localDescription;
      if (!localDescription || localDescription.type !== "answer") {
        throw new Error("The WebRTC answer could not be created.");
      }
      if (Buffer.byteLength(localDescription.sdp, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
        throw new Error("The WebRTC answer is too large.");
      }
      const answerControl = {
        type: "webrtc-answer",
        answer: localDescription,
      };
      if (Buffer.byteLength(JSON.stringify(answerControl), "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
        throw new Error("The WebRTC answer control message is too large.");
      }
      this.sendJson(attachment.socket, answerControl);
    } catch (error) {
      if (attachment.webRtc === state) {
        this.fallbackNegotiation(repositoryId, attachment, (error as Error).message);
      }
    }
  }

  private openSocket(socket: Bun.ServerWebSocket<TerminalSocketData>): void {
    socket.binaryType = "nodebuffer";
    const data = socket.data;
    const existing = this.attachments.get(data.repositoryId);
    if (existing && existing.clientId !== data.clientId && !data.takeover) {
      this.sendJson(socket, {
        type: "error",
        code: "terminal_in_use",
        message: "The tmux terminal is controlled by another browser tab",
        retryable: false,
      });
      socket.close(4003, "terminal_in_use");
      return;
    }
    if (existing) {
      this.destroyAttachment(data.repositoryId, existing, {
        code: 4001,
        reason: "taken_over",
      });
    }

    let terminal: Bun.Terminal | null = null;
    let subprocess: ReturnType<typeof Bun.spawn> | null = null;
    try {
      terminal = this.terminalFactory({
        cols: data.cols,
        rows: data.rows,
        name: "xterm-256color",
        data: (_pty, bytes) => {
          const current = this.attachments.get(data.repositoryId);
          if (current?.socket === socket) {
            this.routeTerminalOutput(data.repositoryId, current, bytes);
          }
        },
        exit: () => {
          const current = this.attachments.get(data.repositoryId);
          if (current?.socket === socket) socket.close(1000, "terminal_closed");
        },
      });
      terminal.setRawMode(true);
      subprocess = this.terminalSpawner(
        this.tmuxArgs(
          "attach-session",
          "-d",
          "-t",
          this.sessionName(data.repositoryId),
        ),
        {
          cwd: data.repositoryRoot,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
          terminal,
        },
      );
      const attachment: TerminalAttachment = {
        socket,
        terminal,
        process: subprocess,
        clientId: data.clientId,
        host: data.host,
        origin: data.origin,
        transport: "websocket",
        webRtc: null,
        leaseExpiresAt: null,
        leaseTimer: null,
      };
      this.attachments.set(data.repositoryId, attachment);
      void subprocess.exited.then((exitCode) => {
        const current = this.attachments.get(data.repositoryId);
        if (current !== attachment) return;
        this.sendJson(socket, { type: "exit", exitCode });
        this.destroyAttachment(data.repositoryId, attachment, {
          code: 1000,
          reason: "terminal_process_exited",
        });
      });
      this.sendJson(socket, {
        type: "ready",
        profileId: data.profileId,
        cols: data.cols,
        rows: data.rows,
      });
    } catch (error) {
      const current = this.attachments.get(data.repositoryId);
      if (current?.socket === socket) this.attachments.delete(data.repositoryId);
      try {
        terminal?.close();
      } catch {
        // A partially initialized PTY may already be closed.
      }
      try {
        subprocess?.kill();
      } catch {
        // A failed tmux client may already have exited.
      }
      try {
        this.sendJson(socket, {
          type: "error",
          code: "terminal_attach_failed",
          message: (error as Error).message,
          retryable: true,
        });
      } catch {
        // The WebSocket may have closed while the PTY was being initialized.
      }
      socket.close(1011, "terminal_attach_failed");
    }
  }

  private message(
    socket: Bun.ServerWebSocket<TerminalSocketData>,
    message: string | Buffer<ArrayBuffer>,
  ): void {
    const attachment = this.attachments.get(socket.data.repositoryId);
    if (!attachment || attachment.socket !== socket) return;
    if (typeof message !== "string") {
      if (attachment.transport !== "webrtc") attachment.terminal.write(message);
      return;
    }
    if (Buffer.byteLength(message, "utf8") > MAX_TERMINAL_CONTROL_BYTES) {
      if (message.includes("\"webrtc-offer\"")) {
        this.sendJson(socket, {
          type: "webrtc-unavailable",
          message: "The WebRTC offer is too large.",
        });
      } else {
        socket.close(1009, "terminal_control_too_large");
      }
      return;
    }
    let control: unknown;
    try {
      control = JSON.parse(message);
    } catch {
      socket.close(1003, "terminal_control_invalid");
      return;
    }
    if (!control || typeof control !== "object") {
      socket.close(1003, "terminal_control_invalid");
      return;
    }
    const typedControl = control as Record<string, unknown>;
    if (typedControl.type === "webrtc-offer") {
      void this.negotiateWebRtc(socket.data.repositoryId, attachment, typedControl.offer);
      return;
    }
    if (typedControl.type === "webrtc-activate") {
      this.activateWebRtc(socket.data.repositoryId, attachment);
      return;
    }
    if (
      attachment.transport === "webrtc" ||
      !this.handleTransportControl(socket.data.repositoryId, attachment, typedControl, "websocket")
    ) {
      socket.close(1003, "terminal_control_invalid");
    }
  }

  renewLease(
    repositoryId: string,
    request: TerminalLeaseRequest,
    binding: { host: string; origin: string },
  ): TerminalLeaseResponse {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(request.clientId)) {
      throw new HttpError(400, "terminal_client_invalid", "Terminal client ID is invalid");
    }
    const attachment = this.attachments.get(repositoryId);
    if (!attachment || attachment.transport !== "webrtc") {
      throw new HttpError(409, "terminal_p2p_inactive", "No direct terminal attachment is active");
    }
    if (
      attachment.clientId !== request.clientId ||
      attachment.host !== binding.host ||
      attachment.origin !== binding.origin
    ) {
      throw new HttpError(403, "terminal_lease_forbidden", "The terminal lease does not match this controller");
    }
    attachment.leaseExpiresAt = this.now() + TERMINAL_P2P_LEASE_TTL_MS;
    this.scheduleLeaseExpiry(repositoryId, attachment);
    return { expiresAt: new Date(attachment.leaseExpiresAt).toISOString() };
  }

  private closeSocket(socket: Bun.ServerWebSocket<TerminalSocketData>): void {
    const attachment = this.attachments.get(socket.data.repositoryId);
    if (!attachment || attachment.socket !== socket) return;
    this.destroyAttachment(socket.data.repositoryId, attachment);
  }

  private closeAttachment(repositoryId: string, code: number, reason: string): void {
    const attachment = this.attachments.get(repositoryId);
    if (!attachment) return;
    this.destroyAttachment(repositoryId, attachment, { code, reason });
  }

  async end(repositoryId: string): Promise<TerminalEndResponse> {
    if (this.closed) {
      throw new HttpError(503, "terminal_unavailable", "The terminal service is shutting down");
    }
    this.clearTickets(repositoryId);
    if (!(await this.hasSession(repositoryId))) {
      this.closeAttachment(repositoryId, TERMINAL_ENDED_CLOSE_CODE, "terminal_ended");
      return { status: "ended" };
    }
    const killed = await this.commandRunner(
      this.tmuxArgs("kill-session", "-t", this.sessionName(repositoryId)),
      { timeoutMs: COMMAND_TIMEOUT_MS },
    );
    if (killed.exitCode !== 0 && await this.hasSession(repositoryId)) {
      throw new HttpError(
        503,
        "terminal_end_failed",
        `The terminal session could not be ended: ${cleanCommandError(killed.stderr)}`,
      );
    }
    this.closeAttachment(repositoryId, TERMINAL_ENDED_CLOSE_CODE, "terminal_ended");
    return { status: "ended" };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tickets.clear();
    for (const repositoryId of [...this.attachments.keys()]) {
      this.closeAttachment(repositoryId, 1001, "server_restarting");
    }
  }
}
