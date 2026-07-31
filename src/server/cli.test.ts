import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  parseCli,
  parseTerminalStunUrls,
  replaceStaticBuild,
  restartCapability,
  restartRunningServer,
  runCli,
  SUPERVISOR_RESTART_EXIT_CODE,
  startServer,
  superviseServer,
} from "./cli.ts";
import {
  CLI_VERSION,
  CliPromptInterrupted,
  type CompletionShell,
  type InteractivePrompter,
} from "./cliCommand.ts";
import { createCouchviewApp, type CouchviewApp } from "./server.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";

const initialRoot = Bun.env.COUCHVIEW_ROOT;
const initialHost = Bun.env.COUCHVIEW_HOST;
const initialLegacyRoot = Bun.env.COUCH_REVIEW_ROOT;
const initialLegacyHost = Bun.env.COUCH_REVIEW_HOST;
const initialPort = Bun.env.PORT;
const initialTerminal = Bun.env.COUCHVIEW_TERMINAL;
const initialTerminalP2p = Bun.env.COUCHVIEW_TERMINAL_P2P;
const initialTerminalStun = Bun.env.COUCHVIEW_TERMINAL_STUN;
const initialRemoteBridge = Bun.env.COUCHVIEW_REMOTE_BRIDGE;
const initialRemoteBridgeP2p = Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
const initialRemoteBridgeStun = Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
const initialRemoteBridgePort = Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
const initialRemoteBridgeOriginAccess = Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
const initialDataHome = Bun.env.XDG_DATA_HOME;
const initialAllowedOrigins = Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
const initialInternalAllowedOrigins = Bun.env.ALLOWED_ORIGINS;
const initialDisableReuse = Bun.env.COUCHVIEW_DISABLE_REUSE;
const initialLegacyDisableReuse = Bun.env.COUCH_REVIEW_DISABLE_REUSE;

function restoreEnvironment() {
  if (initialRoot === undefined) delete Bun.env.COUCHVIEW_ROOT;
  else Bun.env.COUCHVIEW_ROOT = initialRoot;

  if (initialHost === undefined) delete Bun.env.COUCHVIEW_HOST;
  else Bun.env.COUCHVIEW_HOST = initialHost;

  if (initialLegacyRoot === undefined) delete Bun.env.COUCH_REVIEW_ROOT;
  else Bun.env.COUCH_REVIEW_ROOT = initialLegacyRoot;

  if (initialLegacyHost === undefined) delete Bun.env.COUCH_REVIEW_HOST;
  else Bun.env.COUCH_REVIEW_HOST = initialLegacyHost;

  if (initialPort === undefined) delete Bun.env.PORT;
  else Bun.env.PORT = initialPort;

  if (initialTerminal === undefined) delete Bun.env.COUCHVIEW_TERMINAL;
  else Bun.env.COUCHVIEW_TERMINAL = initialTerminal;

  if (initialTerminalP2p === undefined) delete Bun.env.COUCHVIEW_TERMINAL_P2P;
  else Bun.env.COUCHVIEW_TERMINAL_P2P = initialTerminalP2p;

  if (initialTerminalStun === undefined) delete Bun.env.COUCHVIEW_TERMINAL_STUN;
  else Bun.env.COUCHVIEW_TERMINAL_STUN = initialTerminalStun;

  if (initialRemoteBridge === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE;
  else Bun.env.COUCHVIEW_REMOTE_BRIDGE = initialRemoteBridge;

  if (initialRemoteBridgeP2p === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
  else Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P = initialRemoteBridgeP2p;

  if (initialRemoteBridgeStun === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
  else Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN = initialRemoteBridgeStun;

  if (initialRemoteBridgePort === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
  else Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT = initialRemoteBridgePort;

  if (initialRemoteBridgeOriginAccess === undefined) {
    delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
  } else {
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS = initialRemoteBridgeOriginAccess;
  }

  if (initialDataHome === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = initialDataHome;

  if (initialAllowedOrigins === undefined) {
    delete Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
  } else {
    Bun.env.COUCHVIEW_ALLOWED_ORIGINS = initialAllowedOrigins;
  }

  if (initialInternalAllowedOrigins === undefined) {
    delete Bun.env.ALLOWED_ORIGINS;
  } else {
    Bun.env.ALLOWED_ORIGINS = initialInternalAllowedOrigins;
  }

  if (initialDisableReuse === undefined) delete Bun.env.COUCHVIEW_DISABLE_REUSE;
  else Bun.env.COUCHVIEW_DISABLE_REUSE = initialDisableReuse;

  if (initialLegacyDisableReuse === undefined) {
    delete Bun.env.COUCH_REVIEW_DISABLE_REUSE;
  } else {
    Bun.env.COUCH_REVIEW_DISABLE_REUSE = initialLegacyDisableReuse;
  }
}

describe("parseCli", () => {
  beforeEach(() => {
    delete Bun.env.COUCHVIEW_ROOT;
    delete Bun.env.COUCHVIEW_HOST;
    delete Bun.env.COUCH_REVIEW_ROOT;
    delete Bun.env.COUCH_REVIEW_HOST;
    delete Bun.env.PORT;
    delete Bun.env.COUCHVIEW_TERMINAL;
    delete Bun.env.COUCHVIEW_TERMINAL_P2P;
    delete Bun.env.COUCHVIEW_TERMINAL_STUN;
    delete Bun.env.COUCHVIEW_REMOTE_BRIDGE;
    delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
    delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
    delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
    delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
  });

  afterEach(restoreEnvironment);

  test("defaults to the launch directory, loopback, and production port", () => {
    expect(parseCli([])).toEqual({
      root: path.resolve(process.cwd()),
      host: "127.0.0.1",
      port: 4173,
      terminalMode: "auto",
      terminalP2pMode: "auto",
      terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgeMode: "auto",
      remoteBridgeP2pMode: "auto",
      remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgePort: 22,
      remoteBridgeOriginAccess: "auto",
    });
  });

  test("requires repository paths to use --repo", () => {
    expect(() => parseCli(["fixtures/example"])).toThrow(
      "Repository paths must follow the 'serve' command or '--repo'",
    );
  });

  test("accepts --repo and --port in either order", () => {
    expect(parseCli(["--repo", "../project", "--port", "5199"])).toEqual({
      root: path.resolve("../project"),
      host: "127.0.0.1",
      port: 5199,
      terminalMode: "auto",
      terminalP2pMode: "auto",
      terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgeMode: "auto",
      remoteBridgeP2pMode: "auto",
      remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgePort: 22,
      remoteBridgeOriginAccess: "auto",
    });
    expect(parseCli(["--port", "6001", "--repo", "/tmp/project"])).toEqual({
      root: path.resolve("/tmp/project"),
      host: "127.0.0.1",
      port: 6001,
      terminalMode: "auto",
      terminalP2pMode: "auto",
      terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgeMode: "auto",
      remoteBridgeP2pMode: "auto",
      remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgePort: 22,
      remoteBridgeOriginAccess: "auto",
    });
  });

  test("uses environment defaults while command-line flags take precedence", () => {
    Bun.env.COUCHVIEW_ROOT = "environment-project";
    Bun.env.COUCHVIEW_HOST = "192.168.1.25";
    Bun.env.PORT = "4888";

    expect(parseCli([])).toEqual({
      root: path.resolve("environment-project"),
      host: "192.168.1.25",
      port: 4888,
      terminalMode: "auto",
      terminalP2pMode: "auto",
      terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgeMode: "auto",
      remoteBridgeP2pMode: "auto",
      remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgePort: 22,
      remoteBridgeOriginAccess: "auto",
    });
    expect(parseCli(["--repo", "flag-project", "--host", "0.0.0.0", "--port", "4999"])).toEqual({
      root: path.resolve("flag-project"),
      host: "0.0.0.0",
      port: 4999,
      terminalMode: "auto",
      terminalP2pMode: "auto",
      terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgeMode: "auto",
      remoteBridgeP2pMode: "auto",
      remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgePort: 22,
      remoteBridgeOriginAccess: "auto",
    });
  });

  test("accepts pre-rename environment defaults when new names are absent", () => {
    Bun.env.COUCH_REVIEW_ROOT = "legacy-environment-project";
    Bun.env.COUCH_REVIEW_HOST = "127.0.0.1";

    expect(parseCli([])).toEqual({
      root: path.resolve("legacy-environment-project"),
      host: "127.0.0.1",
      port: 4173,
      terminalMode: "auto",
      terminalP2pMode: "auto",
      terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgeMode: "auto",
      remoteBridgeP2pMode: "auto",
      remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
      remoteBridgePort: 22,
      remoteBridgeOriginAccess: "auto",
    });
  });

  test("accepts IPv4, IPv6, and hostname bind values", () => {
    expect(parseCli(["--host", "0.0.0.0"]).host).toBe("0.0.0.0");
    expect(parseCli(["--host", "[::]"]).host).toBe("::");
    expect(parseCli(["--host", "My-Mac.local"]).host).toBe("my-mac.local");
  });

  test("rejects unknown options and the former --root alias", () => {
    expect(() => parseCli(["--watch"])).toThrow("Unknown option: --watch");
    expect(() => parseCli(["--root", "/tmp/project"])).toThrow(
      "Unknown option: --root",
    );
  });

  test("requires values for --repo, --host, and --port", () => {
    expect(() => parseCli(["--repo"])).toThrow("Repository path is required");
    expect(() => parseCli(["--repo", "--port", "5000"])).toThrow(
      "Repository path is required",
    );
    expect(() => parseCli(["--port"])).toThrow(
      "Port must be between 1 and 65535",
    );
    expect(() => parseCli(["--host"])).toThrow("Host is required");
    expect(() => parseCli(["--host", "--port", "5000"])).toThrow("Host is required");
  });

  test.each(["http://0.0.0.0", "127.0.0.1:4173", "bad host", "-invalid.local"])(
    "rejects invalid host %s",
    (host) => {
      expect(() => parseCli(["--host", host])).toThrow(
        "Host must be an IP address or hostname",
      );
    },
  );

  test("rejects positional and competing repository arguments", () => {
    expect(() => parseCli(["one", "two"])).toThrow(
      "Repository paths must follow the 'serve' command or '--repo'",
    );
    expect(() => parseCli(["--repo", "one", "two"])).toThrow(
      "Repository path may only be provided once",
    );
  });

  test.each(["0", "-1", "1.5", "65536", "nope"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => parseCli(["--port", port])).toThrow(
        "Port must be between 1 and 65535",
      );
    },
  );

  test.each(["1", "65535"])("accepts boundary port %s", (port) => {
    expect(parseCli(["--port", port]).port).toBe(Number(port));
  });

  test("parses explicit terminal policy with command-line precedence", () => {
    Bun.env.COUCHVIEW_TERMINAL = "1";
    expect(parseCli([]).terminalMode).toBe("enabled");
    expect(parseCli(["--disable-terminal"]).terminalMode).toBe("disabled");

    Bun.env.COUCHVIEW_TERMINAL = "0";
    expect(parseCli([]).terminalMode).toBe("disabled");
    expect(parseCli(["--enable-terminal"]).terminalMode).toBe("enabled");
    expect(() => parseCli(["--enable-terminal", "--disable-terminal"])).toThrow(
      "cannot be used together",
    );

    Bun.env.COUCHVIEW_TERMINAL = "sometimes";
    expect(() => parseCli([])).toThrow("COUCHVIEW_TERMINAL must be 1 or 0");
  });

  test("keeps terminal P2P opt-in and gives flags precedence over the environment", () => {
    expect(parseCli([]).terminalP2pMode).toBe("auto");
    Bun.env.COUCHVIEW_TERMINAL_P2P = "1";
    expect(parseCli([]).terminalP2pMode).toBe("enabled");
    expect(parseCli(["--disable-terminal-p2p"]).terminalP2pMode).toBe("disabled");
    Bun.env.COUCHVIEW_TERMINAL_P2P = "0";
    expect(parseCli(["--enable-terminal-p2p"]).terminalP2pMode).toBe("enabled");
    expect(() => parseCli([
      "--enable-terminal-p2p",
      "--disable-terminal-p2p",
    ])).toThrow("cannot be used together");
    Bun.env.COUCHVIEW_TERMINAL_P2P = "sometimes";
    expect(() => parseCli([])).toThrow("COUCHVIEW_TERMINAL_P2P must be 1 or 0");
  });

  test("keeps the native bridge and its direct transport explicit", () => {
    expect(parseCli([])).toMatchObject({
      remoteBridgeMode: "auto",
      remoteBridgeP2pMode: "auto",
      remoteBridgePort: 22,
      remoteBridgeOriginAccess: "auto",
    });
    Bun.env.COUCHVIEW_REMOTE_BRIDGE = "1";
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P = "1";
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT = "2222";
    expect(parseCli([])).toMatchObject({
      remoteBridgeMode: "enabled",
      remoteBridgeP2pMode: "enabled",
      remoteBridgePort: 2222,
    });
    expect(parseCli([
      "--disable-remote-bridge",
      "--disable-remote-bridge-p2p",
      "--remote-bridge-origin-access",
      "private-relay",
    ])).toMatchObject({
      remoteBridgeMode: "disabled",
      remoteBridgeP2pMode: "disabled",
      remoteBridgeOriginAccess: "private-relay",
    });
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS = "custom-gateway";
    expect(parseCli([]).remoteBridgeOriginAccess).toBe("custom-gateway");
    expect(() => parseCli([
      "--remote-bridge-origin-access",
      "Invalid_Provider",
    ])).toThrow("lowercase letters");
    Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT = "70000";
    expect(() => parseCli([])).toThrow("COUCHVIEW_REMOTE_BRIDGE_PORT");
  });

  test("validates one to four STUN-only URLs", () => {
    expect(parseTerminalStunUrls(undefined)).toEqual([
      "stun:stun.cloudflare.com:3478",
    ]);
    expect(parseTerminalStunUrls(
      "stun:one.example, stun:two.example:5349, stun:[2001:db8::1]:3478",
    )).toEqual([
      "stun:one.example",
      "stun:two.example:5349",
      "stun:[2001:db8::1]:3478",
    ]);
    for (const invalid of [
      "",
      "turn:relay.example:3478",
      "https://stun.example",
      "stun:bad host",
      "stun:-invalid.example",
      "stun:invalid..example",
      "stun:one.example,,stun:two.example",
      "stun:example.com:0",
      "stun:example.com:65536",
      "stun:a,stun:b,stun:c,stun:d,stun:e",
    ]) {
      expect(() => parseTerminalStunUrls(invalid)).toThrow();
    }
  });
});

describe("CLI entrypoint", () => {
  function entrypointRuntime(prompter?: InteractivePrompter) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const supervised: string[][] = [];
    const started: string[][] = [];
    const restarted: string[][] = [];
    const installed: CompletionShell[] = [];
    const bridgePairs: Array<{ origin: string; code: string; originAccess: string }> = [];
    const bridgeProxies: string[] = [];
    const bridgeCodex: Array<{
      profileSelector: string | null;
      repositoryRoot: string | null;
      codexArgs: string[];
    }> = [];
    const bridgeTerminals: Array<{
      profileSelector: string | null;
      repositoryRoot: string | null;
    }> = [];
    const bridgeClaude: Array<{
      profileSelector: string | null;
      repositoryRoot: string | null;
      claudeArgs: string[];
    }> = [];
    return {
      stdout,
      stderr,
      supervised,
      started,
      restarted,
      installed,
      bridgePairs,
      bridgeProxies,
      bridgeCodex,
      bridgeTerminals,
      bridgeClaude,
      runtime: {
        stdout(message: string) {
          stdout.push(message);
        },
        stderr(message: string) {
          stderr.push(message);
        },
        async supervise(argv: string[]) {
          supervised.push(argv);
          return 0;
        },
        async start(argv: string[]) {
          started.push(argv);
        },
        async restart(argv: string[]) {
          restarted.push(argv);
        },
        async pairBridge(options: {
          origin: string;
          code: string;
          originAccess: string;
        }) {
          bridgePairs.push(options);
          return {
            id: "device-profile",
            origin: options.origin,
            repositoryId: "repo-one",
            repositoryName: "Project One",
            repositoryRoot: "/projects/one",
            deviceId: "device-profile",
            deviceToken: "t".repeat(43),
            deviceLabel: "MacBook Air",
            sshAlias: "couchview-project-one",
            username: "mini-user",
            originAccess: options.originAccess,
          };
        },
        async proxyBridge(profileId: string) {
          bridgeProxies.push(profileId);
          return 0;
        },
        async codexBridge(options: {
          profileSelector: string | null;
          repositoryRoot: string | null;
          codexArgs: string[];
        }) {
          bridgeCodex.push(options);
          return 0;
        },
        async terminalBridge(options: {
          profileSelector: string | null;
          repositoryRoot: string | null;
        }) {
          bridgeTerminals.push(options);
          return 0;
        },
        async claudeBridge(options: {
          profileSelector: string | null;
          repositoryRoot: string | null;
          claudeArgs: string[];
        }) {
          bridgeClaude.push(options);
          return 0;
        },
        async installCompletion(shell: CompletionShell) {
          installed.push(shell);
          return "/tmp/couchview.fish";
        },
        createPrompter() {
          return prompter ?? {
            isTTY: false,
            question: async () => "",
            error() {},
            close() {},
          };
        },
        supervisedWorker: false,
      },
    };
  }

  test("prints help, version, and completion without starting server work", async () => {
    const help = entrypointRuntime();
    expect(await runCli(["--help"], help.runtime)).toBe(0);
    expect(help.stdout.join("\n")).toContain("Usage:");
    expect(help.supervised).toEqual([]);
    expect(help.started).toEqual([]);
    expect(help.restarted).toEqual([]);

    const version = entrypointRuntime();
    expect(await runCli(["--version"], version.runtime)).toBe(0);
    expect(version.stdout).toEqual([`couchview ${CLI_VERSION}`]);

    const completion = entrypointRuntime();
    expect(await runCli(["completion", "bash"], completion.runtime)).toBe(0);
    expect(completion.stdout.join("\n")).toContain("complete -F _couchview couchview");
    expect(completion.supervised).toEqual([]);

    const install = entrypointRuntime();
    expect(await runCli(["completion", "fish", "--install"], install.runtime)).toBe(0);
    expect(install.installed).toEqual(["fish"]);
    expect(install.stdout).toEqual([
      "Installed Fish completion at /tmp/couchview.fish.",
    ]);
    expect(install.supervised).toEqual([]);
  });

  test("dispatches explicit serve and restart commands with their command names removed", async () => {
    const serve = entrypointRuntime();
    expect(await runCli([
      "serve",
      ".",
      "-p",
      "5000",
    ], serve.runtime)).toBe(0);
    expect(serve.supervised).toEqual([["--repo=.", "--port", "5000"]]);

    const restart = entrypointRuntime();
    expect(await runCli(["restart", "-H", "localhost", "-p", "5000"], restart.runtime)).toBe(0);
    expect(restart.restarted).toEqual([["-H", "localhost", "-p", "5000"]]);
  });

  test("pairs native IDE devices and dispatches the silent SSH ProxyCommand", async () => {
    const pairing = entrypointRuntime();
    expect(await runCli([
      "bridge",
      "pair",
      "--url",
      "https://review.example.com",
      "--code",
      "c".repeat(43),
      "--origin-access",
      CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
    ], pairing.runtime)).toBe(0);
    expect(pairing.bridgePairs).toEqual([{
      origin: "https://review.example.com",
      code: "c".repeat(43),
      originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
    }]);
    expect(pairing.stdout.join("\n")).toContain("Open in Zed: zed://ssh/");
    expect(pairing.stdout.join("\n")).toContain(
      "Open in Codex CLI: couchview bridge codex --profile couchview-project-one --repo '/projects/one'",
    );
    expect(pairing.stdout.join("\n")).toContain(
      "Open a remote terminal: couchview bridge terminal --profile couchview-project-one --repo '/projects/one'",
    );
    expect(pairing.stdout.join("\n")).toContain(
      "Start Claude Code Remote Control: couchview bridge claude --profile couchview-project-one --repo '/projects/one'",
    );
    expect(pairing.stdout.join("\n")).not.toContain("t".repeat(43));

    const proxy = entrypointRuntime();
    expect(await runCli([
      "bridge",
      "proxy",
      "--profile",
      "device-profile",
    ], proxy.runtime)).toBe(0);
    expect(proxy.bridgeProxies).toEqual(["device-profile"]);
    expect(proxy.stdout).toEqual([]);

    const codex = entrypointRuntime();
    expect(await runCli([
      "bridge",
      "codex",
      "--profile",
      "couchview-project-one",
      "--repo",
      "/projects/two",
      "--",
      "--model",
      "gpt-5.4",
    ], codex.runtime)).toBe(0);
    expect(codex.bridgeCodex).toEqual([{
      profileSelector: "couchview-project-one",
      repositoryRoot: "/projects/two",
      codexArgs: ["--model", "gpt-5.4"],
    }]);

    const terminal = entrypointRuntime();
    expect(await runCli([
      "bridge",
      "terminal",
      "--profile",
      "couchview-project-one",
      "--repo",
      "/projects/two",
    ], terminal.runtime)).toBe(0);
    expect(terminal.bridgeTerminals).toEqual([{
      profileSelector: "couchview-project-one",
      repositoryRoot: "/projects/two",
    }]);

    const claude = entrypointRuntime();
    expect(await runCli([
      "bridge",
      "claude",
      "--profile",
      "couchview-project-one",
      "--repo",
      "/projects/two",
      "--",
      "--name",
      "Project Two",
    ], claude.runtime)).toBe(0);
    expect(claude.bridgeClaude).toEqual([{
      profileSelector: "couchview-project-one",
      repositoryRoot: "/projects/two",
      claudeArgs: ["--name", "Project Two"],
    }]);
  });

  test("reports usage errors with suggestions and exit code 2", async () => {
    const invocation = entrypointRuntime();
    expect(await runCli(["--hep"], invocation.runtime)).toBe(2);
    expect(invocation.stderr.join("\n")).toContain("Did you mean '--help'");
    expect(invocation.stderr.join("\n")).toContain("couchview help serve");
    expect(invocation.supervised).toEqual([]);

    const invalidPort = entrypointRuntime();
    expect(await runCli(["--port", "nope"], invalidPort.runtime)).toBe(2);
    expect(invalidPort.stderr.join("\n")).toContain("Port must be between 1 and 65535");
    expect(invalidPort.supervised).toEqual([]);
  });

  test("resolves interactive values once before launching the supervisor", async () => {
    const questions: string[] = [];
    let closed = false;
    const answers = ["p2p"];
    const prompter: InteractivePrompter = {
      isTTY: true,
      async question(message) {
        questions.push(message);
        return answers.shift() ?? "";
      },
      error() {},
      close() {
        closed = true;
      },
    };
    const invocation = entrypointRuntime(prompter);

    expect(await runCli([
      "serve",
      "--interactive",
      "--repo",
      ".",
      "--host",
      "127.0.0.1",
      "--port",
      "5000",
    ], invocation.runtime)).toBe(0);

    expect(questions).toHaveLength(1);
    expect(closed).toBe(true);
    expect(invocation.supervised).toEqual([[
      "--repo",
      path.resolve("."),
      "--host",
      "127.0.0.1",
      "--port",
      "5000",
      "--enable-terminal",
      "--enable-terminal-p2p",
    ]]);
  });

  test("does not hang non-TTY automation and returns 130 when prompts are cancelled", async () => {
    const nonTty = entrypointRuntime();
    expect(await runCli(["--interactive"], nonTty.runtime)).toBe(2);
    expect(nonTty.stderr.join("\n")).toContain("requires an attached terminal");
    expect(nonTty.supervised).toEqual([]);

    const cancelled = entrypointRuntime({
      isTTY: true,
      async question() {
        throw new CliPromptInterrupted();
      },
      error() {},
      close() {},
    });
    expect(await runCli(["--interactive"], cancelled.runtime)).toBe(130);
    expect(cancelled.stderr).toEqual(["Interactive setup was cancelled."]);
    expect(cancelled.supervised).toEqual([]);
  });
});

describe("restartCapability", () => {
  test("enables production source launches", () => {
    expect(restartCapability({})).toEqual({
      available: true,
      reason: null,
    });
  });

  test("explains development and custom static-directory launches", () => {
    expect(restartCapability({ NODE_ENV: "development" })).toEqual({
      available: false,
      reason: "Development mode reloads source changes automatically.",
    });
    expect(restartCapability({ STATIC_DIR: "/tmp/custom-couchview-dist" })).toEqual({
      available: false,
      reason: "Restart is unavailable when Couchview uses a custom STATIC_DIR.",
    });
  });
});

describe("server supervisor", () => {
  test("keeps the foreground owner alive while replacing a restarted worker", async () => {
    const exitCodes = [SUPERVISOR_RESTART_EXIT_CODE, 0];
    const commands: string[][] = [];
    const environments: NodeJS.ProcessEnv[] = [];
    const listeners = new Map<string, () => void>();

    const exitCode = await superviseServer(
      ["--repo", "/tmp/project", "--port", "4999", "--enable-terminal-p2p"],
      {
        spawn(command, options) {
          commands.push(command);
          environments.push(options.env);
          return {
            exited: Promise.resolve(exitCodes.shift() ?? 1),
            kill() {},
          };
        },
        onSignal(signal, listener) {
          listeners.set(signal, listener);
        },
        offSignal(signal, listener) {
          if (listeners.get(signal) === listener) listeners.delete(signal);
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.slice(-5)).toEqual([
      "--repo",
      "/tmp/project",
      "--port",
      "4999",
      "--enable-terminal-p2p",
    ]);
    expect(environments[0]?.COUCHVIEW_SUPERVISED_WORKER).toBe("1");
    expect(environments[1]?.COUCHVIEW_SUPERVISED_WORKER).toBe("1");
    expect(environments[1]?.COUCHVIEW_DISABLE_REUSE).toBe("1");
    expect(listeners.size).toBe(0);
  });

  test("forwards termination to the active worker without respawning it", async () => {
    const listeners = new Map<string, () => void>();
    const killed: NodeJS.Signals[] = [];
    let finishWorker!: (exitCode: number) => void;
    const workerExited = new Promise<number>((resolve) => {
      finishWorker = resolve;
    });
    let spawnCount = 0;
    const supervised = superviseServer([], {
      spawn() {
        spawnCount += 1;
        return {
          exited: workerExited,
          kill(signal) {
            killed.push(signal);
            finishWorker(0);
          },
        };
      },
      onSignal(signal, listener) {
        listeners.set(signal, listener);
      },
      offSignal(signal, listener) {
        if (listeners.get(signal) === listener) listeners.delete(signal);
      },
    });

    listeners.get("SIGTERM")?.();

    expect(await supervised).toBe(0);
    expect(killed).toEqual(["SIGTERM"]);
    expect(spawnCount).toBe(1);
    expect(listeners.size).toBe(0);
  });
});

describe("replaceStaticBuild", () => {
  test("atomically promotes a successful build and removes the previous one", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "couchview-build-swap-"));
    const current = path.join(root, "dist");
    const candidate = path.join(root, ".couchview-build-candidate");
    try {
      await mkdir(current);
      await mkdir(candidate);
      await writeFile(path.join(current, "index.html"), "old");
      await writeFile(path.join(candidate, "index.html"), "new");

      await replaceStaticBuild(candidate, current);

      expect(await Bun.file(path.join(current, "index.html")).text()).toBe("new");
      expect(await readdir(root)).toEqual(["dist"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restores the current build when promotion fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "couchview-build-restore-"));
    const current = path.join(root, "dist");
    const missingCandidate = path.join(root, "missing-build");
    try {
      await mkdir(current);
      await writeFile(path.join(current, "index.html"), "old");

      await expect(
        replaceStaticBuild(missingCandidate, current),
      ).rejects.toThrow();

      expect(await Bun.file(path.join(current, "index.html")).text()).toBe("old");
      expect(await readdir(root)).toEqual(["dist"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];
const endpoints = new Map<number, (request: Request) => Response | Promise<Response>>();
let nextPort = 43_100;

async function repositoryFixture(name: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `couchview-cli-${name}-`));
  temporaryDirectories.push(directory);
  expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
  await writeFile(path.join(directory, `${name}.ts`), `export const ${name} = true;\n`);
  return directory;
}

function freePort(): number {
  nextPort += 1;
  return nextPort;
}

async function runningApp(root: string, port: number, stateDatabasePath?: string) {
  const app = await createCouchviewApp({
    root,
    host: "127.0.0.1",
    port,
    stateDatabasePath,
  });
  app.registerServerInstance();
  applications.push(app);
  endpoints.set(port, app.fetch);
  return app;
}

const runtimeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const port = Number(new URL(request.url).port);
  const endpoint = endpoints.get(port);
  if (!endpoint) throw new TypeError("Endpoint is not listening");
  return endpoint(request);
}) as typeof globalThis.fetch;

const runtimeServe = ((options: {
  hostname?: string;
  port?: number;
  fetch(request: Request): Response | Promise<Response>;
}) => {
  const port = options.port ?? 0;
  if (endpoints.has(port)) {
    const error = new Error(`Failed to listen: address already in use (${port})`);
    Object.assign(error, { code: "EADDRINUSE" });
    throw error;
  }
  endpoints.set(port, options.fetch);
  return {
    port,
    stop() {
      endpoints.delete(port);
    },
  } as ReturnType<typeof Bun.serve>;
}) as unknown as typeof Bun.serve;

const runtime = { fetch: runtimeFetch, serve: runtimeServe };

describe("multi-project CLI startup", () => {
  beforeEach(async () => {
    delete Bun.env.COUCHVIEW_ROOT;
    delete Bun.env.COUCHVIEW_HOST;
    delete Bun.env.PORT;
    delete Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
    delete Bun.env.ALLOWED_ORIGINS;
    delete Bun.env.COUCHVIEW_TERMINAL;
    delete Bun.env.COUCHVIEW_TERMINAL_P2P;
    delete Bun.env.COUCHVIEW_TERMINAL_STUN;
    delete Bun.env.COUCHVIEW_DISABLE_REUSE;
    delete Bun.env.COUCH_REVIEW_DISABLE_REUSE;
    const dataHome = await mkdtemp(path.join(tmpdir(), "couchview-cli-data-"));
    temporaryDirectories.push(dataHome);
    Bun.env.XDG_DATA_HOME = dataHome;
  });

  afterEach(async () => {
    endpoints.clear();
    for (const application of applications.splice(0)) application.close();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    restoreEnvironment();
  });

  test("starts the first endpoint with a project-specific URL and global state", async () => {
    const root = await repositoryFixture("first");
    const port = freePort();
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => messages.push(values.join(" "));
    try {
      const result = await startServer(["--repo", root, "--port", String(port)], runtime);
      if (!result.app || !result.server || !result.stop) {
        throw new Error("CLI unexpectedly attached to another server");
      }
      expect(result.app.database.repositories()).toHaveLength(1);
      expect(messages.join("\n")).toContain(`/?repo=${result.app.repository.id}`);
      expect(messages.join("\n")).toContain(`Repository: ${result.app.repository.root}`);
      expect(
        await Bun.file(path.join(root, ".git", "couchview", "state.json")).exists(),
      ).toBe(false);
      result.stop();
    } finally {
      console.log = originalLog;
    }
  });

  test("asks the owning server to rebuild and waits for its replacement", async () => {
    const root = await repositoryFixture("restart-owner");
    const port = freePort();
    let restartRequests = 0;
    let replacementReady = false;
    const app = await createCouchviewApp({
      root,
      host: "127.0.0.1",
      port,
      restart: {
        available: true,
        reason: null,
        request: async () => {
          restartRequests += 1;
          replacementReady = true;
        },
      },
    });
    app.registerServerInstance();
    applications.push(app);
    const replacementId = "replacement-instance";
    endpoints.set(port, async (request) => {
      if (
        replacementReady &&
        request.method === "GET" &&
        new URL(request.url).pathname === "/api/instance"
      ) {
        return Response.json({
          service: "couchview",
          protocolVersion: app.protocolVersion,
          version: app.version,
          instanceId: replacementId,
          bindHost: app.bindHost,
          port: app.port,
          accessOrigins: app.accessOrigins,
          terminalEnabled: app.terminalSessions.enabled,
          terminalP2pEnabled: app.terminalSessions.p2pEnabled,
          terminalStunUrls: [...app.terminalSessions.stunUrls],
          remoteBridgeEnabled: app.remoteBridge.enabled,
          remoteBridgeP2pEnabled: app.remoteBridge.p2pEnabled,
          remoteBridgeStunUrls: [...app.remoteBridge.stunUrls],
          remoteBridgeTargetPort: app.remoteBridge.targetPort,
        });
      }
      return app.fetch(request);
    });

    const result = await restartRunningServer(
      ["--port", String(port)],
      { fetch: runtimeFetch, wait: async () => undefined },
    );

    expect(restartRequests).toBe(1);
    expect(result.previous.instanceId).toBe(app.instanceId);
    expect(result.replacement.instanceId).toBe(replacementId);
    expect(result.replacement.remoteBridgeOriginAccess).toBe("auto");
  });

  test("falls back to browser restart authentication for a pre-control server", async () => {
    const root = await repositoryFixture("restart-legacy");
    const port = freePort();
    let replacementReady = false;
    const app = await createCouchviewApp({
      root,
      host: "127.0.0.1",
      port,
      restart: {
        available: true,
        reason: null,
        request: async () => {
          replacementReady = true;
        },
      },
    });
    app.registerServerInstance();
    applications.push(app);
    endpoints.set(port, (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/control/restart") {
        return Response.json(
          {
            error: {
              code: "origin_required",
              message: "A same-origin browser request is required",
            },
          },
          { status: 403 },
        );
      }
      if (replacementReady && pathname === "/api/instance") {
        return Response.json({
          service: "couchview",
          protocolVersion: app.protocolVersion,
          version: app.version,
          instanceId: "legacy-replacement",
          bindHost: app.bindHost,
          port: app.port,
          accessOrigins: app.accessOrigins,
          terminalEnabled: app.terminalSessions.enabled,
          terminalP2pEnabled: app.terminalSessions.p2pEnabled,
          terminalStunUrls: [...app.terminalSessions.stunUrls],
          remoteBridgeEnabled: app.remoteBridge.enabled,
          remoteBridgeP2pEnabled: app.remoteBridge.p2pEnabled,
          remoteBridgeStunUrls: [...app.remoteBridge.stunUrls],
          remoteBridgeTargetPort: app.remoteBridge.targetPort,
          remoteBridgeOriginAccess: app.remoteBridgeOriginAccess,
        });
      }
      return app.fetch(request);
    });

    const result = await restartRunningServer(
      ["--port", String(port)],
      { fetch: runtimeFetch, wait: async () => undefined },
    );

    expect(result.replacement.instanceId).toBe("legacy-replacement");
  });

  test("accepts exact public and internal reverse-proxy origins", async () => {
    const root = await repositoryFixture("public-origin");
    const port = freePort();
    Bun.env.COUCHVIEW_ALLOWED_ORIGINS = "https://review.example.com";
    Bun.env.ALLOWED_ORIGINS = "https://internal-proxy.example.com";

    const result = await startServer(
      ["--repo", root, "--host", "127.0.0.1", "--port", String(port)],
      runtime,
    );
    if (!result.app || !result.stop) {
      throw new Error("CLI unexpectedly attached to another server");
    }
    try {
      for (const origin of [
        "https://review.example.com",
        "https://internal-proxy.example.com",
      ]) {
        const response = await result.app.fetch(
          new Request(`${origin}/api/instance`, {
            headers: {
              host: new URL(origin).host,
              origin,
            },
          }),
        );
        expect(response.status).toBe(200);
      }
    } finally {
      result.stop();
    }
  });

  test("enables terminal access automatically only for loopback origins", async () => {
    const loopbackRoot = await repositoryFixture("terminal-loopback");
    const loopback = await startServer(
      ["--repo", loopbackRoot, "--port", String(freePort())],
      runtime,
    );
    if (!loopback.app || !loopback.stop) {
      throw new Error("CLI unexpectedly attached to another server");
    }
    expect(loopback.app.terminalSessions.enabled).toBe(true);
    loopback.stop();

    const publicRoot = await repositoryFixture("terminal-public");
    Bun.env.COUCHVIEW_ALLOWED_ORIGINS = "https://review.example.com";
    const publicServer = await startServer(
      ["--repo", publicRoot, "--port", String(freePort())],
      runtime,
    );
    if (!publicServer.app || !publicServer.stop) {
      throw new Error("CLI unexpectedly attached to another server");
    }
    expect(publicServer.app.terminalSessions.enabled).toBe(false);
    publicServer.stop();

    const warningRoot = await repositoryFixture("terminal-explicit-public");
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => warnings.push(values.join(" "));
    try {
      const explicit = await startServer(
        [
          "--repo",
          warningRoot,
          "--port",
          String(freePort()),
          "--enable-terminal",
        ],
        runtime,
      );
      if (!explicit.app || !explicit.stop) {
        throw new Error("CLI unexpectedly attached to another server");
      }
      expect(explicit.app.terminalSessions.enabled).toBe(true);
      expect(warnings.join("\n")).toContain("OS-user permissions");
      explicit.stop();
    } finally {
      console.warn = originalWarn;
    }
  });

  test("rejects reuse when explicit terminal policy conflicts", async () => {
    const firstRoot = await repositoryFixture("terminal-owner");
    const secondRoot = await repositoryFixture("terminal-client");
    const port = freePort();
    await runningApp(firstRoot, port);
    await expect(startServer(
      ["--repo", secondRoot, "--port", String(port), "--disable-terminal"],
      runtime,
    )).rejects.toThrow("terminal access enabled");
  });

  test("requires terminal access for P2P and reports the privacy boundary when enabled", async () => {
    const disabledRoot = await repositoryFixture("p2p-terminal-disabled");
    await expect(startServer([
      "--repo",
      disabledRoot,
      "--port",
      String(freePort()),
      "--disable-terminal",
      "--enable-terminal-p2p",
    ], runtime)).rejects.toThrow("Terminal P2P requires terminal access");

    const enabledRoot = await repositoryFixture("p2p-enabled");
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => warnings.push(values.join(" "));
    try {
      const result = await startServer([
        "--repo",
        enabledRoot,
        "--port",
        String(freePort()),
        "--enable-terminal-p2p",
      ], runtime);
      if (!result.app || !result.stop) throw new Error("CLI unexpectedly reused a server");
      expect(result.app.terminalSessions.p2pEnabled).toBe(true);
      expect(result.app.terminalSessions.stunUrls).toEqual([
        "stun:stun.cloudflare.com:3478",
      ]);
      expect(warnings.join("\n")).toContain("peer");
      expect(warnings.join("\n")).toContain("bypass Cloudflare");
      result.stop();
    } finally {
      console.warn = originalWarn;
    }
  });

  test("rejects running-server reuse when explicit P2P policy conflicts", async () => {
    const firstRoot = await repositoryFixture("p2p-owner");
    const secondRoot = await repositoryFixture("p2p-client");
    const port = freePort();
    await runningApp(firstRoot, port);
    await expect(startServer([
      "--repo",
      secondRoot,
      "--port",
      String(port),
      "--enable-terminal-p2p",
    ], runtime)).rejects.toThrow("terminal P2P disabled");
  });

  test("adds a second project to a compatible server, then reports duplicates", async () => {
    const firstRoot = await repositoryFixture("first");
    const secondRoot = await repositoryFixture("second");
    const port = freePort();
    const app = await runningApp(firstRoot, port);
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => messages.push(values.join(" "));
    try {
      const added = await startServer(
        ["--repo", secondRoot, "--port", String(port)],
        runtime,
      );
      if (!added.registered) throw new Error("CLI unexpectedly started another server");
      expect(added.registered.registration.added).toBe(true);
      expect(app.database.repositories()).toHaveLength(2);
      expect(messages.join("\n")).toContain("Repository added to the running Couchview server.");
      expect(messages.join("\n")).toContain(
        `/?repo=${added.registered.registration.repository.id}`,
      );

      messages.length = 0;
      const duplicate = await startServer(
        ["--repo", secondRoot, "--port", String(port)],
        runtime,
      );
      if (!duplicate.registered) throw new Error("CLI unexpectedly started another server");
      expect(duplicate.registered.registration.added).toBe(false);
      expect(messages.join("\n")).toContain(
        "Repository is already available in the running Couchview server.",
      );
    } finally {
      console.log = originalLog;
    }
  });

  test("rejects unrelated services, data-directory mismatches, and incompatible binds", async () => {
    const root = await repositoryFixture("first");
    const otherRoot = await repositoryFixture("second");

    const unrelatedPort = freePort();
    endpoints.set(unrelatedPort, () => Response.json({ service: "something-else" }));
    await expect(
      startServer(["--repo", root, "--port", String(unrelatedPort)], runtime),
    ).rejects.toThrow("not a compatible Couchview server");

    const incompatiblePort = freePort();
    await runningApp(root, incompatiblePort);
    await expect(
      startServer([
        "--repo",
        otherRoot,
        "--host",
        "0.0.0.0",
        "--port",
        String(incompatiblePort),
      ], runtime),
    ).rejects.toThrow("does not satisfy --host 0.0.0.0");

    const dataMismatchPort = freePort();
    const otherDataHome = await mkdtemp(path.join(tmpdir(), "couchview-cli-other-data-"));
    temporaryDirectories.push(otherDataHome);
    await runningApp(
      root,
      dataMismatchPort,
      path.join(otherDataHome, "couchview", "state.sqlite"),
    );
    await expect(
      startServer(["--repo", otherRoot, "--port", String(dataMismatchPort)], runtime),
    ).rejects.toThrow("different XDG data directory");
  });

  test("development ownership mode refuses to attach to an occupied endpoint", async () => {
    const firstRoot = await repositoryFixture("first");
    const secondRoot = await repositoryFixture("second");
    const port = freePort();
    await runningApp(firstRoot, port);
    Bun.env.COUCHVIEW_DISABLE_REUSE = "1";
    await expect(
      startServer(["--repo", secondRoot, "--port", String(port)], runtime),
    ).rejects.toThrow(/EADDRINUSE|address already in use/i);
  });

  test("retries discovery when another process wins the startup bind race", async () => {
    const firstRoot = await repositoryFixture("first");
    const secondRoot = await repositoryFixture("second");
    const port = freePort();
    const incumbent = await createCouchviewApp({
      root: firstRoot,
      host: "127.0.0.1",
      port,
    });
    incumbent.registerServerInstance();
    applications.push(incumbent);

    let raced = false;
    const raceServe = ((options: Parameters<typeof runtimeServe>[0]) => {
      if (!raced) {
        raced = true;
        endpoints.set(port, incumbent.fetch);
        const error = new Error("Failed to listen: address already in use");
        Object.assign(error, { code: "EADDRINUSE" });
        throw error;
      }
      return runtimeServe(options as never);
    }) as typeof Bun.serve;

    const originalLog = console.log;
    console.log = () => undefined;
    try {
      const result = await startServer(
        ["--repo", secondRoot, "--port", String(port)],
        { fetch: runtimeFetch, serve: raceServe },
      );
      expect(result.registered?.registration.repository.root).toContain(
        secondRoot.split("/").at(-1)!,
      );
      expect(incumbent.database.repositories()).toHaveLength(2);
    } finally {
      console.log = originalLog;
    }
  });
});
