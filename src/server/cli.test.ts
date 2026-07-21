import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";

import { parseCli } from "./cli.ts";

const initialRoot = Bun.env.COUCH_REVIEW_ROOT;
const initialHost = Bun.env.COUCH_REVIEW_HOST;
const initialPort = Bun.env.PORT;

function restoreEnvironment() {
  if (initialRoot === undefined) delete Bun.env.COUCH_REVIEW_ROOT;
  else Bun.env.COUCH_REVIEW_ROOT = initialRoot;

  if (initialHost === undefined) delete Bun.env.COUCH_REVIEW_HOST;
  else Bun.env.COUCH_REVIEW_HOST = initialHost;

  if (initialPort === undefined) delete Bun.env.PORT;
  else Bun.env.PORT = initialPort;
}

describe("parseCli", () => {
  beforeEach(() => {
    delete Bun.env.COUCH_REVIEW_ROOT;
    delete Bun.env.COUCH_REVIEW_HOST;
    delete Bun.env.PORT;
  });

  afterEach(restoreEnvironment);

  test("defaults to the launch directory and production port", () => {
    expect(parseCli([])).toEqual({
      root: path.resolve(process.cwd()),
      host: "127.0.0.1",
      port: 4173,
    });
  });

  test("accepts a positional repository path", () => {
    expect(parseCli(["fixtures/example"])).toEqual({
      root: path.resolve("fixtures/example"),
      host: "127.0.0.1",
      port: 4173,
    });
  });

  test("accepts --repo and --port in either order", () => {
    expect(parseCli(["--repo", "../project", "--port", "5199"])).toEqual({
      root: path.resolve("../project"),
      host: "127.0.0.1",
      port: 5199,
    });
    expect(parseCli(["--port", "6001", "--repo", "/tmp/project"])).toEqual({
      root: path.resolve("/tmp/project"),
      host: "127.0.0.1",
      port: 6001,
    });
  });

  test("uses environment defaults while command-line flags take precedence", () => {
    Bun.env.COUCH_REVIEW_ROOT = "environment-project";
    Bun.env.COUCH_REVIEW_HOST = "192.168.1.25";
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
