import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import type { NativeClientDevice } from "../shared/nativeClients.ts";

interface NativeClientRow {
	id: string;
	label: string;
	token_hash: string;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

function nativeClientFromRow(row: NativeClientRow): NativeClientDevice {
	return {
		id: row.id,
		label: row.label,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		revokedAt: row.revoked_at,
	};
}

export class NativeClientDatabase {
	constructor(private readonly database: Database) {}

	createTables(): void {
		this.database.run(`
      CREATE TABLE IF NOT EXISTS server_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        server_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS native_clients (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS native_clients_created
        ON native_clients(created_at, id);
    `);
		this.database
			.query<unknown, { serverId: string; createdAt: string }>(`
        INSERT OR IGNORE INTO server_identity(singleton, server_id, created_at)
        VALUES (1, $serverId, $createdAt)
      `)
			.run({ serverId: randomUUID(), createdAt: new Date().toISOString() });
	}

	serverId(): string {
		const row = this.database
			.query<{ server_id: string }, []>("SELECT server_id FROM server_identity WHERE singleton = 1")
			.get();
		if (!row) throw new Error("Couchview server identity is missing");
		return row.server_id;
	}

	clients(): NativeClientDevice[] {
		return this.database
			.query<NativeClientRow, []>(`
        SELECT id, label, token_hash, created_at, last_used_at, revoked_at
        FROM native_clients
        WHERE revoked_at IS NULL
        ORDER BY created_at, id
      `)
			.all()
			.map(nativeClientFromRow);
	}

	createClient(input: {
		id: string;
		label: string;
		tokenHash: string;
		createdAt: string;
	}): NativeClientDevice {
		this.database
			.query<unknown, typeof input>(`
        INSERT INTO native_clients(id, label, token_hash, created_at)
        VALUES ($id, $label, $tokenHash, $createdAt)
      `)
			.run(input);
		const client = this.client(input.id);
		if (!client) throw new Error("Could not persist native client");
		return client;
	}

	client(id: string): NativeClientDevice | null {
		const row = this.database
			.query<NativeClientRow, { id: string }>(`
        SELECT id, label, token_hash, created_at, last_used_at, revoked_at
        FROM native_clients WHERE id = $id
      `)
			.get({ id });
		return row ? nativeClientFromRow(row) : null;
	}

	authenticate(tokenHash: string, usedAt: string, updateBefore: string): NativeClientDevice | null {
		const row = this.database
			.query<NativeClientRow, { tokenHash: string }>(`
        SELECT id, label, token_hash, created_at, last_used_at, revoked_at
        FROM native_clients
        WHERE token_hash = $tokenHash AND revoked_at IS NULL
      `)
			.get({ tokenHash });
		if (!row) return null;
		if (row.last_used_at === null || row.last_used_at < updateBefore) {
			this.database
				.query<unknown, { id: string; usedAt: string; updateBefore: string }>(`
          UPDATE native_clients SET last_used_at = $usedAt
          WHERE id = $id AND revoked_at IS NULL
            AND (last_used_at IS NULL OR last_used_at < $updateBefore)
        `)
				.run({ id: row.id, usedAt, updateBefore });
			row.last_used_at = usedAt;
		}
		return nativeClientFromRow(row);
	}

	revoke(id: string, revokedAt: string): NativeClientDevice | null {
		const current = this.client(id);
		if (!current) return null;
		if (!current.revokedAt) {
			this.database
				.query<unknown, { id: string; revokedAt: string }>(`
          UPDATE native_clients SET revoked_at = $revokedAt WHERE id = $id AND revoked_at IS NULL
        `)
				.run({ id, revokedAt });
		}
		return this.client(id);
	}
}
