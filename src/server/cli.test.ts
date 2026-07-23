import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseCli, startServer } from "./cli.ts";
import { createCouchviewApp, type CouchviewApp } from "./server.ts";

const initialRoot = Bun.env.COUCHVIEW_ROOT;
const initialHost = Bun.env.COUCHVIEW_HOST;
const initialLegacyRoot = Bun.env.COUCH_REVIEW_ROOT;
const initialLegacyHost = Bun.env.COUCH_REVIEW_HOST;
const initialPort = Bun.env.PORT;
const initialDataHome = Bun.env.XDG_DATA_HOME;
const initialDisableReuse = Bun.env.COUCHVIEW_DISABLE_REUSE;
const initialLegacyDisableReuse = Bun.env.COUCH_REVIEW_DISABLE_REUSE;

function restoreEnvironment() {
  if (initialRoot === undefined) delete Bun.env.COUCHVIEW_ROOT;
  else Bun.env.COUCHVIEW_ROOT = initialRoot;

  if (initialHost === undefined) delete Bun.env.COUCHVIEW_HOST;
  else Bun.env.COUCHVIEW_HOST = initialHost;

  if (initialLegacyRoot === undefined) delete Bun.env.COUCH_REVIEW_ROOT;
  else Bun.env.COUCH_REVIEW_ROOT = initialLegacyRoot;

  if (initialLegacyHost === undefined) delete Bun.env.COUCH_REVIEW_HOST;
  else Bun.env.COUCH_REVIEW_HOST = initialLegacyHost;

  if (initialPort === undefined) delete Bun.env.PORT;
  else Bun.env.PORT = initialPort;

  if (initialDataHome === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = initialDataHome;

  if (initialDisableReuse === undefined) delete Bun.env.COUCHVIEW_DISABLE_REUSE;
  else Bun.env.COUCHVIEW_DISABLE_REUSE = initialDisableReuse;

  if (initialLegacyDisableReuse === undefined) {
    delete Bun.env.COUCH_REVIEW_DISABLE_REUSE;
  } else {
    Bun.env.COUCH_REVIEW_DISABLE_REUSE = initialLegacyDisableReuse;
  }
}

describe("parseCli", () => {
  beforeEach(() => {
    delete Bun.env.COUCHVIEW_ROOT;
    delete Bun.env.COUCHVIEW_HOST;
    delete Bun.env.COUCH_REVIEW_ROOT;
    delete Bun.env.COUCH_REVIEW_HOST;
    delete Bun.env.PORT;
  });

  afterEach(restoreEnvironment);

  test("defaults to the launch directory, all interfaces, and production port", () => {
    expect(parseCli([])).toEqual({
      root: path.resolve(process.cwd()),
      host: "0.0.0.0",
      port: 4173,
    });
  });

  test("accepts a positional repository path", () => {
    expect(parseCli(["fixtures/example"])).toEqual({
      root: path.resolve("fixtures/example"),
      host: "0.0.0.0",
      port: 4173,
    });
  });

  test("accepts --repo and --port in either order", () => {
    expect(parseCli(["--repo", "../project", "--port", "5199"])).toEqual({
      root: path.resolve("../project"),
      host: "0.0.0.0",
      port: 5199,
    });
    expect(parseCli(["--port", "6001", "--repo", "/tmp/project"])).toEqual({
      root: path.resolve("/tmp/project"),
      host: "0.0.0.0",
      port: 6001,
    });
  });

  test("uses environment defaults while command-line flags take precedence", () => {
    Bun.env.COUCHVIEW_ROOT = "environment-project";
    Bun.env.COUCHVIEW_HOST = "192.168.1.25";
    Bun.env.PORT = "4888";

    expect(parseCli([])).toEqual({
      root: path.resolve("environment-project"),
      host: "192.168.1.25",
      port: 4888,
    });
    expect(parseCli(["--repo", "flag-project", "--host", "0.0.0.0", "--port", "4999"])).toEqual({
      root: path.resolve("flag-project"),
      host: "0.0.0.0",
      port: 4999,
    });
  });

  test("accepts pre-rename environment defaults when new names are absent", () => {
    Bun.env.COUCH_REVIEW_ROOT = "legacy-environment-project";
    Bun.env.COUCH_REVIEW_HOST = "127.0.0.1";

    expect(parseCli([])).toEqual({
      root: path.resolve("legacy-environment-project"),
      host: "127.0.0.1",
      port: 4173,
    });
  });

  test("accepts IPv4, IPv6, and hostname bind values", () => {
    expect(parseCli(["--host", "0.0.0.0"]).host).toBe("0.0.0.0");
    expect(parseCli(["--host", "[::]"]).host).toBe("::");
    expect(parseCli(["--host", "My-Mac.local"]).host).toBe("my-mac.local");
  });

  test("rejects unknown options and the former --root alias", () => {
    expect(() => parseCli(["--watch"])).toThrow("Unknown option: --watch");
    expect(() => parseCli(["--root", "/tmp/project"])).toThrow(
      "Unknown option: --root",
    );
  });

  test("requires values for --repo, --host, and --port", () => {
    expect(() => parseCli(["--repo"])).toThrow("Repository path is required");
    expect(() => parseCli(["--repo", "--port", "5000"])).toThrow(
      "Repository path is required",
    );
    expect(() => parseCli(["--port"])).toThrow(
      "Port must be between 1 and 65535",
    );
    expect(() => parseCli(["--host"])).toThrow("Host is required");
    expect(() => parseCli(["--host", "--port", "5000"])).toThrow("Host is required");
  });

  test.each(["http://0.0.0.0", "127.0.0.1:4173", "bad host", "-invalid.local"])(
    "rejects invalid host %s",
    (host) => {
      expect(() => parseCli(["--host", host])).toThrow(
        "Host must be an IP address or hostname",
      );
    },
  );

  test("rejects multiple competing repository arguments", () => {
    expect(() => parseCli(["one", "two"])).toThrow(
      "Repository path may only be provided once",
    );
    expect(() => parseCli(["--repo", "one", "two"])).toThrow(
      "Repository path may only be provided once",
    );
  });

  test.each(["0", "-1", "1.5", "65536", "nope"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => parseCli(["--port", port])).toThrow(
        "Port must be between 1 and 65535",
      );
    },
  );

  test.each(["1", "65535"])("accepts boundary port %s", (port) => {
    expect(parseCli(["--port", port]).port).toBe(Number(port));
  });
});

const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];
const endpoints = new Map<number, (request: Request) => Response | Promise<Response>>();
let nextPort = 43_100;

async function repositoryFixture(name: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `couchview-cli-${name}-`));
  temporaryDirectories.push(directory);
  expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
  await writeFile(path.join(directory, `${name}.ts`), `export const ${name} = true;\n`);
  return directory;
}

function freePort(): number {
  nextPort += 1;
  return nextPort;
}

async function runningApp(root: string, port: number, stateDatabasePath?: string) {
  const app = await createCouchviewApp({
    root,
    host: "127.0.0.1",
    port,
    stateDatabasePath,
  });
  app.registerServerInstance();
  applications.push(app);
  endpoints.set(port, app.fetch);
  return app;
}

const runtimeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const port = Number(new URL(request.url).port);
  const endpoint = endpoints.get(port);
  if (!endpoint) throw new TypeError("Endpoint is not listening");
  return endpoint(request);
}) as typeof globalThis.fetch;

const runtimeServe = ((options: {
  hostname?: string;
  port?: number;
  fetch(request: Request): Response | Promise<Response>;
}) => {
  const port = options.port ?? 0;
  if (endpoints.has(port)) {
    const error = new Error(`Failed to listen: address already in use (${port})`);
    Object.assign(error, { code: "EADDRINUSE" });
    throw error;
  }
  endpoints.set(port, options.fetch);
  return {
    port,
    stop() {
      endpoints.delete(port);
    },
  } as ReturnType<typeof Bun.serve>;
}) as unknown as typeof Bun.serve;

const runtime = { fetch: runtimeFetch, serve: runtimeServe };

describe("multi-project CLI startup", () => {
  beforeEach(async () => {
    delete Bun.env.COUCHVIEW_ROOT;
    delete Bun.env.COUCHVIEW_HOST;
    delete Bun.env.PORT;
    delete Bun.env.COUCHVIEW_DISABLE_REUSE;
    delete Bun.env.COUCH_REVIEW_DISABLE_REUSE;
    const dataHome = await mkdtemp(path.join(tmpdir(), "couchview-cli-data-"));
    temporaryDirectories.push(dataHome);
    Bun.env.XDG_DATA_HOME = dataHome;
  });

  afterEach(async () => {
    endpoints.clear();
    for (const application of applications.splice(0)) application.close();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    restoreEnvironment();
  });

  test("starts the first endpoint with a project-specific URL and global state", async () => {
    const root = await repositoryFixture("first");
    const port = freePort();
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => messages.push(values.join(" "));
    try {
      const result = await startServer(["--repo", root, "--port", String(port)], runtime);
      if (!result.app || !result.server || !result.stop) {
        throw new Error("CLI unexpectedly attached to another server");
      }
      expect(result.app.database.repositories()).toHaveLength(1);
      expect(messages.join("\n")).toContain(`/?repo=${result.app.repository.id}`);
      expect(messages.join("\n")).toContain(`Repository: ${result.app.repository.root}`);
      expect(
        await Bun.file(path.join(root, ".git", "couchview", "state.json")).exists(),
      ).toBe(false);
      result.stop();
    } finally {
      console.log = originalLog;
    }
  });

  test("adds a second project to a compatible server, then reports duplicates", async () => {
    const firstRoot = await repositoryFixture("first");
    const secondRoot = await repositoryFixture("second");
    const port = freePort();
    const app = await runningApp(firstRoot, port);
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => messages.push(values.join(" "));
    try {
      const added = await startServer(
        ["--repo", secondRoot, "--port", String(port)],
        runtime,
      );
      if (!added.registered) throw new Error("CLI unexpectedly started another server");
      expect(added.registered.registration.added).toBe(true);
      expect(app.database.repositories()).toHaveLength(2);
      expect(messages.join("\n")).toContain("Repository added to the running Couchview server.");
      expect(messages.join("\n")).toContain(
        `/?repo=${added.registered.registration.repository.id}`,
      );

      messages.length = 0;
      const duplicate = await startServer(
        ["--repo", secondRoot, "--port", String(port)],
        runtime,
      );
      if (!duplicate.registered) throw new Error("CLI unexpectedly started another server");
      expect(duplicate.registered.registration.added).toBe(false);
      expect(messages.join("\n")).toContain(
        "Repository is already available in the running Couchview server.",
      );
    } finally {
      console.log = originalLog;
    }
  });

  test("rejects unrelated services, data-directory mismatches, and incompatible binds", async () => {
    const root = await repositoryFixture("first");
    const otherRoot = await repositoryFixture("second");

    const unrelatedPort = freePort();
    endpoints.set(unrelatedPort, () => Response.json({ service: "something-else" }));
    await expect(
      startServer(["--repo", root, "--port", String(unrelatedPort)], runtime),
    ).rejects.toThrow("not a compatible Couchview server");

    const incompatiblePort = freePort();
    await runningApp(root, incompatiblePort);
    await expect(
      startServer([
        "--repo",
        otherRoot,
        "--host",
        "0.0.0.0",
        "--port",
        String(incompatiblePort),
      ], runtime),
    ).rejects.toThrow("does not satisfy --host 0.0.0.0");

    const dataMismatchPort = freePort();
    const otherDataHome = await mkdtemp(path.join(tmpdir(), "couchview-cli-other-data-"));
    temporaryDirectories.push(otherDataHome);
    await runningApp(
      root,
      dataMismatchPort,
      path.join(otherDataHome, "couchview", "state.sqlite"),
    );
    await expect(
      startServer(["--repo", otherRoot, "--port", String(dataMismatchPort)], runtime),
    ).rejects.toThrow("different XDG data directory");
  });

  test("development ownership mode refuses to attach to an occupied endpoint", async () => {
    const firstRoot = await repositoryFixture("first");
    const secondRoot = await repositoryFixture("second");
    const port = freePort();
    await runningApp(firstRoot, port);
    Bun.env.COUCHVIEW_DISABLE_REUSE = "1";
    await expect(
      startServer(["--repo", secondRoot, "--port", String(port)], runtime),
    ).rejects.toThrow(/EADDRINUSE|address already in use/i);
  });

  test("retries discovery when another process wins the startup bind race", async () => {
    const firstRoot = await repositoryFixture("first");
    const secondRoot = await repositoryFixture("second");
    const port = freePort();
    const incumbent = await createCouchviewApp({
      root: firstRoot,
      host: "127.0.0.1",
      port,
    });
    incumbent.registerServerInstance();
    applications.push(incumbent);

    let raced = false;
    const raceServe = ((options: Parameters<typeof runtimeServe>[0]) => {
      if (!raced) {
        raced = true;
        endpoints.set(port, incumbent.fetch);
        const error = new Error("Failed to listen: address already in use");
        Object.assign(error, { code: "EADDRINUSE" });
        throw error;
      }
      return runtimeServe(options as never);
    }) as typeof Bun.serve;

    const originalLog = console.log;
    console.log = () => undefined;
    try {
      const result = await startServer(
        ["--repo", secondRoot, "--port", String(port)],
        { fetch: runtimeFetch, serve: raceServe },
      );
      expect(result.registered?.registration.repository.root).toContain(
        secondRoot.split("/").at(-1)!,
      );
      expect(incumbent.database.repositories()).toHaveLength(2);
    } finally {
      console.log = originalLog;
    }
  });
});
