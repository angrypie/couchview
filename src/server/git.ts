import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import { GitError, GitPluginError, simpleGit } from "simple-git";

import type { ChangeKind, DiffHunk, DiffLine, SearchMatch } from "../shared/contracts.ts";

const decoder = new TextDecoder("utf-8", { fatal: false });
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;

export interface GitResult {
	stdout: Uint8Array;
	stdoutTruncated: boolean;
	stderr: string;
	exitCode: number;
}

export interface RunGitOptions {
	allowExitCodes?: number[];
	binaryOutput?: boolean;
	maxOutputBytes?: number;
	truncateOutput?: boolean;
	timeoutMs?: number;
	env?: Record<string, string | undefined>;
}

export type GitFailureKind =
	| "exit"
	| "timeout"
	| "spawn"
	| "capture"
	| "output_limit"
	| "empty_output";

interface ReconciledGitOutput {
	output: Uint8Array;
	recovered: boolean;
	totalBytes: number;
	truncated: boolean;
}

/** @internal Exported so the missing-stream regression can be tested directly. */
export function reconcileGitStdout(
	capturedOutput: Uint8Array,
	capturedBytes: number,
	bufferedOutput: string,
	maximumBytes: number,
): ReconciledGitOutput {
	if (capturedBytes > 0 || bufferedOutput.length === 0) {
		return {
			output: capturedOutput,
			recovered: false,
			totalBytes: capturedBytes,
			truncated: capturedBytes > maximumBytes,
		};
	}

	const recovered = Buffer.from(bufferedOutput, "utf8");
	return {
		output: Uint8Array.from(recovered.subarray(0, maximumBytes)),
		recovered: true,
		totalBytes: recovered.byteLength,
		truncated: recovered.byteLength > maximumBytes,
	};
}

function operationFromArgs(args: readonly string[]): string {
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index] ?? "";
		if (["-c", "-C", "--git-dir", "--work-tree", "--namespace"].includes(argument)) {
			index += 1;
			continue;
		}
		if (argument.startsWith("-")) continue;
		return argument;
	}
	return "command";
}

export class GitCommandError extends Error {
	readonly args: readonly string[];
	readonly exitCode: number;
	readonly kind: GitFailureKind;
	readonly operation: string;
	readonly stderr: string;
	readonly timeoutMs: number | null;

	constructor(
		args: readonly string[],
		exitCode: number,
		stderr: string,
		kind: GitFailureKind = "exit",
		timeoutMs: number | null = null,
	) {
		const operation = operationFromArgs(args);
		const fallback =
			kind === "timeout"
				? `git ${operation} timed out after ${timeoutMs ?? "the configured timeout"}ms`
				: `git ${operation} exited with ${exitCode}`;
		super(stderr.trim() || fallback);
		this.name = "GitCommandError";
		this.args = args;
		this.exitCode = exitCode;
		this.kind = kind;
		this.operation = operation;
		this.stderr = stderr;
		this.timeoutMs = timeoutMs;
	}
}

function gitEnvironment(
	overrides: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
	const environment: Record<string, string | undefined> = { ...globalThis.process.env };
	for (const variable of [
		"EDITOR",
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_COMMON_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_NAMESPACE",
		"GIT_CEILING_DIRECTORIES",
		"GIT_DISCOVERY_ACROSS_FILESYSTEM",
		"GIT_PREFIX",
		"GIT_CONFIG_PARAMETERS",
		"GIT_CONFIG_COUNT",
		"GIT_CONFIG_GLOBAL",
		"GIT_CONFIG_SYSTEM",
		"GIT_EDITOR",
		"GIT_EXEC_PATH",
		"GIT_EXTERNAL_DIFF",
		"GIT_GLOB_PATHSPECS",
		"GIT_NOGLOB_PATHSPECS",
		"GIT_ICASE_PATHSPECS",
		"GIT_ASKPASS",
		"GIT_PAGER",
		"GIT_PROXY_COMMAND",
		"GIT_SEQUENCE_EDITOR",
		"GIT_SSH",
		"GIT_SSH_COMMAND",
		"GIT_TEMPLATE_DIR",
		"PAGER",
		"PREFIX",
		"SSH_ASKPASS",
	]) {
		delete environment[variable];
	}
	Object.assign(environment, overrides);
	Object.assign(environment, {
		GIT_LITERAL_PATHSPECS: "1",
		GIT_TERMINAL_PROMPT: "0",
		LC_ALL: "C",
		LANG: "C",
	});
	return environment;
}

export async function runGit(
	root: string,
	args: readonly string[],
	options: RunGitOptions = {},
): Promise<GitResult> {
	const maximumBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	const timeoutMs = options.timeoutMs ?? 15_000;
	const allowedExitCodes = options.allowExitCodes ?? [0];
	const abortController = new AbortController();
	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	let stdoutBytes = 0;
	let stderrBytes = 0;
	let stdoutTruncated = false;
	let limitExceeded: "stdout" | "stderr" | null = null;
	let exitCode = -1;
	let bufferedStdout = "";
	let outputSettled: Promise<void> = Promise.resolve();

	const capture = (
		target: Buffer[],
		chunk: unknown,
		maximum: number,
		stream: "stdout" | "stderr",
	) => {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
		const remaining = Math.max(0, maximum - currentBytes);
		if (remaining > 0) target.push(buffer.subarray(0, remaining));
		const nextBytes = currentBytes + buffer.byteLength;
		if (stream === "stdout") {
			stdoutBytes = nextBytes;
			stdoutTruncated ||= nextBytes > maximum;
		} else {
			stderrBytes = nextBytes;
		}
		if (nextBytes > maximum && !limitExceeded) {
			limitExceeded = stream;
			abortController.abort();
		}
	};

	try {
		const git = simpleGit({
			baseDir: root,
			binary: "git",
			maxConcurrentProcesses: 1,
			trimmed: false,
			abort: abortController.signal,
			timeout: { block: timeoutMs },
			unsafe: {
				// Couchview hard-codes `core.fsmonitor=false` for deterministic status
				// snapshots; no user-controlled executable is accepted here.
				allowUnsafeFsMonitor: true,
			},
			errors(error, result) {
				exitCode = result.exitCode;
				if (allowedExitCodes.includes(result.exitCode) && !(error instanceof GitPluginError)) {
					return undefined;
				}
				if (error instanceof GitPluginError) return error;
				const stderr = decoder.decode(Buffer.concat(result.stdErr).subarray(0, MAX_STDERR_BYTES));
				return new GitCommandError(
					args,
					result.exitCode,
					stderr || (error instanceof Error ? error.message : ""),
					result.exitCode < 0 ? "spawn" : "exit",
				);
			},
		});
		git.env(gitEnvironment(options.env));
		git.outputHandler((_command, stdout, stderr) => {
			stdout.on("data", (chunk) => {
				capture(stdoutChunks, chunk, maximumBytes, "stdout");
			});
			stderr.on("data", (chunk) => {
				capture(stderrChunks, chunk, MAX_STDERR_BYTES, "stderr");
			});
			// Bun can report the child process as closed before its compatibility
			// streams have delivered every data event. Wait for the streams as well
			// as simple-git's task promise before finalizing the captured output.
			outputSettled = Promise.all([
				finished(stdout, { cleanup: true }),
				finished(stderr, { cleanup: true }),
			]).then(
				() => undefined,
				() => undefined,
			);
		});
		bufferedStdout = await git.raw([...args]);
		await outputSettled;
		if (exitCode < 0) exitCode = 0;
	} catch (error) {
		const stderr = `${decoder.decode(Buffer.concat(stderrChunks))}${
			stderrBytes > MAX_STDERR_BYTES ? "\n[stderr truncated]" : ""
		}`;
		if (limitExceeded === "stdout" && options.truncateOutput) {
			return {
				stdout: Uint8Array.from(Buffer.concat(stdoutChunks)),
				stdoutTruncated: true,
				stderr,
				exitCode: 0,
			};
		}
		if (limitExceeded) {
			const description =
				limitExceeded === "stderr"
					? "Git stderr exceeded the 1 MiB safety limit."
					: `Git stdout exceeded the ${maximumBytes}-byte safety limit.`;
			throw new GitCommandError(args, -1, description, "output_limit");
		}
		if (error instanceof GitCommandError) throw error;
		if (error instanceof GitPluginError && error.plugin === "timeout") {
			throw new GitCommandError(args, -1, stderr, "timeout", timeoutMs);
		}
		const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
		throw new GitCommandError(
			args,
			exitCode,
			message,
			error instanceof GitError && exitCode >= 0 ? "exit" : "spawn",
		);
	}

	const reconciled = reconcileGitStdout(
		Uint8Array.from(Buffer.concat(stdoutChunks)),
		stdoutBytes,
		bufferedStdout,
		maximumBytes,
	);
	if (reconciled.recovered && options.binaryOutput) {
		throw new GitCommandError(
			args,
			exitCode,
			"Git returned binary data, but Couchview could not capture its raw byte stream.",
			"capture",
		);
	}
	if (reconciled.recovered && reconciled.truncated && !options.truncateOutput) {
		throw new GitCommandError(
			args,
			-1,
			`Git stdout exceeded the ${maximumBytes}-byte safety limit.`,
			"output_limit",
		);
	}

	return {
		stdout: reconciled.output,
		stdoutTruncated: stdoutTruncated || reconciled.truncated,
		stderr: `${decoder.decode(Buffer.concat(stderrChunks))}${
			stderrBytes > MAX_STDERR_BYTES ? "\n[stderr truncated]" : ""
		}`,
		exitCode,
	};
}

export function decodeGitOutput(output: Uint8Array): string {
	return decoder.decode(output);
}

export function sha256(...values: Array<string | Uint8Array>): string {
	const hash = createHash("sha256");
	for (const value of values) hash.update(value);
	return hash.digest("hex");
}

export interface ParsedStatusEntry {
	path: string;
	previousPath: string | null;
	kind: ChangeKind;
	indexStatus: string;
	worktreeStatus: string;
	staged: boolean;
	unstaged: boolean;
	conflicted: boolean;
}

export interface ParsedStatus {
	branch: string | null;
	head: string | null;
	unborn: boolean;
	entries: ParsedStatusEntry[];
}

function splitPrefix(record: string, fieldCount: number): [string[], string] {
	const fields: string[] = [];
	let offset = 0;
	for (let index = 0; index < fieldCount; index += 1) {
		const separator = record.indexOf(" ", offset);
		if (separator < 0) return [fields, ""];
		fields.push(record.slice(offset, separator));
		offset = separator + 1;
	}
	return [fields, record.slice(offset)];
}

function kindFromStatus(indexStatus: string, worktreeStatus: string): ChangeKind {
	const codes = `${indexStatus}${worktreeStatus}`;
	if (codes.includes("U") || codes === "AA" || codes === "DD") return "unmerged";
	if (codes.includes("R")) return "renamed";
	if (codes.includes("C")) return "copied";
	if (codes.includes("A")) return "added";
	if (codes.includes("D")) return "deleted";
	if (codes.includes("T")) return "type-changed";
	if (codes.includes("M")) return "modified";
	return "unknown";
}

export function parsePorcelainV2(output: Uint8Array | string): ParsedStatus {
	const text = typeof output === "string" ? output : decodeGitOutput(output);
	const records = text.split("\0");
	const entries: ParsedStatusEntry[] = [];
	let branch: string | null = null;
	let head: string | null = null;
	let unborn = false;

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!record) continue;
		if (record.startsWith("# branch.head ")) {
			const value = record.slice("# branch.head ".length);
			branch = value === "(detached)" ? null : value;
			continue;
		}
		if (record.startsWith("# branch.oid ")) {
			const value = record.slice("# branch.oid ".length);
			unborn = value === "(initial)";
			head = unborn ? null : value;
			continue;
		}
		if (record.startsWith("? ")) {
			entries.push({
				path: record.slice(2),
				previousPath: null,
				kind: "untracked",
				indexStatus: ".",
				worktreeStatus: "?",
				staged: false,
				unstaged: true,
				conflicted: false,
			});
			continue;
		}
		if (record.startsWith("! ")) continue;

		if (record.startsWith("1 ")) {
			const [fields, path] = splitPrefix(record, 8);
			const xy = fields[1] ?? "..";
			const indexStatus = xy[0] ?? ".";
			const worktreeStatus = xy[1] ?? ".";
			entries.push({
				path,
				previousPath: null,
				kind: kindFromStatus(indexStatus, worktreeStatus),
				indexStatus,
				worktreeStatus,
				staged: indexStatus !== ".",
				unstaged: worktreeStatus !== ".",
				conflicted: false,
			});
			continue;
		}

		if (record.startsWith("2 ")) {
			const [fields, path] = splitPrefix(record, 9);
			const previousPath = records[index + 1] ?? null;
			index += 1;
			const xy = fields[1] ?? "..";
			const indexStatus = xy[0] ?? ".";
			const worktreeStatus = xy[1] ?? ".";
			entries.push({
				path,
				previousPath,
				kind: kindFromStatus(indexStatus, worktreeStatus),
				indexStatus,
				worktreeStatus,
				staged: indexStatus !== ".",
				unstaged: worktreeStatus !== ".",
				conflicted: false,
			});
			continue;
		}

		if (record.startsWith("u ")) {
			const [fields, path] = splitPrefix(record, 10);
			const xy = fields[1] ?? "UU";
			entries.push({
				path,
				previousPath: null,
				kind: "unmerged",
				indexStatus: xy[0] ?? "U",
				worktreeStatus: xy[1] ?? "U",
				staged: true,
				unstaged: true,
				conflicted: true,
			});
		}
	}

	const mergedEntries = new Map<string, ParsedStatusEntry>();
	for (const entry of entries) {
		const existing = mergedEntries.get(entry.path);
		if (!existing) {
			mergedEntries.set(entry.path, entry);
			continue;
		}
		if (existing.kind === "untracked" || entry.kind === "untracked") {
			const tracked = existing.kind === "untracked" ? entry : existing;
			mergedEntries.set(entry.path, {
				...tracked,
				kind: tracked.kind === "deleted" ? "modified" : tracked.kind,
				worktreeStatus: "?",
				staged: tracked.staged,
				unstaged: true,
			});
			continue;
		}
		mergedEntries.set(entry.path, {
			...existing,
			staged: existing.staged || entry.staged,
			unstaged: existing.unstaged || entry.unstaged,
			conflicted: existing.conflicted || entry.conflicted,
		});
	}

	return { branch, head, unborn, entries: [...mergedEntries.values()] };
}

export interface NumstatEntry {
	path: string;
	previousPath: string | null;
	additions: number | null;
	deletions: number | null;
	binary: boolean;
}

/** Parse `git diff --numstat -z`, including its three-record rename format. */
export function parseNumstat(output: Uint8Array | string): NumstatEntry[] {
	const text = typeof output === "string" ? output : decodeGitOutput(output);
	const records = text.split("\0");
	const entries: NumstatEntry[] = [];

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!record) continue;
		const additionsEnd = record.indexOf("\t");
		const deletionsEnd = additionsEnd < 0 ? -1 : record.indexOf("\t", additionsEnd + 1);
		if (additionsEnd < 0 || deletionsEnd < 0) continue;

		const additionsField = record.slice(0, additionsEnd);
		const deletionsField = record.slice(additionsEnd + 1, deletionsEnd);
		const inlinePath = record.slice(deletionsEnd + 1);
		const previousPath = inlinePath ? null : records[index + 1] || null;
		const path = inlinePath || records[index + 2] || "";
		if (!inlinePath) index += 2;
		if (!path) continue;

		const additions = /^\d+$/.test(additionsField) ? Number(additionsField) : null;
		const deletions = /^\d+$/.test(deletionsField) ? Number(deletionsField) : null;
		entries.push({
			path,
			previousPath,
			additions,
			deletions,
			binary: additions === null && deletions === null,
		});
	}

	return entries;
}

export interface ParsedDiff {
	header: string[];
	hunks: DiffHunk[];
	additions: number;
	deletions: number;
	binary: boolean;
	truncated: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(
	patch: string,
	maximumRows = Number.POSITIVE_INFINITY,
): ParsedDiff {
	const header: string[] = [];
	const hunks: DiffHunk[] = [];
	let current: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;
	let additions = 0;
	let deletions = 0;
	let binary = false;
	let sawFileHeader = false;
	let renderedRows = 0;
	let truncated = false;
	let offset = 0;

	while (offset <= patch.length) {
		const newline = patch.indexOf("\n", offset);
		const end = newline < 0 ? patch.length : newline;
		const line = patch.slice(offset, end);
		offset = newline < 0 ? patch.length + 1 : newline + 1;
		if (end === patch.length && line === "") break;
		if (line.startsWith("diff --git ")) {
			if (sawFileHeader) break;
			sawFileHeader = true;
			current = null;
			header.push(line);
			continue;
		}
		if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;

		const match = HUNK_HEADER.exec(line);
		if (match) {
			oldLine = Number(match[1]);
			newLine = Number(match[3]);
			current = {
				id: `hunk-${hunks.length + 1}`,
				header: line,
				oldStart: oldLine,
				oldLines: Number(match[2] ?? 1),
				newStart: newLine,
				newLines: Number(match[4] ?? 1),
				lines: [],
			};
			hunks.push(current);
			continue;
		}

		if (!current) {
			header.push(line);
			continue;
		}

		if (renderedRows >= maximumRows) {
			truncated = true;
			break;
		}

		let diffLine: DiffLine;
		const id = `${current.id}-line-${current.lines.length + 1}`;
		if (line.startsWith("+")) {
			diffLine = {
				id,
				kind: "addition",
				text: line.slice(1),
				oldLine: null,
				newLine,
				noNewline: false,
			};
			newLine += 1;
			additions += 1;
		} else if (line.startsWith("-")) {
			diffLine = {
				id,
				kind: "deletion",
				text: line.slice(1),
				oldLine,
				newLine: null,
				noNewline: false,
			};
			oldLine += 1;
			deletions += 1;
		} else if (line.startsWith(" ")) {
			diffLine = {
				id,
				kind: "context",
				text: line.slice(1),
				oldLine,
				newLine,
				noNewline: false,
			};
			oldLine += 1;
			newLine += 1;
		} else {
			if (line === "\\ No newline at end of file") {
				const previous = current.lines.at(-1);
				if (previous) previous.noNewline = true;
			}
			diffLine = {
				id,
				kind: "metadata",
				text: line,
				oldLine: null,
				newLine: null,
				noNewline: false,
			};
		}
		current.lines.push(diffLine);
		renderedRows += 1;
	}

	return { header, hunks, additions, deletions, binary, truncated };
}

function findByte(bytes: Uint8Array, target: number, start: number): number {
	for (let index = start; index < bytes.length; index += 1) {
		if (bytes[index] === target) return index;
	}
	return -1;
}

export function parseGrepOutput(output: Uint8Array): SearchMatch[] {
	const matches: SearchMatch[] = [];
	let offset = 0;
	while (offset < output.length) {
		const pathEnd = findByte(output, 0, offset);
		if (pathEnd < 0) break;
		const lineEnd = findByte(output, 0, pathEnd + 1);
		if (lineEnd < 0) break;
		const columnEnd = findByte(output, 0, lineEnd + 1);
		if (columnEnd < 0) break;
		let previewEnd = findByte(output, 10, columnEnd + 1);
		if (previewEnd < 0) previewEnd = output.length;
		const path = decoder.decode(output.subarray(offset, pathEnd));
		const line = Number(decoder.decode(output.subarray(pathEnd + 1, lineEnd)));
		const column = Number(decoder.decode(output.subarray(lineEnd + 1, columnEnd)));
		let preview = decoder.decode(output.subarray(columnEnd + 1, previewEnd));
		if (preview.endsWith("\r")) preview = preview.slice(0, -1);
		if (path && Number.isSafeInteger(line) && Number.isSafeInteger(column)) {
			matches.push({ path, line, column, preview });
		}
		offset = previewEnd + 1;
	}
	return matches;
}
