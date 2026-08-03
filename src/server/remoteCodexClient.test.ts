import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RemoteBridgeProfile } from "../shared/contracts.ts";
import { resolveRemoteBridgePaths, storeRemoteBridgeProfile } from "./remoteBridgeClient.ts";
import {
	type RemoteCodexClientRuntime,
	remoteCodexLaunchCommands,
	resolveRemoteCodexProfile,
	runRemoteCodex,
} from "./remoteCodexClient.ts";

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
	const home = await mkdtemp(path.join(tmpdir(), "couchview-remote-codex-"));
	return {
		home,
		paths: resolveRemoteBridgePaths({}, home),
	};
}

class FakeProcess {
	readonly stdout: ReadableStream<Uint8Array> | null;
	readonly stderr: ReadableStream<Uint8Array> | null;
	readonly exited: Promise<number>;
	readonly signals: NodeJS.Signals[] = [];
	private stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
	private stderrController: ReadableStreamDefaultController<Uint8Array> | null = null;
	private resolveExit: ((exitCode: number) => void) | null = null;
	private finished = false;

	constructor(output: { stdout?: string; stderr?: string } = {}) {
		this.stdout = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.stdoutController = controller;
				if (output.stdout) controller.enqueue(Buffer.from(output.stdout));
			},
		});
		this.stderr = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.stderrController = controller;
				if (output.stderr) controller.enqueue(Buffer.from(output.stderr));
			},
		});
		this.exited = new Promise<number>((resolve) => {
			this.resolveExit = resolve;
		});
	}

	exit(exitCode: number): void {
		if (this.finished) return;
		this.finished = true;
		this.stdoutController?.close();
		this.stderrController?.close();
		this.resolveExit?.(exitCode);
	}

	kill(signal: NodeJS.Signals): void {
		this.signals.push(signal);
		this.exit(signal === "SIGKILL" ? 137 : 143);
	}
}

async function storedProfile(overrides: Partial<RemoteBridgeProfile> = {}) {
	const { paths } = await fixture();
	const value = profile(overrides);
	await storeRemoteBridgeProfile(value, {
		paths,
		executableCommand: "couchview",
	});
	return { paths, profile: value };
}

function runtime(
	paths: ReturnType<typeof resolveRemoteBridgePaths>,
	overrides: Partial<RemoteCodexClientRuntime> = {},
) {
	let now = 0;
	const errors: string[] = [];
	let exitListener: (() => void) | null = null;
	const base: RemoteCodexClientRuntime = {
		paths,
		which: (command) => (command === "ssh" ? "/usr/bin/ssh" : "/usr/local/bin/codex"),
		spawn: () => {
			throw new Error("Unexpected spawn");
		},
		allocateLocalPort: async () => 43_210,
		selectRemotePort: () => 54_321,
		probeReady: async () => true,
		now: () => now,
		wait: async (milliseconds) => {
			now += milliseconds;
		},
		onExit: (listener) => {
			exitListener = listener;
		},
		offExit: (listener) => {
			if (exitListener === listener) exitListener = null;
		},
		stderr: (message) => errors.push(message),
	};
	return {
		runtime: { ...base, ...overrides },
		errors,
		exitListener: () => exitListener,
	};
}

describe("remote Codex profile selection", () => {
	test("uses the only profile by default and accepts either its ID or SSH alias", async () => {
		const stored = await storedProfile();
		expect((await resolveRemoteCodexProfile(null, stored.paths)).id).toBe(stored.profile.id);
		expect((await resolveRemoteCodexProfile(stored.profile.id, stored.paths)).sshAlias).toBe(
			stored.profile.sshAlias,
		);
		expect((await resolveRemoteCodexProfile(stored.profile.sshAlias, stored.paths)).id).toBe(
			stored.profile.id,
		);
	});

	test("requires an explicit profile when more than one is paired", async () => {
		const stored = await storedProfile();
		await storeRemoteBridgeProfile(
			profile({
				id: "22222222-2222-4222-8222-222222222222",
				deviceId: "22222222-2222-4222-8222-222222222222",
				repositoryId: "repository-two",
				repositoryName: "Project Two",
				repositoryRoot: "/Users/mini/Code/Project Two",
				sshAlias: "couchview-project-two-22222222",
			}),
			{
				paths: stored.paths,
				executableCommand: "couchview",
			},
		);

		await expect(resolveRemoteCodexProfile(null, stored.paths)).rejects.toThrow(
			"choose one with --profile",
		);
		await expect(resolveRemoteCodexProfile("missing-profile", stored.paths)).rejects.toThrow(
			"Available SSH hosts",
		);
	});
});

describe("remote Codex command construction", () => {
	test("keeps both listeners on loopback and starts Codex in the paired repository", () => {
		const commands = remoteCodexLaunchCommands(
			profile({
				repositoryRoot: "/Users/mini/Code/Project's App",
			}),
			{
				sshExecutable: "/usr/bin/ssh",
				codexExecutable: "/opt/bin/codex",
				localPort: 43_210,
				remotePort: 54_321,
				codexArgs: ["--model", "gpt-5.4"],
			},
		);

		expect(commands.tunnel.slice(0, 7)).toEqual([
			"/usr/bin/ssh",
			"-T",
			"-o",
			"ExitOnForwardFailure=yes",
			"-L",
			"127.0.0.1:43210:127.0.0.1:54321",
			"couchview-project-one-11111111",
		]);
		expect(commands.tunnel.at(-1)).toContain('"$codex_executable" app-server --listen');
		expect(commands.tunnel.at(-1)).toContain("ws://127.0.0.1:54321");
		expect(commands.tunnel.at(-1)).toContain("Project");
		expect(commands.tunnel.at(-1)).toContain("s App");
		expect(commands.client).toEqual([
			"/opt/bin/codex",
			"--remote",
			"ws://127.0.0.1:43210",
			"--cd",
			"/Users/mini/Code/Project's App",
			"--model",
			"gpt-5.4",
		]);
		expect(commands.readyUrl).toBe("http://127.0.0.1:43210/readyz");
	});

	test("rejects arguments that could replace the managed endpoint or repository", () => {
		for (const argument of [
			"--remote=wss://other.example",
			"--remote-auth-token-env",
			"--cd=/tmp/other",
			"-C",
			"-C/tmp/other",
			"--add-dir=/tmp/other",
		]) {
			expect(() =>
				remoteCodexLaunchCommands(profile(), {
					sshExecutable: "ssh",
					codexExecutable: "codex",
					localPort: 43_210,
					remotePort: 54_321,
					codexArgs: [argument],
				}),
			).toThrow("controlled by the Couchview bridge");
		}
	});

	test("uses one paired host profile with an explicitly selected repository", () => {
		const commands = remoteCodexLaunchCommands(profile(), {
			sshExecutable: "/usr/bin/ssh",
			codexExecutable: "/opt/bin/codex",
			localPort: 43_210,
			remotePort: 54_321,
			repositoryRoot: "/Users/mini/Code/Project Two",
		});

		expect(commands.tunnel.at(-1)).toContain("Project Two");
		expect(commands.client.slice(3, 5)).toEqual(["--cd", "/Users/mini/Code/Project Two"]);
	});

	test("preserves spaces and apostrophes through both remote shell layers", async () => {
		const { home } = await fixture();
		const repositoryRoot = path.join(home, "Project's App");
		const executableDirectory = path.join(home, "bin");
		const codexPath = path.join(executableDirectory, "codex");
		const capturePath = path.join(home, "capture.txt");
		await Promise.all([
			mkdir(repositoryRoot, { recursive: true }),
			mkdir(executableDirectory, { recursive: true }),
		]);
		await writeFile(
			codexPath,
			[
				"#!/bin/sh",
				'printf \'%s\\n\' "$PWD" > "$CAPTURE_PATH"',
				'printf \'%s\\n\' "$@" >> "$CAPTURE_PATH"',
				"",
			].join("\n"),
		);
		await chmod(codexPath, 0o700);
		const commands = remoteCodexLaunchCommands(profile({ repositoryRoot }), {
			sshExecutable: "ssh",
			codexExecutable: "codex",
			localPort: 43_210,
			remotePort: 54_321,
		});

		const child = Bun.spawn(["/bin/sh", "-c", commands.tunnel.at(-1)!], {
			cwd: home,
			env: {
				...process.env,
				CAPTURE_PATH: capturePath,
				HOME: home,
				PATH: `${executableDirectory}:${process.env.PATH ?? ""}`,
				SHELL: "/not/used/by-the-bridge",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect((await readFile(capturePath, "utf8")).split("\n")).toEqual([
			repositoryRoot,
			"app-server",
			"--listen",
			"ws://127.0.0.1:54321",
			"",
		]);
	});

	test("finds Codex in the Mini user-local bin when SSH omits it from PATH", async () => {
		const { home } = await fixture();
		const repositoryRoot = path.join(home, "Project");
		const localBin = path.join(home, ".local", "bin");
		const codexPath = path.join(localBin, "codex");
		const capturePath = path.join(home, "capture.txt");
		await Promise.all([
			mkdir(repositoryRoot, { recursive: true }),
			mkdir(localBin, { recursive: true }),
		]);
		await writeFile(
			codexPath,
			[
				"#!/bin/sh",
				'printf \'%s\\n\' "$0" > "$CAPTURE_PATH"',
				'printf \'%s\\n\' "$@" >> "$CAPTURE_PATH"',
				"",
			].join("\n"),
		);
		await chmod(codexPath, 0o700);
		const commands = remoteCodexLaunchCommands(profile({ repositoryRoot }), {
			sshExecutable: "ssh",
			codexExecutable: "codex",
			localPort: 43_210,
			remotePort: 54_321,
		});

		const child = Bun.spawn(["/bin/sh", "-c", commands.tunnel.at(-1)!], {
			cwd: home,
			env: {
				CAPTURE_PATH: capturePath,
				HOME: home,
				PATH: "/usr/bin:/bin",
				SHELL: "/not/used/by-the-bridge",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect((await readFile(capturePath, "utf8")).split("\n")).toEqual([
			codexPath,
			"app-server",
			"--listen",
			"ws://127.0.0.1:54321",
			"",
		]);
	});
});

describe("remote Codex lifecycle", () => {
	test("waits for the remote app-server, launches the local TUI, and closes SSH", async () => {
		const stored = await storedProfile();
		const tunnel = new FakeProcess({
			stderr: "Couchview bridge: direct WebRTC path active.\n",
		});
		const client = new FakeProcess();
		const commands: string[][] = [];
		const setup = runtime(stored.paths, {
			spawn(command) {
				commands.push(command);
				if (commands.length === 1) return tunnel;
				queueMicrotask(() => client.exit(0));
				return client;
			},
		});

		expect(await runRemoteCodex({}, setup.runtime)).toBe(0);
		expect(commands).toHaveLength(2);
		expect(commands[0]).toContain(stored.profile.sshAlias);
		expect(commands[1]?.slice(0, 3)).toEqual([
			"/usr/local/bin/codex",
			"--remote",
			"ws://127.0.0.1:43210",
		]);
		expect(commands[1]?.slice(3, 5)).toEqual(["--cd", stored.profile.repositoryRoot]);
		expect(tunnel.signals).toContain("SIGTERM");
		expect(setup.errors).toEqual([
			`Couchview bridge: starting Codex in ${stored.profile.repositoryRoot} on ${stored.profile.sshAlias}…`,
			"Couchview bridge: remote Codex is ready; launching the local terminal UI.",
		]);
		expect(setup.exitListener()).toBeNull();
	});

	test("reports remote startup output when the SSH command exits early", async () => {
		const stored = await storedProfile();
		const tunnel = new FakeProcess({
			stderr: "Codex CLI is not available in the Mini login shell.\n",
		});
		const commands: string[][] = [];
		const setup = runtime(stored.paths, {
			spawn(command) {
				commands.push(command);
				queueMicrotask(() => tunnel.exit(127));
				return tunnel;
			},
			probeReady: async () => false,
		});

		await expect(runRemoteCodex({}, setup.runtime)).rejects.toThrow(
			"Codex CLI is not available in the Mini login shell",
		);
		expect(commands).toHaveLength(1);
	});

	test("turns SSH host-key and login failures into setup instructions", async () => {
		const stored = await storedProfile();
		for (const failure of [
			{
				diagnostic: "Host key verification failed.\n",
				expected: `Run 'ssh ${stored.profile.sshAlias}' once`,
			},
			{
				diagnostic: "Permission denied (publickey,password).\n",
				expected: `ssh-copy-id ${stored.profile.sshAlias}`,
			},
		]) {
			const tunnel = new FakeProcess({ stderr: failure.diagnostic });
			const setup = runtime(stored.paths, {
				spawn() {
					queueMicrotask(() => tunnel.exit(255));
					return tunnel;
				},
				probeReady: async () => false,
			});

			await expect(runRemoteCodex({}, setup.runtime)).rejects.toThrow(failure.expected);
		}
	});

	test("retries a local or remote forwarding port collision", async () => {
		const stored = await storedProfile();
		const firstTunnel = new FakeProcess({
			stderr: "bind [127.0.0.1]:43210: Address already in use\n",
		});
		const secondTunnel = new FakeProcess();
		const client = new FakeProcess();
		const commands: string[][] = [];
		const localPorts = [43_210, 43_211];
		const remotePorts = [54_321, 54_322];
		const setup = runtime(stored.paths, {
			allocateLocalPort: async () => localPorts.shift()!,
			selectRemotePort: () => remotePorts.shift()!,
			spawn(command) {
				commands.push(command);
				if (commands.length === 1) {
					queueMicrotask(() => firstTunnel.exit(255));
					return firstTunnel;
				}
				if (commands.length === 2) return secondTunnel;
				queueMicrotask(() => client.exit(0));
				return client;
			},
			probeReady: async () => commands.length >= 2,
		});

		expect(await runRemoteCodex({}, setup.runtime)).toBe(0);
		expect(commands).toHaveLength(3);
		expect(commands[0]).toContain("127.0.0.1:43210:127.0.0.1:54321");
		expect(commands[1]).toContain("127.0.0.1:43211:127.0.0.1:54322");
		expect(commands[2]?.slice(0, 3)).toEqual([
			"/usr/local/bin/codex",
			"--remote",
			"ws://127.0.0.1:43211",
		]);
		expect(setup.errors).toContain(
			"Couchview bridge: a Codex forwarding port was busy; retrying (2/3).",
		);
		expect(secondTunnel.signals).toContain("SIGTERM");
	});

	test("stops the local TUI when the SSH bridge closes", async () => {
		const stored = await storedProfile();
		const tunnel = new FakeProcess();
		const client = new FakeProcess();
		let spawnCount = 0;
		const setup = runtime(stored.paths, {
			spawn() {
				spawnCount += 1;
				if (spawnCount === 1) return tunnel;
				queueMicrotask(() => tunnel.exit(9));
				return client;
			},
		});

		await expect(runRemoteCodex({}, setup.runtime)).rejects.toThrow(
			"closed while Codex was running",
		);
		expect(client.signals).toContain("SIGTERM");
	});

	test("times out without leaving the SSH process running", async () => {
		const stored = await storedProfile();
		const tunnel = new FakeProcess();
		const setup = runtime(stored.paths, {
			spawn: () => tunnel,
			probeReady: async () => false,
		});

		await expect(runRemoteCodex({}, setup.runtime)).rejects.toThrow(
			"Timed out waiting for the Mini's Codex app-server",
		);
		expect(tunnel.signals).toContain("SIGTERM");
	});

	test("fails before opening SSH when required local executables are missing", async () => {
		const stored = await storedProfile();
		const setup = runtime(stored.paths, {
			which: (command) => (command === "ssh" ? null : "/opt/bin/codex"),
		});

		await expect(runRemoteCodex({}, setup.runtime)).rejects.toThrow("OpenSSH is not available");
	});
});
