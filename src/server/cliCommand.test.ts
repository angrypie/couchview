import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  CLI_VERSION,
  CliPromptInterrupted,
  CliUsageError,
  type CompletionShell,
  fishCompletionPath,
  type InteractivePrompter,
  parseCliInvocation,
  parseServeArguments,
  promptForServeArguments,
  renderCliHelp,
  renderCompletion,
} from "./cliCommand.ts";

function fakePrompter(
  answers: string[],
  isTTY = true,
): InteractivePrompter & { questions: string[]; errors: string[]; closed: boolean } {
  return {
    isTTY,
    questions: [],
    errors: [],
    closed: false,
    async question(message) {
      this.questions.push(message);
      const answer = answers.shift();
      if (answer === undefined) throw new CliPromptInterrupted();
      return answer;
    },
    error(message) {
      this.errors.push(message);
    },
    close() {
      this.closed = true;
    },
  };
}

const validators = {
  root(value: string) {
    if (!value) throw new Error("Repository path is required");
    return path.resolve(value);
  },
  host(value: string) {
    if (!/^[A-Za-z0-9.:-]+$/.test(value)) throw new Error("Host is invalid");
    return value.toLowerCase();
  },
  port(value: string) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("Port is invalid");
    }
    return port;
  },
};

describe("CLI command parsing", () => {
  test("supports conventional aliases, inline values, and option termination", () => {
    expect(parseServeArguments([
      "-r",
      "../project",
      "-H",
      "0.0.0.0",
      "--port=5199",
      "-i",
    ])).toMatchObject({
      repo: "../project",
      host: "0.0.0.0",
      port: "5199",
      interactive: true,
      explicit: { repo: true, host: true, port: true },
    });
    expect(parseServeArguments(["--", "-repository"], true).repo).toBe("-repository");
  });

  test("rejects duplicate and conflicting options", () => {
    expect(() => parseServeArguments(["--port", "4000", "-p", "5000"])).toThrow(
      "may only be provided once",
    );
    expect(() => parseServeArguments([
      "--enable-terminal-p2p",
      "--disable-terminal-p2p",
    ])).toThrow("cannot be used together");
    expect(() => parseServeArguments([
      "--enable-remote-bridge",
      "--disable-remote-bridge",
    ])).toThrow("cannot be used together");
  });

  test("dispatches the default command, explicit commands, help, and version", () => {
    expect(parseCliInvocation([])).toMatchObject({ kind: "serve", argv: [] });
    expect(parseCliInvocation(["serve", "."])).toMatchObject({
      kind: "serve",
      argv: ["--repo=."],
    });
    expect(parseCliInvocation(["--repo", "."])).toMatchObject({
      kind: "serve",
      argv: ["--repo=."],
    });
    expect(parseCliInvocation(["serve", "--port", "5000"])).toMatchObject({
      kind: "serve",
      argv: ["--port", "5000"],
    });
    expect(parseCliInvocation(["restart", "-p", "5000"])).toMatchObject({
      kind: "restart",
      argv: ["-p", "5000"],
    });
    expect(parseCliInvocation(["--help"])).toEqual({ kind: "help", command: null });
    expect(parseCliInvocation(["serve", "--help"])).toEqual({
      kind: "help",
      command: "serve",
    });
    expect(parseCliInvocation(["help", "restart"])).toEqual({
      kind: "help",
      command: "restart",
    });
    expect(parseCliInvocation(["-V"])).toEqual({ kind: "version" });
    expect(parseCliInvocation(["completion", "zsh"])).toEqual({
      kind: "completion",
      shell: "zsh",
      install: false,
    });
    expect(parseCliInvocation(["completion", "fish", "--install"])).toEqual({
      kind: "completion",
      shell: "fish",
      install: true,
    });
    expect(parseCliInvocation([
      "bridge",
      "pair",
      "--url",
      "https://review.example.com",
      "--code",
      "a".repeat(43),
      "--cloudflare-access",
    ])).toEqual({
      kind: "bridge-pair",
      origin: "https://review.example.com",
      code: "a".repeat(43),
      cloudflareAccess: true,
    });
    expect(parseCliInvocation([
      "bridge",
      "proxy",
      "--profile",
      "device-profile",
    ])).toEqual({ kind: "bridge-proxy", profileId: "device-profile" });
    expect(() => parseCliInvocation(["bridge", "par"])).toThrow("Did you mean 'pair'");
  });

  test("suggests nearby commands, options, and shell names", () => {
    expect(() => parseCliInvocation(["restrat"])).toThrow(
      "Did you mean 'restart'",
    );
    expect(() => parseCliInvocation(["--hep"])).toThrow("Did you mean '--help'");
    expect(() => parseCliInvocation(["completion", "fsh"])).toThrow(
      "Did you mean 'fish'",
    );
    expect(() => parseCliInvocation(["completion", "zsh", "--install"])).toThrow(
      "supports Fish only",
    );
  });

  test("rejects bare repository paths", () => {
    expect(() => parseCliInvocation(["."])).toThrow(
      "Repository paths must follow 'serve' or '--repo'",
    );
    expect(() => parseCliInvocation(["--", "."])).toThrow(
      "Repository paths must follow the 'serve' command or '--repo'",
    );
  });
});

describe("CLI help and completion", () => {
  test("renders general and command-specific help from the shared option schema", () => {
    expect(renderCliHelp(null)).toContain(`Couchview ${CLI_VERSION}`);
    expect(renderCliHelp(null)).not.toContain("couchview [serve]");
    expect(renderCliHelp(null)).toContain("couchview serve [repository]");
    expect(renderCliHelp(null)).toContain("couchview completion <shell>");
    expect(renderCliHelp(null)).toContain("couchview bridge <pair|proxy>");
    expect(renderCliHelp("serve")).toContain("-i, --interactive");
    expect(renderCliHelp("serve")).toContain("--enable-terminal-p2p");
    expect(renderCliHelp("restart")).not.toContain("--repo");
    expect(renderCliHelp("completion")).toContain("couchview completion fish --install");
    expect(renderCliHelp("bridge")).toContain("bridge pair --url");
    expect(renderCliHelp("serve")).toContain("--enable-remote-bridge-p2p");
    expect(fishCompletionPath({}, "/Users/example")).toBe(
      "/Users/example/.config/fish/completions/couchview.fish",
    );
    expect(fishCompletionPath(
      { XDG_CONFIG_HOME: "/tmp/config" },
      "/Users/example",
    )).toBe("/tmp/config/fish/completions/couchview.fish");
  });

  test.each(["zsh", "bash", "fish"] as const)(
    "generates valid %s completion with current commands and flags",
    (shell) => {
      const completion = renderCompletion(shell as CompletionShell);
      expect(completion).toContain("completion");
      expect(completion).toContain("enable-terminal-p2p");
      expect(completion).toContain("bridge");
      expect(completion).toContain("repo");
      if (shell === "zsh") {
        expect(completion).not.toContain("'directories:repository directory:_directories'");
      }
      if (shell === "bash") {
        expect(completion).not.toMatch(
          /COMP_CWORD == 1[\s\S]*?COMPREPLY=.*compgen -W[^\n]+compgen -d/,
        );
      }
      if (shell === "fish") {
        expect(completion).toContain("complete -c couchview -f");
        expect(completion).toContain("__fish_couchview_using_explicit_command serve");
      }
      const binary = Bun.which(shell);
      if (!binary) return;
      const checked = Bun.spawnSync([binary, "-n"], {
        stdin: Buffer.from(completion),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(checked.exitCode, checked.stderr.toString()).toBe(0);
    },
  );
});

describe("interactive serve setup", () => {
  const defaults = {
    root: "/tmp/default-project",
    host: "127.0.0.1",
    port: 4173,
    terminalMode: "auto" as const,
    terminalP2pMode: "auto" as const,
  };

  test("prompts for omitted values, retries validation, and emits canonical arguments", async () => {
    const prompter = fakePrompter([
      "/tmp/project",
      "bad host",
      "0.0.0.0",
      "0",
      "5000",
      "direct",
      "p2p",
    ]);
    const argv = await promptForServeArguments(
      parseServeArguments(["--interactive"]),
      defaults,
      prompter,
      validators,
    );

    expect(argv).toEqual([
      "--repo",
      "/tmp/project",
      "--host",
      "0.0.0.0",
      "--port",
      "5000",
      "--enable-terminal",
      "--enable-terminal-p2p",
    ]);
    expect(prompter.errors).toEqual([
      "Host is invalid",
      "Port is invalid",
      "Choose automatic, disabled, websocket, or p2p.",
    ]);
  });

  test("does not prompt for command-line values or explicit terminal policy", async () => {
    const prompter = fakePrompter([]);
    const parsed = parseServeArguments([
      "--interactive",
      "--repo",
      "/tmp/project",
      "--host",
      "localhost",
      "--port",
      "5000",
      "--disable-terminal",
    ]);
    const argv = await promptForServeArguments(
      parsed,
      {
        ...defaults,
        root: "/tmp/project",
        host: "localhost",
        port: 5000,
        terminalMode: "disabled",
      },
      prompter,
      validators,
    );

    expect(prompter.questions).toEqual([]);
    expect(argv).toContain("--disable-terminal");
    expect(argv).not.toContain("--interactive");
  });

  test("rejects non-TTY use and propagates cancellation", async () => {
    await expect(promptForServeArguments(
      parseServeArguments(["--interactive"]),
      defaults,
      fakePrompter([], false),
      validators,
    )).rejects.toBeInstanceOf(CliUsageError);
    await expect(promptForServeArguments(
      parseServeArguments(["--interactive"]),
      defaults,
      fakePrompter([]),
      validators,
    )).rejects.toBeInstanceOf(CliPromptInterrupted);
  });
});
