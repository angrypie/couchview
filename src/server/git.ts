import { createHash } from "node:crypto";
import { execFile } from "node:child_process";

import type {
  ChangeKind,
  DiffHunk,
  DiffLine,
  SearchMatch,
} from "../shared/contracts.ts";

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
  input?: string | Uint8Array;
  maxOutputBytes?: number;
  truncateOutput?: boolean;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stderr: string;

  constructor(args: readonly string[], exitCode: number, stderr: string) {
    super(stderr.trim() || `git ${args[0] ?? "command"} exited with ${exitCode}`);
    this.name = "GitCommandError";
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

function gitEnvironment(
  overrides: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = { ...globalThis.process.env };
  for (const variable of [
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
    "GIT_GLOB_PATHSPECS",
    "GIT_NOGLOB_PATHSPECS",
    "GIT_ICASE_PATHSPECS",
  ]) {
    delete environment[variable];
  }
  Object.assign(environment, overrides);
  Object.assign(environment, {
    GIT_LITERAL_PATHSPECS: "1",
    GIT_PAGER: "cat",
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
  const input = options.input;
  const subprocessBufferBytes = Math.max(maximumBytes, MAX_STDERR_BYTES) + 1;

  // Use Node's buffered child-process path to avoid transient empty reads from
  // Bun's streaming subprocess capture while preserving byte-for-byte output.
  return new Promise<GitResult>((resolve, reject) => {
    const child = execFile(
      "git",
      ["--literal-pathspecs", ...args],
      {
        cwd: root,
        env: gitEnvironment(options.env),
        encoding: "buffer",
        maxBuffer: subprocessBufferBytes,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, rawStdout, rawStderr) => {
        const stdout = Buffer.from(rawStdout);
        const rawErrorCode = error?.code;
        const bufferExceeded = rawErrorCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        const stdoutBufferExceeded =
          bufferExceeded && /stdout/i.test(error?.message ?? "");
        const stderrBufferExceeded =
          bufferExceeded && /stderr/i.test(error?.message ?? "");
        const stdoutTruncated = stdout.byteLength > maximumBytes || stdoutBufferExceeded;
        const stderrTruncated =
          rawStderr.byteLength > MAX_STDERR_BYTES || stderrBufferExceeded;
        const stderr = `${decoder.decode(rawStderr.subarray(0, MAX_STDERR_BYTES))}${
          stderrTruncated ? "\n[stderr truncated]" : ""
        }`;

        if (error?.killed && !bufferExceeded) {
          reject(new Error(`git command timed out after ${timeoutMs}ms`));
          return;
        }
        if (stderrBufferExceeded) {
          reject(new Error("git command stderr exceeded the safety limit"));
          return;
        }
        if (stdoutTruncated && !options.truncateOutput) {
          reject(new Error("git command output exceeded the safety limit"));
          return;
        }
        if (error && typeof rawErrorCode !== "number" && !stdoutBufferExceeded) {
          reject(error);
          return;
        }

        const exitCode = typeof rawErrorCode === "number" ? rawErrorCode : 0;
        if (!(options.allowExitCodes ?? [0]).includes(exitCode)) {
          reject(new GitCommandError(args, exitCode, stderr));
          return;
        }
        resolve({
          stdout: Uint8Array.from(stdout.subarray(0, maximumBytes)),
          stdoutTruncated,
          stderr,
          exitCode,
        });
      },
    );

    // Git can close stdin before Node finishes writing when a command fails.
    // Its exit code and stderr carry the useful error in that case.
    child.stdin?.on("error", () => undefined);
    if (input === undefined) child.stdin?.end();
    else child.stdin?.end(typeof input === "string" ? input : Buffer.from(input));
  });
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
