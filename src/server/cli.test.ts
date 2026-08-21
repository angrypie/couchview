import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";

import { parseCli, parseTerminalStunUrls, runCli } from "./cli.ts";
import { CLI_VERSION, CliPromptInterrupted, type InteractivePrompter } from "./cliCommand.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";

const initialRoot = Bun.env.COUCHVIEW_ROOT;
const initialHost = Bun.env.COUCHVIEW_HOST;
const initialPort = Bun.env.PORT;
const initialTerminal = Bun.env.COUCHVIEW_TERMINAL;
const initialTerminalP2p = Bun.env.COUCHVIEW_TERMINAL_P2P;
const initialTerminalStun = Bun.env.COUCHVIEW_TERMINAL_STUN;
const initialRemoteBridge = Bun.env.COUCHVIEW_REMOTE_BRIDGE;
const initialRemoteBridgeP2p = Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
const initialRemoteBridgeStun = Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
const initialRemoteBridgePort = Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
const initialRemoteBridgeOriginAccess = Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
const initialSpeech = Bun.env.COUCHVIEW_ENABLE_SPEECH;
const initialDataHome = Bun.env.XDG_DATA_HOME;
const initialAllowedOrigins = Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
const initialInternalAllowedOrigins = Bun.env.ALLOWED_ORIGINS;
const initialDisableReuse = Bun.env.COUCHVIEW_DISABLE_REUSE;

function restoreEnvironment() {
	if (initialRoot === undefined) delete Bun.env.COUCHVIEW_ROOT;
	else Bun.env.COUCHVIEW_ROOT = initialRoot;

	if (initialHost === undefined) delete Bun.env.COUCHVIEW_HOST;
	else Bun.env.COUCHVIEW_HOST = initialHost;

	if (initialPort === undefined) delete Bun.env.PORT;
	else Bun.env.PORT = initialPort;

	if (initialTerminal === undefined) delete Bun.env.COUCHVIEW_TERMINAL;
	else Bun.env.COUCHVIEW_TERMINAL = initialTerminal;

	if (initialTerminalP2p === undefined) delete Bun.env.COUCHVIEW_TERMINAL_P2P;
	else Bun.env.COUCHVIEW_TERMINAL_P2P = initialTerminalP2p;

	if (initialTerminalStun === undefined) delete Bun.env.COUCHVIEW_TERMINAL_STUN;
	else Bun.env.COUCHVIEW_TERMINAL_STUN = initialTerminalStun;

	if (initialRemoteBridge === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE = initialRemoteBridge;

	if (initialRemoteBridgeP2p === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P = initialRemoteBridgeP2p;

	if (initialRemoteBridgeStun === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN = initialRemoteBridgeStun;

	if (initialRemoteBridgePort === undefined) delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
	else Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT = initialRemoteBridgePort;

	if (initialRemoteBridgeOriginAccess === undefined) {
		delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
	} else {
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS = initialRemoteBridgeOriginAccess;
	}

	if (initialSpeech === undefined) delete Bun.env.COUCHVIEW_ENABLE_SPEECH;
	else Bun.env.COUCHVIEW_ENABLE_SPEECH = initialSpeech;

	if (initialDataHome === undefined) delete Bun.env.XDG_DATA_HOME;
	else Bun.env.XDG_DATA_HOME = initialDataHome;

	if (initialAllowedOrigins === undefined) {
		delete Bun.env.COUCHVIEW_ALLOWED_ORIGINS;
	} else {
		Bun.env.COUCHVIEW_ALLOWED_ORIGINS = initialAllowedOrigins;
	}

	if (initialInternalAllowedOrigins === undefined) {
		delete Bun.env.ALLOWED_ORIGINS;
	} else {
		Bun.env.ALLOWED_ORIGINS = initialInternalAllowedOrigins;
	}

	if (initialDisableReuse === undefined) delete Bun.env.COUCHVIEW_DISABLE_REUSE;
	else Bun.env.COUCHVIEW_DISABLE_REUSE = initialDisableReuse;
}

describe("parseCli", () => {
	beforeEach(() => {
		delete Bun.env.COUCHVIEW_ROOT;
		delete Bun.env.COUCHVIEW_HOST;
		delete Bun.env.PORT;
		delete Bun.env.COUCHVIEW_TERMINAL;
		delete Bun.env.COUCHVIEW_TERMINAL_P2P;
		delete Bun.env.COUCHVIEW_TERMINAL_STUN;
		delete Bun.env.COUCHVIEW_REMOTE_BRIDGE;
		delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P;
		delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_STUN;
		delete Bun.env.COUCHVIEW_ENABLE_SPEECH;
		delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT;
		delete Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS;
	});

	afterEach(restoreEnvironment);

	test("defaults to the launch directory, loopback, and production port", () => {
		expect(parseCli([])).toEqual({
			root: path.resolve(process.cwd()),
			host: "127.0.0.1",
			port: 4173,
			terminalMode: "auto",
			terminalP2pMode: "auto",
			terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgeMode: "auto",
			remoteBridgeP2pMode: "auto",
			remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgePort: 22,
			remoteBridgeOriginAccess: "auto",
			speechMode: "auto",
			voiceCommandsEnabled: false,
		});
	});

	test("requires repository paths to use --repo", () => {
		expect(() => parseCli(["fixtures/example"])).toThrow(
			"Repository paths must follow the 'serve' command or '--repo'",
		);
	});

	test("accepts --repo and --port in either order", () => {
		expect(parseCli(["--repo", "../project", "--port", "5199"])).toEqual({
			root: path.resolve("../project"),
			host: "127.0.0.1",
			port: 5199,
			terminalMode: "auto",
			terminalP2pMode: "auto",
			terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgeMode: "auto",
			remoteBridgeP2pMode: "auto",
			remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgePort: 22,
			remoteBridgeOriginAccess: "auto",
			speechMode: "auto",
			voiceCommandsEnabled: false,
		});
		expect(parseCli(["--port", "6001", "--repo", "/tmp/project"])).toEqual({
			root: path.resolve("/tmp/project"),
			host: "127.0.0.1",
			port: 6001,
			terminalMode: "auto",
			terminalP2pMode: "auto",
			terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgeMode: "auto",
			remoteBridgeP2pMode: "auto",
			remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgePort: 22,
			remoteBridgeOriginAccess: "auto",
			speechMode: "auto",
			voiceCommandsEnabled: false,
		});
	});

	test("uses environment defaults while command-line flags take precedence", () => {
		Bun.env.COUCHVIEW_ROOT = "environment-project";
		Bun.env.COUCHVIEW_HOST = "192.168.1.25";
		Bun.env.PORT = "4888";

		expect(parseCli([])).toEqual({
			root: path.resolve("environment-project"),
			host: "192.168.1.25",
			port: 4888,
			terminalMode: "auto",
			terminalP2pMode: "auto",
			terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgeMode: "auto",
			remoteBridgeP2pMode: "auto",
			remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgePort: 22,
			remoteBridgeOriginAccess: "auto",
			speechMode: "auto",
			voiceCommandsEnabled: false,
		});
		expect(parseCli(["--repo", "flag-project", "--host", "0.0.0.0", "--port", "4999"])).toEqual({
			root: path.resolve("flag-project"),
			host: "0.0.0.0",
			port: 4999,
			terminalMode: "auto",
			terminalP2pMode: "auto",
			terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgeMode: "auto",
			remoteBridgeP2pMode: "auto",
			remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
			remoteBridgePort: 22,
			remoteBridgeOriginAccess: "auto",
			speechMode: "auto",
			voiceCommandsEnabled: false,
		});
	});

	test("accepts IPv4, IPv6, and hostname bind values", () => {
		expect(parseCli(["--host", "0.0.0.0"]).host).toBe("0.0.0.0");
		expect(parseCli(["--host", "[::]"]).host).toBe("::");
		expect(parseCli(["--host", "My-Mac.local"]).host).toBe("my-mac.local");
	});

	test("rejects unknown options and the former --root alias", () => {
		expect(() => parseCli(["--watch"])).toThrow("Unknown option: --watch");
		expect(() => parseCli(["--root", "/tmp/project"])).toThrow("Unknown option: --root");
	});

	test("requires values for --repo, --host, and --port", () => {
		expect(() => parseCli(["--repo"])).toThrow("Repository path is required");
		expect(() => parseCli(["--repo", "--port", "5000"])).toThrow("Repository path is required");
		expect(() => parseCli(["--port"])).toThrow("Port must be between 1 and 65535");
		expect(() => parseCli(["--host"])).toThrow("Host is required");
		expect(() => parseCli(["--host", "--port", "5000"])).toThrow("Host is required");
	});

	test.each(["http://0.0.0.0", "127.0.0.1:4173", "bad host", "-invalid.local"])(
		"rejects invalid host %s",
		(host) => {
			expect(() => parseCli(["--host", host])).toThrow("Host must be an IP address or hostname");
		},
	);

	test("rejects positional and competing repository arguments", () => {
		expect(() => parseCli(["one", "two"])).toThrow(
			"Repository paths must follow the 'serve' command or '--repo'",
		);
		expect(() => parseCli(["--repo", "one", "two"])).toThrow(
			"Repository path may only be provided once",
		);
	});

	test.each(["0", "-1", "1.5", "65536", "nope"])("rejects invalid port %s", (port) => {
		expect(() => parseCli(["--port", port])).toThrow("Port must be between 1 and 65535");
	});

	test.each(["1", "65535"])("accepts boundary port %s", (port) => {
		expect(parseCli(["--port", port]).port).toBe(Number(port));
	});

	test("parses explicit terminal policy with command-line precedence", () => {
		Bun.env.COUCHVIEW_TERMINAL = "1";
		expect(parseCli([]).terminalMode).toBe("enabled");
		expect(parseCli(["--disable-terminal"]).terminalMode).toBe("disabled");

		Bun.env.COUCHVIEW_TERMINAL = "0";
		expect(parseCli([]).terminalMode).toBe("disabled");
		expect(parseCli(["--enable-terminal"]).terminalMode).toBe("enabled");
		expect(() => parseCli(["--enable-terminal", "--disable-terminal"])).toThrow(
			"cannot be used together",
		);

		Bun.env.COUCHVIEW_TERMINAL = "sometimes";
		expect(() => parseCli([])).toThrow("COUCHVIEW_TERMINAL must be 1 or 0");
	});

	test("keeps terminal P2P opt-in and gives flags precedence over the environment", () => {
		expect(parseCli([]).terminalP2pMode).toBe("auto");
		Bun.env.COUCHVIEW_TERMINAL_P2P = "1";
		expect(parseCli([]).terminalP2pMode).toBe("enabled");
		expect(parseCli(["--disable-terminal-p2p"]).terminalP2pMode).toBe("disabled");
		Bun.env.COUCHVIEW_TERMINAL_P2P = "0";
		expect(parseCli(["--enable-terminal-p2p"]).terminalP2pMode).toBe("enabled");
		expect(() => parseCli(["--enable-terminal-p2p", "--disable-terminal-p2p"])).toThrow(
			"cannot be used together",
		);
		Bun.env.COUCHVIEW_TERMINAL_P2P = "sometimes";
		expect(() => parseCli([])).toThrow("COUCHVIEW_TERMINAL_P2P must be 1 or 0");
	});

	test("keeps host speech opt-in and lets flags override the environment", () => {
		expect(parseCli([]).speechMode).toBe("auto");
		Bun.env.COUCHVIEW_ENABLE_SPEECH = "1";
		expect(parseCli([]).speechMode).toBe("enabled");
		expect(parseCli(["--disable-speech"]).speechMode).toBe("disabled");
		Bun.env.COUCHVIEW_ENABLE_SPEECH = "0";
		expect(parseCli(["--enable-speech"]).speechMode).toBe("enabled");
		expect(() => parseCli(["--enable-speech", "--disable-speech"])).toThrow(
			"cannot be used together",
		);
		Bun.env.COUCHVIEW_ENABLE_SPEECH = "sometimes";
		expect(() => parseCli([])).toThrow("COUCHVIEW_ENABLE_SPEECH must be 1 or 0");
	});

	test("requires an explicit voice-command flag", () => {
		expect(parseCli([]).voiceCommandsEnabled).toBe(false);
		expect(parseCli(["--enable-voice-commands"]).voiceCommandsEnabled).toBe(true);
		expect(() => parseCli(["--disable-voice-commands"])).toThrow(
			"Unknown option: --disable-voice-commands",
		);
	});

	test("keeps the native bridge and its direct transport explicit", () => {
		expect(parseCli([])).toMatchObject({
			remoteBridgeMode: "auto",
			remoteBridgeP2pMode: "auto",
			remoteBridgePort: 22,
			remoteBridgeOriginAccess: "auto",
			speechMode: "auto",
		});
		Bun.env.COUCHVIEW_REMOTE_BRIDGE = "1";
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_P2P = "1";
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT = "2222";
		expect(parseCli([])).toMatchObject({
			remoteBridgeMode: "enabled",
			remoteBridgeP2pMode: "enabled",
			remoteBridgePort: 2222,
		});
		expect(
			parseCli([
				"--disable-remote-bridge",
				"--disable-remote-bridge-p2p",
				"--remote-bridge-origin-access",
				"private-relay",
			]),
		).toMatchObject({
			remoteBridgeMode: "disabled",
			remoteBridgeP2pMode: "disabled",
			remoteBridgeOriginAccess: "private-relay",
		});
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_ORIGIN_ACCESS = "custom-gateway";
		expect(parseCli([]).remoteBridgeOriginAccess).toBe("custom-gateway");
		expect(() => parseCli(["--remote-bridge-origin-access", "Invalid_Provider"])).toThrow(
			"lowercase letters",
		);
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT = "70000";
		expect(() => parseCli([])).toThrow("COUCHVIEW_REMOTE_BRIDGE_PORT");
	});

	test("validates one to four STUN-only URLs", () => {
		expect(parseTerminalStunUrls(undefined)).toEqual(["stun:stun.cloudflare.com:3478"]);
		expect(
			parseTerminalStunUrls("stun:one.example, stun:two.example:5349, stun:[2001:db8::1]:3478"),
		).toEqual(["stun:one.example", "stun:two.example:5349", "stun:[2001:db8::1]:3478"]);
		for (const invalid of [
			"",
			"turn:relay.example:3478",
			"https://stun.example",
			"stun:bad host",
			"stun:-invalid.example",
			"stun:invalid..example",
			"stun:one.example,,stun:two.example",
			"stun:example.com:0",
			"stun:example.com:65536",
			"stun:a,stun:b,stun:c,stun:d,stun:e",
		]) {
			expect(() => parseTerminalStunUrls(invalid)).toThrow();
		}
	});
});

describe("CLI entrypoint", () => {
	function entrypointRuntime(prompter?: InteractivePrompter) {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const supervised: string[][] = [];
		const started: string[][] = [];
		const restarted: string[][] = [];
		const bridgePairs: Array<{ origin: string; code: string; originAccess: string }> = [];
		const bridgeProxies: string[] = [];
		const bridgeCodex: Array<{
			profileSelector: string | null;
			repositoryRoot: string | null;
			codexArgs: string[];
		}> = [];
		const bridgeTerminals: Array<{
			profileSelector: string | null;
			repositoryRoot: string | null;
		}> = [];
		const bridgeClaude: Array<{
			profileSelector: string | null;
			repositoryRoot: string | null;
			claudeArgs: string[];
		}> = [];
		return {
			stdout,
			stderr,
			supervised,
			started,
			restarted,
			bridgePairs,
			bridgeProxies,
			bridgeCodex,
			bridgeTerminals,
			bridgeClaude,
			runtime: {
				stdout(message: string) {
					stdout.push(message);
				},
				stderr(message: string) {
					stderr.push(message);
				},
				async supervise(argv: string[]) {
					supervised.push(argv);
					return 0;
				},
				async start(argv: string[]) {
					started.push(argv);
				},
				async restart(argv: string[]) {
					restarted.push(argv);
				},
				async pairBridge(options: { origin: string; code: string; originAccess: string }) {
					bridgePairs.push(options);
					return {
						id: "device-profile",
						origin: options.origin,
						repositoryId: "repo-one",
						repositoryName: "Project One",
						repositoryRoot: "/projects/one",
						deviceId: "device-profile",
						deviceToken: "t".repeat(43),
						deviceLabel: "MacBook Air",
						sshAlias: "couchview-project-one",
						username: "mini-user",
						originAccess: options.originAccess,
					};
				},
				async proxyBridge(profileId: string) {
					bridgeProxies.push(profileId);
					return 0;
				},
				async codexBridge(options: {
					profileSelector: string | null;
					repositoryRoot: string | null;
					codexArgs: string[];
				}) {
					bridgeCodex.push(options);
					return 0;
				},
				async terminalBridge(options: {
					profileSelector: string | null;
					repositoryRoot: string | null;
				}) {
					bridgeTerminals.push(options);
					return 0;
				},
				async claudeBridge(options: {
					profileSelector: string | null;
					repositoryRoot: string | null;
					claudeArgs: string[];
				}) {
					bridgeClaude.push(options);
					return 0;
				},
				createPrompter() {
					return (
						prompter ?? {
							isTTY: false,
							question: async () => "",
							error() {},
							close() {},
						}
					);
				},
				supervisedWorker: false,
			},
		};
	}

	test("prints help and version without starting server work", async () => {
		const help = entrypointRuntime();
		expect(await runCli(["--help"], help.runtime)).toBe(0);
		expect(help.stdout.join("\n")).toContain("USAGE");
		expect(help.supervised).toEqual([]);
		expect(help.started).toEqual([]);
		expect(help.restarted).toEqual([]);

		const version = entrypointRuntime();
		expect(await runCli(["--version"], version.runtime)).toBe(0);
		expect(version.stdout).toEqual([`couchview ${CLI_VERSION}`]);
	});

	test("dispatches explicit serve and restart commands with their command names removed", async () => {
		const serve = entrypointRuntime();
		expect(await runCli(["serve", ".", "-p", "5000", "--enable-speech"], serve.runtime)).toBe(0);
		expect(serve.supervised).toEqual([["--repo=.", "--port", "5000", "--enable-speech"]]);

		const restart = entrypointRuntime();
		expect(await runCli(["restart", "-H", "localhost", "-p", "5000"], restart.runtime)).toBe(0);
		expect(restart.restarted).toEqual([["-H", "localhost", "-p", "5000"]]);
	});

	test("pairs native IDE devices and dispatches the silent SSH ProxyCommand", async () => {
		const pairing = entrypointRuntime();
		expect(
			await runCli(
				[
					"bridge",
					"pair",
					"--url",
					"https://review.example.com",
					"--code",
					"c".repeat(43),
					"--origin-access",
					CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
				],
				pairing.runtime,
			),
		).toBe(0);
		expect(pairing.bridgePairs).toEqual([
			{
				origin: "https://review.example.com",
				code: "c".repeat(43),
				originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
			},
		]);
		expect(pairing.stdout.join("\n")).toContain("Open in Zed: zed://ssh/");
		expect(pairing.stdout.join("\n")).toContain(
			"Open in Codex CLI: couchview bridge codex --profile couchview-project-one --repo '/projects/one'",
		);
		expect(pairing.stdout.join("\n")).toContain(
			"Open a remote terminal: couchview bridge terminal --profile couchview-project-one --repo '/projects/one'",
		);
		expect(pairing.stdout.join("\n")).toContain(
			"Start Claude Code Remote Control: couchview bridge claude --profile couchview-project-one --repo '/projects/one'",
		);
		expect(pairing.stdout.join("\n")).not.toContain("t".repeat(43));

		const proxy = entrypointRuntime();
		expect(await runCli(["bridge", "proxy", "--profile", "device-profile"], proxy.runtime)).toBe(0);
		expect(proxy.bridgeProxies).toEqual(["device-profile"]);
		expect(proxy.stdout).toEqual([]);

		const codex = entrypointRuntime();
		expect(
			await runCli(
				[
					"bridge",
					"codex",
					"--profile",
					"couchview-project-one",
					"--repo",
					"/projects/two",
					"--",
					"--model",
					"gpt-5.4",
				],
				codex.runtime,
			),
		).toBe(0);
		expect(codex.bridgeCodex).toEqual([
			{
				profileSelector: "couchview-project-one",
				repositoryRoot: "/projects/two",
				codexArgs: ["--model", "gpt-5.4"],
			},
		]);

		const terminal = entrypointRuntime();
		expect(
			await runCli(
				["bridge", "terminal", "--profile", "couchview-project-one", "--repo", "/projects/two"],
				terminal.runtime,
			),
		).toBe(0);
		expect(terminal.bridgeTerminals).toEqual([
			{
				profileSelector: "couchview-project-one",
				repositoryRoot: "/projects/two",
			},
		]);

		const claude = entrypointRuntime();
		expect(
			await runCli(
				[
					"bridge",
					"claude",
					"--profile",
					"couchview-project-one",
					"--repo",
					"/projects/two",
					"--",
					"--name",
					"Project Two",
				],
				claude.runtime,
			),
		).toBe(0);
		expect(claude.bridgeClaude).toEqual([
			{
				profileSelector: "couchview-project-one",
				repositoryRoot: "/projects/two",
				claudeArgs: ["--name", "Project Two"],
			},
		]);
	});

	test("reports usage errors with suggestions and exit code 2", async () => {
		const invocation = entrypointRuntime();
		expect(await runCli(["--hep"], invocation.runtime)).toBe(2);
		expect(invocation.stderr.join("\n")).toContain("Did you mean '--help'");
		expect(invocation.stderr.join("\n")).toContain("couchview serve --help");
		expect(invocation.supervised).toEqual([]);

		const invalidPort = entrypointRuntime();
		expect(await runCli(["--port", "nope"], invalidPort.runtime)).toBe(2);
		expect(invalidPort.stderr.join("\n")).toContain("Port must be between 1 and 65535");
		expect(invalidPort.supervised).toEqual([]);
	});

	test("resolves interactive values once before launching the supervisor", async () => {
		const questions: string[] = [];
		let closed = false;
		const answers = ["p2p"];
		const prompter: InteractivePrompter = {
			isTTY: true,
			async question(message) {
				questions.push(message);
				return answers.shift() ?? "";
			},
			error() {},
			close() {
				closed = true;
			},
		};
		const invocation = entrypointRuntime(prompter);

		expect(
			await runCli(
				["serve", "--interactive", "--repo", ".", "--host", "127.0.0.1", "--port", "5000"],
				invocation.runtime,
			),
		).toBe(0);

		expect(questions).toHaveLength(1);
		expect(closed).toBe(true);
		expect(invocation.supervised).toEqual([
			[
				"--repo",
				path.resolve("."),
				"--host",
				"127.0.0.1",
				"--port",
				"5000",
				"--enable-terminal",
				"--enable-terminal-p2p",
			],
		]);
	});

	test("does not hang non-TTY automation and returns 130 when prompts are cancelled", async () => {
		const nonTty = entrypointRuntime();
		expect(await runCli(["--interactive"], nonTty.runtime)).toBe(2);
		expect(nonTty.stderr.join("\n")).toContain("requires an attached terminal");
		expect(nonTty.supervised).toEqual([]);

		const cancelled = entrypointRuntime({
			isTTY: true,
			async question() {
				throw new CliPromptInterrupted();
			},
			error() {},
			close() {},
		});
		expect(await runCli(["--interactive"], cancelled.runtime)).toBe(130);
		expect(cancelled.stderr).toEqual(["Interactive setup was cancelled."]);
		expect(cancelled.supervised).toEqual([]);
	});
});
