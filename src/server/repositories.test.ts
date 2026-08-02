import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { StateDatabase } from "./database.ts";
import { HttpError } from "./errors.ts";
import { RepositoryManager } from "./repositories.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function fixture() {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-catalog-"));
	temporaryDirectories.push(directory);
	const root = path.join(directory, "project");
	const nested = path.join(root, "packages", "app");
	await mkdir(nested, { recursive: true });
	expect(Bun.spawnSync(["git", "init", "-q", root]).exitCode).toBe(0);
	await writeFile(path.join(root, "sample.ts"), "export const sample = true;\n");
	const alias = path.join(directory, "project-alias");
	await symlink(root, alias);
	const database = await StateDatabase.open(path.join(directory, "state", "state.sqlite"));
	const manager = new RepositoryManager(database);
	return { alias, database, directory, manager, nested, root };
}

describe("RepositoryManager", () => {
	test("deduplicates canonical roots reached through subdirectories and symlinks", async () => {
		const { alias, database, manager, nested, root } = await fixture();
		try {
			const direct = await manager.register(root);
			const fromSubdirectory = await manager.register(nested);
			const fromSymlink = await manager.register(alias);

			expect(direct.added).toBe(true);
			expect(fromSubdirectory.added).toBe(false);
			expect(fromSymlink.added).toBe(false);
			expect(fromSubdirectory.repository.id).toBe(direct.repository.id);
			expect(fromSymlink.repository.id).toBe(direct.repository.id);
			expect(await manager.list()).toHaveLength(1);
			expect(await Bun.file(path.join(root, ".git", "couchview", "state.json")).exists()).toBe(
				false,
			);
		} finally {
			manager.close();
			database.close();
		}
	});

	test("opens catalog entries lazily and reports a moved repository as unavailable", async () => {
		const { database, directory, manager, root } = await fixture();
		try {
			const registered = await manager.register(root);
			manager.close();

			const lazyManager = new RepositoryManager(database);
			expect((await lazyManager.get(registered.repository.id)).root).toBe(
				registered.repository.root,
			);
			lazyManager.close();

			const moved = path.join(directory, "moved-project");
			await rename(root, moved);
			const unavailableManager = new RepositoryManager(database);
			expect(await unavailableManager.list()).toEqual([
				expect.objectContaining({ id: registered.repository.id, available: false }),
			]);
			const error = await unavailableManager
				.get(registered.repository.id)
				.catch((caught) => caught);
			expect(error).toBeInstanceOf(HttpError);
			expect(error).toMatchObject({ status: 409, code: "repository_unavailable" });
			unavailableManager.forget(registered.repository.id);
			expect(await unavailableManager.list()).toEqual([]);
			unavailableManager.close();
		} finally {
			database.close();
		}
	});
});
