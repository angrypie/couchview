import { describe, expect, test } from "bun:test";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "../..");
const cliPath = path.join(import.meta.dir, "cli.ts");

interface CliProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function runCouchview(args: string[]): Promise<CliProcessResult> {
	const child = Bun.spawn([process.execPath, "run", cliPath, ...args], {
		cwd: projectRoot,
		env: {
			...process.env,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("Couchview CLI process", () => {
	test("renders root and action help from the live Citty command tree", async () => {
		const [root, bridge, pair, proxy, download] = await Promise.all([
			runCouchview(["--help"]),
			runCouchview(["bridge", "--help"]),
			runCouchview(["bridge", "pair", "--help"]),
			runCouchview(["bridge", "proxy", "--help"]),
			runCouchview(["artifacts", "download", "--help"]),
		]);

		expect(root.exitCode, root.stderr).toBe(0);
		expect(root.stdout).toContain("USAGE couchview");
		expect(root.stdout).toContain("--enable-speech");
		expect(root.stdout).toContain("artifacts");
		expect(root.stdout).not.toContain("completion");

		expect(bridge.exitCode, bridge.stderr).toBe(0);
		expect(bridge.stdout).toContain(
			"proxy    Internal OpenSSH ProxyCommand transport; invoked automatically.",
		);

		expect(pair.exitCode, pair.stderr).toBe(0);
		expect(pair.stdout).toContain("USAGE couchview bridge pair");
		expect(pair.stdout).toContain("--url=<origin>");
		expect(pair.stdout).toContain("--code=<code>");
		expect(pair.stdout).not.toContain("--profile");

		expect(proxy.exitCode, proxy.stderr).toBe(0);
		expect(proxy.stdout).toContain("USAGE couchview bridge proxy");
		expect(proxy.stdout).toContain(
			"Generated SSH configuration launches this command automatically.",
		);
		expect(proxy.stdout).toContain("Do not run");

		expect(download.exitCode, download.stderr).toBe(0);
		expect(download.stdout).toContain("USAGE couchview artifacts download");
		expect(download.stdout).toContain("--build=<id>");
		expect(download.stdout).toContain("--output=<file>");
		expect(download.stdout).toContain("--force");
		expect(download.stdout).not.toContain("--url");
	});

	test("rejects unknown, action-specific, and removed completion arguments", async () => {
		const [unknownOption, wrongActionOption, completion] = await Promise.all([
			runCouchview(["serve", "--prot", "4173"]),
			runCouchview(["artifacts", "build", "app", "--force"]),
			runCouchview(["completion", "bash"]),
		]);

		expect(unknownOption.exitCode).toBe(2);
		expect(unknownOption.stderr).toContain("Unknown option: --prot");
		expect(unknownOption.stderr).toContain("Did you mean '--port'");

		expect(wrongActionOption.exitCode).toBe(2);
		expect(wrongActionOption.stderr).toContain("Unknown option: --force");
		expect(wrongActionOption.stderr).toContain("couchview artifacts build --help");

		expect(completion.exitCode).toBe(2);
		expect(completion.stderr).toContain("Unknown command 'completion'");
	});

	test("accepts aliases and inline values before help exits", async () => {
		const [shortOptions, version] = await Promise.all([
			runCouchview(["serve", "-p=5000", "-h"]),
			runCouchview(["-V"]),
		]);

		expect(shortOptions.exitCode, shortOptions.stderr).toBe(0);
		expect(shortOptions.stdout).toContain("USAGE couchview serve");
		expect(version).toMatchObject({ exitCode: 0, stdout: "couchview 0.1.0\n", stderr: "" });
	});
});
