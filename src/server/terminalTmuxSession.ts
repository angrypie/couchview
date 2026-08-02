import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { TerminalCapability } from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import type {
	TerminalCommandRunner,
	TerminalDependencies,
	TerminalSessionServiceOptions,
} from "./terminalSessionTypes.ts";

const COMMAND_TIMEOUT_MS = 5_000;

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function cleanCommandError(value: string): string {
	return (
		value
			.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
			.replaceAll("\0", "�")
			.trim()
			.split("\n")[0]
			?.slice(0, 240) || "The command did not return details"
	);
}

async function runCommand(
	argv: readonly string[],
	options: { cwd?: string; timeoutMs?: number } = {},
) {
	try {
		const subprocess = Bun.spawn([...argv], {
			cwd: options.cwd,
			env: process.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text(),
		]);
		return { exitCode, stdout, stderr };
	} catch (error) {
		return { exitCode: -1, stdout: "", stderr: (error as Error).message };
	}
}

function probeDependencies(): TerminalDependencies {
	const tmuxPath = Bun.which("tmux");
	const infocmp = Bun.which("infocmp");
	const tmux256Color = Boolean(
		infocmp &&
			Bun.spawnSync([infocmp, "tmux-256color"], {
				stdout: "ignore",
				stderr: "ignore",
			}).exitCode === 0,
	);
	return {
		terminalAvailable: typeof Bun.Terminal === "function",
		tmuxPath,
		tmux256Color,
	};
}

export function resolveUserTmuxConfigPath(
	environment: Record<string, string | undefined> = process.env,
	homeDirectory = homedir(),
	exists: (candidate: string) => boolean = existsSync,
): string | null {
	const candidates = [
		...(environment.XDG_CONFIG_HOME
			? [path.join(environment.XDG_CONFIG_HOME, "tmux", "tmux.conf")]
			: []),
		path.join(homeDirectory, ".config", "tmux", "tmux.conf"),
		path.join(homeDirectory, ".tmux.conf"),
	];
	return [...new Set(candidates)].find(exists) ?? null;
}

function tmuxQuoted(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
}

function capabilityFor(
	enabled: boolean,
	disabledReason: string | undefined,
	dependencies: TerminalDependencies,
): TerminalCapability {
	let reason: string | null = null;
	if (!enabled) {
		reason = disabledReason ?? "Browser terminal access is disabled.";
	} else if (process.platform === "win32") {
		reason = "The browser tmux terminal currently requires macOS or Linux.";
	} else if (!dependencies.terminalAvailable) {
		reason = "This Bun runtime does not provide Bun.Terminal.";
	} else if (!dependencies.tmuxPath) {
		reason = "Install tmux on the Couchview host to use persistent terminal sessions.";
	}
	const available = reason === null;
	return {
		available,
		reason,
		persistence: "tmux",
		profiles: [{ id: "tmux", label: "tmux", available, reason }],
	};
}

export class TerminalTmuxSession {
	readonly capability: TerminalCapability;

	private readonly dependencies: TerminalDependencies;
	private readonly commandRunner: TerminalCommandRunner;
	private readonly namespace: string;
	private readonly runtimeDirectory: string;
	private readonly userTmuxConfigPath: string | null;
	private readonly starts = new Map<string, Promise<void>>();
	private serverConfiguration: Promise<void> | null = null;
	private serverConfigured = false;

	constructor(private readonly options: TerminalSessionServiceOptions) {
		this.dependencies = options.dependencies ?? probeDependencies();
		this.capability = capabilityFor(options.enabled, options.disabledReason, this.dependencies);
		this.commandRunner = options.commandRunner ?? runCommand;
		const namespaceHash = hash(options.namespaceSeed).slice(0, 12);
		this.namespace = `couchview-${namespaceHash}`;
		const uid = typeof process.getuid === "function" ? process.getuid() : "user";
		this.runtimeDirectory =
			options.runtimeDirectory ?? path.join("/tmp", `couchview-${uid}-${namespaceHash}`);
		this.userTmuxConfigPath =
			options.userTmuxConfigPath === undefined
				? resolveUserTmuxConfigPath()
				: options.userTmuxConfigPath;
	}

	assertAvailable(): void {
		if (!this.options.enabled) {
			throw new HttpError(
				403,
				"terminal_disabled",
				this.capability.reason ?? "Terminal access is disabled",
			);
		}
		if (!this.capability.available) {
			throw new HttpError(
				503,
				"terminal_unavailable",
				this.capability.reason ?? "tmux is unavailable",
			);
		}
	}

	private tmuxArgs(...args: string[]): string[] {
		const tmuxPath = this.dependencies.tmuxPath;
		if (!tmuxPath) throw new HttpError(503, "terminal_unavailable", "tmux is unavailable");
		return [tmuxPath, "-f", this.tmuxConfigPath(), "-L", this.namespace, ...args];
	}

	attachmentArgs(repositoryId: string): string[] {
		return this.tmuxArgs("attach-session", "-d", "-t", this.sessionName(repositoryId));
	}

	private sessionName(repositoryId: string): string {
		return `nvim-${hash(repositoryId).slice(0, 16)}`;
	}

	private tmuxConfigPath(): string {
		return path.join(this.runtimeDirectory, "tmux.conf");
	}

	private async ensureRuntimeDirectory(): Promise<void> {
		await mkdir(this.runtimeDirectory, { recursive: true, mode: 0o700 });
		const metadata = await lstat(this.runtimeDirectory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new HttpError(
				500,
				"terminal_runtime_unsafe",
				"The terminal runtime path is not a safe directory",
			);
		}
		if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
			throw new HttpError(
				500,
				"terminal_runtime_unsafe",
				"The terminal runtime directory belongs to another user",
			);
		}
		await chmod(this.runtimeDirectory, 0o700);
		const terminalName = this.dependencies.tmux256Color ? "tmux-256color" : "screen-256color";
		const configuration = [
			...(this.userTmuxConfigPath ? [`source-file ${tmuxQuoted(this.userTmuxConfigPath)}`] : []),
			"set-option -s escape-time 0",
			"set-option -g focus-events on",
			"set-option -g mouse on",
			"set-option -g destroy-unattached off",
			"set-option -g remain-on-exit off",
			`set-option -g default-terminal ${terminalName}`,
			...(this.dependencies.tmux256Color
				? ["set-option -as terminal-features ,xterm-256color:RGB"]
				: []),
			"",
		].join("\n");
		await writeFile(this.tmuxConfigPath(), configuration, { encoding: "utf8", mode: 0o600 });
		await chmod(this.tmuxConfigPath(), 0o600);
	}

	private async hasSession(repositoryId: string): Promise<boolean> {
		if (!this.dependencies.tmuxPath) return false;
		const result = await this.commandRunner(
			this.tmuxArgs("has-session", "-t", this.sessionName(repositoryId)),
			{ timeoutMs: COMMAND_TIMEOUT_MS },
		);
		return result.exitCode === 0;
	}

	private async hasTmuxServer(): Promise<boolean> {
		if (!this.dependencies.tmuxPath) return false;
		const result = await this.commandRunner(this.tmuxArgs("list-sessions"), {
			timeoutMs: COMMAND_TIMEOUT_MS,
		});
		return result.exitCode === 0;
	}

	status(repositoryId: string): Promise<boolean> {
		return this.hasSession(repositoryId);
	}

	private async configureTmux(): Promise<void> {
		const commands: string[][] = [
			["set-option", "-s", "escape-time", "0"],
			["set-option", "-g", "focus-events", "on"],
			["set-option", "-g", "mouse", "on"],
			["set-option", "-g", "destroy-unattached", "off"],
			["set-option", "-g", "remain-on-exit", "off"],
			[
				"set-option",
				"-g",
				"default-terminal",
				this.dependencies.tmux256Color ? "tmux-256color" : "screen-256color",
			],
		];
		if (this.dependencies.tmux256Color) {
			commands.push(["set-option", "-as", "terminal-features", ",xterm-256color:RGB"]);
		}
		for (const command of commands) {
			await this.commandRunner(this.tmuxArgs(...command), { timeoutMs: COMMAND_TIMEOUT_MS });
		}
	}

	private async configureExistingTmuxServer(): Promise<void> {
		if (this.serverConfigured) return;
		if (this.serverConfiguration) return this.serverConfiguration;
		const configuration = (async () => {
			if (this.userTmuxConfigPath) {
				const result = await this.commandRunner(
					this.tmuxArgs("source-file", this.userTmuxConfigPath),
					{ timeoutMs: COMMAND_TIMEOUT_MS },
				);
				if (result.exitCode !== 0) {
					throw new HttpError(
						503,
						"terminal_config_failed",
						`The host tmux config could not load: ${cleanCommandError(result.stderr)}`,
					);
				}
			}
			await this.configureTmux();
			this.serverConfigured = true;
		})().finally(() => {
			if (this.serverConfiguration === configuration) this.serverConfiguration = null;
		});
		this.serverConfiguration = configuration;
		return configuration;
	}

	private async startSession(repositoryId: string, repositoryRoot: string): Promise<void> {
		await this.ensureRuntimeDirectory();
		const result = await this.commandRunner(
			this.tmuxArgs(
				"new-session",
				"-d",
				"-s",
				this.sessionName(repositoryId),
				"-c",
				repositoryRoot,
			),
			{ cwd: repositoryRoot, timeoutMs: COMMAND_TIMEOUT_MS },
		);
		if (result.exitCode !== 0) {
			throw new HttpError(
				503,
				"terminal_start_failed",
				`The tmux session could not start: ${cleanCommandError(result.stderr)}`,
			);
		}
		await this.configureTmux();
		this.serverConfigured = true;
	}

	async ensureSession(repositoryId: string, repositoryRoot: string): Promise<void> {
		this.assertAvailable();
		const sessionRunning = await this.hasSession(repositoryId);
		if (sessionRunning || (await this.hasTmuxServer())) await this.configureExistingTmuxServer();
		if (sessionRunning) return;
		const existing = this.starts.get(repositoryId);
		if (existing) return existing;
		const start = this.startSession(repositoryId, repositoryRoot).finally(() => {
			if (this.starts.get(repositoryId) === start) this.starts.delete(repositoryId);
		});
		this.starts.set(repositoryId, start);
		await start;
	}

	async end(repositoryId: string): Promise<void> {
		if (!(await this.hasSession(repositoryId))) return;
		const killed = await this.commandRunner(
			this.tmuxArgs("kill-session", "-t", this.sessionName(repositoryId)),
			{ timeoutMs: COMMAND_TIMEOUT_MS },
		);
		if (killed.exitCode !== 0 && (await this.hasSession(repositoryId))) {
			throw new HttpError(
				503,
				"terminal_end_failed",
				`The terminal session could not be ended: ${cleanCommandError(killed.stderr)}`,
			);
		}
	}
}
