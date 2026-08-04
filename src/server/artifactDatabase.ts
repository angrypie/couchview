import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

import {
	ARTIFACT_RETAINED_BUILDS,
	type ArtifactBuild,
	type ArtifactDefinition,
	type ArtifactDefinitionInput,
	parseArtifactDefinitionInput,
} from "../shared/artifacts.ts";

interface ArtifactDefinitionRow {
	id: string;
	repository_id: string;
	name: string;
	argv_json: string;
	working_directory: string;
	output_path: string;
	output_kind: ArtifactDefinition["outputKind"];
	revision: number;
	created_at: string;
	updated_at: string;
}

interface ArtifactBuildRow {
	id: string;
	repository_id: string;
	artifact_id: string;
	definition_revision: number;
	download_name: string;
	media_type: string;
	size_bytes: number;
	sha256: string;
	created_at: string;
}

interface ArtifactDefinitionBindings {
	[key: string]: string | number;
	id: string;
	repositoryId: string;
	name: string;
	argvJson: string;
	workingDirectory: string;
	outputPath: string;
	outputKind: ArtifactDefinition["outputKind"];
	now: string;
}

interface ArtifactDefinitionUpdateBindings extends ArtifactDefinitionBindings {
	expectedRevision: number;
}

interface ArtifactBuildBindings {
	[key: string]: string | number;
	id: string;
	repositoryId: string;
	artifactId: string;
	definitionRevision: number;
	downloadName: string;
	mediaType: string;
	sizeBytes: number;
	sha256: string;
	createdAt: string;
}

export type UpdateArtifactDefinitionResult =
	| { status: "updated"; definition: ArtifactDefinition }
	| { status: "missing" }
	| { status: "stale"; definition: ArtifactDefinition };

function definitionFromRow(row: ArtifactDefinitionRow): ArtifactDefinition {
	let argv: unknown;
	try {
		argv = JSON.parse(row.argv_json);
	} catch {
		throw new Error(`Artifact definition ${row.id} contains invalid argv JSON`);
	}
	const input = parseArtifactDefinitionInput({
		name: row.name,
		argv,
		workingDirectory: row.working_directory,
		outputPath: row.output_path,
		outputKind: row.output_kind,
	});
	return {
		id: row.id,
		repositoryId: row.repository_id,
		...input,
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function buildFromRow(row: ArtifactBuildRow): ArtifactBuild {
	return {
		id: row.id,
		repositoryId: row.repository_id,
		artifactId: row.artifact_id,
		definitionRevision: row.definition_revision,
		downloadName: row.download_name,
		mediaType: row.media_type,
		sizeBytes: row.size_bytes,
		sha256: row.sha256,
		createdAt: row.created_at,
	};
}

export class ArtifactDatabase {
	constructor(private readonly database: Database) {}

	definitions(repositoryId: string): ArtifactDefinition[] {
		return this.database
			.query<ArtifactDefinitionRow, { repositoryId: string }>(`
        SELECT id, repository_id, name, argv_json, working_directory, output_path,
          output_kind, revision, created_at, updated_at
        FROM artifact_definitions
        WHERE repository_id = $repositoryId
        ORDER BY name COLLATE NOCASE, created_at, id
      `)
			.all({ repositoryId })
			.map(definitionFromRow);
	}

	definition(repositoryId: string, selector: string): ArtifactDefinition | null {
		const row = this.database
			.query<ArtifactDefinitionRow, { repositoryId: string; selector: string }>(`
        SELECT id, repository_id, name, argv_json, working_directory, output_path,
          output_kind, revision, created_at, updated_at
        FROM artifact_definitions
        WHERE repository_id = $repositoryId AND (id = $selector OR name = $selector COLLATE NOCASE)
        ORDER BY CASE WHEN id = $selector THEN 0 ELSE 1 END
        LIMIT 1
      `)
			.get({ repositoryId, selector });
		return row ? definitionFromRow(row) : null;
	}

	createDefinition(repositoryId: string, input: ArtifactDefinitionInput): ArtifactDefinition {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.database
			.query<unknown, ArtifactDefinitionBindings>(`
        INSERT INTO artifact_definitions(
          id, repository_id, name, argv_json, working_directory, output_path,
          output_kind, revision, created_at, updated_at
        ) VALUES (
          $id, $repositoryId, $name, $argvJson, $workingDirectory, $outputPath,
          $outputKind, 1, $now, $now
        )
      `)
			.run({
				id,
				repositoryId,
				name: input.name,
				argvJson: JSON.stringify(input.argv),
				workingDirectory: input.workingDirectory,
				outputPath: input.outputPath,
				outputKind: input.outputKind,
				now,
			});
		const definition = this.definition(repositoryId, id);
		if (!definition) throw new Error("Could not reload artifact definition");
		return definition;
	}

	updateDefinition(
		repositoryId: string,
		id: string,
		input: ArtifactDefinitionInput,
		expectedRevision: number,
	): UpdateArtifactDefinitionResult {
		const now = new Date().toISOString();
		const result = this.database
			.query<unknown, ArtifactDefinitionUpdateBindings>(`
        UPDATE artifact_definitions
        SET name = $name, argv_json = $argvJson, working_directory = $workingDirectory,
          output_path = $outputPath, output_kind = $outputKind,
          revision = revision + 1, updated_at = $now
        WHERE repository_id = $repositoryId AND id = $id AND revision = $expectedRevision
      `)
			.run({
				id,
				repositoryId,
				name: input.name,
				argvJson: JSON.stringify(input.argv),
				workingDirectory: input.workingDirectory,
				outputPath: input.outputPath,
				outputKind: input.outputKind,
				now,
				expectedRevision,
			});
		if (result.changes > 0) {
			const definition = this.definition(repositoryId, id);
			if (!definition) throw new Error("Could not reload updated artifact definition");
			return { status: "updated", definition };
		}
		const current = this.definition(repositoryId, id);
		return current ? { status: "stale", definition: current } : { status: "missing" };
	}

	deleteDefinition(repositoryId: string, id: string): boolean {
		return (
			this.database
				.query<unknown, { repositoryId: string; id: string }>(`
          DELETE FROM artifact_definitions WHERE repository_id = $repositoryId AND id = $id
        `)
				.run({ repositoryId, id }).changes > 0
		);
	}

	builds(repositoryId: string, artifactId?: string): ArtifactBuild[] {
		const rows = artifactId
			? this.database
					.query<ArtifactBuildRow, { repositoryId: string; artifactId: string }>(`
              SELECT id, repository_id, artifact_id, definition_revision, download_name,
                media_type, size_bytes, sha256, created_at
              FROM artifact_builds
              WHERE repository_id = $repositoryId AND artifact_id = $artifactId
              ORDER BY created_at DESC, rowid DESC
            `)
					.all({ repositoryId, artifactId })
			: this.database
					.query<ArtifactBuildRow, { repositoryId: string }>(`
              SELECT id, repository_id, artifact_id, definition_revision, download_name,
                media_type, size_bytes, sha256, created_at
              FROM artifact_builds
              WHERE repository_id = $repositoryId
              ORDER BY created_at DESC, rowid DESC
            `)
					.all({ repositoryId });
		return rows.map(buildFromRow);
	}

	allBuilds(): ArtifactBuild[] {
		return this.database
			.query<ArtifactBuildRow, []>(`
        SELECT id, repository_id, artifact_id, definition_revision, download_name,
          media_type, size_bytes, sha256, created_at
        FROM artifact_builds ORDER BY created_at DESC, rowid DESC
      `)
			.all()
			.map(buildFromRow);
	}

	insertBuild(build: ArtifactBuild): ArtifactBuild[] {
		return this.database
			.transaction(() => {
				this.database
					.query<unknown, ArtifactBuildBindings>(`
              INSERT INTO artifact_builds(
                id, repository_id, artifact_id, definition_revision, download_name,
                media_type, size_bytes, sha256, created_at
              ) VALUES (
                $id, $repositoryId, $artifactId, $definitionRevision, $downloadName,
                $mediaType, $sizeBytes, $sha256, $createdAt
              )
            `)
					.run({
						id: build.id,
						repositoryId: build.repositoryId,
						artifactId: build.artifactId,
						definitionRevision: build.definitionRevision,
						downloadName: build.downloadName,
						mediaType: build.mediaType,
						sizeBytes: build.sizeBytes,
						sha256: build.sha256,
						createdAt: build.createdAt,
					});
				const obsolete = this.builds(build.repositoryId, build.artifactId).slice(
					ARTIFACT_RETAINED_BUILDS,
				);
				for (const item of obsolete) this.deleteBuild(item.id);
				return obsolete;
			})
			.immediate();
	}

	deleteBuild(id: string): boolean {
		return (
			this.database
				.query<unknown, { id: string }>("DELETE FROM artifact_builds WHERE id = $id")
				.run({ id }).changes > 0
		);
	}
}
