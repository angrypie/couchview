import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { browseRunningServer, browserOpenCommand } from "./cliBrowse.ts";
import { type CouchviewApp, createCouchviewApp } from "./server.ts";

const initialDataHome = Bun.env.XDG_DATA_HOME;
const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];
let nextPort = 43_700;

async function repositoryFixture(name: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), `couchview-browse-${name}-`));
	temporaryDirectories.push(root);
	const result = Bun.spawnSync(["git", "init", "--quiet", root]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	await mkdir(path.join(root, "nested"));
	return root;
}

async function runningApp(allowedOrigins: string[] = []): Promise<{
	app: CouchviewApp;
	root: string;
	port: number;
}> {
	const root = await repositoryFixture("repo");
	nextPort += 1;
	const app = await createCouchviewApp({
		root,
		host: "127.0.0.1",
		port: nextPort,
		allowedOrigins,
	});
	app.registerServerInstance();
	applications.push(app);
	return { app, root, port: nextPort };
}

function appFetch(app: CouchviewApp): typeof globalThis.fetch {
	return ((input: string | URL | Request, init?: RequestInit) =>
		app.fetch(new Request(input, init))) as typeof globalThis.fetch;
}

describe("browse command", () => {
	beforeEach(async () => {
		const dataHome = await mkdtemp(path.join(tmpdir(), "couchview-browse-state-"));
		temporaryDirectories.push(dataHome);
		Bun.env.XDG_DATA_HOME = dataHome;
	});

	afterEach(async () => {
		for (const app of applications.splice(0)) app.close();
		await Promise.all(
			temporaryDirectories
				.splice(0)
				.map((directory) => rm(directory, { recursive: true, force: true })),
		);
		if (initialDataHome === undefined) delete Bun.env.XDG_DATA_HOME;
		else Bun.env.XDG_DATA_HOME = initialDataHome;
	});

	test("opens a registered current checkout through the advertised domain", async () => {
		const publicOrigin = "https://review.example.com";
		const { app, root, port } = await runningApp([publicOrigin]);
		const opened: string[] = [];

		const url = await browseRunningServer(["--port", `${port}`], {
			fetch: appFetch(app),
			cwd: () => path.join(root, "nested"),
			openUrl: async (candidate) => {
				opened.push(candidate);
			},
		});

		expect(url).toBe(`${publicOrigin}/?repo=${app.repository.id}`);
		expect(opened).toEqual([url]);
	});

	test("falls back to the direct IP and reports a missing running server", async () => {
		const { app, root, port } = await runningApp();
		const opened: string[] = [];
		const url = await browseRunningServer(["--repo", root, "--port", `${port}`], {
			fetch: appFetch(app),
			openUrl: async (candidate) => {
				opened.push(candidate);
			},
		});
		expect(url).toBe(`http://127.0.0.1:${port}/?repo=${app.repository.id}`);
		expect(opened).toEqual([url]);

		await expect(
			browseRunningServer(["--repo", root, "--port", `${port + 1}`], {
				fetch: (() =>
					Promise.reject(new TypeError("not listening"))) as unknown as typeof globalThis.fetch,
				openUrl: async () => {
					throw new Error("browser should not open");
				},
			}),
		).rejects.toThrow("No Couchview server is running");
	});

	test("uses the native browser opener without a shell", () => {
		const url = "https://review.example.com/?repo=repo-one";
		expect(browserOpenCommand(url, "darwin")).toEqual(["open", url]);
		expect(browserOpenCommand(url, "linux")).toEqual(["xdg-open", url]);
		expect(browserOpenCommand(url, "win32")).toEqual([
			"rundll32.exe",
			"url.dll,FileProtocolHandler",
			url,
		]);
	});
});
