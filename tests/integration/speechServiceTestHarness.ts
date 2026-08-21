import { randomBytes } from "node:crypto";
import { existsSync, type FSWatcher, realpathSync, watch } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const HOST = "127.0.0.1";
const MODEL = "parakeet-tdt-0.6b-v3-int8";
const OUTPUT_LIMIT = 32 * 1024;

interface ProcessRow {
	pid: number;
	parentPid: number;
	command: string;
}

interface SpeechBinaries {
	daemon: string;
	worker: string;
}

interface SpokenFixture {
	bytes: Uint8Array;
	name: string;
}

export interface FileSystemMonitor {
	changes: string[];
	close(): void;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run(command: string[]): Promise<string> {
	const child = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`${command[0]} exited with ${exitCode}: ${stderr.trim()}`);
	}
	return stdout;
}

async function processRows(): Promise<ProcessRow[]> {
	const output = await run(["/bin/ps", "-ww", "-axo", "pid=,ppid=,command="]);
	return output
		.split("\n")
		.map((line) => /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line))
		.filter((match): match is RegExpExecArray => match !== null)
		.map((match) => ({
			pid: Number(match[1]),
			parentPid: Number(match[2]),
			command: match[3] ?? "",
		}));
}

function executablePair(): SpeechBinaries {
	const configured = Bun.env.COUCHSPEECH_INTEGRATION_BIN_DIR;
	const directories: string[] = [];
	if (configured) {
		directories.push(path.resolve(configured));
	} else {
		const installedCli = Bun.which("couchspeech");
		if (installedCli) directories.push(path.dirname(realpathSync(installedCli)));
	}
	for (const directory of directories) {
		const daemon = path.join(directory, "couchspeechd");
		const worker = path.join(directory, "couchspeech-worker");
		if (existsSync(daemon) && existsSync(worker)) return { daemon, worker };
	}
	throw new Error(
		"Standalone CouchSpeech binaries are missing; install CouchSpeech or set " +
			"COUCHSPEECH_INTEGRATION_BIN_DIR to a distribution/libexec directory.",
	);
}

function reserveLoopbackPort(): number {
	const reservation = Bun.serve({
		hostname: HOST,
		port: 0,
		fetch: () => new Response(null, { status: 503 }),
	});
	const port = reservation.port;
	reservation.stop(true);
	if (port === undefined) throw new Error("Bun did not allocate a loopback port");
	return port;
}

function captureOutput(stream: ReadableStream<Uint8Array>, destination: { value: string }): void {
	void (async () => {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				destination.value += decoder.decode(chunk.value, { stream: true });
				if (destination.value.length > OUTPUT_LIMIT) {
					destination.value = destination.value.slice(-OUTPUT_LIMIT);
				}
			}
			destination.value += decoder.decode();
		} finally {
			reader.releaseLock();
		}
	})().catch((error) => {
		destination.value += `\nOutput capture failed: ${String(error)}`;
	});
}

export class SpeechDaemonHarness {
	readonly baseURL: string;
	readonly fixtureDirectory: string;
	readonly monitoredTmpDirectory: string;
	readonly rootDirectory: string;
	readonly token: string;
	readonly workerPath: string;
	private readonly daemon: Bun.Subprocess<"ignore", "pipe", "pipe">;
	private readonly observedWorkerPids = new Set<number>();
	private readonly output = { value: "" };

	private constructor(
		daemon: Bun.Subprocess<"ignore", "pipe", "pipe">,
		paths: {
			baseURL: string;
			fixtureDirectory: string;
			monitoredTmpDirectory: string;
			rootDirectory: string;
			token: string;
			workerPath: string;
		},
	) {
		this.daemon = daemon;
		this.baseURL = paths.baseURL;
		this.fixtureDirectory = paths.fixtureDirectory;
		this.monitoredTmpDirectory = paths.monitoredTmpDirectory;
		this.rootDirectory = paths.rootDirectory;
		this.token = paths.token;
		this.workerPath = paths.workerPath;
		captureOutput(daemon.stdout, this.output);
		captureOutput(daemon.stderr, this.output);
	}

	static async start(): Promise<SpeechDaemonHarness> {
		const binaries = executablePair();
		const rootDirectory = await mkdtemp(path.join(tmpdir(), "couchspeech-service-"));
		const fixtureDirectory = path.join(rootDirectory, "fixtures");
		const monitoredTmpDirectory = path.join(rootDirectory, "daemon-tmp");
		await Promise.all([mkdir(fixtureDirectory), mkdir(monitoredTmpDirectory)]);
		const token = randomBytes(32).toString("base64url");
		const tokenFile = path.join(rootDirectory, "speech-service.token");
		await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
		await chmod(tokenFile, 0o600);
		if (((await stat(tokenFile)).mode & 0o777) !== 0o600) {
			throw new Error("Speech integration token file is not private");
		}
		const port = reserveLoopbackPort();
		const daemon = Bun.spawn(
			[
				binaries.daemon,
				"--host",
				HOST,
				"--port",
				String(port),
				"--token-file",
				tokenFile,
				"--worker",
				binaries.worker,
				"--idle-ttl-seconds",
				"-1",
			],
			{
				env: { ...process.env, TMPDIR: monitoredTmpDirectory },
				stderr: "pipe",
				stdout: "pipe",
			},
		);
		const harness = new SpeechDaemonHarness(daemon, {
			baseURL: `http://${HOST}:${port}`,
			fixtureDirectory,
			monitoredTmpDirectory,
			rootDirectory,
			token,
			workerPath: binaries.worker,
		});
		try {
			await harness.waitForHealth();
			return harness;
		} catch (error) {
			await harness.stop();
			throw error;
		}
	}

	get daemonPid(): number {
		return this.daemon.pid;
	}

	get daemonExitCode(): number | null {
		return this.daemon.exitCode;
	}

	get daemonSignalCode(): NodeJS.Signals | null {
		return this.daemon.signalCode;
	}

	get diagnostics(): string {
		return this.output.value.trim();
	}

	authorizedHeaders(extra: HeadersInit = {}): Headers {
		const headers = new Headers(extra);
		headers.set("Authorization", `Bearer ${this.token}`);
		return headers;
	}

	async workerPids(): Promise<number[]> {
		const rows = await processRows();
		const pids = rows
			.filter((row) => row.parentPid === this.daemon.pid && row.command.includes(this.workerPath))
			.map((row) => row.pid)
			.sort((left, right) => left - right);
		for (const pid of pids) this.observedWorkerPids.add(pid);
		return pids;
	}

	async waitForWorkerCount(count: number, timeoutMilliseconds = 15_000): Promise<number[]> {
		const deadline = performance.now() + timeoutMilliseconds;
		while (performance.now() < deadline) {
			const pids = await this.workerPids();
			if (pids.length === count) return pids;
			await delay(25);
		}
		throw new Error(
			`Expected ${count} speech workers; daemon output:\n${this.diagnostics || "(none)"}`,
		);
	}

	async killWorker(pid: number): Promise<void> {
		const expected = (await processRows()).some(
			(row) =>
				row.pid === pid &&
				row.parentPid === this.daemon.pid &&
				row.command.includes(this.workerPath),
		);
		if (!expected) throw new Error(`Refusing to kill unverified process ${pid}`);
		this.observedWorkerPids.add(pid);
		process.kill(pid, "SIGKILL");
		await this.waitForWorkerCount(0);
	}

	async openFiles(pid: number): Promise<string[]> {
		const output = await run(["/usr/sbin/lsof", "-Fn", "-p", String(pid)]);
		return output
			.split("\n")
			.filter((line) => line.startsWith("n"))
			.map((line) => line.slice(1));
	}

	monitorTemporaryFiles(): FileSystemMonitor {
		const changes: string[] = [];
		const watcher: FSWatcher = watch(
			this.monitoredTmpDirectory,
			{ recursive: true },
			(event, filename) => changes.push(`${event}:${filename ?? "(unknown)"}`),
		);
		return { changes, close: () => watcher.close() };
	}

	async temporaryTree(): Promise<string[]> {
		return listTree(this.monitoredTmpDirectory);
	}

	async stop(): Promise<void> {
		for (const pid of await this.workerPids().catch(() => [])) {
			this.observedWorkerPids.add(pid);
		}
		if (this.daemon.exitCode === null && this.daemon.signalCode === null) {
			this.daemon.kill("SIGTERM");
			const exited = await Promise.race([
				this.daemon.exited.then(() => true),
				delay(2_000).then(() => false),
			]);
			if (!exited && this.daemon.exitCode === null && this.daemon.signalCode === null) {
				this.daemon.kill("SIGKILL");
				await this.daemon.exited;
			}
		}
		const rows = await processRows().catch(() => []);
		for (const pid of this.observedWorkerPids) {
			const row = rows.find((candidate) => candidate.pid === pid);
			if (row?.command.includes(this.workerPath)) process.kill(pid, "SIGKILL");
		}
		await rm(this.rootDirectory, { force: true, recursive: true });
	}

	private async waitForHealth(): Promise<void> {
		const deadline = performance.now() + 15_000;
		while (performance.now() < deadline) {
			if (this.daemon.exitCode !== null || this.daemon.signalCode !== null) {
				throw new Error(
					`Speech daemon exited with ${this.daemon.exitCode ?? this.daemon.signalCode}: ${this.diagnostics}`,
				);
			}
			try {
				const response = await fetch(`${this.baseURL}/health`, {
					signal: AbortSignal.timeout(500),
				});
				const health = (await response.json()) as Record<string, unknown>;
				if (
					response.ok &&
					health.status === "ok" &&
					health.model === MODEL &&
					health.workerState === "stopped"
				) {
					return;
				}
			} catch {
				// The loopback listener may still be starting.
			}
			await delay(50);
		}
		throw new Error(`Speech daemon did not become healthy: ${this.diagnostics}`);
	}
}

export async function spokenFixture(
	directory: string,
	name: string,
	voice: string,
	text: string,
): Promise<SpokenFixture> {
	const aiff = path.join(directory, `${name}.aiff`);
	const wav = path.join(directory, `${name}.wav`);
	await run(["/usr/bin/say", "-v", voice, "-o", aiff, text]);
	await run(["/usr/bin/afconvert", aiff, wav, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"]);
	return { bytes: await readFile(wav), name: `${name}.wav` };
}

export function paddedPcmWav(source: Uint8Array, durationMilliseconds: number): Uint8Array {
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	let sampleRate = 0;
	let data = new Uint8Array();
	for (let offset = 12; offset + 8 <= source.byteLength; ) {
		const id = String.fromCharCode(...source.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		const start = offset + 8;
		if (start + size > source.byteLength) throw new Error("Fixture WAV is truncated");
		if (id === "fmt ") {
			if (
				view.getUint16(start, true) !== 1 ||
				view.getUint16(start + 2, true) !== 1 ||
				view.getUint16(start + 14, true) !== 16
			) {
				throw new Error("Fixture WAV is not mono PCM16");
			}
			sampleRate = view.getUint32(start + 4, true);
		}
		if (id === "data") data = source.slice(start, start + size);
		offset = start + size + (size % 2);
	}
	if (!sampleRate || data.byteLength === 0) throw new Error("Fixture WAV has no PCM data");
	const frameCount = Math.round((durationMilliseconds / 1_000) * sampleRate);
	const dataBytes = frameCount * 2;
	const result = new Uint8Array(44 + dataBytes);
	const resultView = new DataView(result.buffer);
	for (const [offset, text] of [
		[0, "RIFF"],
		[8, "WAVE"],
		[12, "fmt "],
		[36, "data"],
	] as const) {
		for (let index = 0; index < text.length; index += 1) {
			resultView.setUint8(offset + index, text.charCodeAt(index));
		}
	}
	resultView.setUint32(4, result.byteLength - 8, true);
	resultView.setUint32(16, 16, true);
	resultView.setUint16(20, 1, true);
	resultView.setUint16(22, 1, true);
	resultView.setUint32(24, sampleRate, true);
	resultView.setUint32(28, sampleRate * 2, true);
	resultView.setUint16(32, 2, true);
	resultView.setUint16(34, 16, true);
	resultView.setUint32(40, dataBytes, true);
	result.set(data.subarray(0, Math.min(data.length, dataBytes)), 44);
	return result;
}

async function listTree(root: string, relative = ""): Promise<string[]> {
	const entries = await readdir(path.join(root, relative), { withFileTypes: true });
	const result: string[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const child = path.join(relative, entry.name);
		result.push(entry.isDirectory() ? `${child}/` : child);
		if (entry.isDirectory()) result.push(...(await listTree(root, child)));
	}
	return result;
}
