import type { RemoteBridgeDevice, ReviewComment, ReviewRecord } from "../shared/contracts.ts";
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

export interface CommentRow {
	id: string;
	file_id: string;
	path: string;
	side: ReviewComment["side"];
	start_line: number;
	end_line: number;
	old_start_line: number | null;
	old_end_line: number | null;
	new_start_line: number | null;
	new_end_line: number | null;
	hunk_header: string;
	excerpt_json: string;
	body: string;
	content_revision: string;
	stale: number;
	created_at: string;
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

export function commentFromRow(row: CommentRow): ReviewComment {
	const excerpt: unknown = JSON.parse(row.excerpt_json);
	if (!Array.isArray(excerpt) || !excerpt.every((line) => typeof line === "string")) {
		throw new Error(`Comment ${row.id} has invalid stored excerpt data`);
	}
	return {
		id: row.id,
		fileId: row.file_id,
		path: row.path,
		side: row.side,
		startLine: row.start_line,
		endLine: row.end_line,
		...(row.old_start_line === null
			? {}
			: { oldStartLine: row.old_start_line, oldEndLine: row.old_end_line ?? row.old_start_line }),
		...(row.new_start_line === null
			? {}
			: { newStartLine: row.new_start_line, newEndLine: row.new_end_line ?? row.new_start_line }),
		hunkHeader: row.hunk_header,
		excerpt,
		body: row.body,
		contentRevision: row.content_revision,
		stale: row.stale === 1,
		createdAt: row.created_at,
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
