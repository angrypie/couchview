import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ArtifactRun } from "../shared/artifacts.ts";
import { ArtifactService } from "./artifactService.ts";
import { ArtifactStore } from "./artifactStore.ts";
import { StateDatabase } from "./database.ts";
import { RepositoryManager } from "./repositories.ts";
import { RepositoryCommandRunner } from "./repositoryCommandRunner.ts";

const fixtures: string[] = [];

afterEach(async () => {
	await Promise.all(
		fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })),
	);
});

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "couchview-artifact-service-"));
	fixtures.push(root);
	expect(Bun.spawnSync(["git", "init", "-q", root]).exitCode).toBe(0);
	const database = await StateDatabase.open(path.join(root, "state", "state.sqlite"));
	const repositories = new RepositoryManager(database);
	const registered = await repositories.register(root);
	const runner = new RepositoryCommandRunner();
	const store = new ArtifactStore({ root: path.join(root, "state", "artifacts") });
	const service = await ArtifactService.create({ database, repositories, runner, store });
	return {
		root,
		repositoryId: registered.repository.id,
		database,
		repositories,
		runner,
		store,
		service,
	};
}

async function terminalRun(
	service: ArtifactService,
	repositoryId: string,
	artifactId: string,
	runId: string,
): Promise<ArtifactRun> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const subscription = service.subscribe(repositoryId, artifactId, runId, () => undefined);
		const run = subscription.snapshot.run;
		subscription.unsubscribe();
		if (!["running", "stopping", "capturing"].includes(run.status)) return run;
		await Bun.sleep(20);
	}
	throw new Error("Artifact run did not finish");
}

describe("ArtifactService", () => {
	test("runs exact argv, captures successes, retains two, and preserves them after failure", async () => {
		const resources = await fixture();
		const { root, repositoryId, service, store } = resources;
		try {
			const literalArgument = "literal value; touch shell-marker";
			let definition = service.createDefinition(repositoryId, {
				name: "couchview-cli",
				argv: [
					process.execPath,
					"-e",
					'await Bun.write("artifact output.txt", Bun.argv[1])',
					literalArgument,
				],
				workingDirectory: ".",
				outputPath: "artifact output.txt",
				outputKind: "file",
			});

			for (let index = 0; index < 3; index += 1) {
				const run = await service.start(repositoryId, definition.id);
				expect(await terminalRun(service, repositoryId, definition.id, run.id)).toMatchObject({
					status: "succeeded",
					exitCode: 0,
					buildId: expect.any(String),
				});
			}
			const builds = service.catalog(repositoryId).artifacts[0]?.builds ?? [];
			expect(builds).toHaveLength(2);
			expect(await readFile(store.payloadPath(builds[0]!), "utf8")).toBe(literalArgument);
			expect(await Bun.file(path.join(root, "shell-marker")).exists()).toBe(false);

			await rm(path.join(root, "artifact output.txt"));
			definition = service.updateDefinition(
				repositoryId,
				definition.id,
				{
					...definition,
					argv: [process.execPath, "-e", "void 0"],
				},
				definition.revision,
			);
			const failed = await service.start(repositoryId, definition.id);
			expect(await terminalRun(service, repositoryId, definition.id, failed.id)).toMatchObject({
				status: "failed",
				error: expect.stringContaining("does not exist"),
			});
			const failedCatalog = service.catalog(repositoryId).artifacts[0];
			expect(failedCatalog?.builds).toHaveLength(2);
			expect(failedCatalog?.activeRun).toBeNull();
			expect(failedCatalog?.recentRun).toMatchObject({ id: failed.id, status: "failed" });
		} finally {
			service.close();
			resources.runner.close();
			resources.repositories.close();
			resources.database.close();
		}
	});

	test("enforces one active run and cancels real subprocesses", async () => {
		const resources = await fixture();
		const { repositoryId, service } = resources;
		try {
			const definition = service.createDefinition(repositoryId, {
				name: "slow-app",
				argv: [process.execPath, "-e", "await Bun.sleep(30_000)"],
				workingDirectory: ".",
				outputPath: "slow.app",
				outputKind: "file",
			});
			const run = await service.start(repositoryId, definition.id);
			expect(
				await service.start(repositoryId, definition.id).catch((error) => error),
			).toMatchObject({ status: 409, code: "artifact_running" });
			expect(service.stop(repositoryId, definition.id, run.id).status).toBe("stopping");
			expect(await terminalRun(service, repositoryId, definition.id, run.id)).toMatchObject({
				status: "stopped",
			});
		} finally {
			service.close();
			resources.runner.close();
			resources.repositories.close();
			resources.database.close();
		}
	});

	test("discards missing payload metadata and its build directory during restart reconciliation", async () => {
		const resources = await fixture();
		const { root, repositoryId, database, repositories, store } = resources;
		let replacement: ArtifactService | null = null;
		let replacementRunner: RepositoryCommandRunner | null = null;
		try {
			const definition = resources.service.createDefinition(repositoryId, {
				name: "restart-build",
				argv: [process.execPath, "-e", 'await Bun.write("restart.bin", "payload")'],
				workingDirectory: ".",
				outputPath: "restart.bin",
				outputKind: "file",
			});
			const started = await resources.service.start(repositoryId, definition.id);
			expect(
				await terminalRun(resources.service, repositoryId, definition.id, started.id),
			).toMatchObject({ status: "succeeded" });
			const build = resources.service.catalog(repositoryId).artifacts[0]!.builds[0]!;
			const payload = store.payloadPath(build);
			await rm(payload);
			resources.service.close();
			resources.runner.close();

			replacementRunner = new RepositoryCommandRunner();
			replacement = await ArtifactService.create({
				database,
				repositories,
				runner: replacementRunner,
				store,
			});
			expect(replacement.catalog(repositoryId).artifacts[0]!.builds).toEqual([]);
			expect(await Bun.file(path.dirname(payload)).exists()).toBe(false);
			expect(await Bun.file(path.join(root, "restart.bin")).exists()).toBe(true);
		} finally {
			replacement?.close();
			replacementRunner?.close();
			resources.service.close();
			resources.runner.close();
			resources.repositories.close();
			resources.database.close();
		}
	});
});
