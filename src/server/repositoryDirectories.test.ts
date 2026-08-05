import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { HttpError } from "./errors.ts";
import { listRepositoryDirectories } from "./repositoryDirectories.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("repository directory browser", () => {
	test("lists only bounded child directory metadata from a canonical server path", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "couchview-directory-browser-"));
		temporaryDirectories.push(root);
		await mkdir(path.join(root, "Beta"));
		await mkdir(path.join(root, "alpha"));
		await writeFile(path.join(root, "notes.txt"), "not a directory\n");

		const listing = await listRepositoryDirectories(root);

		expect(listing).toEqual({
			directories: [
				{ name: "alpha", path: path.join(await realpath(root), "alpha") },
				{ name: "Beta", path: path.join(await realpath(root), "Beta") },
			],
			parent: path.dirname(await realpath(root)),
			path: await realpath(root),
			truncated: false,
		});
	});

	test("rejects relative, missing, and non-directory paths with structured errors", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "couchview-directory-browser-"));
		temporaryDirectories.push(root);
		const file = path.join(root, "project.txt");
		await writeFile(file, "file\n");

		for (const [candidate, expected] of [
			["relative/project", { status: 400, code: "directory_invalid" }],
			[path.join(root, "missing"), { status: 404, code: "directory_not_found" }],
			[file, { status: 400, code: "directory_invalid" }],
		] as const) {
			const error = await listRepositoryDirectories(candidate).catch((caught) => caught);
			expect(error).toBeInstanceOf(HttpError);
			expect(error).toMatchObject(expected);
		}
	});

	test("bounds unusually large directories", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "couchview-directory-browser-"));
		temporaryDirectories.push(root);
		await Promise.all(
			Array.from({ length: 501 }, (_, index) =>
				mkdir(path.join(root, `project-${String(index).padStart(3, "0")}`)),
			),
		);

		const listing = await listRepositoryDirectories(root);

		expect(listing.directories).toHaveLength(500);
		expect(listing.truncated).toBe(true);
	});
});
