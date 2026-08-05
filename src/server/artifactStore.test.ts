import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ArtifactBuild, ArtifactDefinition } from "../shared/artifacts.ts";
import { ArtifactStore } from "./artifactStore.ts";

const fixtures: string[] = [];

afterEach(async () => {
	await Promise.all(
		fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })),
	);
});

async function fixture(): Promise<{ root: string; store: ArtifactStore }> {
	const root = await mkdtemp(path.join(tmpdir(), "couchview-artifact-store-"));
	fixtures.push(root);
	return { root, store: new ArtifactStore({ root: path.join(root, "private-store") }) };
}

function definition(
	outputPath: string,
	outputKind: ArtifactDefinition["outputKind"],
): ArtifactDefinition {
	return {
		id: "artifact-one",
		repositoryId: "repo-one",
		name: "release",
		argv: ["build"],
		workingDirectory: ".",
		outputPath,
		outputKind,
		revision: 1,
		createdAt: "2026-08-01T10:00:00.000Z",
		updatedAt: "2026-08-01T10:00:00.000Z",
	};
}

function build(captured: Awaited<ReturnType<ArtifactStore["capture"]>>): ArtifactBuild {
	return {
		id: "build-one",
		repositoryId: "repo-one",
		artifactId: "artifact-one",
		definitionRevision: 1,
		...captured,
		createdAt: "2026-08-01T10:01:00.000Z",
	};
}

describe("ArtifactStore", () => {
	test("stream-copies files with spaces into a private atomic snapshot", async () => {
		const { root, store } = await fixture();
		await writeFile(path.join(root, "Couchview CLI"), "binary bytes");
		await chmod(path.join(root, "Couchview CLI"), 0o755);
		const captured = await store.capture(
			root,
			definition("Couchview CLI", "file"),
			"build-one",
			new AbortController().signal,
		);
		expect(captured).toMatchObject({
			downloadName: "Couchview CLI",
			sizeBytes: 12,
			sha256: "4f463802bc436efdd9a0c4e8c999ec3d37450657bd50b579d796b58bc9d3f1ef",
			executable: true,
		});
		const payload = store.payloadPath(build(captured));
		expect(await readFile(payload, "utf8")).toBe("binary bytes");
		expect((await stat(payload)).mode & 0o777).toBe(0o600);
	});

	test("archives safe directories as tar.gz and preserves extracted bytes", async () => {
		const { root, store } = await fixture();
		await mkdir(path.join(root, "release app", "nested"), { recursive: true });
		await writeFile(path.join(root, "release app", "nested", "hello.txt"), "hello archive");
		const captured = await store.capture(
			root,
			definition("release app", "directory"),
			"build-one",
			new AbortController().signal,
		);
		expect(captured.downloadName).toBe("release app.tar.gz");
		expect(captured.executable).toBe(false);
		const extraction = path.join(root, "extracted");
		await mkdir(extraction);
		const result = Bun.spawnSync(
			["tar", "-xzf", store.payloadPath(build(captured)), "-C", extraction],
			{ stderr: "pipe" },
		);
		expect(result.exitCode, result.stderr.toString()).toBe(0);
		expect(await readFile(path.join(extraction, "nested", "hello.txt"), "utf8")).toBe(
			"hello archive",
		);
	});

	test("streams larger directory archives without retaining their contents in memory", async () => {
		const { root } = await fixture();
		const store = new ArtifactStore({
			root: path.join(root, "streaming-store"),
			archiveMemoryLimitBytes: 1,
		});
		await mkdir(path.join(root, "streamed", "nested"), { recursive: true });
		await writeFile(path.join(root, "streamed", "nested", "payload.txt"), "streamed bytes");
		const captured = await store.capture(
			root,
			definition("streamed", "directory"),
			"build-one",
			new AbortController().signal,
		);
		const extraction = path.join(root, "streaming-extracted");
		await mkdir(extraction);
		const extracted = Bun.spawnSync(
			["tar", "-xzf", store.payloadPath(build(captured)), "-C", extraction],
			{ stderr: "pipe" },
		);
		expect(extracted.exitCode, extracted.stderr.toString()).toBe(0);
		expect(await readFile(path.join(extraction, "nested", "payload.txt"), "utf8")).toBe(
			"streamed bytes",
		);
		expect((await stat(store.root)).mode & 0o777).toBe(0o700);
	});

	test("rejects symlinks, wrong kinds, cancellation, and injected size limits", async () => {
		const { root } = await fixture();
		await mkdir(path.join(root, "bundle"));
		await writeFile(path.join(root, "outside"), "outside");
		await symlink(path.join(root, "outside"), path.join(root, "bundle", "linked"));
		const store = new ArtifactStore({ root: path.join(root, "store"), maxPayloadBytes: 4 });
		await expect(
			store.capture(
				root,
				definition("bundle", "directory"),
				"build-symlink",
				new AbortController().signal,
			),
		).rejects.toThrow("symbolic links");
		await expect(
			store.capture(
				root,
				definition("outside", "directory"),
				"build-kind",
				new AbortController().signal,
			),
		).rejects.toThrow("configured directory kind");
		await expect(
			store.capture(
				root,
				definition("outside", "file"),
				"build-large",
				new AbortController().signal,
			),
		).rejects.toThrow("4-byte limit");
		const aborted = new AbortController();
		aborted.abort();
		await expect(
			store.capture(root, definition("outside", "file"), "build-abort", aborted.signal),
		).rejects.toThrow("cancelled");
	});

	test("rejects nested Git metadata and special filesystem entries", async () => {
		const { root, store } = await fixture();
		await mkdir(path.join(root, "git-bundle", ".git"), { recursive: true });
		await expect(
			store.capture(
				root,
				definition("git-bundle", "directory"),
				"build-git",
				new AbortController().signal,
			),
		).rejects.toThrow("cannot contain .git");

		await mkdir(path.join(root, "special-bundle"));
		const fifo = path.join(root, "special-bundle", "named-pipe");
		const created = Bun.spawnSync(["mkfifo", fifo]);
		expect(created.exitCode).toBe(0);
		await expect(
			store.capture(
				root,
				definition("special-bundle", "directory"),
				"build-special",
				new AbortController().signal,
			),
		).rejects.toThrow("only regular files and directories");
	});

	test("reconciles missing metadata payloads and removes orphan build directories", async () => {
		const { root, store } = await fixture();
		await writeFile(path.join(root, "output"), "kept");
		const captured = await store.capture(
			root,
			definition("output", "file"),
			"build-one",
			new AbortController().signal,
		);
		await mkdir(path.join(store.root, "repo-one", "artifact-one", "orphan"), {
			recursive: true,
		});
		const kept = build(captured);
		await writeFile(
			path.join(store.root, "repo-one", "artifact-one", "build-one", ".tmp-abandoned"),
			"partial",
		);
		expect(await store.initialize([kept])).toEqual([]);
		expect(
			await Bun.file(path.join(store.root, "repo-one", "artifact-one", "orphan")).exists(),
		).toBe(false);
		expect(
			await Bun.file(
				path.join(store.root, "repo-one", "artifact-one", "build-one", ".tmp-abandoned"),
			).exists(),
		).toBe(false);
		await rm(store.payloadPath(kept));
		expect(await store.initialize([kept])).toEqual(["build-one"]);
	});
});
