import { describe, expect, test } from "bun:test";

import {
  REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
} from "../shared/contracts.ts";
import {
  CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
  cloudflareOriginAccessProvider,
} from "./cloudflareAccess.ts";
import {
  remoteBridgeOriginAccessSession,
  type RemoteBridgeOriginAccessProvider,
} from "./remoteBridgeOriginAccess.ts";

describe("native bridge origin access", () => {
  test("keeps direct LAN and transparent tunnel origins dependency-free", async () => {
    const session = remoteBridgeOriginAccessSession(
      REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
      "http://mini.local:4173",
      [],
    );

    expect(await session.requestHeaders()).toEqual({});
    expect(await session.requestHeaders({ interactive: true, refresh: true })).toEqual({});
  });

  test("selects an installed provider by stable ID", async () => {
    const provider: RemoteBridgeOriginAccessProvider = {
      id: "private-relay",
      createSession: (origin) => ({
        requestHeaders: async () => ({
          authorization: `Relay ${origin}`,
        }),
      }),
    };
    const session = remoteBridgeOriginAccessSession(
      provider.id,
      "https://relay.example.com",
      [provider],
    );

    expect(await session.requestHeaders()).toEqual({
      authorization: "Relay https://relay.example.com",
    });
    expect(() => remoteBridgeOriginAccessSession(
      "missing-provider",
      "https://relay.example.com",
      [provider],
    )).toThrow("is not installed");
  });

  test("isolates cloudflared token acquisition inside the Cloudflare adapter", async () => {
    const calls: Array<{ origin: string; allowLogin: boolean }> = [];
    let token = 0;
    const provider = cloudflareOriginAccessProvider(async (origin, options) => {
      calls.push({ origin, allowLogin: options?.allowLogin ?? false });
      token += 1;
      return `access-token-${token}`;
    });
    expect(provider.id).toBe(CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID);
    const session = provider.createSession("https://review.example.com");

    expect(await session.requestHeaders({ interactive: true })).toEqual({
      "cf-access-token": "access-token-1",
    });
    expect(await session.requestHeaders()).toEqual({
      "cf-access-token": "access-token-1",
    });
    expect(await session.requestHeaders({ refresh: true })).toEqual({
      "cf-access-token": "access-token-2",
    });
    expect(calls).toEqual([
      { origin: "https://review.example.com", allowLogin: true },
      { origin: "https://review.example.com", allowLogin: false },
    ]);
  });
});
