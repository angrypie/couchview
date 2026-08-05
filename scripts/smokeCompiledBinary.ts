import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PackageCommandService } from "../src/server/packageCommands.ts";

const projectRoot = path.resolve(import.meta.dir, "..");
const executable = path.join(
	projectRoot,
	"dist",
	process.platform === "win32" ? "couchview.exe" : "couchview",
);
const expectedWorkerError = "The repository directory does not exist";
const invalidSupervisorError = "Unknown command 'run'";

try {
	await access(executable, constants.X_OK);
} catch {
	throw new Error(
		`Compiled Couchview binary not found at ${executable}. Run bun run build:binary first.`,
	);
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "couchview-binary-smoke-"));
try {
	await writeFile(path.join(temporaryRoot, ".env"), "COUCHVIEW_HOST=invalid host\n");
	await writeFile(path.join(temporaryRoot, "bunfig.toml"), "this is not valid TOML = [\n");
	const environment = { ...process.env };
	delete environment.COUCHVIEW_SUPERVISED_WORKER;
	const invocation = Bun.spawnSync(
		[executable, "--repo", path.join(temporaryRoot, "missing-repository")],
		{
			cwd: temporaryRoot,
			env: {
				...environment,
				COUCHVIEW_DISABLE_REUSE: "1",
				XDG_DATA_HOME: path.join(temporaryRoot, "state"),
			},
			timeout: 10_000,
		},
	);
	const stdout = invocation.stdout.toString();
	const stderr = invocation.stderr.toString();
	if (
		invocation.exitCode !== 1 ||
		!stderr.includes(expectedWorkerError) ||
		stderr.includes(invalidSupervisorError)
	) {
		throw new Error(
			[
				"Compiled Couchview did not reach its server worker correctly.",
				`Exit code: ${invocation.exitCode}`,
				`stdout: ${stdout || "(empty)"}`,
				`stderr: ${stderr || "(empty)"}`,
			].join("\n"),
		);
	}
	console.log("Compiled Couchview launched its server worker successfully.");

	const repository = path.join(temporaryRoot, "package-repository");
	await mkdir(repository);
	await writeFile(
		path.join(repository, "package.json"),
		JSON.stringify({ scripts: { smoke: "printf compiled-package-script-ok" } }),
	);
	const gitInit = Bun.spawnSync(["git", "init", "-q", repository]);
	if (gitInit.exitCode !== 0) {
		throw new Error(`Could not initialize package smoke repository: ${gitInit.stderr.toString()}`);
	}
	const gitAdd = Bun.spawnSync(["git", "-C", repository, "add", "package.json"]);
	if (gitAdd.exitCode !== 0) {
		throw new Error(`Could not stage package smoke manifest: ${gitAdd.stderr.toString()}`);
	}
	const packages = new PackageCommandService({
		compiledExecutable: true,
		resolveExecutable: () => executable,
	});
	try {
		const packageEntry = (await packages.discover(repository)).packages[0];
		if (!packageEntry) throw new Error("Package smoke repository was not discovered");
		const started = await packages.start("compiled-smoke", repository, {
			packagePath: packageEntry.packagePath,
			scriptName: "smoke",
			manifestRevision: packageEntry.manifestRevision,
		});
		const deadline = Date.now() + 10_000;
		let status = started.status;
		while (["running", "stopping"].includes(status) && Date.now() < deadline) {
			await Bun.sleep(20);
			status =
				packages.runs("compiled-smoke").find((run) => run.id === started.id)?.status ?? status;
		}
		const snapshot = packages.subscribe("compiled-smoke", started.id, () => undefined).snapshot;
		const output = snapshot.output.map((chunk) => chunk.text).join("");
		if (status !== "succeeded" || !output.includes("compiled-package-script-ok")) {
			throw new Error(
				`Compiled Couchview could not run a Bun package script (status: ${status}, output: ${output || "(empty)"}).`,
			);
		}
		console.log("Compiled Couchview ran a Bun package script through its embedded runtime.");
	} finally {
		packages.close();
	}
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}
