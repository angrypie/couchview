import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type {
	PackageRunEvent,
	PackageRunner,
	PackageRunOutputChunk,
	PackageRunSnapshot,
	PackageRunSummary,
	PackageScriptsPackage,
	PackageScriptsResponse,
	PackageScriptWarning,
	StartPackageRunRequest,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { decodeGitOutput, runGit, sha256 } from "./git/index.ts";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_COMPLETED_RUNS_PER_REPOSITORY = 20;
const STOP_GRACE_MS = 3_000;
const ACTIVE_STATUSES = new Set<PackageRunSummary["status"]>(["running", "stopping"]);

interface ParsedPackage {
	contract: PackageScriptsPackage;
	packageManager: PackageRunner | null;
}

interface ProcessHandle {
	pid: number;
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exited: Promise<number>;
	kill(signal?: NodeJS.Signals): void;
}

interface SpawnOptions {
	cwd: string;
	env: Record<string, string | undefined>;
}

type SpawnProcess = (command: readonly string[], options: SpawnOptions) => ProcessHandle;

interface PackageCommandServiceOptions {
	maxConcurrentRuns?: number;
	maxOutputBytes?: number;
	completedRunsPerRepository?: number;
	resolveExecutable?: (runner: PackageRunner) => string | null;
	spawn?: SpawnProcess;
}

interface StoredRun {
	summary: PackageRunSummary;
	output: PackageRunOutputChunk[];
	outputBytes: number;
	nextSequence: number;
	process: ProcessHandle | null;
	stopRequested: boolean;
	stopTimer: ReturnType<typeof setTimeout> | null;
}

type RunListener = (event: Exclude<PackageRunEvent, { type: "snapshot" }>) => void;

function isInsideRoot(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safePackagePath(value: string): boolean {
	if (!value || path.isAbsolute(value) || value.includes("\0")) return false;
	const parts = value.split("/");
	return parts.every((part) => part && part !== "." && part !== ".." && part !== "node_modules");
}

function runnerFromPackageManager(value: unknown): PackageRunner | null {
	if (typeof value !== "string") return null;
	const match = /^(bun|npm|pnpm|yarn)(?:@|$)/.exec(value.trim());
	return (match?.[1] as PackageRunner | undefined) ?? null;
}

function invocationArgument(value: string): string {
	return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function defaultSpawn(command: readonly string[], options: SpawnOptions): ProcessHandle {
	const child = Bun.spawn([...command], {
		cwd: options.cwd,
		detached: true,
		env: options.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		pid: child.pid,
		stdout: child.stdout,
		stderr: child.stderr,
		exited: child.exited,
		kill(signal) {
			child.kill(signal);
		},
	};
}

export class PackageCommandService {
	private readonly maxConcurrentRuns: number;
	private readonly maxOutputBytes: number;
	private readonly completedRunsPerRepository: number;
	private readonly resolveExecutable: (runner: PackageRunner) => string | null;
	private readonly spawnProcess: SpawnProcess;
	private readonly storedRuns = new Map<string, StoredRun>();
	private readonly listeners = new Map<string, Set<RunListener>>();

	constructor(options: PackageCommandServiceOptions = {}) {
		this.maxConcurrentRuns = options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
		this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
		this.completedRunsPerRepository =
			options.completedRunsPerRepository ?? DEFAULT_COMPLETED_RUNS_PER_REPOSITORY;
		this.resolveExecutable =
			options.resolveExecutable ??
			((runner) => (runner === "bun" ? process.execPath : Bun.which(runner)));
		this.spawnProcess = options.spawn ?? defaultSpawn;
	}

	async discover(root: string): Promise<PackageScriptsResponse> {
		const canonicalRoot = await realpath(root);
		const result = await runGit(canonicalRoot, [
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
		]);
		const packagePaths = decodeGitOutput(result.stdout)
			.split("\0")
			.filter(Boolean)
			.filter(
				(packagePath) => packagePath === "package.json" || packagePath.endsWith("/package.json"),
			)
			.filter((packagePath, index, all) => all.indexOf(packagePath) === index)
			.filter((packagePath) => !packagePath.split("/").includes("node_modules"))
			.sort((left, right) => {
				if (left === "package.json") return -1;
				if (right === "package.json") return 1;
				return left.localeCompare(right);
			});

		const warnings: PackageScriptWarning[] = [];
		const parsed: ParsedPackage[] = [];
		for (const packagePath of packagePaths) {
			const loaded = await this.readPackage(canonicalRoot, packagePath, warnings);
			if (loaded) parsed.push(loaded);
		}

		const byPath = new Map(parsed.map((item) => [item.contract.packagePath, item]));
		for (const item of parsed) {
			item.contract.runner = await this.resolveRunner(
				canonicalRoot,
				item.contract.directory,
				byPath,
			);
		}

		return {
			packages: parsed.map((item) => item.contract),
			warnings,
		};
	}

	runs(repositoryId: string): PackageRunSummary[] {
		return [...this.storedRuns.values()]
			.map((item) => item.summary)
			.filter((run) => run.repositoryId === repositoryId)
			.sort((left, right) => {
				const activeDifference =
					Number(ACTIVE_STATUSES.has(right.status)) - Number(ACTIVE_STATUSES.has(left.status));
				return activeDifference || right.startedAt.localeCompare(left.startedAt);
			})
			.map((run) => structuredClone(run));
	}

	async start(
		repositoryId: string,
		root: string,
		input: StartPackageRunRequest,
	): Promise<PackageRunSummary> {
		this.validateStartRequest(input);
		if (
			[...this.storedRuns.values()].filter((run) => ACTIVE_STATUSES.has(run.summary.status))
				.length >= this.maxConcurrentRuns
		) {
			throw new HttpError(
				429,
				"package_run_limit",
				`At most ${this.maxConcurrentRuns} package scripts can run at once`,
			);
		}

		const discovery = await this.discover(root);
		const selectedPackage = discovery.packages.find(
			(item) => item.packagePath === input.packagePath,
		);
		if (!selectedPackage) {
			throw new HttpError(404, "package_not_found", "The selected package is no longer available");
		}
		if (selectedPackage.manifestRevision !== input.manifestRevision) {
			throw new HttpError(
				409,
				"package_scripts_changed",
				"The package scripts changed; refresh the command list and try again",
			);
		}
		const script = selectedPackage.scripts.find((item) => item.name === input.scriptName);
		if (!script) {
			throw new HttpError(
				404,
				"package_script_not_found",
				"The selected package script is no longer available",
			);
		}
		const duplicate = [...this.storedRuns.values()].some(
			(run) =>
				run.summary.repositoryId === repositoryId &&
				run.summary.packagePath === selectedPackage.packagePath &&
				run.summary.scriptName === script.name &&
				ACTIVE_STATUSES.has(run.summary.status),
		);
		if (duplicate) {
			throw new HttpError(409, "package_script_running", "This package script is already running");
		}

		const now = new Date().toISOString();
		const command = [selectedPackage.runner, "run", script.name] as const;
		const run: StoredRun = {
			summary: {
				id: randomUUID(),
				repositoryId,
				packagePath: selectedPackage.packagePath,
				packageName: selectedPackage.name,
				directory: selectedPackage.directory,
				scriptName: script.name,
				command: script.command,
				runner: selectedPackage.runner,
				invocation: command.map(invocationArgument).join(" "),
				status: "running",
				exitCode: null,
				startedAt: now,
				finishedAt: null,
				outputTruncated: false,
			},
			output: [],
			outputBytes: 0,
			nextSequence: 1,
			process: null,
			stopRequested: false,
			stopTimer: null,
		};
		this.storedRuns.set(run.summary.id, run);

		const executable = this.resolveExecutable(selectedPackage.runner);
		if (!executable) {
			this.appendOutput(
				run,
				"stderr",
				`Could not find ${selectedPackage.runner} on the Couchview server PATH.\n`,
			);
			this.finishRun(run, "failed", null);
			return structuredClone(run.summary);
		}

		const workingDirectory =
			selectedPackage.directory === "."
				? root
				: path.join(root, ...selectedPackage.directory.split("/"));
		try {
			run.process = this.spawnProcess([executable, "run", script.name], {
				cwd: workingDirectory,
				env: { ...process.env },
			});
		} catch (error) {
			this.appendOutput(
				run,
				"stderr",
				`Could not start ${selectedPackage.runner}: ${
					error instanceof Error ? error.message : String(error)
				}\n`,
			);
			this.finishRun(run, "failed", null);
			return structuredClone(run.summary);
		}

		void this.monitorRun(run);
		return structuredClone(run.summary);
	}

	stop(repositoryId: string, runId: string): PackageRunSummary {
		const run = this.requireRun(repositoryId, runId);
		if (!ACTIVE_STATUSES.has(run.summary.status)) {
			return structuredClone(run.summary);
		}
		if (run.summary.status !== "stopping") {
			run.stopRequested = true;
			run.summary.status = "stopping";
			this.emit(run, { type: "status", run: structuredClone(run.summary) });
			this.killRun(run, "SIGTERM");
			run.stopTimer = setTimeout(() => {
				if (ACTIVE_STATUSES.has(run.summary.status)) {
					this.killRun(run, "SIGKILL");
				}
			}, STOP_GRACE_MS);
			run.stopTimer.unref?.();
		}
		return structuredClone(run.summary);
	}

	subscribe(
		repositoryId: string,
		runId: string,
		listener: RunListener,
	): { snapshot: PackageRunSnapshot; unsubscribe: () => void } {
		const run = this.requireRun(repositoryId, runId);
		const runListeners = this.listeners.get(runId) ?? new Set<RunListener>();
		runListeners.add(listener);
		this.listeners.set(runId, runListeners);
		return {
			snapshot: {
				run: structuredClone(run.summary),
				output: structuredClone(run.output),
			},
			unsubscribe: () => {
				runListeners.delete(listener);
				if (runListeners.size === 0) this.listeners.delete(runId);
			},
		};
	}

	stopRepository(repositoryId: string): void {
		for (const run of this.storedRuns.values()) {
			if (run.summary.repositoryId === repositoryId && ACTIVE_STATUSES.has(run.summary.status)) {
				this.stop(repositoryId, run.summary.id);
			}
		}
	}

	close(): void {
		for (const run of this.storedRuns.values()) {
			if (ACTIVE_STATUSES.has(run.summary.status)) {
				this.stop(run.summary.repositoryId, run.summary.id);
			}
		}
		this.listeners.clear();
	}

	private async readPackage(
		root: string,
		packagePath: string,
		warnings: PackageScriptWarning[],
	): Promise<ParsedPackage | null> {
		if (!safePackagePath(packagePath)) {
			warnings.push({ packagePath, message: "Package path is not safe to read" });
			return null;
		}
		const target = path.resolve(root, ...packagePath.split("/"));
		if (!isInsideRoot(root, target)) {
			warnings.push({ packagePath, message: "Package path escapes the repository" });
			return null;
		}
		const metadata = await lstat(target).catch(() => null);
		if (!metadata) return null;
		if (metadata.isSymbolicLink()) {
			warnings.push({ packagePath, message: "Symbolic-link manifests are ignored" });
			return null;
		}
		if (!metadata.isFile()) {
			warnings.push({ packagePath, message: "Manifest is not a regular file" });
			return null;
		}
		if (metadata.size > MAX_MANIFEST_BYTES) {
			warnings.push({
				packagePath,
				message: "Manifest exceeds the 1 MiB safety limit",
			});
			return null;
		}
		const canonicalTarget = await realpath(target).catch(() => null);
		if (!canonicalTarget || !isInsideRoot(root, canonicalTarget)) {
			warnings.push({ packagePath, message: "Manifest resolves outside the repository" });
			return null;
		}

		const bytes = await readFile(canonicalTarget);
		let value: unknown;
		try {
			value = JSON.parse(bytes.toString("utf8"));
		} catch {
			warnings.push({ packagePath, message: "Manifest is not valid JSON" });
			return null;
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			warnings.push({ packagePath, message: "Manifest must contain a JSON object" });
			return null;
		}

		const manifest = value as Record<string, unknown>;
		const scriptsValue = manifest.scripts;
		const scripts =
			scriptsValue && typeof scriptsValue === "object" && !Array.isArray(scriptsValue)
				? Object.entries(scriptsValue).flatMap(([name, command]) => {
						if (typeof command === "string") return [{ name, command }];
						warnings.push({
							packagePath,
							message: `Script ${JSON.stringify(name)} is ignored because it is not a string`,
						});
						return [];
					})
				: [];
		if (
			scriptsValue !== undefined &&
			(!scriptsValue || typeof scriptsValue !== "object" || Array.isArray(scriptsValue))
		) {
			warnings.push({ packagePath, message: "The scripts field must be an object" });
		}

		const directory = path.posix.dirname(packagePath);
		return {
			contract: {
				packagePath,
				directory,
				name: typeof manifest.name === "string" && manifest.name.trim() ? manifest.name : null,
				manifestRevision: sha256(bytes),
				runner: "bun",
				scripts,
			},
			packageManager: runnerFromPackageManager(manifest.packageManager),
		};
	}

	private async resolveRunner(
		root: string,
		directory: string,
		packages: ReadonlyMap<string, ParsedPackage>,
	): Promise<PackageRunner> {
		for (const ancestor of this.ancestorDirectories(directory)) {
			const packagePath = ancestor === "." ? "package.json" : `${ancestor}/package.json`;
			const declared = packages.get(packagePath)?.packageManager;
			if (declared) return declared;
		}

		const locks: ReadonlyArray<[string, PackageRunner]> = [
			["bun.lock", "bun"],
			["bun.lockb", "bun"],
			["pnpm-lock.yaml", "pnpm"],
			["yarn.lock", "yarn"],
			["npm-shrinkwrap.json", "npm"],
			["package-lock.json", "npm"],
		];
		for (const ancestor of this.ancestorDirectories(directory)) {
			const absolute = ancestor === "." ? root : path.join(root, ...ancestor.split("/"));
			for (const [lockfile, runner] of locks) {
				const lock = await stat(path.join(absolute, lockfile)).catch(() => null);
				if (lock?.isFile()) return runner;
			}
		}
		return "bun";
	}

	private ancestorDirectories(directory: string): string[] {
		const ancestors: string[] = [];
		let current = directory;
		while (true) {
			ancestors.push(current);
			if (current === ".") break;
			const parent = path.posix.dirname(current);
			current = parent === current ? "." : parent;
		}
		return ancestors;
	}

	private validateStartRequest(input: StartPackageRunRequest): void {
		for (const [field, value, maximum] of [
			["packagePath", input.packagePath, 4_096],
			["scriptName", input.scriptName, 1_024],
			["manifestRevision", input.manifestRevision, 256],
		] as const) {
			if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
				throw new HttpError(400, "invalid_package_run", `${field} is invalid`);
			}
		}
		if (!safePackagePath(input.packagePath)) {
			throw new HttpError(400, "invalid_package_run", "packagePath is invalid");
		}
	}

	private requireRun(repositoryId: string, runId: string): StoredRun {
		const run = this.storedRuns.get(runId);
		if (!run || run.summary.repositoryId !== repositoryId) {
			throw new HttpError(404, "package_run_not_found", "Package run not found");
		}
		return run;
	}

	private async monitorRun(run: StoredRun): Promise<void> {
		const process = run.process;
		if (!process) return;
		const stdout = this.captureStream(run, "stdout", process.stdout);
		const stderr = this.captureStream(run, "stderr", process.stderr);
		let exitCode: number | null = null;
		try {
			exitCode = await process.exited;
		} catch (error) {
			this.appendOutput(
				run,
				"stderr",
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
		await Promise.allSettled([stdout, stderr]);
		this.finishRun(
			run,
			run.stopRequested ? "stopped" : exitCode === 0 ? "succeeded" : "failed",
			exitCode,
		);
	}

	private async captureStream(
		run: StoredRun,
		stream: PackageRunOutputChunk["stream"],
		readable: ReadableStream<Uint8Array> | null,
	): Promise<void> {
		if (!readable) return;
		const reader = readable.getReader();
		const decoder = new TextDecoder("utf-8", { fatal: false });
		try {
			while (true) {
				const result = await reader.read();
				if (result.done) break;
				const text = decoder.decode(result.value, { stream: true });
				if (text) this.appendOutput(run, stream, text);
			}
			const tail = decoder.decode();
			if (tail) this.appendOutput(run, stream, tail);
		} catch (error) {
			if (!run.stopRequested) {
				this.appendOutput(
					run,
					"stderr",
					`Could not read ${stream}: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		} finally {
			reader.releaseLock();
		}
	}

	private appendOutput(
		run: StoredRun,
		stream: PackageRunOutputChunk["stream"],
		text: string,
	): void {
		let sanitized = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replaceAll("\0", "�");
		if (!sanitized) return;
		const encoded = Buffer.from(sanitized);
		if (encoded.byteLength > this.maxOutputBytes) {
			sanitized = encoded.subarray(encoded.byteLength - this.maxOutputBytes).toString("utf8");
			run.summary.outputTruncated = true;
		}
		const chunk: PackageRunOutputChunk = {
			sequence: run.nextSequence,
			stream,
			text: sanitized,
		};
		run.nextSequence += 1;
		run.output.push(chunk);
		run.outputBytes += Buffer.byteLength(sanitized);
		while (run.outputBytes > this.maxOutputBytes && run.output.length > 1) {
			const removed = run.output.shift();
			if (removed) run.outputBytes -= Buffer.byteLength(removed.text);
			run.summary.outputTruncated = true;
		}
		this.emit(run, { type: "output", chunk: structuredClone(chunk) });
	}

	private finishRun(
		run: StoredRun,
		status: Extract<PackageRunSummary["status"], "succeeded" | "failed" | "stopped">,
		exitCode: number | null,
	): void {
		if (!ACTIVE_STATUSES.has(run.summary.status)) return;
		if (run.stopTimer) clearTimeout(run.stopTimer);
		run.stopTimer = null;
		run.summary.status = status;
		run.summary.exitCode = exitCode;
		run.summary.finishedAt = new Date().toISOString();
		run.process = null;
		this.emit(run, { type: "status", run: structuredClone(run.summary) });
		this.prune(run.summary.repositoryId);
	}

	private emit(run: StoredRun, event: Exclude<PackageRunEvent, { type: "snapshot" }>): void {
		for (const listener of this.listeners.get(run.summary.id) ?? []) {
			try {
				listener(event);
			} catch {
				// A disconnected response removes its listener independently.
			}
		}
	}

	private prune(repositoryId: string): void {
		const completed = [...this.storedRuns.values()]
			.filter(
				(run) =>
					run.summary.repositoryId === repositoryId && !ACTIVE_STATUSES.has(run.summary.status),
			)
			.sort((left, right) => right.summary.startedAt.localeCompare(left.summary.startedAt));
		for (const run of completed.slice(this.completedRunsPerRepository)) {
			this.storedRuns.delete(run.summary.id);
			this.listeners.delete(run.summary.id);
		}
	}

	private killRun(run: StoredRun, signal: NodeJS.Signals): void {
		const child = run.process;
		if (!child) return;
		if (process.platform !== "win32" && child.pid > 0) {
			try {
				process.kill(-child.pid, signal);
				return;
			} catch {
				// Fall back to Bun's direct child signal when process groups are unavailable.
			}
		}
		try {
			child.kill(signal);
		} catch {
			// The child may already have exited.
		}
	}
}
