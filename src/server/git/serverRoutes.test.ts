import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	API_ROUTES,
	type BootstrapResponse,
	type ChangesResponse,
	CSRF_HEADER,
} from "../../shared/contracts.ts";
import {
	GIT_API_ROUTES,
	type GitActionResponse,
	type GitCommitChangesResponse,
	type GitHistoryResponse,
} from "../../shared/git/index.ts";
import { type CouchviewApp, createCouchviewApp } from "../server.ts";

const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];
const decoder = new TextDecoder();

function git(directory: string, args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", directory, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, LANG: "C", LC_ALL: "C" },
	});
	if (result.exitCode !== 0) throw new Error(decoder.decode(result.stderr));
	return decoder.decode(result.stdout).trim();
}

async function fixture(): Promise<CouchviewApp> {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-server-history-"));
	const stateDirectory = await mkdtemp(path.join(tmpdir(), "couchview-server-history-state-"));
	temporaryDirectories.push(directory, stateDirectory);
	git(directory, ["init", "-q", "--initial-branch=main"]);
	git(directory, ["config", "user.name", "Couchview Tests"]);
	git(directory, ["config", "user.email", "couchview@example.invalid"]);
	await writeFile(path.join(directory, "sample.ts"), "export const first = true;\n");
	git(directory, ["add", "-A"]);
	git(directory, ["commit", "-q", "-m", "initial history fixture"]);
	await writeFile(path.join(directory, "sample.ts"), "export const second = true;\n");
	git(directory, ["add", "-A"]);
	git(directory, ["commit", "-q", "-m", "update history fixture"]);
	const app = await createCouchviewApp({
		root: directory,
		host: "127.0.0.1",
		port: 3001,
		stateDatabasePath: path.join(stateDirectory, "state.sqlite"),
	});
	applications.push(app);
	return app;
}

function request(pathname: string, init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set("host", "127.0.0.1:3001");
	const result = new Request(`http://127.0.0.1:3001${pathname}`, {
		...init,
		headers: undefined,
	});
	for (const [name, value] of headers) result.headers.set(name, value);
	return result;
}

afterEach(async () => {
	for (const app of applications.splice(0)) app.close();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("Git history routes", () => {
	test("serves historical files and diffs", async () => {
		const app = await fixture();
		const historyResponse = await app.fetch(
			request(`${GIT_API_ROUTES.history(app.repository.id)}?scope=current`),
		);
		expect(historyResponse.status).toBe(200);
		const history = (await historyResponse.json()) as GitHistoryResponse;
		expect(history.commits.map((commit) => commit.subject)).toEqual([
			"update history fixture",
			"initial history fixture",
		]);
		const commitResponse = await app.fetch(
			request(GIT_API_ROUTES.historyCommit(app.repository.id, history.commits[0]!.id)),
		);
		const commit = (await commitResponse.json()) as GitCommitChangesResponse;
		expect(commit.files).toEqual([
			expect.objectContaining({ path: "sample.ts", kind: "modified" }),
		]);
		const diffResponse = await app.fetch(
			request(GIT_API_ROUTES.historyDiff(app.repository.id, commit.commit.id, commit.files[0]!.id)),
		);
		expect(diffResponse.status).toBe(200);
		expect(await diffResponse.text()).toContain("export const second = true;");
	});

	test("protects destructive actions with CSRF and returns authoritative state", async () => {
		const app = await fixture();
		await writeFile(path.join(app.repository.root, "sample.ts"), "dirty\n");
		await writeFile(path.join(app.repository.root, "untracked.txt"), "remove\n");
		const changes = (await (
			await app.fetch(request(API_ROUTES.files(app.repository.id)))
		).json()) as ChangesResponse;
		const body = JSON.stringify({
			action: "clean",
			operationRevision: changes.operationRevision,
		});
		expect(
			(
				await app.fetch(
					request(GIT_API_ROUTES.actions(app.repository.id), { body, method: "POST" }),
				)
			).status,
		).toBe(403);
		const bootstrap = (await (
			await app.fetch(request(API_ROUTES.bootstrap))
		).json()) as BootstrapResponse;
		const cleanedResponse = await app.fetch(
			request(GIT_API_ROUTES.actions(app.repository.id), {
				body,
				headers: {
					[CSRF_HEADER]: bootstrap.csrfToken,
					"content-type": "application/json",
					origin: "http://127.0.0.1:3001",
				},
				method: "POST",
			}),
		);
		expect(cleanedResponse.status).toBe(200);
		const cleaned = (await cleanedResponse.json()) as GitActionResponse;
		expect(cleaned.files).toEqual([]);
		expect(cleaned.status).toMatchObject({ trackedChangeCount: 0, untrackedChangeCount: 0 });
	});
});
