import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	CliPromptInterrupted,
	CliUsageError,
	type InteractivePrompter,
	parseCliInvocation,
	parseServeArguments,
	promptForServeArguments,
} from "./cliCommand.ts";
import { CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID } from "./cloudflareAccess.ts";

function fakePrompter(
	answers: string[],
	isTTY = true,
): InteractivePrompter & { questions: string[]; errors: string[]; closed: boolean } {
	return {
		isTTY,
		questions: [],
		errors: [],
		closed: false,
		async question(message) {
			this.questions.push(message);
			const answer = answers.shift();
			if (answer === undefined) throw new CliPromptInterrupted();
			return answer;
		},
		error(message) {
			this.errors.push(message);
		},
		close() {
			this.closed = true;
		},
	};
}

const validators = {
	root(value: string) {
		if (!value) throw new Error("Repository path is required");
		return path.resolve(value);
	},
	host(value: string) {
		if (!/^[A-Za-z0-9.:-]+$/.test(value)) throw new Error("Host is invalid");
		return value.toLowerCase();
	},
	port(value: string) {
		const port = Number(value);
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new Error("Port is invalid");
		}
		return port;
	},
};

describe("CLI command parsing", () => {
	test("supports conventional aliases, inline values, and option termination", () => {
		expect(
			parseServeArguments(["-r", "../project", "-H", "0.0.0.0", "--port=5199", "-i"]),
		).toMatchObject({
			repo: "../project",
			host: "0.0.0.0",
			port: "5199",
			interactive: true,
			explicit: { repo: true, host: true, port: true },
		});
		expect(parseServeArguments(["--", "-repository"], true).repo).toBe("-repository");
	});

	test("rejects duplicate and conflicting options", () => {
		expect(() => parseServeArguments(["--port", "4000", "-p", "5000"])).toThrow(
			"may only be provided once",
		);
		expect(() => parseServeArguments(["--enable-terminal-p2p", "--disable-terminal-p2p"])).toThrow(
			"cannot be used together",
		);
		expect(() =>
			parseServeArguments(["--enable-remote-bridge", "--disable-remote-bridge"]),
		).toThrow("cannot be used together");
		expect(() =>
			parseCliInvocation([
				"bridge",
				"pair",
				"--url",
				"https://review.example.com",
				"--code",
				"a".repeat(43),
				"--",
				"--model",
				"gpt-5.4",
			]),
		).toThrow("only valid for bridge codex");
		expect(() =>
			parseCliInvocation(["bridge", "codex", "--url", "https://review.example.com"]),
		).toThrow("Unknown option: --url");
		expect(() => parseCliInvocation(["bridge", "codex", "--repo", "relative/project"])).toThrow(
			"must be absolute",
		);
		expect(() => parseCliInvocation(["bridge", "terminal", "--repo", "relative/project"])).toThrow(
			"must be absolute",
		);
		expect(() => parseCliInvocation(["bridge", "terminal", "--", "claude"])).toThrow(
			"opens a login shell",
		);
	});

	test("dispatches the default command, explicit commands, help, and version", () => {
		expect(parseCliInvocation([])).toMatchObject({ kind: "serve", argv: [] });
		expect(parseCliInvocation(["serve", "."])).toMatchObject({
			kind: "serve",
			argv: ["--repo=."],
		});
		expect(parseCliInvocation(["--repo", "."])).toMatchObject({
			kind: "serve",
			argv: ["--repo=."],
		});
		expect(parseCliInvocation(["serve", "--port", "5000"])).toMatchObject({
			kind: "serve",
			argv: ["--port", "5000"],
		});
		expect(parseCliInvocation(["restart", "-p", "5000"])).toMatchObject({
			kind: "restart",
			argv: ["-p", "5000"],
		});
		expect(parseCliInvocation(["browse", "--repo", ".", "-p", "5000"])).toMatchObject({
			kind: "browse",
			argv: ["--repo", ".", "--port", "5000"],
		});
		expect(parseCliInvocation(["--help"])).toEqual({ kind: "help", path: [] });
		expect(parseCliInvocation(["serve", "--help"])).toEqual({
			kind: "help",
			path: ["serve"],
		});
		expect(parseCliInvocation(["browse", "--help"])).toEqual({
			kind: "help",
			path: ["browse"],
		});
		expect(parseCliInvocation(["help", "restart"])).toEqual({
			kind: "help",
			path: ["restart"],
		});
		expect(parseCliInvocation(["help", "bridge", "pair"])).toEqual({
			kind: "help",
			path: ["bridge", "pair"],
		});
		expect(parseCliInvocation(["-V"])).toEqual({ kind: "version" });
		expect(
			parseCliInvocation([
				"bridge",
				"pair",
				"--url",
				"https://review.example.com",
				"--code",
				"a".repeat(43),
				"--origin-access",
				CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
			]),
		).toEqual({
			kind: "bridge-pair",
			origin: "https://review.example.com",
			code: "a".repeat(43),
			originAccess: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
		});
		expect(parseCliInvocation(["bridge", "proxy", "--profile", "device-profile"])).toEqual({
			kind: "bridge-proxy",
			profileId: "device-profile",
		});
		expect(
			parseCliInvocation([
				"bridge",
				"codex",
				"--profile",
				"couchview-project-one",
				"--repo",
				"/Users/mini/Code/Project One",
				"--",
				"--model",
				"gpt-5.4",
				"Inspect the repository",
			]),
		).toEqual({
			kind: "bridge-codex",
			profileSelector: "couchview-project-one",
			repositoryRoot: "/Users/mini/Code/Project One",
			codexArgs: ["--model", "gpt-5.4", "Inspect the repository"],
		});
		expect(parseCliInvocation(["bridge", "codex"])).toEqual({
			kind: "bridge-codex",
			profileSelector: null,
			repositoryRoot: null,
			codexArgs: [],
		});
		expect(
			parseCliInvocation([
				"bridge",
				"terminal",
				"--profile",
				"couchview-project-one",
				"--repo",
				"/Users/mini/Code/Project One",
			]),
		).toEqual({
			kind: "bridge-terminal",
			profileSelector: "couchview-project-one",
			repositoryRoot: "/Users/mini/Code/Project One",
		});
		expect(
			parseCliInvocation([
				"bridge",
				"claude",
				"--profile",
				"couchview-project-one",
				"--repo",
				"/Users/mini/Code/Project One",
				"--",
				"--name",
				"Project One",
			]),
		).toEqual({
			kind: "bridge-claude",
			profileSelector: "couchview-project-one",
			repositoryRoot: "/Users/mini/Code/Project One",
			claudeArgs: ["--name", "Project One"],
		});
		expect(parseCliInvocation(["bridge", "claude"])).toEqual({
			kind: "bridge-claude",
			profileSelector: null,
			repositoryRoot: null,
			claudeArgs: [],
		});
		expect(() => parseCliInvocation(["bridge", "par"])).toThrow("Did you mean 'pair'");
		expect(() => parseCliInvocation(["speech", "status"])).toThrow("Unknown command 'speech'");
	});

	test("suggests nearby commands and options", () => {
		expect(() => parseCliInvocation(["restrat"])).toThrow("Did you mean 'restart'");
		expect(() => parseCliInvocation(["--hep"])).toThrow("Did you mean '--help'");
	});

	test("rejects bare repository paths", () => {
		expect(() => parseCliInvocation(["."])).toThrow(
			"Repository paths must follow 'serve' or '--repo'",
		);
		expect(() => parseCliInvocation(["--", "."])).toThrow(
			"Repository paths must follow the 'serve' command or '--repo'",
		);
		expect(() => parseCliInvocation(["browse", "."])).toThrow(
			"accepts a repository only through --repo",
		);
	});
});

describe("artifact CLI parsing", () => {
	test("parses selection, download, JSON, and overwrite options", () => {
		expect(
			parseCliInvocation([
				"artifacts",
				"download",
				"couchview-cli",
				"--profile",
				"couchview-air",
				"--repository",
				"server-repo",
				"--build",
				"build-one",
				"--output",
				"./bin/couchview",
				"--force",
				"--json",
			]),
		).toEqual({
			kind: "artifacts",
			parsed: {
				action: "download",
				name: "couchview-cli",
				profile: "couchview-air",
				repository: "server-repo",
				repo: null,
				build: "build-one",
				output: "./bin/couchview",
				force: true,
				json: true,
			},
		});
		expect(parseCliInvocation(["artifacts", "list", "--repo", "../checkout"])).toMatchObject({
			kind: "artifacts",
			parsed: { action: "list", repo: "../checkout" },
		});
	});

	test("validates actions, names, and action-specific options with suggestions", () => {
		expect(() => parseCliInvocation(["artifacts", "pul", "app"])).toThrow("Did you mean 'pull'");
		expect(() => parseCliInvocation(["artifacts", "list", "extra"])).toThrow("does not accept");
		expect(() => parseCliInvocation(["artifacts", "build", "app", "--force"])).toThrow(
			"Unknown option: --force",
		);
		expect(() => parseCliInvocation(["artifacts", "pull", "bad name"])).toThrow(
			"Artifact name is invalid",
		);
	});
});

describe("interactive serve setup", () => {
	const defaults = {
		root: "/tmp/default-project",
		host: "127.0.0.1",
		port: 4173,
		terminalMode: "auto" as const,
		terminalP2pMode: "auto" as const,
	};

	test("prompts for omitted values, retries validation, and emits canonical arguments", async () => {
		const prompter = fakePrompter([
			"/tmp/project",
			"bad host",
			"0.0.0.0",
			"0",
			"5000",
			"direct",
			"p2p",
		]);
		const argv = await promptForServeArguments(
			parseServeArguments(["--interactive"]),
			defaults,
			prompter,
			validators,
		);

		expect(argv).toEqual([
			"--repo",
			"/tmp/project",
			"--host",
			"0.0.0.0",
			"--port",
			"5000",
			"--enable-terminal",
			"--enable-terminal-p2p",
		]);
		expect(prompter.errors).toEqual([
			"Host is invalid",
			"Port is invalid",
			"Choose automatic, disabled, websocket, or p2p.",
		]);
	});

	test("does not prompt for command-line values or explicit terminal policy", async () => {
		const prompter = fakePrompter([]);
		const parsed = parseServeArguments([
			"--interactive",
			"--repo",
			"/tmp/project",
			"--host",
			"localhost",
			"--port",
			"5000",
			"--disable-terminal",
		]);
		const argv = await promptForServeArguments(
			parsed,
			{
				...defaults,
				root: "/tmp/project",
				host: "localhost",
				port: 5000,
				terminalMode: "disabled",
			},
			prompter,
			validators,
		);

		expect(prompter.questions).toEqual([]);
		expect(argv).toContain("--disable-terminal");
		expect(argv).not.toContain("--interactive");
	});

	test("rejects non-TTY use and propagates cancellation", async () => {
		await expect(
			promptForServeArguments(
				parseServeArguments(["--interactive"]),
				defaults,
				fakePrompter([], false),
				validators,
			),
		).rejects.toBeInstanceOf(CliUsageError);
		await expect(
			promptForServeArguments(
				parseServeArguments(["--interactive"]),
				defaults,
				fakePrompter([]),
				validators,
			),
		).rejects.toBeInstanceOf(CliPromptInterrupted);
	});
});
