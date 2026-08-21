import type { RemoteBridgeDevice, ReviewRecord } from "../shared/contracts.ts";
import { parseSettingsProfileData, type SettingsProfile } from "../shared/settings.ts";

export interface RepositoryRow {
	id: string;
	name: string;
	root: string;
	git_directory: string;
	added_at: string;
	updated_at: string;
	state_revision: number;
}

export interface ReviewRow {
	file_id: string;
	path: string;
	content_revision: string;
	reviewed: number;
	updated_at: string;
}

export interface MetadataRow {
	value: number;
}

export interface InstanceRow {
	instance_id: string;
	bind_host: string;
	port: number;
	pid: number;
	version: string;
	protocol_version: number;
	control_token: string;
	access_origins_json: string;
	started_at: string;
}

export interface RemoteBridgeDeviceRow {
	id: string;
	repository_id: string;
	label: string;
	ssh_alias: string;
	token_hash: string;
	created_at: string;
	last_used_at: string | null;
}

export interface SettingsProfileRow {
	id: string;
	name: string;
	data_json: string;
	revision: number;
	created_at: string;
	updated_at: string;
}

export function repositoryFromRow(row: RepositoryRow) {
	return {
		id: row.id,
		name: row.name,
		root: row.root,
		gitDirectory: row.git_directory,
		addedAt: row.added_at,
		updatedAt: row.updated_at,
		stateRevision: row.state_revision,
	};
}

export function reviewFromRow(row: ReviewRow): ReviewRecord {
	return {
		fileId: row.file_id,
		path: row.path,
		contentRevision: row.content_revision,
		reviewed: row.reviewed === 1,
		updatedAt: row.updated_at,
	};
}

export function remoteBridgeDeviceFromRow(row: RemoteBridgeDeviceRow): RemoteBridgeDevice {
	return {
		id: row.id,
		repositoryId: row.repository_id,
		label: row.label,
		sshAlias: row.ssh_alias,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
	};
}

export function settingsProfileFromRow(row: SettingsProfileRow): SettingsProfile {
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.data_json);
	} catch {
		throw new Error(`Settings profile ${row.id} contains invalid JSON`);
	}
	return {
		id: row.id,
		name: row.name,
		data: parseSettingsProfileData(parsed),
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
