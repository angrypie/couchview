import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  API_ROUTES,
  REMOTE_BRIDGE_DATA_CHANNEL_LABEL,
  REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL,
  REMOTE_BRIDGE_DEVICE_TOKEN_HEADER,
  REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
  REMOTE_BRIDGE_PROTOCOL,
  type RemoteBridgeProfile,
} from "../shared/contracts.ts";
import {
  pairRemoteBridge,
  readRemoteBridgeConfig,
  remoteBridgeZedUrl,
  resolveRemoteBridgePaths,
  runRemoteBridgeProxy,
  storeRemoteBridgeProfile,
  type RemoteBridgeClientRuntime,
} from "./remoteBridgeClient.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function fixturePaths() {
  const home = await mkdtemp(path.join(tmpdir(), "couchview-bridge-client-"));
  temporaryDirectories.push(home);
  return { home, paths: resolveRemoteBridgePaths({}, home) };
}

function profile(overrides: Partial<RemoteBridgeProfile> = {}): RemoteBridgeProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    origin: "https://review.example.com",
    repositoryId: "repo-one",
    repositoryName: "Project One",
    repositoryRoot: "/Users/mini/Code/Project One",
    deviceId: "11111111-1111-4111-8111-111111111111",
    deviceToken: "t".repeat(43),
    deviceLabel: "MacBook Air",
    sshAlias: "couchview-project-one-11111111",
    username: "mini-user",
    originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
    ...overrides,
  };
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly protocol = REMOTE_BRIDGE_PROTOCOL;
  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  readonly sent: Array<string | ArrayBufferView<ArrayBuffer>> = [];

  send(value: string | ArrayBufferView<ArrayBuffer>): void {
    this.sent.push(value);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  receive(data: string | ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

class FakeInput extends EventEmitter {
  resumed = false;

  resume(): this {
    this.resumed = true;
    return this;
  }
}

class FakeOutput extends EventEmitter {
  writableLength = 0;
  readonly writes: Buffer[] = [];

  write(value: Uint8Array | string): boolean {
    this.writes.push(Buffer.from(value));
    return true;
  }
}

class FakeRtcEvent<T extends unknown[]> {
  private readonly handlers = new Set<(...args: T) => void>();

  subscribe(handler: (...args: T) => void) {
    this.handlers.add(handler);
    return { unSubscribe: () => this.handlers.delete(handler) };
  }

  emit(...args: T): void {
    for (const handler of this.handlers) handler(...args);
  }
}

class FakeClientDataChannel {
  readonly label = REMOTE_BRIDGE_DATA_CHANNEL_LABEL;
  readonly protocol = REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL;
  readonly ordered = true;
  readonly maxRetransmits = undefined;
  readonly maxPacketLifeTime = undefined;
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  bufferedAmount = 0;
  readonly onMessage = new FakeRtcEvent<[string | Buffer<ArrayBufferLike>]>();
  readonly error = new FakeRtcEvent<[Error]>();
  readonly stateChanged = new FakeRtcEvent<[
    "connecting" | "open" | "closing" | "closed"
  ]>();
  readonly sent: Array<string | Buffer<ArrayBufferLike>> = [];

  send(value: string | Buffer<ArrayBufferLike>): void {
    this.sent.push(typeof value === "string" ? value : Buffer.from(value));
  }

  open(): void {
    this.readyState = "open";
    this.stateChanged.emit("open");
  }

  receive(value: string | Buffer<ArrayBufferLike>): void {
    this.onMessage.emit(value);
  }
}

class FakeClientPeerConnection {
  readonly channel = new FakeClientDataChannel();
  readonly connectionStateChange = new FakeRtcEvent<[
    "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed"
  ]>();
  localDescription: { type: "offer"; sdp: string } | undefined;
  remoteDescription: { type: "answer"; sdp: string } | undefined;
  closed = false;

  createDataChannel(): FakeClientDataChannel {
    return this.channel;
  }

  async createOffer(): Promise<{ type: "offer"; sdp: string }> {
    return {
      type: "offer",
      sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
    };
  }

  async setLocalDescription(description: { type: "offer"; sdp: string }): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(description: { type: "answer"; sdp: string }): Promise<void> {
    this.remoteDescription = description;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("native bridge client configuration", () => {
  test("pairs through Cloudflare Access and installs a private managed SSH alias", async () => {
    const { paths } = await fixturePaths();
    await mkdir(paths.sshDirectory, { recursive: true });
    await writeFile(paths.sshConfigFile, "Host existing\n  HostName example.com\n");
    const requests: Request[] = [];
    let accessCalls = 0;
    const accessLoginModes: boolean[] = [];
    const result = await pairRemoteBridge(
      {
        origin: "https://review.example.com",
        code: "c".repeat(43),
        originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
      },
      {
        paths,
        executableCommand: "'/opt/couchview'",
        originAccessProviders: [{
          id: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
          createSession: () => ({
            requestHeaders: async (options) => {
              accessCalls += 1;
              accessLoginModes.push(options?.interactive ?? false);
              return { "cf-access-token": "access.jwt.token" };
            },
          }),
        }],
        fetch: (async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return Response.json(profile(), { status: 201 });
        }) as typeof globalThis.fetch,
      },
    );

    expect(result.deviceLabel).toBe("MacBook Air");
    expect(accessCalls).toBe(1);
    expect(accessLoginModes).toEqual([true]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("cf-access-token")).toBe("access.jwt.token");
    expect(await requests[0]?.json()).toEqual({ code: "c".repeat(43) });
    expect(await readRemoteBridgeConfig(paths)).toEqual({ version: 2, profiles: [profile()] });
    expect((await stat(paths.configFile)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.managedSshConfigFile)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.sshDirectory)).mode & 0o777).toBe(0o700);

    const managed = await readFile(paths.managedSshConfigFile, "utf8");
    expect(managed).toContain("Host couchview-project-one-11111111");
    expect(managed).toContain("ProxyCommand '/opt/couchview' bridge proxy --profile");
    expect(managed).not.toContain(profile().deviceToken);
    const sshConfig = await readFile(paths.sshConfigFile, "utf8");
    expect(sshConfig).toStartWith("Include ~/.ssh/couchview_config\n");
    expect(sshConfig).toContain("Host existing");
    expect(remoteBridgeZedUrl(result)).toBe(
      "zed://ssh/couchview-project-one-11111111/Users/mini/Code/Project%20One",
    );
  });

  test("updates a profile without duplicating the OpenSSH include", async () => {
    const { paths } = await fixturePaths();
    await storeRemoteBridgeProfile(profile(), {
      paths,
      executableCommand: "couchview",
    });
    await storeRemoteBridgeProfile(profile({ deviceLabel: "Renamed Air" }), {
      paths,
      executableCommand: "couchview",
    });
    expect((await readRemoteBridgeConfig(paths)).profiles).toHaveLength(1);
    expect((await readRemoteBridgeConfig(paths)).profiles[0]?.deviceLabel).toBe("Renamed Air");
    expect((await readFile(paths.sshConfigFile, "utf8")).match(/couchview_config/g)).toHaveLength(1);
  });

  test("migrates Cloudflare-specific version-one profiles to origin-access providers", async () => {
    const { paths } = await fixturePaths();
    await mkdir(paths.configDirectory, { recursive: true });
    const { originAccess: _originAccess, ...legacyProfile } = profile();
    await writeFile(paths.configFile, JSON.stringify({
      version: 1,
      profiles: [{ ...legacyProfile, cloudflareAccess: true }],
    }));

    expect(await readRemoteBridgeConfig(paths)).toEqual({
      version: 2,
      profiles: [profile()],
    });
  });

  test("pairs directly over a LAN origin without any origin-access adapter", async () => {
    const { paths } = await fixturePaths();
    const requests: Request[] = [];
    const directProfile = profile({
      origin: "http://mini.local:4173",
      originAccess: REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
    });
    const result = await pairRemoteBridge(
      {
        origin: "http://mini.local:4173",
        code: "c".repeat(43),
        originAccess: REMOTE_BRIDGE_NO_ORIGIN_ACCESS,
      },
      {
        paths,
        executableCommand: "couchview",
        originAccessProviders: [],
        fetch: (async (input, init) => {
          const request = new Request(input, init);
          requests.push(request);
          return Response.json(directProfile, { status: 201 });
        }) as typeof globalThis.fetch,
      },
    );

    expect(result.originAccess).toBe(REMOTE_BRIDGE_NO_ORIGIN_ACCESS);
    expect(requests[0]?.headers.has("authorization")).toBe(false);
    expect(requests[0]?.headers.has("cf-access-token")).toBe(false);
  });
});

describe("native bridge ProxyCommand", () => {
  test("composes a custom origin-access adapter with Couchview device authentication", async () => {
    const { paths } = await fixturePaths();
    await storeRemoteBridgeProfile(profile({ originAccess: "private-relay" }), {
      paths,
      executableCommand: "couchview",
    });
    const input = new FakeInput();
    const output = new FakeOutput();
    const errors: string[] = [];
    let socket: FakeWebSocket | null = null;
    let socketUrl = "";
    let socketOptions: Bun.WebSocketOptions | null = null;
    const requests: Request[] = [];
    const accessLoginModes: boolean[] = [];
    const runtime: Partial<RemoteBridgeClientRuntime> = {
      paths,
      stdin: input as unknown as NodeJS.ReadableStream,
      stdout: output as unknown as NodeJS.WritableStream & { writableLength?: number },
      stderr: (message) => errors.push(message),
      originAccessProviders: [{
        id: "private-relay",
        createSession: () => ({
          requestHeaders: async (options) => {
            accessLoginModes.push(options?.interactive ?? false);
            return { authorization: "Bearer relay-access-token" };
          },
        }),
      }],
      fetch: (async (rawInput, init) => {
        const request = new Request(rawInput, init);
        requests.push(request);
        return Response.json({
          ticket: "k".repeat(43),
          expiresAt: "2026-07-29T10:05:00.000Z",
          protocol: REMOTE_BRIDGE_PROTOCOL,
          leaseRenewIntervalMs: 30_000,
        }, { status: 201 });
      }) as typeof globalThis.fetch,
      createWebSocket: (url, options) => {
        socketUrl = url;
        socketOptions = options;
        socket = new FakeWebSocket();
        return socket as unknown as WebSocket;
      },
    };

    const proxy = runRemoteBridgeProxy(profile().id, runtime);
    for (let index = 0; index < 100 && !socket; index += 1) await Bun.sleep(1);
    const activeSocket = socket as FakeWebSocket | null;
    if (!activeSocket) throw new Error("Proxy did not create a WebSocket");
    activeSocket.open();
    activeSocket.receive(JSON.stringify({ type: "ready", transport: "websocket" }));
    expect(input.resumed).toBe(true);

    input.emit("data", Buffer.from("ssh-client"));
    const binarySent = activeSocket.sent.find((value) => typeof value !== "string");
    if (!binarySent || typeof binarySent === "string") throw new Error("Proxy sent no SSH bytes");
    expect(Buffer.from(
      binarySent.buffer,
      binarySent.byteOffset,
      binarySent.byteLength,
    ).toString()).toBe("ssh-client");
    activeSocket.receive(Uint8Array.from(Buffer.from("ssh-server")).buffer);
    expect(Buffer.concat(output.writes).toString()).toBe("ssh-server");
    activeSocket.close(1000, "remote_bridge_target_closed");
    expect(await proxy).toBe(0);

    expect(requests[0]?.headers.get(REMOTE_BRIDGE_DEVICE_TOKEN_HEADER)).toBe(
      profile().deviceToken,
    );
    expect(new URL(requests[0]!.url).pathname).toBe(
      API_ROUTES.remoteBridgeHostTickets,
    );
    expect(new URL(socketUrl).pathname).toBe(
      API_ROUTES.remoteBridgeHostSocket,
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer relay-access-token");
    expect(accessLoginModes).toEqual([false, false]);
    expect(JSON.stringify(socketOptions)).not.toContain(profile().deviceToken);
    expect(socketOptions).toMatchObject({
      headers: { authorization: "Bearer relay-access-token" },
    });
    expect(socketOptions).toMatchObject({
      protocols: [
        REMOTE_BRIDGE_PROTOCOL,
        expect.stringContaining("couchview-bridge-ticket."),
      ],
    });
    expect(errors).toEqual([]);
  });

  test("switches SSH traffic losslessly to the reliable WebRTC channel", async () => {
    const { paths } = await fixturePaths();
    await storeRemoteBridgeProfile(profile({ originAccess: REMOTE_BRIDGE_NO_ORIGIN_ACCESS }), {
      paths,
      executableCommand: "couchview",
    });
    const input = new FakeInput();
    const output = new FakeOutput();
    const peer = new FakeClientPeerConnection();
    let socket: FakeWebSocket | null = null;
    const runtime: Partial<RemoteBridgeClientRuntime> = {
      paths,
      stdin: input as unknown as NodeJS.ReadableStream,
      stdout: output as unknown as NodeJS.WritableStream & { writableLength?: number },
      stderr: () => undefined,
      fetch: (async (_input, _init) => Response.json({
          ticket: "k".repeat(43),
          expiresAt: "2026-07-29T10:05:00.000Z",
          protocol: REMOTE_BRIDGE_PROTOCOL,
          leaseRenewIntervalMs: 30_000,
          webRtc: {
            iceServers: [],
            negotiationTimeoutMs: 10_000,
            leaseRenewIntervalMs: 30_000,
          },
        }, { status: 201 })) as typeof globalThis.fetch,
      createWebSocket: () => {
        socket = new FakeWebSocket();
        return socket as unknown as WebSocket;
      },
      createPeerConnection: () => peer as unknown as ReturnType<
        RemoteBridgeClientRuntime["createPeerConnection"]
      >,
    };

    const proxy = runRemoteBridgeProxy(profile().id, runtime);
    for (let index = 0; index < 100 && !socket; index += 1) await Bun.sleep(1);
    const activeSocket = socket as FakeWebSocket | null;
    if (!activeSocket) throw new Error("Proxy did not create a WebSocket");
    activeSocket.open();
    activeSocket.receive(JSON.stringify({ type: "ready", transport: "websocket" }));
    input.emit("data", Buffer.from("before-direct"));

    for (
      let index = 0;
      index < 100 && !activeSocket.sent.some((value) =>
        typeof value === "string" && value.includes("webrtc-offer")
      );
      index += 1
    ) await Bun.sleep(1);
    expect(activeSocket.sent.some((value) =>
      typeof value === "string" && value.includes("webrtc-offer")
    )).toBe(true);
    peer.channel.open();
    activeSocket.receive(JSON.stringify({ type: "webrtc-switch" }));
    input.emit("data", Buffer.from("during-switch"));
    expect(peer.channel.sent).toEqual([]);
    expect(activeSocket.sent).toContain(JSON.stringify({ type: "webrtc-activate" }));

    peer.channel.receive(JSON.stringify({ type: "ready", transport: "webrtc" }));
    input.emit("data", Buffer.from("after-direct"));
    expect(peer.channel.sent.map((value) =>
      typeof value === "string" ? value : value.toString()
    )).toEqual(["during-switch", "after-direct"]);
    peer.channel.receive(Buffer.from("server-direct"));
    expect(Buffer.concat(output.writes).toString()).toBe("server-direct");

    const websocketBytes = activeSocket.sent
      .filter((value): value is ArrayBufferView<ArrayBuffer> => typeof value !== "string")
      .map((value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString());
    expect(websocketBytes).toEqual(["before-direct"]);
    activeSocket.close(1000, "remote_bridge_target_closed");
    expect(await proxy).toBe(0);
    expect(peer.closed).toBe(true);
  });
});
