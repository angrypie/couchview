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

  test("requests an AJAX 401 and reports that secure sign-in is required", async () => {
    let requestHeaders = new Headers();
    let credentials: RequestCredentials | undefined;
    let redirect: RequestRedirect | undefined;
    globalThis.fetch = ((_input, init) => {
      requestHeaders = new Headers(init?.headers);
      credentials = init?.credentials;
      redirect = init?.redirect;
      return Promise.resolve(new Response("Sign in", { status: 401 }));
    }) as typeof fetch;

    const error = await api.bootstrap().catch((caught) => caught);
    expect(requestHeaders.get("x-requested-with")).toBe("XMLHttpRequest");
    expect(credentials).toBe("same-origin");
    expect(redirect).toBe("manual");
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: "authentication_required",
      message: "Your secure sign-in session has expired.",
    });
  });

  test("treats an opaque Access login redirect as an authentication failure", async () => {
    globalThis.fetch = (() => Promise.resolve({
      ok: false,
      status: 0,
      type: "opaqueredirect",
    } as Response)) as unknown as typeof fetch;

    const error = await api.bootstrap().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: "authentication_required",
    });
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
