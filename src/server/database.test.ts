import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReviewComment, ReviewRecord } from "../shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
} from "../shared/settings.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function databasePath(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-sqlite-"));
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
		expect(resolveStateDatabasePath({ XDG_DATA_HOME: "/var/lib/example" }, "/home/reviewer")).toBe(
			"/var/lib/example/couchview/state.sqlite",
		);
		expect(resolveStateDatabasePath({ XDG_DATA_HOME: "relative/data" }, "/home/reviewer")).toBe(
			"/home/reviewer/.local/share/couchview/state.sqlite",
		);
		expect(resolveStateDatabasePath({}, "/home/reviewer")).toBe(
			"/home/reviewer/.local/share/couchview/state.sqlite",
		);
	});

	test("continues using an existing pre-rename database", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "couchview-path-"));
		temporaryDirectories.push(directory);
		const legacyPath = path.join(directory, "couch-review", "state.sqlite");
		await mkdir(path.dirname(legacyPath), { recursive: true });
		await writeFile(legacyPath, "");

		expect(resolveStateDatabasePath({ XDG_DATA_HOME: directory })).toBe(legacyPath);

		const currentPath = path.join(directory, "couchview", "state.sqlite");
		await mkdir(path.dirname(currentPath), { recursive: true });
		await writeFile(currentPath, "");
		expect(resolveStateDatabasePath({ XDG_DATA_HOME: directory })).toBe(currentPath);
	});

	test("rejects an explicitly relative database location", async () => {
		await expect(StateDatabase.open("relative/state.sqlite")).rejects.toThrow("must be absolute");
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
			4,
		);
		expect(
			raw
				.query<{ value: number }, []>("SELECT value FROM metadata WHERE key = 'schema_version'")
				.get()?.value,
		).toBe(4);
		raw.close();

		const reopened = await StateDatabase.open(filePath);
		expect(reopened.repository("repo-one")).toMatchObject({ name: "one" });
		expect(reopened.reviewState("repo-one")).toEqual({
			reviews: [review("alpha")],
			comments: [comment("comment-one", "alpha")],
		});
		expect(reopened.settingsProfiles()).toEqual([
			expect.objectContaining({ id: DEFAULT_SETTINGS_PROFILE_ID, name: "Default", revision: 1 }),
		]);
		reopened.close();
	});

	test("migrates version-one state without losing repositories", async () => {
		const filePath = await databasePath();
		await mkdir(path.dirname(filePath), { recursive: true });
		const raw = new Database(filePath, { create: true, strict: true });
		raw.run(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root TEXT NOT NULL UNIQUE,
        git_directory TEXT NOT NULL,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state_revision INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO metadata(key, value) VALUES ('schema_version', 1);
      INSERT INTO metadata(key, value) VALUES ('catalog_revision', 1);
      INSERT INTO repositories(
        id, name, root, git_directory, added_at, updated_at, state_revision
      ) VALUES (
        'repo-one', 'one', '/projects/one', '/projects/one/.git',
        '2026-07-29T10:00:00.000Z', '2026-07-29T10:00:00.000Z', 0
      );
      PRAGMA user_version = 1;
    `);
		raw.close();

		const migrated = await StateDatabase.open(filePath);
		try {
			expect(migrated.repository("repo-one")).toMatchObject({ name: "one" });
			expect(migrated.remoteBridgeDevices()).toEqual([]);
			migrated.insertRemoteBridgeDevice(
				{
					id: "device-one",
					repositoryId: "repo-one",
					label: "Air",
					sshAlias: "couchview-one-device",
					createdAt: "2026-07-29T10:01:00.000Z",
					lastUsedAt: null,
				},
				"hash",
			);
			expect(migrated.remoteBridgeDevices()).toHaveLength(1);
		} finally {
			migrated.close();
		}
		const inspected = new Database(filePath, { readonly: true, strict: true });
		expect(
			inspected.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
		).toBe(4);
		expect(
			inspected
				.query<{ value: number }, []>("SELECT value FROM metadata WHERE key = 'schema_version'")
				.get()?.value,
		).toBe(4);
		inspected.close();
	});

	test("migrates repository-scoped bridge devices to host-wide credentials", async () => {
		const filePath = await databasePath();
		await mkdir(path.dirname(filePath), { recursive: true });
		const raw = new Database(filePath, { create: true, strict: true });
		raw.run(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root TEXT NOT NULL UNIQUE,
        git_directory TEXT NOT NULL,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state_revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE remote_bridge_devices (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        ssh_alias TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      INSERT INTO metadata(key, value) VALUES ('schema_version', 2);
      INSERT INTO metadata(key, value) VALUES ('catalog_revision', 1);
      INSERT INTO repositories(
        id, name, root, git_directory, added_at, updated_at, state_revision
      ) VALUES (
        'repo-one', 'one', '/projects/one', '/projects/one/.git',
        '2026-07-29T10:00:00.000Z', '2026-07-29T10:00:00.000Z', 0
      );
      INSERT INTO remote_bridge_devices(
        id, repository_id, label, ssh_alias, token_hash, created_at, last_used_at
      ) VALUES (
        'device-one', 'repo-one', 'Air', 'couchview-one-device',
        'hashed-secret', '2026-07-29T10:01:00.000Z', NULL
      );
      PRAGMA user_version = 2;
    `);
		raw.close();

		const migrated = await StateDatabase.open(filePath);
		try {
			expect(migrated.remoteBridgeDevices()).toEqual([
				expect.objectContaining({
					id: "device-one",
					repositoryId: "repo-one",
					sshAlias: "couchview-one-device",
				}),
			]);
			expect(migrated.forgetRepository("repo-one")).toBe(true);
			expect(migrated.remoteBridgeDeviceByTokenHash("hashed-secret")).toMatchObject({
				id: "device-one",
			});
		} finally {
			migrated.close();
		}

		const inspected = new Database(filePath, { readonly: true, strict: true });
		expect(
			inspected.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
		).toBe(4);
		expect(
			inspected
				.query<{ table: string }, []>("PRAGMA foreign_key_list(remote_bridge_devices)")
				.all(),
		).toEqual([]);
		inspected.close();
	});

	test("migrates version-three state and inserts the protected Default profile", async () => {
		const filePath = await databasePath();
		await mkdir(path.dirname(filePath), { recursive: true });
		const raw = new Database(filePath, { create: true, strict: true });
		raw.run(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root TEXT NOT NULL UNIQUE,
        git_directory TEXT NOT NULL,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state_revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE remote_bridge_devices (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        label TEXT NOT NULL,
        ssh_alias TEXT NOT NULL UNIQUE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      INSERT INTO metadata(key, value) VALUES ('schema_version', 3);
      INSERT INTO metadata(key, value) VALUES ('catalog_revision', 8);
      INSERT INTO repositories(
        id, name, root, git_directory, added_at, updated_at, state_revision
      ) VALUES (
        'repo-three', 'three', '/projects/three', '/projects/three/.git',
        '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z', 2
      );
      INSERT INTO remote_bridge_devices(
        id, repository_id, label, ssh_alias, token_hash, created_at, last_used_at
      ) VALUES (
        'device-three', 'repo-three', 'Studio', 'couchview-three-device',
        'hashed-three', '2026-07-30T10:01:00.000Z', NULL
      );
      PRAGMA user_version = 3;
    `);
		raw.close();

		const migrated = await StateDatabase.open(filePath);
		try {
			expect(migrated.repository("repo-three")).toMatchObject({ name: "three" });
			expect(migrated.remoteBridgeDevices()).toEqual([
				expect.objectContaining({ id: "device-three", repositoryId: "repo-three" }),
			]);
			expect(migrated.catalogRevision()).toBe(8);
			expect(migrated.settingsProfiles()).toEqual([
				expect.objectContaining({
					id: DEFAULT_SETTINGS_PROFILE_ID,
					name: "Default",
					data: createDefaultSettingsProfileData(),
					revision: 1,
				}),
			]);
		} finally {
			migrated.close();
		}
		const inspected = new Database(filePath, { readonly: true, strict: true });
		expect(
			inspected.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
		).toBe(4);
		inspected.close();
	});

	test("creates, duplicates, updates, resets, and deletes host-wide profiles", async () => {
		const filePath = await databasePath();
		const database = await StateDatabase.open(filePath);
		const defaults = createDefaultSettingsProfileData();
		const editedDefault = structuredClone(defaults);
		editedDefault.typography.diff.fontSize = 14;
		try {
			const initial = database.settingsProfiles();
			expect(initial).toHaveLength(1);
			expect(database.deleteSettingsProfile(DEFAULT_SETTINGS_PROFILE_ID)).toBe(false);

			const defaultUpdate = database.updateSettingsProfile(
				DEFAULT_SETTINGS_PROFILE_ID,
				"Renamed Default",
				editedDefault,
				1,
			);
			expect(defaultUpdate).toMatchObject({
				status: "updated",
				profile: { name: "Default", revision: 2, data: editedDefault },
			});
			expect(
				database.updateSettingsProfile(DEFAULT_SETTINGS_PROFILE_ID, "Default", defaults, 1),
			).toMatchObject({ status: "stale", profile: { revision: 2 } });

			const duplicate = database.createSettingsProfile(
				"  Review room  ",
				DEFAULT_SETTINGS_PROFILE_ID,
			);
			expect(duplicate).toMatchObject({
				name: "Review room",
				revision: 1,
				data: editedDefault,
			});
			expect(() => database.createSettingsProfile("review ROOM")).toThrow("UNIQUE");
			expect(() => database.createSettingsProfile("Default")).toThrow("UNIQUE");
			expect(() => database.createSettingsProfile("", duplicate.id)).toThrow("between 1 and 64");
			expect(() => database.createSettingsProfile("Missing source", "missing")).toThrow(
				"does not exist",
			);

			const reset = database.updateSettingsProfile(
				duplicate.id,
				"Desk",
				defaults,
				duplicate.revision,
			);
			expect(reset).toMatchObject({
				status: "updated",
				profile: { name: "Desk", revision: 2, data: defaults },
			});
			expect(database.deleteSettingsProfile(duplicate.id)).toBe(true);
			expect(database.deleteSettingsProfile(duplicate.id)).toBe(false);
		} finally {
			database.close();
		}

		const reopened = await StateDatabase.open(filePath);
		try {
			expect(reopened.settingsProfile(DEFAULT_SETTINGS_PROFILE_ID)).toMatchObject({
				name: "Default",
				revision: 2,
				data: editedDefault,
			});
			expect(reopened.settingsProfiles()).toHaveLength(1);
		} finally {
			reopened.close();
		}
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

	test("stores only hashed host-wide bridge credentials independently of repositories", async () => {
		const database = StateDatabase.memory();
		try {
			database.registerRepository({
				id: "repo-one",
				name: "one",
				root: "/projects/one",
				gitDirectory: "/projects/one/.git",
			});
			const device = {
				id: "device-one",
				repositoryId: "repo-one",
				label: "MacBook Air",
				sshAlias: "couchview-one-device",
				createdAt: "2026-07-29T10:00:00.000Z",
				lastUsedAt: null,
			};
			database.insertRemoteBridgeDevice(device, "hashed-secret");
			expect(database.remoteBridgeDevices()).toEqual([device]);
			expect(database.remoteBridgeDeviceByTokenHash("raw-secret")).toBeNull();
			expect(database.remoteBridgeDeviceByTokenHash("hashed-secret")).toEqual(device);
			expect(database.touchRemoteBridgeDevice(device.id, "2026-07-29T10:01:00.000Z")).toBe(true);
			expect(database.remoteBridgeDevices()[0]?.lastUsedAt).toBe("2026-07-29T10:01:00.000Z");
			expect(database.forgetRepository("repo-one")).toBe(true);
			expect(database.remoteBridgeDevices()).toEqual([
				{ ...device, lastUsedAt: "2026-07-29T10:01:00.000Z" },
			]);
			expect(database.remoteBridgeDeviceByTokenHash("hashed-secret")).toMatchObject({
				id: "device-one",
			});
		} finally {
			database.close();
		}
	});
});
