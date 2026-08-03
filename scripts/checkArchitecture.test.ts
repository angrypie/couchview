import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { checkArchitecture } from "./checkArchitecture.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

async function fixture(files: Record<string, string>) {
	const root = await mkdtemp(resolve(tmpdir(), "couchview-architecture-"));
	temporaryDirectories.push(root);
	for (const [path, source] of Object.entries(files)) {
		const absolutePath = resolve(root, path);
		await mkdir(resolve(absolutePath, ".."), { recursive: true });
		await writeFile(absolutePath, source);
	}
	return root;
}

describe("architecture policy", () => {
	test("enforces App, feature, client, and shared import direction", async () => {
		const root = await fixture({
			"src/client/App.tsx": 'import "./api.ts";\n',
			"src/client/components/View.tsx": 'import "../../server/server.ts";\n',
			"src/client/features/review/useThing.ts": 'import "../../../client/components/View.tsx";\n',
			"src/shared/bad.ts": 'import "../client/App.tsx";\n',
		});
		const report = await checkArchitecture(root, ["src"]);
		expect(report.violations).toHaveLength(4);
		expect(report.violations.every((violation) => violation.rule === "boundary")).toBe(true);
	});

	test("allows App to compose components, features, and libraries", async () => {
		const root = await fixture({
			"src/client/App.tsx": [
				'import "./components/View.tsx";',
				'import "./features/review/useThing.ts";',
				'import "./lib/media.ts";',
			].join("\n"),
			"src/client/components/View.tsx": "export {};\n",
			"src/client/features/review/useThing.ts": "export {};\n",
			"src/client/lib/media.ts": "export {};\n",
		});
		const report = await checkArchitecture(root, ["src"]);
		expect(report.violations).toEqual([]);
	});

	test("requires consumers to use Git module entry points", async () => {
		const root = await fixture({
			"src/client/consumer.ts": [
				'import "./features/git/api.ts";',
				'import "./components/git/GitWorkspaceSheet.tsx";',
			].join("\n"),
			"src/client/features/git/api.ts": "export {};\n",
			"src/client/components/git/GitWorkspaceSheet.tsx": "export {};\n",
			"src/server/consumer.ts": 'import "./git/actions.ts";\n',
			"src/server/git/actions.ts": "export {};\n",
			"src/shared/consumer.ts": 'import "./git/contracts.ts";\n',
			"src/shared/git/contracts.ts": "export {};\n",
		});
		const report = await checkArchitecture(root, ["src"]);
		expect(report.violations.map(({ file }) => file)).toEqual([
			"src/client/consumer.ts",
			"src/client/consumer.ts",
			"src/server/consumer.ts",
			"src/shared/consumer.ts",
		]);
	});

	test("allows Git module public entry points and internal imports", async () => {
		const root = await fixture({
			"src/client/consumer.ts": [
				'import "./features/git/index.ts";',
				'import "./components/git/index.ts";',
			].join("\n"),
			"src/client/features/git/index.ts": 'export * from "./api.ts";\n',
			"src/client/features/git/api.ts": "export {};\n",
			"src/client/components/git/index.ts": 'export * from "./View.tsx";\n',
			"src/client/components/git/View.tsx": "export {};\n",
			"src/server/consumer.ts": 'import "./git/index.ts";\n',
			"src/server/git/index.ts": 'export * from "./actions.ts";\n',
			"src/server/git/actions.ts": "export {};\n",
			"src/shared/consumer.ts": 'import "./git/index.ts";\n',
			"src/shared/git/index.ts": 'export * from "./contracts.ts";\n',
			"src/shared/git/contracts.ts": "export {};\n",
		});
		const report = await checkArchitecture(root, ["src"]);
		expect(report.violations).toEqual([]);
	});

	test("rejects blanket Biome and TypeScript suppressions", async () => {
		const root = await fixture({
			"src/biome.ts": "// biome-ignore lint/suspicious/noExplicitAny: blanket\nexport {};\n",
			"src/typescript.ts": "// @ts-nocheck\nexport {};\n",
		});
		const report = await checkArchitecture(root, ["src"]);
		expect(report.violations.map(({ file, rule }) => [file, rule])).toEqual([
			["src/biome.ts", "suppression"],
			["src/typescript.ts", "suppression"],
		]);
	});
});
