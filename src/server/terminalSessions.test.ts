import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  TERMINAL_ENDED_CLOSE_CODE,
} from "../shared/contracts.ts";
import {
  isLoopbackHostname,
  TERMINAL_PROTOCOL,
  TERMINAL_TICKET_PREFIX,
  terminalAccessIsLoopback,
  TerminalSessionService,
  type TerminalCommandRunner,
  type TerminalSocketData,
} from "./terminalSessions.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

interface CommandHarness {
  commands: string[][];
  runner: TerminalCommandRunner;
  serverRunning: boolean;
  sessionRunning: boolean;
}

function commandHarness(initialSession = false, initialServer = initialSession): CommandHarness {
  const harness: CommandHarness = {
    commands: [],
    serverRunning: initialServer,
    sessionRunning: initialSession,
    async runner(argv) {
      const command = [...argv];
      harness.commands.push(command);
      if (command.includes("has-session")) {
        return { exitCode: harness.sessionRunning ? 0 : 1, stdout: "", stderr: "" };
      }
      if (command.includes("list-sessions")) {
        return { exitCode: harness.serverRunning ? 0 : 1, stdout: "", stderr: "" };
      }
      if (command.includes("new-session")) {
        harness.serverRunning = true;
        harness.sessionRunning = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command.includes("kill-session")) {
        harness.serverRunning = false;
        harness.sessionRunning = false;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  return harness;
}

async function serviceFixture(
  harness: CommandHarness,
  options: {
    enabled?: boolean;
    now?: () => number;
    tokenFactory?: () => string;
    userTmuxConfig?: string;
    withPty?: boolean;
  } = {},
) {
  const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "couchview-terminal-"));
  temporaryDirectories.push(runtimeDirectory);
  const userTmuxConfigPath = options.userTmuxConfig
    ? path.join(runtimeDirectory, "user-tmux.conf")
    : null;
  if (userTmuxConfigPath) await writeFile(userTmuxConfigPath, options.userTmuxConfig!, "utf8");
  let terminalClosed = 0;
  let processKilled = 0;
  const terminal = {
    close() {
      terminalClosed += 1;
    },
    resize() {},
    setRawMode() {},
    write() {},
  } as unknown as Bun.Terminal;
  const process = {
    exited: new Promise<number>(() => undefined),
    kill() {
      processKilled += 1;
    },
  } as unknown as ReturnType<typeof Bun.spawn>;
  const service = new TerminalSessionService({
    enabled: options.enabled ?? true,
    namespaceSeed: "terminal-session-tests",
    runtimeDirectory,
    dependencies: {
      terminalAvailable: true,
      tmuxPath: "/fake/tmux",
      tmux256Color: true,
    },
    commandRunner: harness.runner,
    now: options.now,
    tokenFactory: options.tokenFactory,
    userTmuxConfigPath,
    ...(options.withPty
      ? {
          terminalFactory: () => terminal,
          terminalSpawner: () => process,
        }
      : {}),
  });
  return {
    processKilled: () => processKilled,
    runtimeDirectory,
    service,
    terminalClosed: () => terminalClosed,
  };
}

function attachmentRequest(clientId = "client_12345678") {
  return {
    clientId,
    profileId: "tmux" as const,
    cols: 100,
    rows: 32,
    takeover: false,
  };
}

function upgradeRequest(ticket: string): Request {
  return new Request("http://127.0.0.1:4173/api/repositories/repo/terminal/socket", {
    headers: {
      host: "127.0.0.1:4173",
      origin: "http://127.0.0.1:4173",
      "sec-websocket-protocol": `${TERMINAL_PROTOCOL}, ${TERMINAL_TICKET_PREFIX}${ticket}`,
      upgrade: "websocket",
    },
  });
}

function fakeSocket(data: TerminalSocketData) {
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  return {
    binaryType: "arraybuffer",
    closes,
    data,
    sendBinary() {
      return 1;
    },
    sendText(value: string) {
      sent.push(value);
      return 1;
    },
    close(code?: number, reason?: string) {
      closes.push({ code, reason });
    },
    sent,
  } as unknown as Bun.ServerWebSocket<TerminalSocketData> & {
    closes: Array<{ code?: number; reason?: string }>;
    sent: string[];
  };
}

describe("terminal network policy", () => {
  test("recognizes only loopback bind hosts and origins", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.42.0.9")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("192.168.1.10")).toBe(false);
    expect(terminalAccessIsLoopback("127.0.0.1", [
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ])).toBe(true);
    expect(terminalAccessIsLoopback("127.0.0.1", ["http://192.168.1.10:4173"])).toBe(false);
    expect(terminalAccessIsLoopback("0.0.0.0", [])).toBe(false);
  });

  test("reports dependency and explicit-policy failures", async () => {
    const harness = commandHarness();
    const disabled = await serviceFixture(harness, { enabled: false });
    expect(disabled.service.capability).toMatchObject({
      available: false,
      persistence: "tmux",
    });
    expect(disabled.service.capability.reason).toContain("disabled");

    const missing = new TerminalSessionService({
      enabled: true,
      namespaceSeed: "missing-dependencies",
      dependencies: {
        terminalAvailable: true,
        tmuxPath: null,
        tmux256Color: false,
      },
    });
    expect(missing.capability.reason).toContain("Install tmux");
    missing.close();
  });
});

describe("persistent tmux sessions", () => {
  test("rejects malformed takeover requests before starting tmux", async () => {
    const harness = commandHarness();
    const { service } = await serviceFixture(harness);
    await expect(service.issueAttachment(
      "repo",
      "/project",
      {
        ...attachmentRequest(),
        takeover: "yes" as unknown as boolean,
      },
      { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
    )).rejects.toMatchObject({
      status: 400,
      code: "terminal_takeover_invalid",
    });
    expect(harness.commands.some((command) => command.includes("new-session"))).toBe(false);
    service.close();
  });

  test("starts one raw tmux session and sources the local config before required overrides", async () => {
    const harness = commandHarness();
    let token = 0;
    const { runtimeDirectory, service } = await serviceFixture(harness, {
      tokenFactory: () => `ticket-${++token}`,
      userTmuxConfig: "set -g default-shell /opt/homebrew/bin/fish\nset -g mouse off\n",
    });

    await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
    );
    await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
    );

    expect(harness.commands.filter((command) => command.includes("new-session"))).toHaveLength(1);
    const newSession = harness.commands.find((command) => command.includes("new-session"));
    expect(newSession).toEqual(
      expect.arrayContaining([
        "/fake/tmux",
        "-f",
        path.join(runtimeDirectory, "tmux.conf"),
        "-L",
      ]),
    );
    expect(newSession?.slice(-6)).toEqual([
      "new-session",
      "-d",
      "-s",
      expect.stringMatching(/^nvim-/),
      "-c",
      "/project",
    ]);
    const tmuxConfiguration = await readFile(
      path.join(runtimeDirectory, "tmux.conf"),
      "utf8",
    );
    expect(tmuxConfiguration.indexOf("source-file")).toBeLessThan(
      tmuxConfiguration.indexOf("mouse on"),
    );
    expect(tmuxConfiguration).toContain("user-tmux.conf");
    expect(tmuxConfiguration).toContain("escape-time 0");
    expect(tmuxConfiguration).toContain("focus-events on");
    expect(tmuxConfiguration).toContain("mouse on");
    expect(tmuxConfiguration).toContain("default-terminal tmux-256color");
    expect(tmuxConfiguration).toContain("xterm-256color:RGB");
    expect((await stat(path.join(runtimeDirectory, "tmux.conf"))).mode & 0o777).toBe(0o600);
    expect(harness.commands.flat()).not.toContain("/fake/nvim");
    expect(await service.status("repo")).toEqual({
      profileId: "tmux",
      running: true,
      controllerConnected: false,
    });
    service.close();
    expect(harness.sessionRunning).toBe(true);
  });

  test("loads the host config into a preserved tmux server before applying overrides", async () => {
    const harness = commandHarness(true);
    const { runtimeDirectory, service } = await serviceFixture(harness, {
      userTmuxConfig: "set -g status-style bg=blue\n",
    });

    await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
    );
    await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" },
    );

    expect(harness.commands.some((command) => command.includes("new-session"))).toBe(false);
    const sourceIndexes = harness.commands.flatMap((command, index) =>
      command.includes("source-file") ? [index] : []
    );
    expect(sourceIndexes).toHaveLength(1);
    expect(harness.commands[sourceIndexes[0]!]?.at(-1)).toBe(
      path.join(runtimeDirectory, "user-tmux.conf"),
    );
    const mouseOverrideIndex = harness.commands.findIndex((command) =>
      command.includes("set-option") && command.includes("mouse") && command.includes("on")
    );
    expect(sourceIndexes[0]!).toBeLessThan(mouseOverrideIndex);
    service.close();
    expect(harness.sessionRunning).toBe(true);
  });

  test("binds short-lived tickets to repository, host, and origin and consumes them once", async () => {
    const harness = commandHarness();
    let now = 1_000;
    let token = 0;
    const { service } = await serviceFixture(harness, {
      now: () => now,
      tokenFactory: () => `ticket-${++token}`,
    });
    const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
    const issued = await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      binding,
    );
    expect(service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding)).toMatchObject({
      repositoryId: "repo",
      clientId: "client_12345678",
      cols: 100,
      rows: 32,
    });
    expect(() => service.consumeUpgrade("repo", upgradeRequest(issued.ticket), binding)).toThrow(
      expect.objectContaining({ code: "terminal_ticket_invalid" }),
    );

    const wrongBinding = await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      binding,
    );
    expect(() => service.consumeUpgrade("repo", upgradeRequest(wrongBinding.ticket), {
      ...binding,
      origin: "http://localhost:4173",
    })).toThrow(expect.objectContaining({ code: "terminal_ticket_invalid" }));

    const expired = await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      binding,
    );
    now += 30_001;
    expect(() => service.consumeUpgrade("repo", upgradeRequest(expired.ticket), binding)).toThrow(
      expect.objectContaining({ code: "terminal_ticket_invalid" }),
    );
    service.close();
  });

  test("enforces one controller and explicit takeover while leaving tmux alive", async () => {
    const harness = commandHarness();
    let token = 0;
    const fixture = await serviceFixture(harness, {
      tokenFactory: () => `ticket-${++token}`,
      withPty: true,
    });
    const { service } = fixture;
    const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
    const first = await service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest("first_client"),
      binding,
    );
    const firstSocket = fakeSocket(
      service.consumeUpgrade("repo", upgradeRequest(first.ticket), binding),
    );
    service.websocket.open!(firstSocket);
    expect(firstSocket.sent.map((value) => JSON.parse(value))).toContainEqual(
      expect.objectContaining({ type: "ready" }),
    );

    await expect(service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest("second_client"),
      binding,
    )).rejects.toMatchObject({ status: 409, code: "terminal_in_use" });

    const takeover = await service.issueAttachment(
      "repo",
      "/project",
      { ...attachmentRequest("second_client"), takeover: true },
      binding,
    );
    const secondSocket = fakeSocket(
      service.consumeUpgrade("repo", upgradeRequest(takeover.ticket), binding),
    );
    service.websocket.open!(secondSocket);
    expect(firstSocket.closes).toContainEqual({ code: 4001, reason: "taken_over" });
    expect(await service.status("repo")).toMatchObject({ controllerConnected: true });

    service.close();
    expect(fixture.processKilled()).toBeGreaterThan(0);
    expect(fixture.terminalClosed()).toBeGreaterThan(0);
    expect(harness.commands.some((command) => command.includes("kill-session"))).toBe(false);
    expect(harness.sessionRunning).toBe(true);
  });

  test("ends running sessions directly even when terminal access is now disabled", async () => {
    const harness = commandHarness(true);
    const enabled = await serviceFixture(harness);
    expect(await enabled.service.end("repo")).toEqual({ status: "ended" });
    expect(harness.sessionRunning).toBe(false);
    expect(harness.commands.some((command) => command.includes("kill-session"))).toBe(true);
    enabled.service.close();

    const disabledHarness = commandHarness(true);
    const disabled = await serviceFixture(disabledHarness, { enabled: false });
    expect(await disabled.service.status("repo")).toMatchObject({ running: true });
    expect(await disabled.service.end("repo")).toEqual({ status: "ended" });
    expect(disabledHarness.sessionRunning).toBe(false);
    disabled.service.close();
  });

  test("closes controllers and invalidates pending tickets when a session ends", async () => {
    const harness = commandHarness(true);
    let token = 0;
    const fixture = await serviceFixture(harness, {
      tokenFactory: () => `ticket-${++token}`,
      withPty: true,
    });
    const binding = { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" };
    const first = await fixture.service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      binding,
    );
    const socket = fakeSocket(
      fixture.service.consumeUpgrade("repo", upgradeRequest(first.ticket), binding),
    );
    fixture.service.websocket.open!(socket);
    const pending = await fixture.service.issueAttachment(
      "repo",
      "/project",
      attachmentRequest(),
      binding,
    );

    await fixture.service.end("repo");

    expect(socket.closes).toContainEqual({
      code: TERMINAL_ENDED_CLOSE_CODE,
      reason: "terminal_ended",
    });
    expect(() => fixture.service.consumeUpgrade(
      "repo",
      upgradeRequest(pending.ticket),
      binding,
    )).toThrow(expect.objectContaining({ code: "terminal_ticket_invalid" }));
    expect(harness.sessionRunning).toBe(false);
    fixture.service.close();
  });
});
