import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  API_ROUTES,
  CSRF_HEADER,
  REMOTE_BRIDGE_DEVICE_TOKEN_HEADER,
  REMOTE_BRIDGE_PROTOCOL,
  REMOTE_BRIDGE_TICKET_PREFIX,
  type ApiErrorBody,
  type BootstrapResponse,
  type ChangesResponse,
  type CommitResponse,
  type GenerateCommitMessageResponse,
  type PackageRunEvent,
  type PackageRunResponse,
  type PackageRunsResponse,
  type PackageScriptsResponse,
  type RegisterRepositoryResponse,
  type RepositoryCatalogResponse,
  type ReviewStateResponse,
  type ServerEvent,
  type StageFileResponse,
  type StageFilesResponse,
  type RemoteBridgeProfile,
  type RemoteBridgeTicketResponse,
} from "../shared/contracts.ts";
import type { CommitMessageGenerator } from "./commitMessage.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";
import type { CodexAppServerService } from "./codexAppServer.ts";
import {
  accessOriginsForHost,
  createCouchviewApp,
  type CouchviewApp,
  type CouchviewAppOptions,
  type CouchviewSocketData,
} from "./server.ts";
import { GitCommandError } from "./git.ts";
import type { TerminalSessionService, TerminalSocketData } from "./terminalSessions.ts";

const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];

afterEach(async () => {
  for (const application of applications.splice(0)) application.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  revisionPollIntervalMs?: number,
  restart?: CouchviewAppOptions["restart"],
  commitMessages?: CommitMessageGenerator,
  codex?: CodexAppServerService,
  terminalSessions?: TerminalSessionService,
  remoteBridge?: CouchviewAppOptions["remoteBridge"],
) {
  const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-"));
  temporaryDirectories.push(directory);
  expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "-C", directory, "config", "user.name", "Couchview Tests"]).exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "-C", directory, "config", "user.email", "couchview@example.invalid"]).exitCode).toBe(0);
  await writeFile(path.join(directory, "sample.ts"), "const sample = true;\n", "utf8");
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "couchview-server-state-"));
  temporaryDirectories.push(stateDirectory);
  const app = await createCouchviewApp({
    root: directory,
    host: "127.0.0.1",
    port: 3001,
    stateDatabasePath: path.join(stateDirectory, "state.sqlite"),
    revisionPollIntervalMs,
    restart,
    commitMessages,
    codex,
    terminalSessions,
    remoteBridge,
  });
  applications.push(app);
  return app;
}

function request(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1:3001");
  return new Request(`http://127.0.0.1:3001${pathname}`, { ...init, headers });
}

async function repositoryFixture(fileName: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-repository-"));
  temporaryDirectories.push(directory);
  expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
  await writeFile(path.join(directory, fileName), `export const ${fileName.replace(/\W/g, "_")} = true;\n`);
  return directory;
}

async function nextSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedType: ServerEvent["type"],
): Promise<ServerEvent> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (result === "timeout" || result.done) break;
    const text = new TextDecoder().decode(result.value);
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6)) as ServerEvent;
      if (event.type === expectedType) return event;
    }
  }
  throw new Error(`Timed out waiting for ${expectedType} SSE event`);
}

async function nextPackageRunEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<PackageRunEvent> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), deadline - Date.now())
      ),
    ]);
    if (result === "timeout" || result.done) break;
    const text = new TextDecoder().decode(result.value);
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        return JSON.parse(line.slice(6)) as PackageRunEvent;
      }
    }
  }
  throw new Error("Timed out waiting for package-run SSE event");
}

describe("Couchview HTTP security and routes", () => {
  test("guards tmux APIs and upgrades only authenticated sockets", async () => {
    const attachmentCalls: Array<{
      repositoryId: string;
      repositoryRoot: string;
    }> = [];
    const endCalls: string[] = [];
    const leaseCalls: Array<{ repositoryId: string; clientId: string }> = [];
    let consumedUpgrade = false;
    let closed = false;
    const terminalSessions = {
      enabled: true,
      p2pEnabled: true,
      stunUrls: ["stun:stun.cloudflare.com:3478"],
      capability: {
        available: true,
        reason: null,
        persistence: "tmux",
        profiles: [{ id: "tmux", label: "tmux", available: true, reason: null }],
      },
      websocket: {},
      async status() {
        return { profileId: "tmux", running: true, controllerConnected: false };
      },
      async issueAttachment(
        repositoryId: string,
        repositoryRoot: string,
        _input: unknown,
        _binding: unknown,
      ) {
        attachmentCalls.push({ repositoryId, repositoryRoot });
        return {
          ticket: "single-use-ticket",
          expiresAt: "2026-07-26T12:00:30.000Z",
          protocol: "couchview-terminal-v1",
          session: { profileId: "tmux", running: true, controllerConnected: false },
        };
      },
      async end(repositoryId: string) {
        endCalls.push(repositoryId);
        return { status: "ended" };
      },
      renewLease(repositoryId: string, input: { clientId: string }) {
        leaseCalls.push({ repositoryId, clientId: input.clientId });
        return { expiresAt: "2026-07-26T12:02:00.000Z" };
      },
      consumeUpgrade(
        repositoryId: string,
        _request: Request,
        _binding: unknown,
      ): TerminalSocketData {
        consumedUpgrade = true;
        return {
          kind: "terminal",
          repositoryId,
          repositoryRoot: "/project",
          clientId: "client_12345678",
          profileId: "tmux",
          cols: 100,
          rows: 32,
          takeover: false,
          host: "127.0.0.1:3001",
          origin: "http://127.0.0.1:3001",
        };
      },
      close() {
        closed = true;
      },
    } as unknown as TerminalSessionService;
    const app = await fixture(
      undefined,
      undefined,
      undefined,
      undefined,
      terminalSessions,
    );
    const bootstrap = await (await app.fetch(request(API_ROUTES.bootstrap))).json() as BootstrapResponse;
    expect(bootstrap.terminal).toMatchObject({ available: true, persistence: "tmux" });

    const attachmentBody = JSON.stringify({
      clientId: "client_12345678",
      profileId: "tmux",
      cols: 100,
      rows: 32,
      takeover: false,
    });
    const mutationHeaders = {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3001",
      [CSRF_HEADER]: app.csrfToken,
    };

    const unprotected = await app.fetch(request(
      API_ROUTES.terminalAttachments(app.repository.id),
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:3001" },
        body: attachmentBody,
      },
    ));
    expect(unprotected.status).toBe(403);

    const attached = await app.fetch(request(
      API_ROUTES.terminalAttachments(app.repository.id),
      { method: "POST", headers: mutationHeaders, body: attachmentBody },
    ));
    expect(attached.status).toBe(201);
    expect(attachmentCalls).toEqual([{
      repositoryId: app.repository.id,
      repositoryRoot: app.repository.root,
    }]);

    const leased = await app.fetch(request(
      API_ROUTES.terminalLease(app.repository.id),
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ clientId: "client_12345678" }),
      },
    ));
    expect(leased.status).toBe(200);
    expect(leaseCalls).toEqual([{
      repositoryId: app.repository.id,
      clientId: "client_12345678",
    }]);

    const ended = await app.fetch(request(
      API_ROUTES.terminalEnd(app.repository.id),
      {
        method: "POST",
        headers: mutationHeaders,
      },
    ));
    expect(ended.status).toBe(200);
    expect(endCalls).toEqual([app.repository.id]);

    let upgradedData: TerminalSocketData | null = null;
    let selectedProtocol: string | null = null;
    const fakeServer = {
      upgrade(_request: Request, options: { data: TerminalSocketData; headers: HeadersInit }) {
        upgradedData = options.data;
        selectedProtocol = new Headers(options.headers).get("sec-websocket-protocol");
        return true;
      },
    } as unknown as Bun.Server<TerminalSocketData>;
    const socketRequest = (origin = "http://127.0.0.1:3001") => request(
      API_ROUTES.terminalSocket(app.repository.id),
      {
        headers: {
          origin,
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-protocol": "couchview-terminal-v1, couchview-ticket.single-use-ticket",
        },
      },
    );
    const missingOrigin = await app.fetchWithServer(
      request(API_ROUTES.terminalSocket(app.repository.id), {
        headers: { upgrade: "websocket" },
      }),
      fakeServer,
    );
    expect(missingOrigin?.status).toBe(403);
    const upgraded = await app.fetchWithServer(socketRequest(), fakeServer);
    expect(upgraded).toBeUndefined();
    expect(consumedUpgrade).toBe(true);
    expect(upgradedData).toMatchObject({ repositoryId: app.repository.id });
    expect(String(selectedProtocol)).toBe("couchview-terminal-v1");

    app.close();
    expect(closed).toBe(true);
    applications.splice(applications.indexOf(app), 1);
  });

  test("pairs, authenticates, upgrades, and revokes native IDE devices", async () => {
    const app = await fixture(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        enabled: true,
        p2pEnabled: true,
        stunUrls: ["stun:stun.cloudflare.com:3478"],
      },
    );
    const bootstrap = await (await app.fetch(request(API_ROUTES.bootstrap))).json() as
      BootstrapResponse;
    expect(bootstrap.remoteBridge).toMatchObject({
      available: true,
      p2pEnabled: true,
    });
    const route = API_ROUTES.remoteBridgePairings(app.repository.id);
    const unauthenticated = await app.fetch(request(route, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3001",
        "content-type": "application/json",
      },
      body: JSON.stringify({ label: "MacBook Air" }),
    }));
    expect(unauthenticated.status).toBe(403);

    const created = await app.fetch(request(route, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3001",
        [CSRF_HEADER]: app.csrfToken,
        "content-type": "application/json",
        "cf-access-jwt-assertion": "edge-verified-jwt",
      },
      body: JSON.stringify({ label: "MacBook Air" }),
    }));
    expect(created.status).toBe(201);
    const pairing = await created.json() as { command: string; sshAlias: string };
    expect(pairing.command).toContain("--origin-access 'cloudflare-access'");
    const code = /--code '([^']+)'/.exec(pairing.command)?.[1];
    expect(code).toBeString();

    const claimed = await app.fetch(request(API_ROUTES.remoteBridgeClaim, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }));
    expect(claimed.status).toBe(201);
    const profile = await claimed.json() as RemoteBridgeProfile;
    expect(profile).toMatchObject({
      sshAlias: pairing.sshAlias,
      repositoryId: app.repository.id,
      originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
    });

    const listed = await app.fetch(request(route));
    expect(await listed.json()).toMatchObject({
      devices: [{ id: profile.deviceId, label: "MacBook Air" }],
    });
    const missingCredential = await app.fetch(request(
      API_ROUTES.remoteBridgeHostTickets,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection_123" }),
      },
    ));
    expect(missingCredential.status).toBe(403);
    const legacyCredential = await app.fetch(request(
      API_ROUTES.remoteBridgeTickets(app.repository.id),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${profile.deviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ connectionId: "connection_legacy" }),
      },
    ));
    expect(legacyCredential.status).toBe(201);
    const ticketResponse = await app.fetch(request(
      API_ROUTES.remoteBridgeHostTickets,
      {
        method: "POST",
        headers: {
          [REMOTE_BRIDGE_DEVICE_TOKEN_HEADER]: profile.deviceToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ connectionId: "connection_123" }),
      },
    ));
    expect(ticketResponse.status).toBe(201);
    const ticket = await ticketResponse.json() as RemoteBridgeTicketResponse;
    expect(ticket.webRtc?.iceServers).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);

    let upgradedData: CouchviewSocketData | null = null;
    let selectedProtocol: string | null = null;
    const fakeServer = {
      upgrade(_request: Request, options: { data: CouchviewSocketData; headers: HeadersInit }) {
        upgradedData = options.data;
        selectedProtocol = new Headers(options.headers).get("sec-websocket-protocol");
        return true;
      },
    } as unknown as Bun.Server<CouchviewSocketData>;
    const socketRequest = request(API_ROUTES.remoteBridgeHostSocket, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-protocol":
          `${REMOTE_BRIDGE_PROTOCOL}, ${REMOTE_BRIDGE_TICKET_PREFIX}${ticket.ticket}`,
      },
    });
    expect(await app.fetchWithServer(socketRequest, fakeServer)).toBeUndefined();
    expect(upgradedData).toMatchObject({
      kind: "remote-bridge",
      deviceId: profile.deviceId,
      connectionId: "connection_123",
    });
    expect(String(selectedProtocol)).toBe(REMOTE_BRIDGE_PROTOCOL);
    const replay = await app.fetchWithServer(socketRequest, fakeServer);
    expect(replay?.status).toBe(403);

    const revoked = await app.fetch(request(
      API_ROUTES.remoteBridgePairing(app.repository.id, profile.deviceId),
      {
        method: "DELETE",
        headers: {
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: app.csrfToken,
        },
      },
    ));
    expect(revoked.status).toBe(204);
    expect(await (await app.fetch(request(route))).json()).toEqual({ devices: [] });
  });

  test("embeds a configured tunnel-neutral origin-access provider in pairings", async () => {
    const app = await fixture(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        enabled: true,
        originAccess: "private-relay",
      },
    );
    const route = API_ROUTES.remoteBridgePairings(app.repository.id);
    const created = await app.fetch(request(route, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3001",
        [CSRF_HEADER]: app.csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ label: "MacBook Air" }),
    }));
    const pairing = await created.json() as { command: string };
    expect(pairing.command).toContain("--origin-access 'private-relay'");
    const code = /--code '([^']+)'/.exec(pairing.command)?.[1];
    const claimed = await app.fetch(request(API_ROUTES.remoteBridgeClaim, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }));
    expect(await claimed.json()).toMatchObject({ originAccess: "private-relay" });
    expect(app.remoteBridgeOriginAccess).toBe("private-relay");
  });

  test("exposes project-scoped Codex threads and sends only current comments", async () => {
    let activeRoot = "";
    let prompt = "";
    const capability = { available: true, reason: null };
    const summary = (id: string, cwd: string, status: "idle" | "active" = "idle") => ({
      id,
      preview: id,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      recencyAt: "2026-01-01T00:01:00.000Z",
      modelProvider: "fake",
      status,
      cwd,
    });
    const codex = {
      capability,
      capabilityFor() {
        return capability;
      },
      async listThreads(root: string) {
        activeRoot = root;
        return { threads: [summary("project-thread", root)], nextCursor: "older" };
      },
      async startThread(root: string) {
        return summary("new-thread", root);
      },
      async readThread(threadId: string) {
        if (threadId === "active-thread") return summary(threadId, activeRoot, "active");
        return summary(threadId, threadId === "cross-project" ? "/another/project" : activeRoot);
      },
      async resumeThread(threadId: string) {
        return summary(threadId, activeRoot);
      },
      async startTurn(threadId: string, value: string) {
        prompt = value;
        return { threadId, turnId: "turn-1", status: "started" as const };
      },
      async interruptTurn() {},
      events() {
        return { events: [], unsubscribe() {} };
      },
      async respondApproval() {},
      close() {},
    } as unknown as CouchviewAppOptions["codex"];
    const app = await fixture(undefined, undefined, undefined, codex);

    const bootstrap = await (await app.fetch(request(API_ROUTES.bootstrap))).json() as BootstrapResponse;
    expect(bootstrap.codex).toEqual({ available: true, reason: null });
    const threadsResponse = await app.fetch(request(API_ROUTES.codexThreads(app.repository.id)));
    expect(threadsResponse.status).toBe(200);
    expect(await threadsResponse.json()).toMatchObject({
      threads: [{ id: "project-thread" }],
      nextCursor: "older",
    });

    const createWithoutCsrf = await app.fetch(request(API_ROUTES.codexThreads(app.repository.id), {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3001", "content-type": "application/json" },
      body: "{}",
    }));
    expect(createWithoutCsrf.status).toBe(403);
    const created = await app.fetch(request(API_ROUTES.codexThreads(app.repository.id), {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3001",
        "content-type": "application/json",
        [CSRF_HEADER]: app.csrfToken,
      },
      body: "{}",
    }));
    expect(created.status).toBe(201);

    const crossProject = await app.fetch(request(API_ROUTES.codexThread(app.repository.id, "cross-project")));
    expect(crossProject.status).toBe(404);
    const activeSend = await app.fetch(request(API_ROUTES.codexThreadTurns(app.repository.id, "active-thread"), {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3001", [CSRF_HEADER]: app.csrfToken, "content-type": "application/json" },
      body: "{}",
    }));
    expect(activeSend.status).toBe(409);
    expect((await activeSend.json()) as ApiErrorBody).toMatchObject({ error: { code: "codex_thread_in_use" } });
    const emptySend = await app.fetch(request(API_ROUTES.codexThreadTurns(app.repository.id, "project-thread"), {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3001", [CSRF_HEADER]: app.csrfToken, "content-type": "application/json" },
      body: "{}",
    }));
    expect(emptySend.status).toBe(409);
    expect((await emptySend.json()) as ApiErrorBody).toMatchObject({ error: { code: "codex_no_comments" } });

    const firstChanges = await app.repository.changes();
    const firstFile = firstChanges.files[0]!;
    const firstDiff = await app.repository.diff(firstFile.id);
    await app.repository.createComment({
      fileId: firstFile.id,
      contentRevision: firstFile.contentRevision,
      side: "new",
      startLine: 1,
      endLine: 1,
      hunkHeader: firstDiff.diff.hunks[0]?.header ?? "",
      excerpt: ["stale"],
      body: "stale comment",
    });
    await writeFile(path.join(app.repository.root, "sample.ts"), "const sample = false;\n", "utf8");
    const secondChanges = await app.repository.changes();
    const secondFile = secondChanges.files[0]!;
    const secondDiff = await app.repository.diff(secondFile.id);
    await app.repository.createComment({
      fileId: secondFile.id,
      contentRevision: secondFile.contentRevision,
      side: "new",
      startLine: 1,
      endLine: 1,
      hunkHeader: secondDiff.diff.hunks[0]?.header ?? "",
      excerpt: ["current"],
      body: "current comment",
    });
    const sent = await app.fetch(request(API_ROUTES.codexThreadTurns(app.repository.id, "project-thread"), {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3001", [CSRF_HEADER]: app.csrfToken, "content-type": "application/json" },
      body: "{}",
    }));
    expect(sent.status).toBe(202);
    expect(prompt).toContain("current comment");
    expect(prompt).not.toContain("stale comment");
  });

  test("discovers and runs package scripts through protected repository routes", async () => {
    const app = await fixture();
    await writeFile(
      path.join(app.repository.root, "package.json"),
      JSON.stringify({
        scripts: {
          verify: "printf 'server-route-output'",
          dev: "sleep 30",
        },
      }),
    );

    const scriptsResponse = await app.fetch(
      request(API_ROUTES.packageScripts(app.repository.id)),
    );
    expect(scriptsResponse.status).toBe(200);
    const scripts = (await scriptsResponse.json()) as PackageScriptsResponse;
    expect(scripts.packages).toHaveLength(1);
    expect(scripts.packages[0]).toMatchObject({
      packagePath: "package.json",
      directory: ".",
      runner: "bun",
    });
    const packageEntry = scripts.packages[0]!;
    const startBody = JSON.stringify({
      packagePath: packageEntry.packagePath,
      scriptName: "verify",
      manifestRevision: packageEntry.manifestRevision,
    });

    const unprotected = await app.fetch(
      request(API_ROUTES.packageRuns(app.repository.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: startBody,
      }),
    );
    expect(unprotected.status).toBe(403);

    const startedResponse = await app.fetch(
      request(API_ROUTES.packageRuns(app.repository.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: app.csrfToken,
        },
        body: startBody,
      }),
    );
    expect(startedResponse.status).toBe(201);
    const started = (await startedResponse.json()) as PackageRunResponse;
    await Bun.sleep(80);

    const eventsResponse = await app.fetch(
      request(API_ROUTES.packageRunEvents(app.repository.id, started.run.id)),
    );
    expect(eventsResponse.status).toBe(200);
    const reader = eventsResponse.body!.getReader();
    const event = await nextPackageRunEvent(reader);
    expect(event.type).toBe("snapshot");
    if (event.type !== "snapshot") throw new Error("Package snapshot missing");
    expect(
      event.snapshot.run,
      event.snapshot.output.map((chunk) => chunk.text).join(""),
    ).toMatchObject({
      id: started.run.id,
      status: "succeeded",
      exitCode: 0,
    });
    expect(event.snapshot.output.map((chunk) => chunk.text).join("")).toContain(
      "server-route-output",
    );
    await reader.cancel();

    const runs = (await (
      await app.fetch(request(API_ROUTES.packageRuns(app.repository.id)))
    ).json()) as PackageRunsResponse;
    expect(runs.runs.map((run) => run.id)).toContain(started.run.id);

    const longRunResponse = await app.fetch(
      request(API_ROUTES.packageRuns(app.repository.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: app.csrfToken,
        },
        body: JSON.stringify({
          packagePath: packageEntry.packagePath,
          scriptName: "dev",
          manifestRevision: packageEntry.manifestRevision,
        }),
      }),
    );
    const longRun = (await longRunResponse.json()) as PackageRunResponse;
    const stop = async () =>
      app.fetch(
        request(
          API_ROUTES.packageRunStop(app.repository.id, longRun.run.id),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://127.0.0.1:3001",
              [CSRF_HEADER]: app.csrfToken,
            },
            body: "{}",
          },
        ),
      );
    expect(((await (await stop()).json()) as PackageRunResponse).run.status).toBe(
      "stopping",
    );
    expect(
      ((await (await stop()).json()) as PackageRunResponse).run.status,
    ).toMatch(/stopping|stopped/);
  });

  test("bootstraps, rejects foreign origins, and protects staging and committing", async () => {
    const app = await fixture();
    const bootstrapResponse = await app.fetch(request(API_ROUTES.bootstrap));
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = (await bootstrapResponse.json()) as BootstrapResponse;
    expect(bootstrap.csrfToken).toHaveLength(43);
    expect(bootstrap.restart).toEqual({
      available: false,
      reason: "Restart is unavailable for this Couchview process.",
    });
    const unavailableRestart = await app.fetch(
      request(API_ROUTES.restart, {
        method: "POST",
        headers: {
          [CSRF_HEADER]: bootstrap.csrfToken,
          origin: "http://127.0.0.1:3001",
        },
      }),
    );
    expect(unavailableRestart.status).toBe(409);
    expect((await unavailableRestart.json()) as ApiErrorBody).toMatchObject({
      error: { code: "restart_unavailable" },
    });

    const changes = (await (
      await app.fetch(request(API_ROUTES.files(app.repository.id)))
    ).json()) as ChangesResponse;
    const file = changes.files.find((candidate) => candidate.path === "sample.ts");
    if (!file) throw new Error("fixture file missing");
    const body = JSON.stringify({
      fileId: file.id,
      operationRevision: changes.operationRevision,
      contentRevision: file.contentRevision,
    });

    const withoutToken = await app.fetch(
      request(API_ROUTES.fileStage(app.repository.id, file.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
        },
        body,
      }),
    );
    expect(withoutToken.status).toBe(403);

    const foreign = await app.fetch(
      request(API_ROUTES.files(app.repository.id), {
        headers: { origin: "https://attacker.example" },
      }),
    );
    expect(foreign.status).toBe(403);

    const staged = await app.fetch(
      request(API_ROUTES.fileStage(app.repository.id, file.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CSRF_HEADER]: bootstrap.csrfToken,
          origin: "http://127.0.0.1:3001",
        },
        body,
      }),
    );
    expect(staged.status).toBe(200);
    expect(staged.headers.has("access-control-allow-origin")).toBe(false);
    const stagedState = (await staged.json()) as StageFileResponse;
    if (!stagedState.file) throw new Error("staged fixture disappeared");
    expect(stagedState.changes).toEqual({
      upserted: [stagedState.file],
      removedFileIds: [],
      orderedFileIds: [stagedState.file.id],
    });

    const committed = await app.fetch(
      request(API_ROUTES.commit(app.repository.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CSRF_HEADER]: bootstrap.csrfToken,
          origin: "http://127.0.0.1:3001",
        },
        body: JSON.stringify({
          message: "Commit from Couchview",
          operationRevision: stagedState.operationRevision,
        }),
      }),
    );
    expect(committed.status).toBe(201);
    const commit = (await committed.json()) as CommitResponse;
    expect(commit.commit).toMatch(/^[0-9a-f]{40}$/);
    expect((await app.repository.changes()).files).toHaveLength(0);
  });

  test("returns from Access sign-in through an uncached safe redirect", async () => {
    const app = await fixture();
    const refresh = await app.fetch(
      request(`${API_ROUTES.accessRefresh}?repo=${encodeURIComponent(app.repository.id)}`),
    );
    expect(refresh.status).toBe(302);
    expect(refresh.headers.get("location")).toBe(
      `/?repo=${encodeURIComponent(app.repository.id)}&access_refresh=1`,
    );
    expect(refresh.headers.get("cache-control")).toBe("no-store");
    expect(refresh.headers.get("content-security-policy")).toContain("default-src 'self'");

    const defaultRefresh = await app.fetch(request(API_ROUTES.accessRefresh));
    expect(defaultRefresh.status).toBe(302);
    expect(defaultRefresh.headers.get("location")).toBe("/?access_refresh=1");

    const logout = await app.fetch(request(API_ROUTES.accessLogout));
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/cdn-cgi/access/logout");
    expect(logout.headers.get("cache-control")).toBe("no-store");
  });

  test("generates a protected staged-only commit message and rejects stale output", async () => {
    const contexts: string[] = [];
    let mutateDuringGeneration = false;
    let app!: CouchviewApp;
    const commitMessages: CommitMessageGenerator = {
      capability: { available: true, reason: null },
      async generate(context) {
        contexts.push(context);
        if (mutateDuringGeneration) {
          await writeFile(
            path.join(app.repository.root, "sample.ts"),
            "const sample = \"changed while generating\";\n",
          );
        }
        return "feat(review): generate commit messages";
      },
      close() {},
    };
    app = await fixture(undefined, undefined, commitMessages);
    await writeFile(
      path.join(app.repository.root, "unstaged.txt"),
      "not part of the staged context\n",
    );
    expect(
      Bun.spawnSync(
        ["git", "-C", app.repository.root, "add", "--", "sample.ts"],
      ).exitCode,
    ).toBe(0);
    const changes = await app.repository.changes();
    const requestBody = JSON.stringify({
      operationRevision: changes.operationRevision,
    });

    const unprotected = await app.fetch(
      request(API_ROUTES.commitMessage(app.repository.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
        },
        body: requestBody,
      }),
    );
    expect(unprotected.status).toBe(403);
    expect(contexts).toHaveLength(0);

    const generated = await app.fetch(
      request(API_ROUTES.commitMessage(app.repository.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CSRF_HEADER]: app.csrfToken,
          origin: "http://127.0.0.1:3001",
        },
        body: requestBody,
      }),
    );
    expect(generated.status).toBe(200);
    expect((await generated.json()) as GenerateCommitMessageResponse).toEqual({
      message: "feat(review): generate commit messages",
      operationRevision: changes.operationRevision,
    });
    expect(contexts[0]).toContain('"path":"sample.ts"');
    expect(contexts[0]).toContain("+const sample = true;");
    expect(contexts[0]).not.toContain("not part of the staged context");

    mutateDuringGeneration = true;
    const stale = await app.fetch(
      request(API_ROUTES.commitMessage(app.repository.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CSRF_HEADER]: app.csrfToken,
          origin: "http://127.0.0.1:3001",
        },
        body: requestBody,
      }),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()) as ApiErrorBody).toMatchObject({
      error: { code: "operation_changed" },
    });
  });

  test("reports and secures the rebuild-and-restart action", async () => {
    let restartRequests = 0;
    const app = await fixture(undefined, {
      available: true,
      reason: null,
      request: async () => {
        restartRequests += 1;
      },
    });
    const bootstrap = (await (
      await app.fetch(request(API_ROUTES.bootstrap))
    ).json()) as BootstrapResponse;
    expect(bootstrap.restart).toEqual({ available: true, reason: null });

    const rejected = await app.fetch(
      request(API_ROUTES.restart, {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3001" },
      }),
    );
    expect(rejected.status).toBe(403);
    expect(restartRequests).toBe(0);

    const rejectedControl = await app.fetch(
      request(API_ROUTES.controlRestart, { method: "POST" }),
    );
    expect(rejectedControl.status).toBe(403);
    expect((await rejectedControl.json()) as ApiErrorBody).toMatchObject({
      error: { code: "control_token_failed" },
    });
    expect(restartRequests).toBe(0);

    const acceptedControl = await app.fetch(
      request(API_ROUTES.controlRestart, {
        method: "POST",
        headers: { authorization: `Bearer ${app.controlToken}` },
      }),
    );
    expect(acceptedControl.status).toBe(202);
    expect(await acceptedControl.json()).toEqual({
      status: "restarting",
      previousInstanceId: app.instanceId,
    });
    expect(restartRequests).toBe(1);

    const accepted = await app.fetch(
      request(API_ROUTES.restart, {
        method: "POST",
        headers: {
          [CSRF_HEADER]: bootstrap.csrfToken,
          origin: "http://127.0.0.1:3001",
        },
      }),
    );
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({
      status: "restarting",
      previousInstanceId: app.instanceId,
    });
    expect(restartRequests).toBe(2);
  });

  test("bulk stages an exact validated set of files", async () => {
    const app = await fixture();
    await writeFile(
      path.join(app.repository.root, "second.ts"),
      "const second = true;\n",
      "utf8",
    );
    const bootstrap = (await (
      await app.fetch(request(API_ROUTES.bootstrap))
    ).json()) as BootstrapResponse;
    const changes = (await (
      await app.fetch(request(API_ROUTES.files(app.repository.id)))
    ).json()) as ChangesResponse;
    expect(changes.files).toHaveLength(2);
    const headers = {
      "content-type": "application/json",
      [CSRF_HEADER]: bootstrap.csrfToken,
      origin: "http://127.0.0.1:3001",
    };

    const duplicate = await app.fetch(
      request(API_ROUTES.fileStages(app.repository.id), {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: [
            {
              fileId: changes.files[0]!.id,
              contentRevision: changes.files[0]!.contentRevision,
            },
            {
              fileId: changes.files[0]!.id,
              contentRevision: changes.files[0]!.contentRevision,
            },
          ],
          operationRevision: changes.operationRevision,
        }),
      }),
    );
    expect(duplicate.status).toBe(400);

    const staged = await app.fetch(
      request(API_ROUTES.fileStages(app.repository.id), {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: changes.files.map((file) => ({
            fileId: file.id,
            contentRevision: file.contentRevision,
          })),
          operationRevision: changes.operationRevision,
        }),
      }),
    );
    expect(staged.status).toBe(200);
    const result = (await staged.json()) as StageFilesResponse;
    expect(result.files).toHaveLength(2);
    expect(result.files.every((file) => file.staged && !file.unstaged)).toBe(true);
    expect(result.changes.upserted).toHaveLength(2);
  });

  test("rejects missing origins and malformed mutation bodies with structured errors", async () => {
    const app = await fixture();
    const bootstrap = (await (
      await app.fetch(request(API_ROUTES.bootstrap))
    ).json()) as BootstrapResponse;
    const changes = (await (
      await app.fetch(request(API_ROUTES.files(app.repository.id)))
    ).json()) as ChangesResponse;
    const file = changes.files[0];
    if (!file) throw new Error("fixture file missing");
    const baseHeaders = {
      "content-type": "application/json",
      [CSRF_HEADER]: bootstrap.csrfToken,
    };

    const missingOrigin = await app.fetch(
      request(API_ROUTES.fileReview(app.repository.id, file.id), {
        method: "PUT",
        headers: baseHeaders,
        body: JSON.stringify({
          fileId: file.id,
          contentRevision: file.contentRevision,
          reviewed: true,
        }),
      }),
    );
    expect(missingOrigin.status).toBe(403);

    const nullBody = await app.fetch(
      request(API_ROUTES.fileReview(app.repository.id, file.id), {
        method: "PUT",
        headers: { ...baseHeaders, origin: "http://127.0.0.1:3001" },
        body: "null",
      }),
    );
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toEqual({
      error: { code: "invalid_request", message: "Request body must be a JSON object" },
    });

    const wrongBoolean = await app.fetch(
      request(API_ROUTES.fileReview(app.repository.id, file.id), {
        method: "PUT",
        headers: { ...baseHeaders, origin: "http://127.0.0.1:3001" },
        body: JSON.stringify({
          fileId: file.id,
          contentRevision: file.contentRevision,
          reviewed: "false",
        }),
      }),
    );
    expect(wrongBoolean.status).toBe(400);

    const malformedStage = await app.fetch(
      request(API_ROUTES.fileStage(app.repository.id, file.id), {
        method: "POST",
        headers: { ...baseHeaders, origin: "http://127.0.0.1:3001" },
        body: JSON.stringify({
          fileId: file.id,
          operationRevision: 42,
          contentRevision: file.contentRevision,
        }),
      }),
    );
    expect(malformedStage.status).toBe(400);

    const misleadingContentType = await app.fetch(
      request(API_ROUTES.fileReview(app.repository.id, file.id), {
        method: "PUT",
        headers: {
          ...baseHeaders,
          origin: "http://127.0.0.1:3001",
          "content-type": "application/jsonish",
        },
        body: JSON.stringify({
          fileId: file.id,
          contentRevision: file.contentRevision,
          reviewed: true,
        }),
      }),
    );
    expect(misleadingContentType.status).toBe(415);

    const preflight = await app.fetch(
      request(API_ROUTES.fileStage(app.repository.id, file.id), {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:3001" },
      }),
    );
    expect(preflight.status).toBe(404);
    expect(preflight.headers.has("access-control-allow-origin")).toBe(false);
  });

  test("returns actionable Git diagnostics for command failures and timeouts", async () => {
    const app = await fixture();
    const backend = app.repository as unknown as {
      changes: typeof app.repository.changes;
    };
    const originalChanges = app.repository.changes.bind(app.repository);
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      backend.changes = async () => {
        throw new GitCommandError(
          ["diff", "--", "sample.ts"],
          128,
          "fatal: bad object HEAD",
        );
      };
      const failed = await app.fetch(request(API_ROUTES.files(app.repository.id)));
      const failedBody = (await failed.json()) as ApiErrorBody;
      expect(failed.status).toBe(500);
      expect(failedBody.error.message).toContain("fatal: bad object HEAD");
      expect(failedBody.error.diagnostic).toMatchObject({
        source: "git",
        operation: "diff",
        kind: "exit",
        exitCode: 128,
        stderr: "fatal: bad object HEAD",
        retryable: false,
      });
      expect(failed.headers.get("x-couchview-diagnostic")).toBe(
        failedBody.error.diagnostic?.id ?? null,
      );

      backend.changes = async () => {
        throw new GitCommandError(["diff"], -1, "", "timeout", 15_000);
      };
      const timedOut = await app.fetch(request(API_ROUTES.files(app.repository.id)));
      const timedOutBody = (await timedOut.json()) as ApiErrorBody;
      expect(timedOut.status).toBe(504);
      expect(timedOutBody.error).toMatchObject({
        code: "git_timeout",
        message: "Git diff stopped responding after 15 seconds",
        diagnostic: {
          operation: "diff",
          kind: "timeout",
          retryable: true,
          timeoutMs: 15_000,
        },
      });
    } finally {
      backend.changes = originalChanges;
      console.error = originalConsoleError;
    }
  });

  test("rejects traversal, forged hosts, mismatched paths, and oversized bodies", async () => {
    const app = await fixture();
    const bootstrap = (await (
      await app.fetch(request(API_ROUTES.bootstrap))
    ).json()) as BootstrapResponse;
    const changes = (await (
      await app.fetch(request(API_ROUTES.files(app.repository.id)))
    ).json()) as ChangesResponse;
    const file = changes.files[0];
    if (!file) throw new Error("fixture file missing");

    const diff = await app.fetch(request(API_ROUTES.fileDiff(app.repository.id, file.id)));
    expect(diff.status).toBe(200);

    const traversal = await app.fetch(
      request(
        `${API_ROUTES.source(app.repository.id)}?path=${encodeURIComponent("../secret")}&line=1`,
      ),
    );
    expect(traversal.status).toBe(400);

    const forgedHost = await app.fetch(
      new Request("http://attacker.invalid/api/files", {
        headers: { host: "attacker.invalid" },
      }),
    );
    expect(forgedHost.status).toBe(403);

    const mismatched = await app.fetch(
      request(API_ROUTES.fileStage(app.repository.id, file.id), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: bootstrap.csrfToken,
        },
        body: JSON.stringify({
          fileId: "another-file",
          operationRevision: changes.operationRevision,
          contentRevision: file.contentRevision,
        }),
      }),
    );
    expect(mismatched.status).toBe(400);

    const oversized = await app.fetch(
      request(API_ROUTES.fileReview(app.repository.id, file.id), {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: bootstrap.csrfToken,
        },
        body: JSON.stringify({ payload: "x".repeat(70 * 1024) }),
      }),
    );
    expect(oversized.status).toBe(413);

    const malformedOrigin = await app.fetch(
      request(API_ROUTES.files(app.repository.id), { headers: { origin: "not a URL" } }),
    );
    expect(malformedOrigin.status).toBe(403);
  });

  test("streams default SSE message events", async () => {
    const app = await fixture();
    const response = await app.fetch(request(API_ROUTES.events(app.repository.id)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SSE body missing");
    const first = await reader.read();
    const payload = new TextDecoder().decode(first.value);
    expect(payload.startsWith("data: ")).toBe(true);
    expect(payload).toContain('"type":"ready"');
    await reader.cancel();
  });

  test("keeps the API namespace structured and accepts exact configured LAN hosts", async () => {
    const app = await fixture();
    const apiRoot = await app.fetch(request("/api"));
    expect(apiRoot.status).toBe(404);
    expect(await apiRoot.json()).toEqual({
      error: { code: "route_not_found", message: "API route not found" },
    });

    const lanApp = await createCouchviewApp({
      root: app.repository.root,
      host: "192.0.2.25",
      port: 3001,
      stateDatabasePath: await (async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-state-"));
        temporaryDirectories.push(directory);
        return path.join(directory, "state.sqlite");
      })(),
    });
    applications.push(lanApp);
    const accepted = await lanApp.fetch(
      new Request("http://192.0.2.25:3001/api/bootstrap", {
        headers: { host: "192.0.2.25:3001", origin: "http://192.0.2.25:3001" },
      }),
    );
    expect(accepted.status).toBe(200);
    const alias = await lanApp.fetch(
      new Request("http://phone-alias.local:3001/api/bootstrap", {
        headers: { host: "phone-alias.local:3001" },
      }),
    );
    expect(alias.status).toBe(403);
  });

  test("registers, isolates, lists, and forgets repositories through secured routes", async () => {
    const app = await fixture();
    const secondRoot = await repositoryFixture("sample.ts");

    const instance = await app.fetch(request(API_ROUTES.instance));
    expect(instance.status).toBe(200);
    expect(await instance.json()).toMatchObject({
      service: "couchview",
      protocolVersion: 5,
      instanceId: app.instanceId,
      bindHost: "127.0.0.1",
      port: 3001,
    });

    const rejected = await app.fetch(
      request(API_ROUTES.controlRepositories, {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ root: secondRoot }),
      }),
    );
    expect(rejected.status).toBe(403);

    const registeredResponse = await app.fetch(
      request(API_ROUTES.controlRepositories, {
        method: "POST",
        headers: {
          authorization: `Bearer ${app.controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ root: secondRoot }),
      }),
    );
    expect(registeredResponse.status).toBe(201);
    const registered = (await registeredResponse.json()) as RegisterRepositoryResponse;
    expect(registered.added).toBe(true);

    const nested = path.join(secondRoot, "nested");
    await mkdir(nested);
    const duplicateResponse = await app.fetch(
      request(API_ROUTES.controlRepositories, {
        method: "POST",
        headers: {
          authorization: `Bearer ${app.controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ root: nested }),
      }),
    );
    expect(duplicateResponse.status).toBe(200);
    expect((await duplicateResponse.json()) as RegisterRepositoryResponse).toMatchObject({
      added: false,
      repository: { id: registered.repository.id },
    });

    const catalog = (await (
      await app.fetch(request(API_ROUTES.repositories))
    ).json()) as RepositoryCatalogResponse;
    expect(catalog.repositories).toHaveLength(2);

    const firstChanges = (await (
      await app.fetch(request(API_ROUTES.files(app.repository.id)))
    ).json()) as ChangesResponse;
    const secondChanges = (await (
      await app.fetch(request(API_ROUTES.files(registered.repository.id)))
    ).json()) as ChangesResponse;
    expect(firstChanges.repository.id).not.toBe(secondChanges.repository.id);
    expect(secondChanges.files.map((file) => file.path)).toEqual(["sample.ts"]);
    const firstFile = firstChanges.files[0];
    if (!firstFile) throw new Error("first repository fixture missing");
    expect(secondChanges.files[0]?.id).not.toBe(firstFile.id);

    const crossed = await app.fetch(
      request(API_ROUTES.fileDiff(registered.repository.id, firstFile.id)),
    );
    expect(crossed.status).toBe(404);

    const reviewed = await app.fetch(
      request(API_ROUTES.fileReview(app.repository.id, firstFile.id), {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: app.csrfToken,
        },
        body: JSON.stringify({
          fileId: firstFile.id,
          contentRevision: firstFile.contentRevision,
          reviewed: true,
        }),
      }),
    );
    expect(reviewed.status).toBe(200);
    const firstState = (await (
      await app.fetch(request(API_ROUTES.comments(app.repository.id)))
    ).json()) as ReviewStateResponse;
    const secondState = (await (
      await app.fetch(request(API_ROUTES.comments(registered.repository.id)))
    ).json()) as ReviewStateResponse;
    expect(firstState.reviews).toHaveLength(1);
    expect(secondState.reviews).toHaveLength(0);

    const missingOrigin = await app.fetch(
      request(API_ROUTES.repository(registered.repository.id), {
        method: "DELETE",
        headers: { [CSRF_HEADER]: app.csrfToken },
        body: JSON.stringify({ repositoryId: registered.repository.id }),
      }),
    );
    expect(missingOrigin.status).toBe(403);

    const movedSecondRoot = `${secondRoot}-moved`;
    await rename(secondRoot, movedSecondRoot);
    temporaryDirectories.push(movedSecondRoot);
    const unavailable = (await (
      await app.fetch(request(API_ROUTES.repositories))
    ).json()) as RepositoryCatalogResponse;
    expect(unavailable.repositories).toContainEqual(
      expect.objectContaining({ id: registered.repository.id, available: false }),
    );

    const forgotten = await app.fetch(
      request(API_ROUTES.repository(registered.repository.id), {
        method: "DELETE",
        headers: {
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: app.csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ repositoryId: registered.repository.id }),
      }),
    );
    expect(forgotten.status).toBe(200);
    expect((await app.repositories.list()).map((item) => item.id)).toEqual([app.repository.id]);
  });

  test("polls shared SQLite revisions into repository-aware SSE events", async () => {
    const first = await fixture(25);
    const secondRoot = await repositoryFixture("second.ts");
    const second = await createCouchviewApp({
      root: secondRoot,
      host: "127.0.0.1",
      port: 3001,
      stateDatabasePath: first.database.filePath,
      revisionPollIntervalMs: 25,
    });
    applications.push(second);

    const response = await first.fetch(request(API_ROUTES.events(first.repository.id)));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SSE body missing");
    expect((await nextSseEvent(reader, "ready")).repositoryId).toBe(first.repository.id);

    const changes = (await (
      await second.fetch(request(API_ROUTES.files(first.repository.id)))
    ).json()) as ChangesResponse;
    const file = changes.files[0];
    if (!file) throw new Error("shared repository fixture missing");
    const mutation = await second.fetch(
      request(API_ROUTES.fileReview(first.repository.id, file.id), {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3001",
          [CSRF_HEADER]: second.csrfToken,
        },
        body: JSON.stringify({
          fileId: file.id,
          contentRevision: file.contentRevision,
          reviewed: true,
        }),
      }),
    );
    expect(mutation.status).toBe(200);
    const stateEvent = await nextSseEvent(reader, "state");
    expect(stateEvent).toMatchObject({ repositoryId: first.repository.id, stateRevision: 1 });

    const thirdRoot = await repositoryFixture("third.ts");
    const catalogMutation = await second.fetch(
      request(API_ROUTES.controlRepositories, {
        method: "POST",
        headers: {
          authorization: `Bearer ${second.controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ root: thirdRoot }),
      }),
    );
    expect(catalogMutation.status).toBe(201);
    const catalogEvent = await nextSseEvent(reader, "repositories");
    expect(catalogEvent.repositoryId).toBe(first.repository.id);
    expect(catalogEvent.catalogRevision).toBeGreaterThan(1);
    await reader.cancel();
  });

  test("allows independent versions on production and development endpoints to share state", async () => {
    const development = await fixture();
    const productionRoot = await repositoryFixture("production.ts");
    const production = await createCouchviewApp({
      root: productionRoot,
      host: "127.0.0.1",
      port: 4173,
      version: "9.9.9-test",
      stateDatabasePath: development.database.filePath,
    });
    applications.push(production);
    development.registerServerInstance();
    production.registerServerInstance();

    expect(development.database.repositories()).toHaveLength(2);
    expect(development.database.serverInstance(development.instanceId)).toMatchObject({
      port: 3001,
    });
    expect(production.database.serverInstance(production.instanceId)).toMatchObject({
      port: 4173,
      version: "9.9.9-test",
    });

    const metadata = await production.fetch(
      new Request("http://127.0.0.1:4173/api/instance", {
        headers: { host: "127.0.0.1:4173" },
      }),
    );
    expect(await metadata.json()).toMatchObject({ version: "9.9.9-test", port: 4173 });
  });

  test("defaults the application host to loopback", async () => {
    const root = await repositoryFixture("loopback-default.ts");
    const stateDirectory = await mkdtemp(path.join(tmpdir(), "couchview-server-state-"));
    temporaryDirectories.push(stateDirectory);
    const app = await createCouchviewApp({
      root,
      stateDatabasePath: path.join(stateDirectory, "state.sqlite"),
    });
    applications.push(app);

    expect(app.bindHost).toBe("127.0.0.1");
    expect(app.accessOrigins).toEqual(["http://127.0.0.1:4173"]);
  });

  test("derives copyable exact origins from wildcard network interfaces", () => {
    expect(
      accessOriginsForHost("0.0.0.0", 4173, ["192.168.50.4", "10.0.0.8", "2001:db8::1"]),
    ).toEqual([
      "http://0.0.0.0:4173",
      "http://127.0.0.1:4173",
      "http://localhost:4173",
      "http://192.168.50.4:4173",
      "http://10.0.0.8:4173",
    ]);
    expect(accessOriginsForHost("::", 4173, ["192.168.50.4", "2001:db8::1"])).toContain(
      "http://[2001:db8::1]:4173",
    );
  });
});
