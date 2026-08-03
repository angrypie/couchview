import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RemoteBridgeProfile } from "../shared/contracts.ts";
import { resolveRemoteBridgePaths, storeRemoteBridgeProfile } from "./remoteBridgeClient.ts";
import {
	type RemoteTerminalClientRuntime,
	remoteClaudeLaunchCommand,
	remoteTerminalLaunchCommand,
	runRemoteClaude,
	runRemoteTerminal,
} from "./remoteTerminalClient.ts";

function profile(overrides: Partial<RemoteBridgeProfile> = {}): RemoteBridgeProfile {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		origin: "https://review.example.com",
		repositoryId: "repository-one",
		repositoryName: "Project One",
		repositoryRoot: "/Users/mini/Code/Project One",
		deviceId: "11111111-1111-4111-8111-111111111111",
		deviceToken: "t".repeat(43),
		deviceLabel: "MacBook Air",
		sshAlias: "couchview-project-one-11111111",
		username: "mini",
		originAccess: "none",
		...overrides,
	};
}

async function fixture() {
	const home = await mkdtemp(path.join(tmpdir(), "couchview-remote-terminal-"));
	const paths = resolveRemoteBridgePaths({}, home);
	const stored = profile();
	await storeRemoteBridgeProfile(stored, {
		paths,
		executableCommand: "couchview",
	});
	return { home, paths, profile: stored };
}

describe("remote terminal command construction", () => {
	test("opens the selected repository in the remote account's login shell", async () => {
		const home = await mkdtemp(path.join(tmpdir(), "couchview-terminal-command-"));
		const repositoryRoot = path.join(home, "Project's App");
		const shellPath = path.join(home, "capture-shell");
		const capturePath = path.join(home, "capture.txt");
		await mkdir(repositoryRoot, { recursive: true });
		await writeFile(
			shellPath,
			[
				"#!/bin/sh",
				'printf \'%s\\n\' "$PWD" > "$CAPTURE_PATH"',
				'printf \'%s\\n\' "$@" >> "$CAPTURE_PATH"',
				"",
			].join("\n"),
		);
		await chmod(shellPath, 0o700);

		const command = remoteTerminalLaunchCommand(profile(), {
			sshExecutable: "/usr/bin/ssh",
			repositoryRoot,
		});
		expect(command.slice(0, 3)).toEqual(["/usr/bin/ssh", "-t", "couchview-project-one-11111111"]);

		const child = Bun.spawn(["/bin/sh", "-c", command.at(-1)!], {
			env: {
				CAPTURE_PATH: capturePath,
				HOME: home,
				PATH: "/usr/bin:/bin",
				SHELL: shellPath,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect((await readFile(capturePath, "utf8")).split("\n")).toEqual([repositoryRoot, "-l", ""]);
	});

	test("starts Claude Code Remote Control and preserves forwarded arguments", async () => {
		const home = await mkdtemp(path.join(tmpdir(), "couchview-claude-command-"));
		const repositoryRoot = path.join(home, "Project's App");
		const localBin = path.join(home, ".local", "bin");
		const claudePath = path.join(localBin, "claude");
		const capturePath = path.join(home, "capture.txt");
		await Promise.all([
			mkdir(repositoryRoot, { recursive: true }),
			mkdir(localBin, { recursive: true }),
		]);
		await writeFile(
			claudePath,
			[
				"#!/bin/sh",
				'printf \'%s\\n\' "$PWD" > "$CAPTURE_PATH"',
				'printf \'%s\\n\' "$@" >> "$CAPTURE_PATH"',
				"",
			].join("\n"),
		);
		await chmod(claudePath, 0o700);

		const command = remoteClaudeLaunchCommand(profile(), {
			sshExecutable: "/usr/bin/ssh",
			repositoryRoot,
			claudeArgs: ["--name", "Project's Remote"],
		});
		expect(command.slice(0, 3)).toEqual(["/usr/bin/ssh", "-t", "couchview-project-one-11111111"]);

		const child = Bun.spawn(["/bin/sh", "-c", command.at(-1)!], {
			env: {
				CAPTURE_PATH: capturePath,
				HOME: home,
				PATH: "/usr/bin:/bin",
				SHELL: "/bin/sh",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect((await readFile(capturePath, "utf8")).split("\n")).toEqual([
			repositoryRoot,
			"remote-control",
			"--name",
			"Project's Remote",
			"",
		]);
	});

	test("rejects relative repository paths before constructing SSH", () => {
		expect(() =>
			remoteTerminalLaunchCommand(profile(), {
				sshExecutable: "ssh",
				repositoryRoot: "relative/project",
			}),
		).toThrow("must be absolute");
		expect(() =>
			remoteClaudeLaunchCommand(profile(), {
				sshExecutable: "ssh",
				repositoryRoot: "relative/project",
			}),
		).toThrow("must be absolute");
	});
});

describe("remote terminal lifecycle", () => {
	test("runs terminal and Claude launchers over one inherited SSH session", async () => {
		const stored = await fixture();
		const commands: string[][] = [];
		const spawnOptions: unknown[] = [];
		const messages: string[] = [];
		let exitListener: (() => void) | null = null;
		const runtime: RemoteTerminalClientRuntime = {
			paths: stored.paths,
			env: { TERM: "xterm-ghostty", USER: "mini" },
			which: () => "/usr/bin/ssh",
			spawn(command, options) {
				commands.push(command);
				spawnOptions.push(options);
				return {
					exited: Promise.resolve(commands.length === 1 ? 0 : 7),
					kill() {},
				};
			},
			onExit(listener) {
				exitListener = listener;
			},
			offExit(listener) {
				if (exitListener === listener) exitListener = null;
			},
			stderr: (message) => messages.push(message),
		};

		expect(await runRemoteTerminal({}, runtime)).toBe(0);
		expect(
			await runRemoteClaude(
				{
					claudeArgs: ["--name", "Project One"],
				},
				runtime,
			),
		).toBe(7);
		expect(commands).toHaveLength(2);
		expect(commands[0]?.slice(0, 3)).toEqual(["/usr/bin/ssh", "-t", stored.profile.sshAlias]);
		expect(commands[1]?.at(-1)).toContain("remote-control");
		expect(commands[1]?.at(-1)).toContain("Project One");
		expect(spawnOptions).toEqual([
			expect.objectContaining({
				env: { TERM: "xterm-256color", USER: "mini" },
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			}),
			expect.objectContaining({
				env: { TERM: "xterm-256color", USER: "mini" },
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			}),
		]);
		expect(messages[0]).toContain("opening a terminal");
		expect(messages[1]).toContain("starting Claude Code Remote Control");
		expect(exitListener).toBeNull();
	});

	test("fails before spawning when OpenSSH is unavailable", async () => {
		const stored = await fixture();
		const runtime: Partial<RemoteTerminalClientRuntime> = {
			paths: stored.paths,
			which: () => null,
		};

		await expect(runRemoteTerminal({}, runtime)).rejects.toThrow("OpenSSH is not available");
		await expect(runRemoteClaude({}, runtime)).rejects.toThrow("OpenSSH is not available");
	});
});
