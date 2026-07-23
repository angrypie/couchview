import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReviewComment, ReviewRecord } from "../shared/contracts.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "couch-review-sqlite-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "data", "state.sqlite");
}

function review(fileId: string, reviewed = true): ReviewRecord {
  return {
    fileId,
    path: `${fileId}.ts`,
    contentRevision: `${fileId}-revision`,
    reviewed,
    updatedAt: "2026-07-22T10:00:00.000Z",
  };
}

function comment(id: string, fileId: string): ReviewComment {
  return {
    id,
    fileId,
    path: `${fileId}.ts`,
    side: "mixed",
    startLine: 3,
    endLine: 4,
    oldStartLine: 3,
    oldEndLine: 3,
    newStartLine: 4,
    newEndLine: 4,
    hunkHeader: "@@ -3 +4 @@",
    excerpt: ["- old", "+ new"],
    body: "Keep this review comment.",
    contentRevision: `${fileId}-revision`,
    stale: false,
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
  };
}

describe("global SQLite state", () => {
  test("uses only absolute XDG data homes and otherwise follows the XDG fallback", () => {
    expect(
      resolveStateDatabasePath({ XDG_DATA_HOME: "/var/lib/example" }, "/home/reviewer"),
    ).toBe("/var/lib/example/couch-review/state.sqlite");
    expect(
      resolveStateDatabasePath({ XDG_DATA_HOME: "relative/data" }, "/home/reviewer"),
    ).toBe("/home/reviewer/.local/share/couch-review/state.sqlite");
    expect(resolveStateDatabasePath({}, "/home/reviewer")).toBe(
      "/home/reviewer/.local/share/couch-review/state.sqlite",
    );
  });

  test("rejects an explicitly relative database location", async () => {
    await expect(StateDatabase.open("relative/state.sqlite")).rejects.toThrow(
      "must be absolute",
    );
  });

  test("creates a private versioned WAL database and reopens it", async () => {
    const filePath = await databasePath();
    const database = await StateDatabase.open(filePath);
    database.registerRepository({
      id: "repo-one",
      name: "one",
      root: "/projects/one",
      gitDirectory: "/projects/one/.git",
    });
    database.setReview("repo-one", review("alpha"));
    database.insertComment("repo-one", comment("comment-one", "alpha"));
    database.close();

    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const raw = new Database(filePath, { readonly: true, strict: true });
    expect(raw.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe(
      "wal",
    );
    expect(raw.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(
      1,
    );
    expect(
      raw
        .query<{ value: number }, []>(
          "SELECT value FROM metadata WHERE key = 'schema_version'",
        )
        .get()?.value,
    ).toBe(1);
    raw.close();

    const reopened = await StateDatabase.open(filePath);
    expect(reopened.repository("repo-one")).toMatchObject({ name: "one" });
    expect(reopened.reviewState("repo-one")).toEqual({
      reviews: [review("alpha")],
      comments: [comment("comment-one", "alpha")],
    });
    reopened.close();
  });

  test("isolates repositories across concurrent connections and cascades Forget", async () => {
    const filePath = await databasePath();
    const first = await StateDatabase.open(filePath);
    const second = await StateDatabase.open(filePath);
    try {
      expect(
        first.registerRepository({
          id: "repo-one",
          name: "one",
          root: "/projects/one",
          gitDirectory: "/projects/one/.git",
        }).added,
      ).toBe(true);
      expect(
        second.registerRepository({
          id: "repo-two",
          name: "two",
          root: "/projects/two",
          gitDirectory: "/projects/two/.git",
        }).added,
      ).toBe(true);
      expect(first.catalogRevision()).toBe(2);

      first.setReview("repo-one", review("alpha"));
      second.setReview("repo-two", review("beta"));
      second.insertComment("repo-one", comment("comment-one", "alpha"));

      expect(first.reviewState("repo-one")).toEqual({
        reviews: [review("alpha")],
        comments: [comment("comment-one", "alpha")],
      });
      expect(second.reviewState("repo-two")).toEqual({
        reviews: [review("beta")],
        comments: [],
      });
      expect(first.stateRevision("repo-one")).toBe(2);
      expect(second.stateRevision("repo-two")).toBe(1);

      expect(second.forgetRepository("repo-one")).toBe(true);
      expect(first.repository("repo-one")).toBeNull();
      expect(first.reviewState("repo-one")).toEqual({ reviews: [], comments: [] });
      expect(first.catalogRevision()).toBe(3);
    } finally {
      first.close();
      second.close();
    }
  });

  test("deduplicates catalog registration and enforces repository foreign keys", async () => {
    const database = await StateDatabase.open(await databasePath());
    try {
      const input = {
        id: "repo-one",
        name: "one",
        root: "/projects/one",
        gitDirectory: "/projects/one/.git",
      };
      expect(database.registerRepository(input).added).toBe(true);
      expect(database.registerRepository(input).added).toBe(false);
      expect(database.catalogRevision()).toBe(1);
      expect(() => database.setReview("missing-repository", review("alpha"))).toThrow();
      expect(database.stateRevision("repo-one")).toBe(0);
    } finally {
      database.close();
    }
  });

  test("shares server instance control records between processes", async () => {
    const filePath = await databasePath();
    const writer = await StateDatabase.open(filePath);
    const reader = await StateDatabase.open(filePath);
    try {
      writer.registerServerInstance({
        instanceId: "instance-one",
        bindHost: "127.0.0.1",
        port: 4173,
        pid: 42,
        version: "1.2.3",
        protocolVersion: 1,
        controlToken: "local-secret",
        accessOrigins: ["http://127.0.0.1:4173"],
        startedAt: "2026-07-22T10:00:00.000Z",
      });
      expect(reader.serverInstance("instance-one")).toMatchObject({
        controlToken: "local-secret",
        accessOrigins: ["http://127.0.0.1:4173"],
      });
      reader.removeServerInstance("instance-one");
      expect(writer.serverInstance("instance-one")).toBeNull();
    } finally {
      writer.close();
      reader.close();
    }
  });
});
