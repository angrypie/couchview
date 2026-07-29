import { describe, expect, test } from "bun:test";

import {
  REMOTE_BRIDGE_DATA_CHANNEL_LABEL,
  REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL,
  REMOTE_BRIDGE_P2P_FAILED_CLOSE_CODE,
  REMOTE_BRIDGE_PROTOCOL,
  REMOTE_BRIDGE_TICKET_PREFIX,
} from "../shared/contracts.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";
import { StateDatabase } from "./database.ts";
import {
  RemoteBridgeService,
  type RemoteBridgeSocketData,
  type RemoteBridgeTcpSocket,
} from "./remoteBridgeService.ts";
import type {
  TerminalDataChannel,
  TerminalEvent,
  TerminalPeerConnection,
} from "./terminalSessions.ts";

class FakeEvent<T extends unknown[]> implements TerminalEvent<T> {
  private readonly handlers = new Set<(...args: T) => void>();

  subscribe(handler: (...args: T) => void) {
    this.handlers.add(handler);
    return { unSubscribe: () => this.handlers.delete(handler) };
  }

  emit(...args: T): void {
    for (const handler of this.handlers) handler(...args);
  }
}

class FakeDataChannel implements TerminalDataChannel {
  readonly label = REMOTE_BRIDGE_DATA_CHANNEL_LABEL;
  readonly protocol = REMOTE_BRIDGE_DATA_CHANNEL_PROTOCOL;
  readonly ordered = true;
  readonly maxRetransmits = undefined;
  readonly maxPacketLifeTime = undefined;
  readyState: "open" | "closed" | "connecting" | "closing" = "connecting";
  bufferedAmount = 0;
  readonly stateChanged = new FakeEvent<[
    "open" | "closed" | "connecting" | "closing"
  ]>();
  readonly onMessage = new FakeEvent<[string | Buffer<ArrayBufferLike>]>();
  readonly error = new FakeEvent<[Error]>();
  readonly sent: Array<string | Buffer<ArrayBufferLike>> = [];

  send(value: string | Buffer<ArrayBufferLike>): void {
    this.sent.push(typeof value === "string" ? value : Buffer.from(value));
  }

  open(): void {
    this.readyState = "open";
    this.stateChanged.emit("open");
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.stateChanged.emit("closed");
  }
}

class FakePeerConnection implements TerminalPeerConnection {
  readonly onDataChannel = new FakeEvent<[TerminalDataChannel]>();
  readonly connectionStateChange = new FakeEvent<[
    "disconnected" | "closed" | "new" | "connected" | "connecting" | "failed"
  ]>();
  localDescription: { type: "answer"; sdp: string } | undefined;
  closed = false;

  async setRemoteDescription(): Promise<void> {}

  async createAnswer(): Promise<{ type: "answer"; sdp: string }> {
    return {
      type: "answer",
      sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
    };
  }

  async setLocalDescription(description: { type: "answer"; sdp: string }): Promise<void> {
    this.localDescription = description;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeTcpSocket implements RemoteBridgeTcpSocket {
  writableLength = 0;
  readonly writes: Buffer<ArrayBufferLike>[] = [];
  connectedTo: { host: string; port: number } | null = null;
  destroyed = false;
  private openHandler: () => void = () => undefined;
  private dataHandler: (data: Buffer<ArrayBufferLike>) => void = () => undefined;
  private closeHandler: () => void = () => undefined;
  private errorHandler: (error: Error) => void = () => undefined;

  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }

  onData(handler: (data: Buffer<ArrayBufferLike>) => void): void {
    this.dataHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  connect(host: string, port: number): void {
    this.connectedTo = { host, port };
  }

  write(data: Buffer<ArrayBufferLike>): boolean {
    this.writes.push(Buffer.from(data));
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  open(): void {
    this.openHandler();
  }

  data(value: string): void {
    this.dataHandler(Buffer.from(value));
  }

  closeFromTarget(): void {
    this.closeHandler();
  }

  fail(message: string): void {
    this.errorHandler(new Error(message));
  }
}

function fakeSocket(data: RemoteBridgeSocketData) {
  const sent: string[] = [];
  const binary: Uint8Array[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  return {
    binaryType: "arraybuffer",
    data,
    sent,
    binary,
    closes,
    sendText(value: string) {
      sent.push(value);
      return value.length;
    },
    sendBinary(value: Uint8Array) {
      binary.push(Uint8Array.from(value));
      return value.byteLength;
    },
    close(code?: number, reason?: string) {
      closes.push({ code, reason });
    },
  } as unknown as Bun.ServerWebSocket<RemoteBridgeSocketData> & {
    sent: string[];
    binary: Uint8Array[];
    closes: Array<{ code?: number; reason?: string }>;
  };
}

function upgradeRequest(ticket: string): Request {
  return new Request(
    "https://review.example.com/api/repositories/repo-one/remote-bridge/socket",
    {
      headers: {
        host: "review.example.com",
        upgrade: "websocket",
        "sec-websocket-protocol":
          `${REMOTE_BRIDGE_PROTOCOL}, ${REMOTE_BRIDGE_TICKET_PREFIX}${ticket}`,
      },
    },
  );
}

function serviceFixture(options: {
  p2pEnabled?: boolean;
  peer?: FakePeerConnection;
  now?: () => number;
} = {}) {
  const database = StateDatabase.memory();
  database.registerRepository({
    id: "repo-one",
    name: "Project One",
    root: "/projects/one",
    gitDirectory: "/projects/one/.git",
  });
  const tcp = new FakeTcpSocket();
  const tokens = ["a".repeat(43), "b".repeat(43), "c".repeat(43), "d".repeat(43)];
  const service = new RemoteBridgeService({
    enabled: true,
    database,
    p2pEnabled: options.p2pEnabled,
    username: "mini-user",
    now: options.now,
    tokenFactory: () => tokens.shift() ?? "z".repeat(43),
    tcpSocketFactory: () => tcp,
    peerConnectionFactory: options.peer ? () => options.peer! : undefined,
  });
  return { database, service, tcp };
}

function pair(service: RemoteBridgeService) {
  const pairing = service.createPairing(
    { id: "repo-one", name: "Project One", root: "/projects/one" },
    { label: "MacBook Air" },
    {
      origin: "https://review.example.com",
      originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
    },
  );
  const code = /--code '([^']+)'/.exec(pairing.command)?.[1];
  if (!code) throw new Error("Pairing command did not contain a code");
  return {
    pairing,
    profile: service.claimPairing({ code }),
  };
}

function attach(service: RemoteBridgeService, deviceToken: string, connectionId = "connection_123") {
  const ticket = service.issueTicket(
    "repo-one",
    "/projects/one",
    deviceToken,
    { connectionId },
    { host: "review.example.com" },
  );
  const data = service.consumeUpgrade(
    "repo-one",
    upgradeRequest(ticket.ticket),
    { host: "review.example.com" },
  );
  const socket = fakeSocket(data);
  service.websocket.open!(socket);
  return { socket, ticket };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("native remote bridge authorization", () => {
  test("keeps the bridge opt-in and restricts its SSH target to loopback", () => {
    const database = StateDatabase.memory();
    const disabled = new RemoteBridgeService({ enabled: false, database });
    expect(disabled.capability).toMatchObject({ available: false, p2pEnabled: false });
    expect(() => disabled.listDevices("repo-one")).toThrow(
      expect.objectContaining({ code: "remote_bridge_disabled" }),
    );
    expect(() => new RemoteBridgeService({
      enabled: true,
      database,
      targetHost: "192.168.1.5",
    })).toThrow("must be loopback");
    expect(() => new RemoteBridgeService({
      enabled: true,
      database,
      targetHost: "localhost",
    })).toThrow("must be loopback");
    expect(() => new RemoteBridgeService({
      enabled: true,
      database,
      username: "invalid user",
    })).toThrow("username is invalid");
    disabled.close();
    database.close();
  });

  test("uses one-use pairing codes, hashed device credentials, and bound tickets", () => {
    const { database, service } = serviceFixture();
    const { pairing, profile } = pair(service);
    expect(pairing.command).toContain("--origin-access 'cloudflare-access'");
    expect(profile).toMatchObject({
      origin: "https://review.example.com",
      repositoryId: "repo-one",
      repositoryRoot: "/projects/one",
      deviceLabel: "MacBook Air",
      username: "mini-user",
      originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
    });
    expect(service.listDevices("repo-one").devices[0]).not.toHaveProperty("deviceToken");
    expect(() => service.claimPairing({ code: "a".repeat(43) })).toThrow(
      expect.objectContaining({ code: "remote_bridge_pairing_expired" }),
    );
    expect(() => service.issueTicket(
      "repo-one",
      "/projects/one",
      "x".repeat(43),
      { connectionId: "connection_123" },
      { host: "review.example.com" },
    )).toThrow(expect.objectContaining({ code: "remote_bridge_token_invalid" }));

    const issued = service.issueTicket(
      "repo-one",
      "/projects/one",
      profile.deviceToken,
      { connectionId: "connection_123" },
      { host: "review.example.com" },
    );
    expect(issued).toMatchObject({
      protocol: REMOTE_BRIDGE_PROTOCOL,
      leaseRenewIntervalMs: 30_000,
    });
    expect(() => service.consumeUpgrade(
      "repo-one",
      upgradeRequest(issued.ticket),
      { host: "other.example.com" },
    )).toThrow(expect.objectContaining({ code: "remote_bridge_ticket_invalid" }));
    expect(() => service.consumeUpgrade(
      "repo-one",
      upgradeRequest(issued.ticket),
      { host: "review.example.com" },
    )).toThrow(expect.objectContaining({ code: "remote_bridge_ticket_invalid" }));
    service.close();
    database.close();
  });
});

describe("native remote bridge transport", () => {
  test("pipes SSH bytes through WebSocket fallback and revokes an active device", () => {
    const { database, service, tcp } = serviceFixture();
    const { profile } = pair(service);
    const { socket } = attach(service, profile.deviceToken);
    expect(tcp.connectedTo).toEqual({ host: "127.0.0.1", port: 22 });
    tcp.open();
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual(
      expect.objectContaining({ type: "ready", transport: "websocket" }),
    );

    service.websocket.message!(socket, Buffer.from("ssh-client"));
    expect(tcp.writes.map((value) => value.toString())).toEqual(["ssh-client"]);
    tcp.data("ssh-server");
    expect(Buffer.concat(socket.binary.map((value) => Buffer.from(value))).toString()).toBe(
      "ssh-server",
    );
    expect(service.renewLease(
      "repo-one",
      profile.deviceToken,
      { connectionId: "connection_123" },
      { host: "review.example.com" },
    ).expiresAt).toBeString();

    const pending = service.issueTicket(
      "repo-one",
      "/projects/one",
      profile.deviceToken,
      { connectionId: "pending_connection" },
      { host: "review.example.com" },
    );

    service.revokeDevice("repo-one", profile.deviceId);
    expect(tcp.destroyed).toBe(true);
    expect(socket.closes).toContainEqual({
      code: 4003,
      reason: "remote_bridge_device_revoked",
    });
    expect(service.listDevices("repo-one").devices).toEqual([]);
    expect(() => service.consumeUpgrade(
      "repo-one",
      upgradeRequest(pending.ticket),
      { host: "review.example.com" },
    )).toThrow(expect.objectContaining({ code: "remote_bridge_ticket_invalid" }));
    service.close();
    database.close();
  });

  test("hands off losslessly to reliable WebRTC and reconnects after active failure", async () => {
    const peer = new FakePeerConnection();
    const channel = new FakeDataChannel();
    const { database, service, tcp } = serviceFixture({ p2pEnabled: true, peer });
    const { profile } = pair(service);
    const { socket, ticket } = attach(service, profile.deviceToken);
    expect(ticket.webRtc?.iceServers).toBeArray();
    tcp.open();
    service.websocket.message!(socket, JSON.stringify({
      type: "webrtc-offer",
      offer: {
        type: "offer",
        sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
      },
    }));
    await settle();
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual(
      expect.objectContaining({ type: "webrtc-answer" }),
    );

    peer.onDataChannel.emit(channel);
    channel.open();
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "webrtc-switch",
    });
    tcp.data("buffered-before-activation");
    expect(channel.sent).toEqual([]);
    service.websocket.message!(socket, JSON.stringify({ type: "webrtc-activate" }));
    expect(JSON.parse(channel.sent[0] as string)).toEqual({
      type: "ready",
      transport: "webrtc",
    });
    expect(Buffer.from(channel.sent[1] as Buffer).toString()).toBe(
      "buffered-before-activation",
    );

    channel.onMessage.emit(Buffer.from("direct-client"));
    expect(tcp.writes.at(-1)?.toString()).toBe("direct-client");
    tcp.data("direct-server");
    expect(Buffer.from(channel.sent.at(-1) as Buffer).toString()).toBe("direct-server");

    peer.connectionStateChange.emit("failed");
    expect(socket.closes).toContainEqual({
      code: REMOTE_BRIDGE_P2P_FAILED_CLOSE_CODE,
      reason: "remote_bridge_p2p_connection_lost",
    });
    expect(tcp.destroyed).toBe(true);
    service.close();
    database.close();
  });
});
