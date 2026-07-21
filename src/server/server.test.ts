import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { API_ROUTES, CSRF_HEADER, type BootstrapResponse, type ChangesResponse } from "../shared/contracts.ts";
import {
  accessOriginsForHost,
  createCouchReviewApp,
  type CouchReviewApp,
} from "./server.ts";

const temporaryDirectories: string[] = [];
const applications: CouchReviewApp[] = [];

afterEach(async () => {
  for (const application of applications.splice(0)) application.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "couch-review-server-"));
  temporaryDirectories.push(directory);
  expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
  await writeFile(path.join(directory, "sample.ts"), "const sample = true;\n", "utf8");
  const app = await createCouchReviewApp({ root: directory, host: "127.0.0.1", port: 3001 });
  applications.push(app);
  return app;
}

function request(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1:3001");
  return new Request(`http://127.0.0.1:3001${pathname}`, { ...init, headers });
}

describe("Couch Review HTTP security and routes", () => {
  test("bootstraps, rejects foreign origins, and requires CSRF for staging", async () => {
    const app = await fixture();
    const bootstrapResponse = await app.fetch(request(API_ROUTES.bootstrap));
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = (await bootstrapResponse.json()) as BootstrapResponse;
    expect(bootstrap.csrfToken).toHaveLength(43);

    const changes = (await (await app.fetch(request(API_ROUTES.files))).json()) as ChangesResponse;
    const file = changes.files.find((candidate) => candidate.path === "sample.ts");
    if (!file) throw new Error("fixture file missing");
    const body = JSON.stringify({
      fileId: file.id,
      operationRevision: changes.operationRevision,
      contentRevision: file.contentRevision,
    });

    const withoutToken = await app.fetch(
      request(API_ROUTES.fileStage(file.id), {
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
      request(API_ROUTES.files, { headers: { origin: "https://attacker.example" } }),
    );
    expect(foreign.status).toBe(403);

    const staged = await app.fetch(
      request(API_ROUTES.fileStage(file.id), {
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
  });

  test("rejects missing origins and malformed mutation bodies with structured errors", async () => {
    const app = await fixture();
    const bootstrap = (await (
      await app.fetch(request(API_ROUTES.bootstrap))
    ).json()) as BootstrapResponse;
    const changes = (await (
      await app.fetch(request(API_ROUTES.files))
    ).json()) as ChangesResponse;
    const file = changes.files[0];
    if (!file) throw new Error("fixture file missing");
    const baseHeaders = {
      "content-type": "application/json",
      [CSRF_HEADER]: bootstrap.csrfToken,
    };

    const missingOrigin = await app.fetch(
      request(API_ROUTES.fileReview(file.id), {
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
      request(API_ROUTES.fileReview(file.id), {
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
      request(API_ROUTES.fileReview(file.id), {
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
      request(API_ROUTES.fileStage(file.id), {
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
      request(API_ROUTES.fileReview(file.id), {
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
      request(API_ROUTES.fileStage(file.id), {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:3001" },
      }),
    );
    expect(preflight.status).toBe(404);
    expect(preflight.headers.has("access-control-allow-origin")).toBe(false);
  });

  test("rejects traversal, forged hosts, mismatched paths, and oversized bodies", async () => {
    const app = await fixture();
    const bootstrap = (await (
      await app.fetch(request(API_ROUTES.bootstrap))
    ).json()) as BootstrapResponse;
    const changes = (await (
      await app.fetch(request(API_ROUTES.files))
    ).json()) as ChangesResponse;
    const file = changes.files[0];
    if (!file) throw new Error("fixture file missing");

    const diff = await app.fetch(request(API_ROUTES.fileDiff(file.id)));
    expect(diff.status).toBe(200);

    const traversal = await app.fetch(
      request(`${API_ROUTES.source}?path=${encodeURIComponent("../secret")}&line=1`),
    );
    expect(traversal.status).toBe(400);

    const forgedHost = await app.fetch(
      new Request("http://attacker.invalid/api/files", {
        headers: { host: "attacker.invalid" },
      }),
    );
    expect(forgedHost.status).toBe(403);

    const mismatched = await app.fetch(
      request(API_ROUTES.fileStage(file.id), {
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
      request(API_ROUTES.fileReview(file.id), {
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
      request(API_ROUTES.files, { headers: { origin: "not a URL" } }),
    );
    expect(malformedOrigin.status).toBe(403);
  });

  test("streams default SSE message events", async () => {
    const app = await fixture();
    const response = await app.fetch(request(API_ROUTES.events));
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

    const lanApp = await createCouchReviewApp({
      root: app.repository.root,
      host: "192.0.2.25",
      port: 3001,
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
