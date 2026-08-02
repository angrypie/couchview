import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createCouchviewApp, type CouchviewApp } from "./server.ts";

const temporaryDirectories: string[] = [];
const applications: CouchviewApp[] = [];

afterEach(async () => {
	for (const application of applications.splice(0)) application.close();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function fixture() {
	const directory = await mkdtemp(path.join(tmpdir(), "couchview-static-"));
	temporaryDirectories.push(directory);
	const repositoryRoot = path.join(directory, "repository");
	const staticRoot = path.join(directory, "dist");
	await mkdir(path.join(staticRoot, "assets"), { recursive: true });
	await mkdir(repositoryRoot, { recursive: true });
	expect(Bun.spawnSync(["git", "init", "-q", repositoryRoot]).exitCode).toBe(0);
	await writeFile(
		path.join(staticRoot, "index.html"),
		"<!doctype html><title>Couchview</title><main>Disconnected shell</main>",
		"utf8",
	);
	await writeFile(path.join(staticRoot, "assets", "app-12345678.js"), "export {};\n", "utf8");
	await writeFile(
		path.join(staticRoot, "assets", "ghostty-vt-12345678.wasm"),
		new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
	);
	await writeFile(
		path.join(staticRoot, "assets", "Iosevka-Regular-12345678.woff2"),
		new Uint8Array([0x00, 0x01, 0x00, 0x00]),
	);
	const secret = path.join(directory, "secret.js");
	await writeFile(secret, "do not serve me\n", "utf8");
	await symlink(secret, path.join(staticRoot, "leak.js"));

	const app = await createCouchviewApp({
		root: repositoryRoot,
		host: "127.0.0.1",
		port: 3001,
		staticDirectory: staticRoot,
		stateDatabasePath: path.join(directory, "state", "state.sqlite"),
	});
	applications.push(app);
	return app;
}

function localRequest(pathname: string, init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set("host", "127.0.0.1:3001");
	return new Request(`http://127.0.0.1:3001${pathname}`, { ...init, headers });
}

describe("production static serving", () => {
	test("serves the shell and hashed assets with restrictive security headers", async () => {
		const app = await fixture();

		const shell = await app.fetch(localRequest("/nested/client/route"));
		expect(shell.status).toBe(200);
		expect(await shell.text()).toContain("Disconnected shell");
		expect(shell.headers.get("cache-control")).toBe("no-cache");
		expect(shell.headers.get("content-security-policy")).toContain("default-src 'self'");
		expect(shell.headers.get("content-security-policy")).toContain("form-action 'none'");
		expect(shell.headers.get("content-security-policy")).toContain(
			"script-src 'self' 'wasm-unsafe-eval'",
		);
		expect(shell.headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
		expect(shell.headers.get("x-frame-options")).toBe("DENY");
		expect(shell.headers.has("access-control-allow-origin")).toBe(false);

		const settings = await app.fetch(localRequest("/settings?repo=fixture"));
		expect(settings.status).toBe(200);
		expect(await settings.text()).toContain("Disconnected shell");
		expect(settings.headers.get("cache-control")).toBe("no-cache");

		const asset = await app.fetch(localRequest("/assets/app-12345678.js"));
		expect(asset.status).toBe(200);
		expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

		const wasm = await app.fetch(localRequest("/assets/ghostty-vt-12345678.wasm"));
		expect(wasm.status).toBe(200);
		expect(wasm.headers.get("content-type")).toContain("application/wasm");
		expect(wasm.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

		const font = await app.fetch(localRequest("/assets/Iosevka-Regular-12345678.woff2"));
		expect(font.status).toBe(200);
		expect(font.headers.get("content-type")).toContain("font/woff2");
		expect(font.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
	});

	test("rejects symlink escapes, lexical traversal, host aliases, and non-exact origins", async () => {
		const app = await fixture();

		const symlinkEscape = await app.fetch(localRequest("/leak.js"));
		expect(symlinkEscape.status).toBe(403);
		expect(await symlinkEscape.text()).not.toContain("do not serve me");

		const traversal = await app.fetch(localRequest("/%2e%2e%2fsecret.js"));
		expect(traversal.status).toBe(400);

		const aliasHost = await app.fetch(
			new Request("http://localhost:3001/", { headers: { host: "localhost:3001" } }),
		);
		expect(aliasHost.status).toBe(403);

		const developmentHost = await app.fetch(
			new Request("http://127.0.0.1:5173/", { headers: { host: "127.0.0.1:5173" } }),
		);
		expect(developmentHost.status).toBe(403);

		const originWithPath = await app.fetch(
			localRequest("/", { headers: { origin: "http://127.0.0.1:3001/path" } }),
		);
		expect(originWithPath.status).toBe(403);
	});
});
