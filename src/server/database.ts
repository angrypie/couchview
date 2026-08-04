import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { RemoteBridgeDevice, ReviewComment, ReviewRecord } from "../shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	DEFAULT_SETTINGS_PROFILE_NAME,
	normalizeSettingsProfileName,
	parseSettingsProfileData,
	type SettingsProfile,
	type SettingsProfileData,
} from "../shared/settings.ts";
import { ArtifactDatabase } from "./artifactDatabase.ts";
import {
	type CommentRow,
	commentFromRow,
	type InstanceRow,
	type MetadataRow,
	type RemoteBridgeDeviceRow,
	type RepositoryRow,
	type ReviewRow,
	remoteBridgeDeviceFromRow,
	repositoryFromRow,
	reviewFromRow,
	type SettingsProfileRow,
	settingsProfileFromRow,
} from "./databaseRows.ts";

const SCHEMA_VERSION = 5;

export interface StoredRepository {
	id: string;
	name: string;
	root: string;
	gitDirectory: string;
	addedAt: string;
	updatedAt: string;
	stateRevision: number;
}

export interface RegisterStoredRepositoryInput {
	id: string;
	name: string;
	root: string;
	gitDirectory: string;
}

export interface StoredServerInstance {
	instanceId: string;
	bindHost: string;
	port: number;
	pid: number;
	version: string;
	protocolVersion: number;
	controlToken: string;
	accessOrigins: string[];
	startedAt: string;
}

export interface StoredReviewState {
	reviews: ReviewRecord[];
	comments: ReviewComment[];
}

export type UpdateSettingsProfileResult =
	| { status: "updated"; profile: SettingsProfile }
	| { status: "missing" }
	| { status: "stale"; profile: SettingsProfile };

export function resolveStateDatabasePath(
	environment: NodeJS.ProcessEnv = process.env,
	homeDirectory = homedir(),
): string {
	const configured = environment.XDG_DATA_HOME;
	const dataHome =
		configured && path.isAbsolute(configured)
			? configured
			: path.join(homeDirectory, ".local", "share");
	return path.join(dataHome, "couchview", "state.sqlite");
}

export class StateDatabase {
	readonly filePath: string;
	readonly artifacts: ArtifactDatabase;
	private readonly database: Database;

	private constructor(filePath: string, database: Database, requireWal: boolean) {
		this.filePath = filePath;
		this.database = database;
		this.artifacts = new ArtifactDatabase(database);
		this.database.run("PRAGMA foreign_keys = ON;");
		this.database.run("PRAGMA busy_timeout = 5000;");
		if (requireWal) {
			const result = this.database
				.query<{ journal_mode: string }, []>("PRAGMA journal_mode = WAL;")
				.get();
			if (result?.journal_mode.toLocaleLowerCase() !== "wal") {
				this.database.close();
				throw new Error(
					"Couchview requires SQLite WAL support; place XDG_DATA_HOME on a local filesystem",
				);
			}
		}
		this.initializeSchema();
	}

	static async open(filePath = resolveStateDatabasePath()): Promise<StateDatabase> {
		if (filePath === ":memory:") return StateDatabase.memory();
		if (!path.isAbsolute(filePath)) {
			throw new Error("Couchview state database path must be absolute");
		}
		const directory = path.dirname(filePath);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await chmod(directory, 0o700);
		const database = new Database(filePath, { create: true, strict: true });
		try {
			const state = new StateDatabase(filePath, database, true);
			await chmod(filePath, 0o600);
			return state;
		} catch (error) {
			database.close();
			throw error;
		}
	}

	static memory(): StateDatabase {
		return new StateDatabase(":memory:", new Database(":memory:", { strict: true }), false);
	}

	private initializeSchema(): void {
		const version =
			this.database.query<{ user_version: number }, []>("PRAGMA user_version;").get()
				?.user_version ?? 0;
		if (version > SCHEMA_VERSION) {
			throw new Error(
				`Couchview data uses schema ${version}, but this version supports ${SCHEMA_VERSION}`,
			);
		}
		if (version === SCHEMA_VERSION) {
			this.database.run(
				`INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', ${SCHEMA_VERSION})`,
			);
			this.database.run(
				"INSERT OR IGNORE INTO metadata(key, value) VALUES ('catalog_revision', 0)",
			);
			this.createSettingsProfilesTable();
			this.createArtifactTables();
			this.ensureDefaultSettingsProfile();
			return;
		}

		if (version === 4) {
			this.migrateVersionFourToFive();
			return;
		}

		if (version === 3) {
			this.migrateVersionThreeToFour();
			return;
		}

		if (version === 2) {
			this.database.transaction(() => {
				this.database.run(`
          ALTER TABLE remote_bridge_devices
            RENAME TO remote_bridge_devices_repository_scoped;
          CREATE TABLE remote_bridge_devices (
            id TEXT PRIMARY KEY,
            repository_id TEXT NOT NULL,
            label TEXT NOT NULL,
            ssh_alias TEXT NOT NULL UNIQUE,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            last_used_at TEXT
          );
          INSERT INTO remote_bridge_devices(
            id, repository_id, label, ssh_alias, token_hash, created_at, last_used_at
          )
          SELECT
            id, repository_id, label, ssh_alias, token_hash, created_at, last_used_at
          FROM remote_bridge_devices_repository_scoped;
          DROP TABLE remote_bridge_devices_repository_scoped;
          CREATE INDEX remote_bridge_devices_created
            ON remote_bridge_devices(created_at);
          UPDATE metadata SET value = 3 WHERE key = 'schema_version';
          PRAGMA user_version = 3;
        `);
			})();
			this.migrateVersionThreeToFour();
			return;
		}

		if (version === 1) {
			this.database.transaction(() => {
				this.database.run(`
          CREATE TABLE remote_bridge_devices (
            id TEXT PRIMARY KEY,
            repository_id TEXT NOT NULL,
            label TEXT NOT NULL,
            ssh_alias TEXT NOT NULL UNIQUE,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            last_used_at TEXT
          );
          CREATE INDEX remote_bridge_devices_created
            ON remote_bridge_devices(created_at);
          UPDATE metadata SET value = 3 WHERE key = 'schema_version';
          PRAGMA user_version = 3;
        `);
			})();
			this.migrateVersionThreeToFour();
			return;
		}

		this.database.transaction(() => {
			this.database.run(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS repositories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root TEXT NOT NULL UNIQUE,
          git_directory TEXT NOT NULL,
          added_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          state_revision INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reviews (
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL,
          path TEXT NOT NULL,
          content_revision TEXT NOT NULL,
          reviewed INTEGER NOT NULL CHECK (reviewed IN (0, 1)),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (repository_id, file_id)
        );
        CREATE TABLE IF NOT EXISTS comments (
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          file_id TEXT NOT NULL,
          path TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('old', 'new', 'mixed')),
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          old_start_line INTEGER,
          old_end_line INTEGER,
          new_start_line INTEGER,
          new_end_line INTEGER,
          hunk_header TEXT NOT NULL,
          excerpt_json TEXT NOT NULL,
          body TEXT NOT NULL,
          content_revision TEXT NOT NULL,
          stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (repository_id, id)
        );
        CREATE INDEX IF NOT EXISTS comments_repository_file
          ON comments(repository_id, file_id);
        CREATE TABLE IF NOT EXISTS server_instances (
          instance_id TEXT PRIMARY KEY,
          bind_host TEXT NOT NULL,
          port INTEGER NOT NULL,
          pid INTEGER NOT NULL,
          version TEXT NOT NULL,
          protocol_version INTEGER NOT NULL,
          control_token TEXT NOT NULL,
          access_origins_json TEXT NOT NULL,
          started_at TEXT NOT NULL,
          UNIQUE (bind_host, port)
        );
        CREATE TABLE IF NOT EXISTS remote_bridge_devices (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL,
          label TEXT NOT NULL,
          ssh_alias TEXT NOT NULL UNIQUE,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_used_at TEXT
        );
        CREATE INDEX IF NOT EXISTS remote_bridge_devices_created
          ON remote_bridge_devices(created_at);
        CREATE TABLE IF NOT EXISTS settings_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          data_json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
		CREATE TABLE IF NOT EXISTS artifact_definitions (
		  id TEXT PRIMARY KEY,
		  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
		  name TEXT NOT NULL COLLATE NOCASE,
		  argv_json TEXT NOT NULL,
		  working_directory TEXT NOT NULL,
		  output_path TEXT NOT NULL,
		  output_kind TEXT NOT NULL CHECK (output_kind IN ('file', 'directory')),
		  revision INTEGER NOT NULL CHECK (revision >= 1),
		  created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL,
		  UNIQUE(repository_id, name)
		);
		CREATE INDEX IF NOT EXISTS artifact_definitions_repository
		  ON artifact_definitions(repository_id, name);
		CREATE TABLE IF NOT EXISTS artifact_builds (
		  id TEXT PRIMARY KEY,
		  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
		  artifact_id TEXT NOT NULL REFERENCES artifact_definitions(id) ON DELETE CASCADE,
		  definition_revision INTEGER NOT NULL,
		  download_name TEXT NOT NULL,
		  media_type TEXT NOT NULL,
		  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
		  sha256 TEXT NOT NULL,
		  created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS artifact_builds_artifact_created
		  ON artifact_builds(artifact_id, created_at DESC);
        INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', 5);
        INSERT OR IGNORE INTO metadata(key, value) VALUES ('catalog_revision', 0);
        PRAGMA user_version = 5;
      `);
			this.ensureDefaultSettingsProfile();
		})();
	}

	private createSettingsProfilesTable(): void {
		this.database.run(`
      CREATE TABLE IF NOT EXISTS settings_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        data_json TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
	}

	private createArtifactTables(): void {
		this.database.run(`
      CREATE TABLE IF NOT EXISTS artifact_definitions (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE,
        argv_json TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        output_path TEXT NOT NULL,
        output_kind TEXT NOT NULL CHECK (output_kind IN ('file', 'directory')),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(repository_id, name)
      );
      CREATE INDEX IF NOT EXISTS artifact_definitions_repository
        ON artifact_definitions(repository_id, name);
      CREATE TABLE IF NOT EXISTS artifact_builds (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES artifact_definitions(id) ON DELETE CASCADE,
        definition_revision INTEGER NOT NULL,
        download_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS artifact_builds_artifact_created
        ON artifact_builds(artifact_id, created_at DESC)
    `);
	}

	private ensureDefaultSettingsProfile(): void {
		const now = new Date().toISOString();
		this.database
			.query<
				unknown,
				{
					id: string;
					name: string;
					dataJson: string;
					now: string;
				}
			>(`
      INSERT OR IGNORE INTO settings_profiles(
        id, name, data_json, revision, created_at, updated_at
      ) VALUES ($id, $name, $dataJson, 1, $now, $now)
    `)
			.run({
				id: DEFAULT_SETTINGS_PROFILE_ID,
				name: DEFAULT_SETTINGS_PROFILE_NAME,
				dataJson: JSON.stringify(createDefaultSettingsProfileData()),
				now,
			});
	}

	private migrateVersionThreeToFour(): void {
		this.database.transaction(() => {
			this.createSettingsProfilesTable();
			this.ensureDefaultSettingsProfile();
			this.database.run(`
        UPDATE metadata SET value = 4 WHERE key = 'schema_version';
        INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', 4);
        PRAGMA user_version = 4;
      `);
		})();
		this.migrateVersionFourToFive();
	}

	private migrateVersionFourToFive(): void {
		this.database.transaction(() => {
			this.createArtifactTables();
			this.database.run(`
        UPDATE metadata SET value = 5 WHERE key = 'schema_version';
        INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', 5);
        PRAGMA user_version = 5;
      `);
		})();
	}

	settingsProfiles(): SettingsProfile[] {
		return this.database
			.query<SettingsProfileRow, []>(`
      SELECT id, name, data_json, revision, created_at, updated_at
      FROM settings_profiles
      ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END,
        name COLLATE NOCASE, created_at, id
    `)
			.all()
			.map(settingsProfileFromRow);
	}

	settingsProfile(id: string): SettingsProfile | null {
		const row = this.database
			.query<SettingsProfileRow, { id: string }>(`
      SELECT id, name, data_json, revision, created_at, updated_at
      FROM settings_profiles WHERE id = $id
    `)
			.get({ id });
		return row ? settingsProfileFromRow(row) : null;
	}

	createSettingsProfile(nameValue: unknown, sourceProfileId?: string): SettingsProfile {
		const name = normalizeSettingsProfileName(nameValue);
		const source = sourceProfileId ? this.settingsProfile(sourceProfileId) : null;
		if (sourceProfileId && !source) {
			throw new Error("Source settings profile does not exist");
		}
		const data = source?.data ?? createDefaultSettingsProfileData();
		const now = new Date().toISOString();
		const id = randomUUID();
		this.database
			.query<
				unknown,
				{
					id: string;
					name: string;
					dataJson: string;
					now: string;
				}
			>(`
      INSERT INTO settings_profiles(
        id, name, data_json, revision, created_at, updated_at
      ) VALUES ($id, $name, $dataJson, 1, $now, $now)
    `)
			.run({ id, name, dataJson: JSON.stringify(data), now });
		const profile = this.settingsProfile(id);
		if (!profile) throw new Error("Could not persist settings profile");
		return profile;
	}

	updateSettingsProfile(
		id: string,
		nameValue: unknown,
		dataValue: SettingsProfileData,
		expectedRevision: number,
	): UpdateSettingsProfileResult {
		const current = this.settingsProfile(id);
		if (!current) return { status: "missing" };
		if (current.revision !== expectedRevision) {
			return { status: "stale", profile: current };
		}
		const name =
			id === DEFAULT_SETTINGS_PROFILE_ID
				? DEFAULT_SETTINGS_PROFILE_NAME
				: normalizeSettingsProfileName(nameValue);
		const data = parseSettingsProfileData(dataValue);
		const updatedAt = new Date().toISOString();
		const result = this.database
			.query<
				unknown,
				{
					id: string;
					name: string;
					dataJson: string;
					expectedRevision: number;
					updatedAt: string;
				}
			>(`
      UPDATE settings_profiles
      SET name = $name,
        data_json = $dataJson,
        revision = revision + 1,
        updated_at = $updatedAt
      WHERE id = $id AND revision = $expectedRevision
    `)
			.run({
				id,
				name,
				dataJson: JSON.stringify(data),
				expectedRevision,
				updatedAt,
			});
		if (result.changes === 0) {
			const latest = this.settingsProfile(id);
			return latest ? { status: "stale", profile: latest } : { status: "missing" };
		}
		const profile = this.settingsProfile(id);
		if (!profile) throw new Error("Could not reload updated settings profile");
		return { status: "updated", profile };
	}

	deleteSettingsProfile(id: string): boolean {
		if (id === DEFAULT_SETTINGS_PROFILE_ID) return false;
		return (
			this.database
				.query<unknown, { id: string }>("DELETE FROM settings_profiles WHERE id = $id")
				.run({ id }).changes > 0
		);
	}

	registerRepository(input: RegisterStoredRepositoryInput): {
		repository: StoredRepository;
		added: boolean;
	} {
		return this.database
			.transaction(() => {
				const existing = this.repository(input.id);
				const now = new Date().toISOString();
				if (!existing) {
					this.database
						.query<
							unknown,
							{
								id: string;
								name: string;
								root: string;
								gitDirectory: string;
								now: string;
							}
						>(`
          INSERT INTO repositories(id, name, root, git_directory, added_at, updated_at)
          VALUES ($id, $name, $root, $gitDirectory, $now, $now)
        `)
						.run({ ...input, now });
					this.bumpCatalogRevision();
				} else {
					const changed =
						existing.name !== input.name ||
						existing.root !== input.root ||
						existing.gitDirectory !== input.gitDirectory;
					if (changed) {
						this.database
							.query<
								unknown,
								{
									id: string;
									name: string;
									root: string;
									gitDirectory: string;
									now: string;
								}
							>(`
            UPDATE repositories
            SET name = $name, root = $root, git_directory = $gitDirectory, updated_at = $now
            WHERE id = $id
          `)
							.run({ ...input, now });
						this.bumpCatalogRevision();
					}
				}
				const repository = this.repository(input.id);
				if (!repository) throw new Error("Could not persist repository metadata");
				return { repository, added: !existing };
			})
			.immediate();
	}

	repository(id: string): StoredRepository | null {
		const row = this.database
			.query<RepositoryRow, { id: string }>(`
      SELECT id, name, root, git_directory, added_at, updated_at, state_revision
      FROM repositories WHERE id = $id
    `)
			.get({ id });
		return row ? repositoryFromRow(row) : null;
	}

	repositories(): StoredRepository[] {
		return this.database
			.query<RepositoryRow, []>(`
      SELECT id, name, root, git_directory, added_at, updated_at, state_revision
      FROM repositories ORDER BY updated_at DESC, name COLLATE NOCASE, root
    `)
			.all()
			.map(repositoryFromRow);
	}

	forgetRepository(id: string): boolean {
		return this.database
			.transaction(() => {
				const result = this.database
					.query<unknown, { id: string }>("DELETE FROM repositories WHERE id = $id")
					.run({ id });
				if (result.changes > 0) this.bumpCatalogRevision();
				return result.changes > 0;
			})
			.immediate();
	}

	catalogRevision(): number {
		return (
			this.database
				.query<MetadataRow, []>("SELECT value FROM metadata WHERE key = 'catalog_revision'")
				.get()?.value ?? 0
		);
	}

	private bumpCatalogRevision(): void {
		this.database.run("UPDATE metadata SET value = value + 1 WHERE key = 'catalog_revision'");
	}

	stateRevision(repositoryId: string): number | null {
		return (
			this.database
				.query<{ state_revision: number }, { repositoryId: string }>(
					"SELECT state_revision FROM repositories WHERE id = $repositoryId",
				)
				.get({ repositoryId })?.state_revision ?? null
		);
	}

	private bumpStateRevision(repositoryId: string): void {
		this.database
			.query<unknown, { repositoryId: string }>(`
        UPDATE repositories
        SET state_revision = state_revision + 1, updated_at = updated_at
        WHERE id = $repositoryId
      `)
			.run({ repositoryId });
	}

	reviewState(repositoryId: string): StoredReviewState {
		return this.database
			.transaction(() => {
				const reviews = this.database
					.query<ReviewRow, { repositoryId: string }>(`
        SELECT file_id, path, content_revision, reviewed, updated_at
        FROM reviews WHERE repository_id = $repositoryId ORDER BY updated_at, file_id
      `)
					.all({ repositoryId })
					.map(reviewFromRow);
				const comments = this.database
					.query<CommentRow, { repositoryId: string }>(`
        SELECT id, file_id, path, side, start_line, end_line,
          old_start_line, old_end_line, new_start_line, new_end_line,
          hunk_header, excerpt_json, body, content_revision, stale,
          created_at, updated_at
        FROM comments WHERE repository_id = $repositoryId ORDER BY created_at, id
      `)
					.all({ repositoryId })
					.map(commentFromRow);
				return { reviews, comments };
			})
			.deferred();
	}

	setReview(repositoryId: string, record: ReviewRecord): ReviewRecord {
		this.database
			.transaction(() => {
				this.database
					.query<
						unknown,
						{
							repositoryId: string;
							fileId: string;
							path: string;
							contentRevision: string;
							reviewed: boolean;
							updatedAt: string;
						}
					>(`
        INSERT INTO reviews(repository_id, file_id, path, content_revision, reviewed, updated_at)
        VALUES ($repositoryId, $fileId, $path, $contentRevision, $reviewed, $updatedAt)
        ON CONFLICT(repository_id, file_id) DO UPDATE SET
          path = excluded.path,
          content_revision = excluded.content_revision,
          reviewed = excluded.reviewed,
          updated_at = excluded.updated_at
      `)
					.run({ repositoryId, ...record });
				this.bumpStateRevision(repositoryId);
			})
			.immediate();
		return structuredClone(record);
	}

	insertComment(repositoryId: string, comment: ReviewComment): ReviewComment {
		this.database
			.transaction(() => {
				this.database
					.query<
						unknown,
						{
							repositoryId: string;
							id: string;
							fileId: string;
							path: string;
							side: ReviewComment["side"];
							startLine: number;
							endLine: number;
							oldStartLine: number | null;
							oldEndLine: number | null;
							newStartLine: number | null;
							newEndLine: number | null;
							hunkHeader: string;
							excerptJson: string;
							body: string;
							contentRevision: string;
							stale: boolean;
							createdAt: string;
							updatedAt: string;
						}
					>(`
        INSERT INTO comments(
          repository_id, id, file_id, path, side, start_line, end_line,
          old_start_line, old_end_line, new_start_line, new_end_line,
          hunk_header, excerpt_json, body, content_revision, stale,
          created_at, updated_at
        ) VALUES (
          $repositoryId, $id, $fileId, $path, $side, $startLine, $endLine,
          $oldStartLine, $oldEndLine, $newStartLine, $newEndLine,
          $hunkHeader, $excerptJson, $body, $contentRevision, $stale,
          $createdAt, $updatedAt
        )
      `)
					.run({
						repositoryId,
						...comment,
						oldStartLine: comment.oldStartLine ?? null,
						oldEndLine: comment.oldEndLine ?? null,
						newStartLine: comment.newStartLine ?? null,
						newEndLine: comment.newEndLine ?? null,
						excerptJson: JSON.stringify(comment.excerpt),
					});
				this.bumpStateRevision(repositoryId);
			})
			.immediate();
		return structuredClone(comment);
	}

	updateComment(
		repositoryId: string,
		id: string,
		body: string,
		updatedAt: string,
	): ReviewComment | null {
		return this.database
			.transaction(() => {
				const result = this.database
					.query<
						unknown,
						{
							repositoryId: string;
							id: string;
							body: string;
							updatedAt: string;
						}
					>(`
        UPDATE comments SET body = $body, updated_at = $updatedAt
        WHERE repository_id = $repositoryId AND id = $id
      `)
					.run({ repositoryId, id, body, updatedAt });
				if (result.changes === 0) return null;
				this.bumpStateRevision(repositoryId);
				const row = this.database
					.query<CommentRow, { repositoryId: string; id: string }>(`
        SELECT id, file_id, path, side, start_line, end_line,
          old_start_line, old_end_line, new_start_line, new_end_line,
          hunk_header, excerpt_json, body, content_revision, stale,
          created_at, updated_at
        FROM comments WHERE repository_id = $repositoryId AND id = $id
      `)
					.get({ repositoryId, id });
				return row ? commentFromRow(row) : null;
			})
			.immediate();
	}

	deleteComment(repositoryId: string, id: string): boolean {
		return this.database
			.transaction(() => {
				const result = this.database
					.query<unknown, { repositoryId: string; id: string }>(
						"DELETE FROM comments WHERE repository_id = $repositoryId AND id = $id",
					)
					.run({ repositoryId, id });
				if (result.changes > 0) this.bumpStateRevision(repositoryId);
				return result.changes > 0;
			})
			.immediate();
	}

	remoteBridgeDevices(): RemoteBridgeDevice[] {
		return this.database
			.query<RemoteBridgeDeviceRow, []>(`
      SELECT id, repository_id, label, ssh_alias, token_hash, created_at, last_used_at
      FROM remote_bridge_devices
      ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC, id
    `)
			.all()
			.map(remoteBridgeDeviceFromRow);
	}

	insertRemoteBridgeDevice(device: RemoteBridgeDevice, tokenHash: string): RemoteBridgeDevice {
		this.database
			.query<
				unknown,
				{
					id: string;
					repositoryId: string;
					label: string;
					sshAlias: string;
					tokenHash: string;
					createdAt: string;
					lastUsedAt: string | null;
				}
			>(`
      INSERT INTO remote_bridge_devices(
        id, repository_id, label, ssh_alias, token_hash, created_at, last_used_at
      ) VALUES (
        $id, $repositoryId, $label, $sshAlias, $tokenHash, $createdAt, $lastUsedAt
      )
    `)
			.run({ ...device, tokenHash });
		return structuredClone(device);
	}

	remoteBridgeDeviceByTokenHash(tokenHash: string): RemoteBridgeDevice | null {
		const row = this.database
			.query<RemoteBridgeDeviceRow, { tokenHash: string }>(`
      SELECT id, repository_id, label, ssh_alias, token_hash, created_at, last_used_at
      FROM remote_bridge_devices WHERE token_hash = $tokenHash
    `)
			.get({ tokenHash });
		return row ? remoteBridgeDeviceFromRow(row) : null;
	}

	touchRemoteBridgeDevice(id: string, lastUsedAt: string): boolean {
		return (
			this.database
				.query<unknown, { id: string; lastUsedAt: string }>(`
      UPDATE remote_bridge_devices SET last_used_at = $lastUsedAt WHERE id = $id
    `)
				.run({ id, lastUsedAt }).changes > 0
		);
	}

	deleteRemoteBridgeDevice(id: string): boolean {
		return (
			this.database
				.query<unknown, { id: string }>(`
      DELETE FROM remote_bridge_devices WHERE id = $id
    `)
				.run({ id }).changes > 0
		);
	}

	registerServerInstance(instance: StoredServerInstance): void {
		this.database
			.transaction(() => {
				this.database
					.query<unknown, { bindHost: string; port: number }>(
						"DELETE FROM server_instances WHERE bind_host = $bindHost AND port = $port",
					)
					.run({ bindHost: instance.bindHost, port: instance.port });
				this.database
					.query<
						unknown,
						{
							instanceId: string;
							bindHost: string;
							port: number;
							pid: number;
							version: string;
							protocolVersion: number;
							controlToken: string;
							accessOriginsJson: string;
							startedAt: string;
						}
					>(`
        INSERT INTO server_instances(
          instance_id, bind_host, port, pid, version, protocol_version,
          control_token, access_origins_json, started_at
        ) VALUES (
          $instanceId, $bindHost, $port, $pid, $version, $protocolVersion,
          $controlToken, $accessOriginsJson, $startedAt
        )
      `)
					.run({
						...instance,
						accessOriginsJson: JSON.stringify(instance.accessOrigins),
					});
			})
			.immediate();
	}

	serverInstance(instanceId: string): StoredServerInstance | null {
		const row = this.database
			.query<InstanceRow, { instanceId: string }>(`
      SELECT instance_id, bind_host, port, pid, version, protocol_version,
        control_token, access_origins_json, started_at
      FROM server_instances WHERE instance_id = $instanceId
    `)
			.get({ instanceId });
		if (!row) return null;
		const accessOrigins: unknown = JSON.parse(row.access_origins_json);
		if (!Array.isArray(accessOrigins) || !accessOrigins.every((item) => typeof item === "string")) {
			throw new Error(`Server instance ${instanceId} has invalid origin data`);
		}
		return {
			instanceId: row.instance_id,
			bindHost: row.bind_host,
			port: row.port,
			pid: row.pid,
			version: row.version,
			protocolVersion: row.protocol_version,
			controlToken: row.control_token,
			accessOrigins,
			startedAt: row.started_at,
		};
	}

	serverInstances(): StoredServerInstance[] {
		return this.database
			.query<InstanceRow, []>(`
        SELECT instance_id, bind_host, port, pid, version, protocol_version,
          control_token, access_origins_json, started_at
        FROM server_instances ORDER BY started_at DESC, instance_id
      `)
			.all()
			.map((row) => {
				const accessOrigins: unknown = JSON.parse(row.access_origins_json);
				if (
					!Array.isArray(accessOrigins) ||
					!accessOrigins.every((item) => typeof item === "string")
				) {
					throw new Error(`Server instance ${row.instance_id} has invalid origin data`);
				}
				return {
					instanceId: row.instance_id,
					bindHost: row.bind_host,
					port: row.port,
					pid: row.pid,
					version: row.version,
					protocolVersion: row.protocol_version,
					controlToken: row.control_token,
					accessOrigins,
					startedAt: row.started_at,
				};
			});
	}

	removeServerInstance(instanceId: string): void {
		this.database
			.query<unknown, { instanceId: string }>(
				"DELETE FROM server_instances WHERE instance_id = $instanceId",
			)
			.run({ instanceId });
	}

	close(): void {
		this.database.close();
	}
}
