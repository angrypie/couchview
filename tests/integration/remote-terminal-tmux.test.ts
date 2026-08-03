import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	resolveRemoteBridgePaths,
	storeRemoteBridgeProfile,
} from "../../src/server/remoteBridgeClient.ts";
import {
	type RemoteTerminalClientRuntime,
	runRemoteTerminal,
} from "../../src/server/remoteTerminalClient.ts";
import type { RemoteBridgeProfile } from "../../src/shared/contracts.ts";

interface RealTmuxProcess {
	exited: Promise<number>;
	kill(signal: NodeJS.Signals): void;
	output(): string;
}

function profile(): RemoteBridgeProfile {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		origin: "https://review.example.com",
		repositoryId: "repository-one",
		repositoryName: "Project One",
		repositoryRoot: "/tmp/project-one",
		deviceId: "11111111-1111-4111-8111-111111111111",
		deviceToken: "t".repeat(43),
		deviceLabel: "MacBook Air",
		sshAlias: "couchview-project-one-11111111",
		username: "mini",
		originAccess: "none",
	};
}

function spawnTmux(
	tmuxPath: string,
	socketPath: string,
	environment: NodeJS.ProcessEnv,
	marker: string,
): RealTmuxProcess {
	const chunks: Buffer[] = [];
	const terminal = new Bun.Terminal({
		cols: 80,
		rows: 24,
		name: environment.TERM ?? "xterm-256color",
		data: (_terminal, bytes) => chunks.push(Buffer.from(bytes)),
		exit() {},
	});
	terminal.setRawMode(true);
	const child = Bun.spawn(
		[
			tmuxPath,
			"-f",
			"/dev/null",
			"-S",
			socketPath,
			"new-session",
			"-s",
			"smoke",
			`printf ${marker}`,
		],
		{
			cwd: path.dirname(socketPath),
			env: environment,
			terminal,
		},
	);
	return {
		exited: child.exited.finally(() => terminal.close()),
		kill: (signal) => child.kill(signal),
		output: () => Buffer.concat(chunks).toString("utf8"),
	};
}

describe("remote terminal with real tmux", () => {
	test("normalizes Ghostty TERM before opening the tmux client", async () => {
		const tmuxPath = Bun.which("tmux");
		if (!tmuxPath) throw new Error("This integration test requires tmux");
		if (typeof Bun.Terminal !== "function") {
			throw new Error("This integration test requires Bun.Terminal");
		}

		const home = await mkdtemp(path.join(tmpdir(), "couchview-real-tmux-"));
		const paths = resolveRemoteBridgePaths({}, home);
		await storeRemoteBridgeProfile(profile(), { paths, executableCommand: "couchview" });
		const tmuxProcesses: RealTmuxProcess[] = [];
		const runtime: RemoteTerminalClientRuntime = {
			paths,
			env: { ...process.env, TERM: "xterm-ghostty" },
			which: () => "/usr/bin/ssh",
			spawn(_command, options) {
				const tmuxProcess = spawnTmux(
					tmuxPath,
					path.join(home, "tmux.sock"),
					options.env,
					"COUCHVIEW_TMUX_OK",
				);
				tmuxProcesses.push(tmuxProcess);
				return tmuxProcess;
			},
			onExit() {},
			offExit() {},
			stderr() {},
		};

		expect(await runRemoteTerminal({}, runtime)).toBe(0);
		expect(tmuxProcesses).toHaveLength(1);
		expect(tmuxProcesses[0]?.output()).toContain("COUCHVIEW_TMUX_OK");
	});
});
