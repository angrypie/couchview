import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("a compiled executable reaches its real worker without acting as the Bun CLI", async () => {
	const projectRoot = path.resolve(import.meta.dir, "../..");
	const outputRoot = await mkdtemp(path.join(tmpdir(), "couchview-compiled-cli-"));
	const executable = path.join(outputRoot, "couchview");
	try {
		const build = Bun.spawnSync(
			[
				process.execPath,
				"build",
				"--compile",
				"--outfile",
				executable,
				path.join(projectRoot, "src/server/cli.ts"),
			],
			{ cwd: projectRoot },
		);
		expect(build.exitCode).toBe(0);

		const invocation = Bun.spawnSync(
			[executable, "--repo", path.join(outputRoot, "missing-repository")],
			{
				env: {
					...process.env,
					COUCHVIEW_DISABLE_REUSE: "1",
					XDG_DATA_HOME: path.join(outputRoot, "state"),
				},
				timeout: 10_000,
			},
		);
		const stderr = invocation.stderr.toString();
		expect(invocation.exitCode).toBe(1);
		expect(stderr).toContain("The repository directory does not exist");
		expect(stderr).not.toContain("Unknown command 'run'");
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});
