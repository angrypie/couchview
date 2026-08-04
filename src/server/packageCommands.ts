import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type {
	PackageRunEvent,
	PackageRunner,
	PackageRunSnapshot,
	PackageRunSummary,
	PackageScriptsPackage,
	PackageScriptsResponse,
	PackageScriptWarning,
	StartPackageRunRequest,
} from "../shared/contracts.ts";
import { HttpError } from "./errors.ts";
import { decodeGitOutput, runGit, sha256 } from "./git/index.ts";
import {
	RepositoryCommandRunner,
	type RepositoryCommandSummary,
	type SpawnRepositoryCommand,
} from "./repositoryCommandRunner.ts";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const RUN_OWNER = "packages";

interface ParsedPackage {
	contract: PackageScriptsPackage;
	packageManager: PackageRunner | null;
}

interface PackageCommandServiceOptions {
	maxConcurrentRuns?: number;
	maxOutputBytes?: number;
	completedRunsPerRepository?: number;
	resolveExecutable?: (runner: PackageRunner) => string | null;
	spawn?: SpawnRepositoryCommand;
	commandRunner?: RepositoryCommandRunner;
}

interface PackageRunMetadata {
	repositoryId: string;
	packagePath: string;
	packageName: string | null;
	directory: string;
	scriptName: string;
	command: string;
	runner: PackageRunner;
	invocation: string;
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

export class PackageCommandService {
	private readonly resolveExecutable: (runner: PackageRunner) => string | null;
	private readonly commandRunner: RepositoryCommandRunner;
	private readonly ownsCommandRunner: boolean;
	private readonly runMetadata = new Map<string, PackageRunMetadata>();

	constructor(options: PackageCommandServiceOptions = {}) {
		this.resolveExecutable =
			options.resolveExecutable ??
			((runner) => (runner === "bun" ? process.execPath : Bun.which(runner)));
		this.ownsCommandRunner = !options.commandRunner;
		this.commandRunner =
			options.commandRunner ??
			new RepositoryCommandRunner({
				maxConcurrentRuns: options.maxConcurrentRuns,
				maxOutputBytes: options.maxOutputBytes,
				completedRunsPerOwner: options.completedRunsPerRepository,
				spawn: options.spawn,
			});
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
		const commands = this.commandRunner.runs(RUN_OWNER, repositoryId);
		const retainedIds = new Set(commands.map((command) => command.id));
		for (const [runId, metadata] of this.runMetadata) {
			if (metadata.repositoryId === repositoryId && !retainedIds.has(runId)) {
				this.runMetadata.delete(runId);
			}
		}
		return commands.map((command) => this.toPackageRun(command));
	}

	async start(
		repositoryId: string,
		root: string,
		input: StartPackageRunRequest,
	): Promise<PackageRunSummary> {
		this.validateStartRequest(input);
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
		const command = [selectedPackage.runner, "run", script.name] as const;
		const executable = this.resolveExecutable(selectedPackage.runner);
		const workingDirectory =
			selectedPackage.directory === "."
				? root
				: path.join(root, ...selectedPackage.directory.split("/"));
		let started: RepositoryCommandSummary;
		try {
			started = this.commandRunner.start({
				owner: RUN_OWNER,
				repositoryId,
				key: `${selectedPackage.packagePath}\0${script.name}`,
				argv: [executable ?? selectedPackage.runner, "run", script.name],
				cwd: workingDirectory,
				...(executable
					? {}
					: {
							startError: `Could not find ${selectedPackage.runner} on the Couchview server PATH.`,
						}),
			});
		} catch (error) {
			if (error instanceof HttpError && error.code === "command_run_limit") {
				throw new HttpError(429, "package_run_limit", error.message);
			}
			if (error instanceof HttpError && error.code === "command_already_running") {
				throw new HttpError(
					409,
					"package_script_running",
					"This package script is already running",
				);
			}
			throw error;
		}
		this.runMetadata.set(started.id, {
			repositoryId,
			packagePath: selectedPackage.packagePath,
			packageName: selectedPackage.name,
			directory: selectedPackage.directory,
			scriptName: script.name,
			command: script.command,
			runner: selectedPackage.runner,
			invocation: command.map(invocationArgument).join(" "),
		});
		return this.toPackageRun(started);
	}

	stop(repositoryId: string, runId: string): PackageRunSummary {
		this.requireMetadata(repositoryId, runId);
		return this.toPackageRun(this.commandRunner.stop(RUN_OWNER, repositoryId, runId));
	}

	subscribe(
		repositoryId: string,
		runId: string,
		listener: RunListener,
	): { snapshot: PackageRunSnapshot; unsubscribe: () => void } {
		this.requireMetadata(repositoryId, runId);
		const subscription = this.commandRunner.subscribe(RUN_OWNER, repositoryId, runId, (event) => {
			if (event.type === "output") listener({ type: "output", chunk: event.chunk });
			else listener({ type: "status", run: this.toPackageRun(event.run) });
		});
		return {
			snapshot: {
				run: this.toPackageRun(subscription.snapshot.run),
				output: subscription.snapshot.output,
			},
			unsubscribe: subscription.unsubscribe,
		};
	}

	stopRepository(repositoryId: string): void {
		this.commandRunner.stopOwnerRepository(RUN_OWNER, repositoryId);
	}

	close(): void {
		for (const metadata of this.runMetadata.values()) {
			this.commandRunner.stopOwnerRepository(RUN_OWNER, metadata.repositoryId);
		}
		if (this.ownsCommandRunner) this.commandRunner.close();
		this.runMetadata.clear();
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

	private requireMetadata(repositoryId: string, runId: string): PackageRunMetadata {
		const metadata = this.runMetadata.get(runId);
		if (!metadata || metadata.repositoryId !== repositoryId) {
			throw new HttpError(404, "package_run_not_found", "Package run not found");
		}
		return metadata;
	}

	private toPackageRun(command: RepositoryCommandSummary): PackageRunSummary {
		const metadata = this.requireMetadata(command.repositoryId, command.id);
		return {
			id: command.id,
			repositoryId: command.repositoryId,
			packagePath: metadata.packagePath,
			packageName: metadata.packageName,
			directory: metadata.directory,
			scriptName: metadata.scriptName,
			command: metadata.command,
			runner: metadata.runner,
			invocation: metadata.invocation,
			status: command.status === "finalizing" ? "running" : command.status,
			exitCode: command.exitCode,
			startedAt: command.startedAt,
			finishedAt: command.finishedAt,
			outputTruncated: command.outputTruncated,
		};
	}
}
