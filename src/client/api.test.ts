import { afterEach, describe, expect, test } from "bun:test";

import { ApiError, api } from "./api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("API client", () => {
  test("preserves abort semantics instead of reporting a disconnect", async () => {
    const controller = new AbortController();
    globalThis.fetch = (() => Promise.reject(new TypeError("cancelled"))) as unknown as typeof fetch;
    controller.abort();

    const error = await api.changes("repository-id", controller.signal).catch((caught) => caught);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });

  test("turns an actual network failure into a structured disconnected error", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;

    const error = await api.changes("repository-id").catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "disconnected" });
  });

  test("preserves Git diagnostics returned by the local server", async () => {
    globalThis.fetch = (() => Promise.resolve(Response.json(
      {
        error: {
          code: "git_timeout",
          message: "Git diff stopped responding after 15 seconds",
          diagnostic: {
            id: "abc12345",
            source: "git",
            operation: "diff",
            kind: "timeout",
            exitCode: null,
            stderr: "fatal: simulated timeout",
            retryable: true,
            timeoutMs: 15_000,
          },
        },
      },
      { status: 504 },
    ))) as unknown as typeof fetch;

    const error = await api.changes("repository-id").catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 504,
      code: "git_timeout",
      diagnostic: {
        id: "abc12345",
        operation: "diff",
        kind: "timeout",
        timeoutMs: 15_000,
      },
    });
  });
});
