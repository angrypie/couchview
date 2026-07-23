import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  CODEX_COMMIT_MESSAGE_MODEL,
  CODEX_COMMIT_MESSAGE_REASONING,
  CodexCommitMessageService,
  type SpawnCommitMessageProcess,
} from "./commitMessage.ts";

const encoder = new TextEncoder();

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function completedProcess(stdout: string, stderr = "", exitCode = 0) {
  return {
    stdout: textStream(stdout),
    stderr: textStream(stderr),
    exited: Promise.resolve(exitCode),
    kill() {},
  };
}

function pendingProcess() {
  let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
  let stderrController!: ReadableStreamDefaultController<Uint8Array>;
  let resolveExit!: (exitCode: number) => void;
  let stopped = false;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  return {
    handle: {
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          stdoutController = controller;
        },
      }),
      stderr: new ReadableStream<Uint8Array>({
        start(controller) {
          stderrController = controller;
        },
      }),
      exited,
      kill() {
        if (stopped) return;
        stopped = true;
        stdoutController.close();
        stderrController.close();
        resolveExit(143);
      },
    },
    stopped: () => stopped,
  };
}

describe("CodexCommitMessageService", () => {
  test("runs an isolated schema-constrained Luna request", async () => {
    let command: readonly string[] = [];
    let cwd = "";
    let stdin = "";
    const spawn: SpawnCommitMessageProcess = (nextCommand, options) => {
      command = nextCommand;
      cwd = options.cwd;
      stdin = options.stdin;
      expect(options.env.GIT_DIR).toBeUndefined();
      expect(options.env.GIT_INDEX_FILE).toBeUndefined();
      return completedProcess(
        JSON.stringify({ message: "feat(review): generate commit messages" }),
      );
    };
    const service = new CodexCommitMessageService({
      executable: "/opt/bin/codex",
      spawn,
    });

    const message = await service.generate("STAGED PATCH:\n+new behavior");

    expect(message).toBe("feat(review): generate commit messages");
    expect(command[0]).toBe("/opt/bin/codex");
    expect(command).toContain("exec");
    expect(command).toContain("--ephemeral");
    expect(command).toContain("read-only");
    expect(command).toContain("--ignore-user-config");
    expect(command).toContain("--skip-git-repo-check");
    expect(command[command.indexOf("--model") + 1]).toBe(
      CODEX_COMMIT_MESSAGE_MODEL,
    );
    expect(command).toContain(
      `model_reasoning_effort="${CODEX_COMMIT_MESSAGE_REASONING}"`,
    );
    expect(command[command.indexOf("--output-schema") + 1]).toStartWith(cwd);
    expect(cwd).toStartWith(tmpdir());
    expect(stdin).toBe("STAGED PATCH:\n+new behavior");
    expect(await stat(cwd).catch(() => null)).toBeNull();
  });

  test("rejects unavailable, malformed, and non-conventional output", async () => {
    const unavailable = new CodexCommitMessageService({ executable: null });
    expect(unavailable.capability.available).toBe(false);
    await expect(unavailable.generate("context")).rejects.toMatchObject({
      status: 503,
      code: "codex_unavailable",
    });

    const malformed = new CodexCommitMessageService({
      executable: "codex",
      spawn: () => completedProcess("not json"),
    });
    await expect(malformed.generate("context")).rejects.toMatchObject({
      status: 502,
      code: "codex_invalid_output",
    });

    const invalid = new CodexCommitMessageService({
      executable: "codex",
      spawn: () =>
        completedProcess(JSON.stringify({ message: "A plain commit subject" })),
    });
    await expect(invalid.generate("context")).rejects.toMatchObject({
      status: 502,
      code: "codex_invalid_output",
    });

    const extraProperty = new CodexCommitMessageService({
      executable: "codex",
      spawn: () =>
        completedProcess(
          JSON.stringify({
            message: "feat(review): generate commit messages",
            body: "Unexpected extra output",
          }),
        ),
    });
    await expect(extraProperty.generate("context")).rejects.toMatchObject({
      status: 502,
      code: "codex_invalid_output",
    });
  });

  test("maps authentication and model failures without falling back", async () => {
    const loggedOut = new CodexCommitMessageService({
      executable: "codex",
      spawn: () =>
        completedProcess("", "Not logged in. Run codex login.", 1),
    });
    await expect(loggedOut.generate("context")).rejects.toMatchObject({
      status: 503,
      code: "codex_login_required",
    });

    const missingModel = new CodexCommitMessageService({
      executable: "codex",
      spawn: () =>
        completedProcess("", "Unknown model gpt-5.6-luna", 1),
    });
    await expect(missingModel.generate("context")).rejects.toMatchObject({
      status: 503,
      code: "codex_model_unavailable",
    });
  });

  test("limits concurrent generation and stops an aborted subprocess", async () => {
    const pending = pendingProcess();
    let spawned = false;
    const service = new CodexCommitMessageService({
      executable: "codex",
      spawn: () => {
        spawned = true;
        return pending.handle;
      },
    });
    const controller = new AbortController();
    const first = service.generate("first context", controller.signal);

    await expect(service.generate("second context")).rejects.toMatchObject({
      status: 429,
      code: "codex_busy",
    });
    while (!spawned) await Bun.sleep(1);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(pending.stopped()).toBe(true);
  });

  test("terminates slow and excessive-output subprocesses", async () => {
    const slow = pendingProcess();
    const timed = new CodexCommitMessageService({
      executable: "codex",
      spawn: () => slow.handle,
      timeoutMs: 5,
    });
    await expect(timed.generate("context")).rejects.toMatchObject({
      status: 504,
      code: "codex_timeout",
    });
    expect(slow.stopped()).toBe(true);

    const excessive = new CodexCommitMessageService({
      executable: "codex",
      spawn: () => completedProcess("x".repeat(20 * 1024)),
    });
    await expect(excessive.generate("context")).rejects.toMatchObject({
      status: 502,
      code: "codex_output_limit",
    });
  });
});
