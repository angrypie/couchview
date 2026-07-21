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

    const error = await api.changes(controller.signal).catch((caught) => caught);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });

  test("turns an actual network failure into a structured disconnected error", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;

    const error = await api.changes().catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "disconnected" });
  });
});
