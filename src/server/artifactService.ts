import { randomUUID } from "node:crypto";
import path from "node:path";

import {
	type ArtifactBuild,
	type ArtifactCatalogResponse,
	type ArtifactDefinition,
	type ArtifactDefinitionInput,
	type ArtifactRepositoryResolveRequest,
	type ArtifactRepositoryResolveResponse,
	type ArtifactRun,
	type ArtifactRunEvent,
	type ArtifactRunOutputChunk,
	parseArtifactDefinitionInput,
	quoteArtifactInvocation,
} from "../shared/artifacts.ts";
import { repositoryRemoteFingerprints } from "./artifactRepositoryIdentity.ts";
import { ArtifactStore } from "./artifactStore.ts";
import type { StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import type { RepositoryManager } from "./repositories.ts";
import {
	RepositoryCommandRunner,
	type RepositoryCommandSummary,
} from "./repositoryCommandRunner.ts";

const RUN_OWNER = "artifacts";

interface ArtifactRunMetadata {
	artifactId: string;
	artifactName: string;
	definitionRevision: number;
	invocation: string;
	repositoryId: string;
	workingDirectory: string;
	buildId: string | null;
}

interface ArtifactServiceOptions {
	database: StateDatabase;
	repositories: RepositoryManager;
	store: ArtifactStore;
	runner: RepositoryCommandRunner;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class ArtifactService {
	readonly store: ArtifactStore;
	private readonly database: StateDatabase;
	private readonly repositories: RepositoryManager;
	private readonly runner: RepositoryCommandRunner;
	private readonly runMetadata = new Map<string, ArtifactRunMetadata>();
	private readonly deletedArtifacts = new Set<string>();

	private constructor(options: ArtifactServiceOptions) {
		this.database = options.database;
		this.repositories = options.repositories;
		this.store = options.store;
		this.runner = options.runner;
	}

	static async create(options: ArtifactServiceOptions): Promise<ArtifactService> {
		const service = new ArtifactService(options);
		const builds = service.database.artifacts.allBuilds();
		const missing = new Set(await service.store.initialize(builds));
		for (const build of builds) {
			if (!missing.has(build.id)) continue;
			service.database.artifacts.deleteBuild(build.id);
			await service.store.deleteBuild(build);
		}
		return service;
	}

	catalog(repositoryId: string): ArtifactCatalogResponse {
		const commands = this.runner.runs(RUN_OWNER, repositoryId);
		const retainedIds = new Set(commands.map((command) => command.id));
		for (const [runId, metadata] of this.runMetadata) {
			if (metadata.repositoryId === repositoryId && !retainedIds.has(runId)) {
				this.runMetadata.delete(runId);
			}
		}
		const activeByArtifact = new Map<string, ArtifactRun>();
		const recentByArtifact = new Map<string, ArtifactRun>();
		for (const command of commands) {
			const run = this.toRun(command);
			if (!recentByArtifact.has(run.artifactId)) recentByArtifact.set(run.artifactId, run);
			if (["running", "stopping", "capturing"].includes(run.status)) {
				activeByArtifact.set(run.artifactId, run);
			}
		}
		return {
			artifacts: this.database.artifacts.definitions(repositoryId).map((definition) => ({
				definition,
				builds: this.database.artifacts.builds(repositoryId, definition.id),
				activeRun: activeByArtifact.get(definition.id) ?? null,
				recentRun: recentByArtifact.get(definition.id) ?? null,
			})),
		};
	}

	definition(repositoryId: string, selector: string): ArtifactDefinition {
		const definition = this.database.artifacts.definition(repositoryId, selector);
		if (!definition) {
			throw new HttpError(404, "artifact_not_found", "Artifact definition not found");
		}
		return definition;
	}

	createDefinition(repositoryId: string, value: unknown): ArtifactDefinition {
		const input = this.parseInput(value);
		try {
			return this.database.artifacts.createDefinition(repositoryId, input);
		} catch (error) {
			if (/UNIQUE constraint failed/i.test(errorMessage(error))) {
				throw new HttpError(409, "artifact_name_conflict", "That artifact name is already in use");
			}
			throw error;
		}
	}

	updateDefinition(
		repositoryId: string,
		artifactId: string,
		value: unknown,
		expectedRevision: unknown,
	): ArtifactDefinition {
		if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) {
			throw new HttpError(400, "artifact_revision_invalid", "Artifact revision is invalid");
		}
		const input = this.parseInput(value);
		try {
			const result = this.database.artifacts.updateDefinition(
				repositoryId,
				artifactId,
				input,
				Number(expectedRevision),
			);
			if (result.status === "missing") {
				throw new HttpError(404, "artifact_not_found", "Artifact definition not found");
			}
			if (result.status === "stale") {
				throw new HttpError(
					409,
					"stale_artifact_definition",
					"This artifact changed in another client. Reload before saving.",
				);
			}
			return result.definition;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			if (/UNIQUE constraint failed/i.test(errorMessage(error))) {
				throw new HttpError(409, "artifact_name_conflict", "That artifact name is already in use");
			}
			throw error;
		}
	}

	async deleteDefinition(repositoryId: string, artifactId: string): Promise<void> {
		this.definition(repositoryId, artifactId);
		this.deletedArtifacts.add(artifactId);
		this.stopArtifact(repositoryId, artifactId);
		if (!this.database.artifacts.deleteDefinition(repositoryId, artifactId)) {
			throw new HttpError(404, "artifact_not_found", "Artifact definition not found");
		}
		await this.store.deleteArtifact(repositoryId, artifactId);
	}

	async start(repositoryId: string, selector: string): Promise<ArtifactRun> {
		const definition = this.definition(repositoryId, selector);
		this.deletedArtifacts.delete(definition.id);
		const repository = await this.repositories.get(repositoryId);
		const runId = randomUUID();
		const buildId = randomUUID();
		const metadata: ArtifactRunMetadata = {
			artifactId: definition.id,
			artifactName: definition.name,
			definitionRevision: definition.revision,
			invocation: quoteArtifactInvocation(definition.argv),
			repositoryId,
			workingDirectory: definition.workingDirectory,
			buildId: null,
		};
		this.runMetadata.set(runId, metadata);
		const workingDirectory = path.resolve(
			repository.root,
			...definition.workingDirectory.split("/"),
		);
		try {
			const command = this.runner.start({
				id: runId,
				owner: RUN_OWNER,
				repositoryId,
				key: definition.id,
				argv: definition.argv,
				cwd: workingDirectory,
				finalize: async (signal) => {
					const captured = await this.store.capture(repository.root, definition, buildId, signal);
					if (signal.aborted || this.deletedArtifacts.has(definition.id)) {
						await this.store.deleteBuild({
							repositoryId,
							artifactId: definition.id,
							id: buildId,
						});
						throw new Error("Artifact capture was cancelled");
					}
					const build: ArtifactBuild = {
						id: buildId,
						repositoryId,
						artifactId: definition.id,
						definitionRevision: definition.revision,
						...captured,
						createdAt: new Date().toISOString(),
					};
					const obsolete = this.database.artifacts.insertBuild(build);
					metadata.buildId = buildId;
					await Promise.all(obsolete.map((item) => this.store.deleteBuild(item)));
				},
			});
			return this.toRun(command);
		} catch (error) {
			this.runMetadata.delete(runId);
			if (error instanceof HttpError && error.code === "command_already_running") {
				throw new HttpError(409, "artifact_running", "This artifact is already building");
			}
			throw error;
		}
	}

	stop(repositoryId: string, artifactId: string, runId: string): ArtifactRun {
		const metadata = this.runMetadata.get(runId);
		if (!metadata || metadata.artifactId !== artifactId) {
			throw new HttpError(404, "artifact_run_not_found", "Artifact run not found");
		}
		return this.toRun(this.runner.stop(RUN_OWNER, repositoryId, runId));
	}

	subscribe(
		repositoryId: string,
		artifactId: string,
		runId: string,
		listener: (event: Exclude<ArtifactRunEvent, { type: "snapshot" }>) => void,
	): { snapshot: { run: ArtifactRun; output: ArtifactRunOutputChunk[] }; unsubscribe(): void } {
		const metadata = this.runMetadata.get(runId);
		if (!metadata || metadata.artifactId !== artifactId) {
			throw new HttpError(404, "artifact_run_not_found", "Artifact run not found");
		}
		const subscription = this.runner.subscribe(RUN_OWNER, repositoryId, runId, (event) => {
			if (event.type === "output") listener({ type: "output", chunk: event.chunk });
			else listener({ type: "status", run: this.toRun(event.run) });
		});
		return {
			snapshot: {
				run: this.toRun(subscription.snapshot.run),
				output: subscription.snapshot.output,
			},
			unsubscribe: subscription.unsubscribe,
		};
	}

	build(repositoryId: string, artifactId: string, buildId?: string): ArtifactBuild {
		this.definition(repositoryId, artifactId);
		const builds = this.database.artifacts.builds(repositoryId, artifactId);
		const build = buildId ? builds.find((item) => item.id === buildId) : builds[0];
		if (!build) throw new HttpError(404, "artifact_build_not_found", "Artifact build not found");
		return build;
	}

	async resolveRepository(
		input: ArtifactRepositoryResolveRequest,
	): Promise<ArtifactRepositoryResolveResponse> {
		const repositories = this.database.repositories().map(({ id, name }) => ({ id, name }));
		if (input.repository) {
			const selector = input.repository.toLocaleLowerCase();
			const matches = repositories.filter(
				(repository) =>
					repository.id === input.repository || repository.name.toLocaleLowerCase() === selector,
			);
			return { repository: matches.length === 1 ? matches[0]! : null, repositories };
		}
		const wanted = new Set(input.fingerprints ?? []);
		const matches = [];
		for (const repository of this.database.repositories()) {
			const fingerprints = await repositoryRemoteFingerprints(repository.root).catch(() => []);
			if (fingerprints.some((fingerprint) => wanted.has(fingerprint))) {
				matches.push({ id: repository.id, name: repository.name });
			}
		}
		return { repository: matches.length === 1 ? matches[0]! : null, repositories };
	}

	async forgetRepository(repositoryId: string): Promise<void> {
		this.runner.stopOwnerRepository(RUN_OWNER, repositoryId);
		for (const definition of this.database.artifacts.definitions(repositoryId)) {
			this.deletedArtifacts.add(definition.id);
		}
		await this.store.deleteRepository(repositoryId);
	}

	close(): void {
		for (const repository of this.database.repositories()) {
			this.runner.stopOwnerRepository(RUN_OWNER, repository.id);
		}
	}

	private stopArtifact(repositoryId: string, artifactId: string): void {
		for (const command of this.runner.runs(RUN_OWNER, repositoryId)) {
			if (
				command.key === artifactId &&
				["running", "stopping", "finalizing"].includes(command.status)
			) {
				this.runner.stop(RUN_OWNER, repositoryId, command.id);
			}
		}
	}

	private parseInput(value: unknown): ArtifactDefinitionInput {
		try {
			return parseArtifactDefinitionInput(value);
		} catch (error) {
			throw new HttpError(400, "artifact_definition_invalid", errorMessage(error));
		}
	}

	private toRun(command: RepositoryCommandSummary): ArtifactRun {
		const metadata = this.runMetadata.get(command.id);
		if (!metadata) throw new Error(`Artifact run ${command.id} is missing metadata`);
		return {
			id: command.id,
			repositoryId: command.repositoryId,
			artifactId: metadata.artifactId,
			artifactName: metadata.artifactName,
			definitionRevision: metadata.definitionRevision,
			argv: [...command.argv],
			invocation: metadata.invocation,
			workingDirectory: metadata.workingDirectory,
			status: command.status === "finalizing" ? "capturing" : command.status,
			exitCode: command.exitCode,
			startedAt: command.startedAt,
			finishedAt: command.finishedAt,
			outputTruncated: command.outputTruncated,
			error: command.error,
			buildId: metadata.buildId,
		};
	}
}
