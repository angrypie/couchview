import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  TERMINAL_ENDED_CLOSE_CODE,
  type TerminalAttachmentRequest,
  type TerminalAttachmentResponse,
  type TerminalCapability,
  type TerminalEndResponse,
  type TerminalRendererConfig,
  type TerminalSessionStatus,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { defaultTerminalRendererConfig } from "./terminalConfig.ts";

export const TERMINAL_PROTOCOL = "couchview-terminal-v1";
export const TERMINAL_TICKET_PREFIX = "couchview-ticket.";

const TICKET_LIFETIME_MS = 30_000;
const MAX_TICKETS = 256;
const COMMAND_TIMEOUT_MS = 5_000;

export interface TerminalSocketData {
  kind: "terminal";
  repositoryId: string;
  repositoryRoot: string;
  clientId: string;
  profileId: "tmux";
  cols: number;
  rows: number;
  takeover: boolean;
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
  host: string;
  origin: string;
}

interface TerminalAttachment {
  socket: Bun.ServerWebSocket<TerminalSocketData>;
  terminal: Bun.Terminal;
  process: ReturnType<typeof Bun.spawn>;
  clientId: string;
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
  rendererConfig?: TerminalRendererConfig;
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
  renderer: TerminalRendererConfig,
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
    renderer,
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
  private serverConfiguration: Promise<void> | null = null;
  private serverConfigured = false;
  private closed = false;

  constructor(options: TerminalSessionServiceOptions) {
    this.enabled = options.enabled;
    this.dependencies = options.dependencies ?? probeDependencies();
    this.capability = capabilityFor(
      options.enabled,
      options.disabledReason,
      this.dependencies,
      options.rendererConfig ?? defaultTerminalRendererConfig(),
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
    const { expiresAt: _expiresAt, host: _host, origin: _origin, ...data } = ticket;
    return data;
  }

  private sendJson(
    socket: Bun.ServerWebSocket<TerminalSocketData>,
    value: unknown,
  ): void {
    socket.sendText(JSON.stringify(value), false);
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
      existing.socket.close(4001, "taken_over");
      existing.terminal.close();
      try {
        existing.process.kill();
      } catch {
        // The detached tmux client may already have exited.
      }
      this.attachments.delete(data.repositoryId);
    }

    let terminal: Bun.Terminal | null = null;
    let subprocess: ReturnType<typeof Bun.spawn> | null = null;
    try {
      terminal = this.terminalFactory({
        cols: data.cols,
        rows: data.rows,
        name: "xterm-256color",
        data: (_pty, bytes) => {
          const sent = socket.sendBinary(bytes, false);
          if (sent === 0) socket.close(1013, "terminal_backpressure");
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
      };
      this.attachments.set(data.repositoryId, attachment);
      void subprocess.exited.then((exitCode) => {
        const current = this.attachments.get(data.repositoryId);
        if (current !== attachment) return;
        this.attachments.delete(data.repositoryId);
        this.sendJson(socket, { type: "exit", exitCode });
        socket.close(1000, "terminal_process_exited");
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
      attachment.terminal.write(message);
      return;
    }
    if (message.length > 4_096) {
      socket.close(1009, "terminal_control_too_large");
      return;
    }
    let control: unknown;
    try {
      control = JSON.parse(message);
    } catch {
      socket.close(1003, "terminal_control_invalid");
      return;
    }
    if (
      !control ||
      typeof control !== "object" ||
      (control as { type?: unknown }).type !== "resize"
    ) {
      socket.close(1003, "terminal_control_invalid");
      return;
    }
    const { cols, rows } = control as { cols: number; rows: number };
    if (!validDimensions(cols, rows)) {
      socket.close(1008, "terminal_size_invalid");
      return;
    }
    attachment.terminal.resize(cols, rows);
  }

  private closeSocket(socket: Bun.ServerWebSocket<TerminalSocketData>): void {
    const attachment = this.attachments.get(socket.data.repositoryId);
    if (!attachment || attachment.socket !== socket) return;
    this.attachments.delete(socket.data.repositoryId);
    attachment.terminal.close();
    try {
      attachment.process.kill();
    } catch {
      // The tmux client may already have exited.
    }
  }

  private closeAttachment(repositoryId: string, code: number, reason: string): void {
    const attachment = this.attachments.get(repositoryId);
    if (!attachment) return;
    this.attachments.delete(repositoryId);
    attachment.socket.close(code, reason);
    attachment.terminal.close();
    try {
      attachment.process.kill();
    } catch {
      // The tmux client may already have exited.
    }
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
