import { dlopen, ptr } from "bun:ffi";

export interface ProcessRow {
	command: string;
	pid: number;
	parentPid: number;
}

export interface ProcessUsage {
	command: string;
	cpuTimeNanoseconds: bigint;
	cycles: bigint;
	energyNanojoules: bigint;
	instructions: bigint;
	interruptWakeups: bigint;
	lifetimeMaxPhysicalFootprintBytes: bigint;
	packageIdleWakeups: bigint;
	physicalFootprintBytes: bigint;
	pid: number;
}

export interface ProcessTreeSnapshot {
	capturedAtNanoseconds: number;
	processes: Map<number, ProcessUsage>;
	rootPid: number;
}

export interface ProcessUsageDelta {
	averageCpuPercent: number;
	averagePowerWatts: number;
	cpuTimeMs: number;
	cycles: number;
	energyJoules: number;
	instructions: number;
	interruptWakeups: number;
	lifetimeMaxPhysicalFootprintMB: number;
	lostPids: number[];
	packageIdleWakeups: number;
	physicalFootprintMB: number;
	processes: Array<{
		command: string;
		cpuTimeMs: number;
		energyJoules: number;
		physicalFootprintMB: number;
		pid: number;
	}>;
	wallTimeMs: number;
}

export interface ProcessMetricSelfTest {
	durationMs: number;
	passed: boolean;
	thresholds: {
		minimumAverageCpuPercent: number;
		minimumCpuTimeMs: number;
		minimumEnergyJoules: number;
	};
	usage: ProcessUsageDelta;
}

interface LibSystemApi {
	mach_absolute_time(): bigint;
	mach_timebase_info(buffer: unknown): number;
	proc_pid_rusage(pid: number, flavor: number, buffer: unknown): number;
}

const RUSAGE_INFO_V6 = 6;
const RUSAGE_BUFFER_BYTES = 512;
const OFFSETS = {
	userTime: 16,
	systemTime: 24,
	packageIdleWakeups: 32,
	interruptWakeups: 40,
	physicalFootprint: 72,
	instructions: 248,
	cycles: 256,
	energyNanojoules: 336,
	lifetimeMaxPhysicalFootprint: 240,
} as const;

let libSystemApi: LibSystemApi | null = null;
let timebase: { denominator: bigint; numerator: bigint } | null = null;

function macosApi(): LibSystemApi {
	if (process.platform !== "darwin") {
		throw new Error("Process energy metrics are available only on macOS.");
	}
	if (libSystemApi !== null) return libSystemApi;
	const library = dlopen("/usr/lib/libSystem.B.dylib", {
		mach_absolute_time: { args: [], returns: "u64" },
		mach_timebase_info: { args: ["ptr"], returns: "i32" },
		proc_pid_rusage: { args: ["i32", "i32", "ptr"], returns: "i32" },
	} as unknown as Parameters<typeof dlopen>[1]);
	libSystemApi = library.symbols as unknown as LibSystemApi;
	return libSystemApi;
}

function machTimebase(): { denominator: bigint; numerator: bigint } {
	if (timebase !== null) return timebase;
	const buffer = new Uint8Array(8);
	const result = macosApi().mach_timebase_info(ptr(buffer));
	if (result !== 0) throw new Error(`mach_timebase_info failed with code ${result}.`);
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	timebase = {
		numerator: BigInt(view.getUint32(0, true)),
		denominator: BigInt(view.getUint32(4, true)),
	};
	return timebase;
}

function absoluteTimeToNanoseconds(value: bigint): bigint {
	const { denominator, numerator } = machTimebase();
	return (value * numerator) / denominator;
}

function parseProcessRows(output: string): ProcessRow[] {
	return output.split("\n").flatMap((line): ProcessRow[] => {
		const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
		if (!match?.[1] || !match[2] || !match[3]) return [];
		return [
			{
				pid: Number(match[1]),
				parentPid: Number(match[2]),
				command: match[3],
			},
		];
	});
}

async function readProcessRows(): Promise<ProcessRow[]> {
	const child = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,comm="], {
		stderr: "pipe",
		stdout: "pipe",
	});
	const stdout = new TextDecoder().decode(child.stdout);
	const stderr = new TextDecoder().decode(child.stderr);
	if (!child.success) throw new Error(`ps failed with code ${child.exitCode}: ${stderr.trim()}`);
	return parseProcessRows(stdout);
}

export function processTreeFromRows(rows: readonly ProcessRow[], rootPid: number): number[] {
	const selected = new Set<number>([rootPid]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const row of rows) {
			if (selected.has(row.pid) || !selected.has(row.parentPid)) continue;
			selected.add(row.pid);
			changed = true;
		}
	}
	return [...selected].sort((left, right) => left - right);
}

function readProcessUsage(row: Pick<ProcessRow, "command" | "pid">): ProcessUsage | null {
	const buffer = new Uint8Array(RUSAGE_BUFFER_BYTES);
	const result = macosApi().proc_pid_rusage(row.pid, RUSAGE_INFO_V6, ptr(buffer));
	if (result !== 0) return null;
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const read = (offset: number) => view.getBigUint64(offset, true);
	return {
		command: row.command,
		cpuTimeNanoseconds: absoluteTimeToNanoseconds(
			read(OFFSETS.userTime) + read(OFFSETS.systemTime),
		),
		cycles: read(OFFSETS.cycles),
		energyNanojoules: read(OFFSETS.energyNanojoules),
		instructions: read(OFFSETS.instructions),
		interruptWakeups: read(OFFSETS.interruptWakeups),
		lifetimeMaxPhysicalFootprintBytes: read(OFFSETS.lifetimeMaxPhysicalFootprint),
		packageIdleWakeups: read(OFFSETS.packageIdleWakeups),
		physicalFootprintBytes: read(OFFSETS.physicalFootprint),
		pid: row.pid,
	};
}

export async function captureProcessTree(rootPid: number): Promise<ProcessTreeSnapshot> {
	const rows = await readProcessRows();
	const rowByPid = new Map(rows.map((row) => [row.pid, row]));
	if (!rowByPid.has(rootPid)) throw new Error(`Process ${rootPid} is not running.`);
	return captureKnownProcesses(
		processTreeFromRows(rows, rootPid).flatMap((pid) => {
			const row = rowByPid.get(pid);
			return row ? [row] : [];
		}),
		rootPid,
	);
}

/**
 * Capture an explicitly identified owned process set without enumerating the
 * operating system process table. Browser benchmarks can obtain this set from
 * Chromium's SystemInfo domain when process-list access is unavailable.
 */
export function captureKnownProcesses(
	rows: readonly Pick<ProcessRow, "command" | "pid">[],
	rootPid: number,
): ProcessTreeSnapshot {
	const processes = new Map<number, ProcessUsage>();
	for (const row of rows) {
		const usage = readProcessUsage(row);
		if (usage) processes.set(row.pid, usage);
	}
	if (!processes.has(rootPid)) throw new Error(`Process ${rootPid} is not running.`);
	return {
		capturedAtNanoseconds: Number(absoluteTimeToNanoseconds(macosApi().mach_absolute_time())),
		processes,
		rootPid,
	};
}

function positiveDelta(after: bigint, before: bigint): bigint {
	return after >= before ? after - before : 0n;
}

export function diffProcessTreeUsage(
	before: ProcessTreeSnapshot,
	after: ProcessTreeSnapshot,
): ProcessUsageDelta {
	if (before.rootPid !== after.rootPid) {
		throw new Error("Cannot compare snapshots from different process trees.");
	}
	const wallTimeNanoseconds = after.capturedAtNanoseconds - before.capturedAtNanoseconds;
	if (wallTimeNanoseconds <= 0) throw new Error("Process snapshots are out of order.");
	let cpuTimeNanoseconds = 0n;
	let cycles = 0n;
	let energyNanojoules = 0n;
	let instructions = 0n;
	let interruptWakeups = 0n;
	let packageIdleWakeups = 0n;
	let physicalFootprintBytes = 0n;
	let lifetimeMaxPhysicalFootprintBytes = 0n;
	const processDeltas: ProcessUsageDelta["processes"] = [];
	for (const current of after.processes.values()) {
		const previous = before.processes.get(current.pid);
		const cpuDelta = positiveDelta(current.cpuTimeNanoseconds, previous?.cpuTimeNanoseconds ?? 0n);
		const energyDelta = positiveDelta(current.energyNanojoules, previous?.energyNanojoules ?? 0n);
		cpuTimeNanoseconds += cpuDelta;
		energyNanojoules += energyDelta;
		cycles += positiveDelta(current.cycles, previous?.cycles ?? 0n);
		instructions += positiveDelta(current.instructions, previous?.instructions ?? 0n);
		interruptWakeups += positiveDelta(current.interruptWakeups, previous?.interruptWakeups ?? 0n);
		packageIdleWakeups += positiveDelta(
			current.packageIdleWakeups,
			previous?.packageIdleWakeups ?? 0n,
		);
		physicalFootprintBytes += current.physicalFootprintBytes;
		lifetimeMaxPhysicalFootprintBytes += current.lifetimeMaxPhysicalFootprintBytes;
		processDeltas.push({
			command: current.command,
			cpuTimeMs: Number(cpuDelta) / 1_000_000,
			energyJoules: Number(energyDelta) / 1_000_000_000,
			physicalFootprintMB: Number(current.physicalFootprintBytes) / 1024 / 1024,
			pid: current.pid,
		});
	}
	const wallTimeMs = wallTimeNanoseconds / 1_000_000;
	const cpuTimeMs = Number(cpuTimeNanoseconds) / 1_000_000;
	const energyJoules = Number(energyNanojoules) / 1_000_000_000;
	return {
		averageCpuPercent: (cpuTimeMs / wallTimeMs) * 100,
		averagePowerWatts: energyJoules / (wallTimeMs / 1_000),
		cpuTimeMs,
		cycles: Number(cycles),
		energyJoules,
		instructions: Number(instructions),
		interruptWakeups: Number(interruptWakeups),
		lifetimeMaxPhysicalFootprintMB: Number(lifetimeMaxPhysicalFootprintBytes) / 1024 / 1024,
		lostPids: [...before.processes.keys()].filter((pid) => !after.processes.has(pid)),
		packageIdleWakeups: Number(packageIdleWakeups),
		physicalFootprintMB: Number(physicalFootprintBytes) / 1024 / 1024,
		processes: processDeltas.sort((left, right) => right.cpuTimeMs - left.cpuTimeMs),
		wallTimeMs,
	};
}

export async function runProcessMetricSelfTest(durationMs = 120): Promise<ProcessMetricSelfTest> {
	return runMetricSelfTest(durationMs, () => captureProcessTree(process.pid));
}

export async function runKnownProcessMetricSelfTest(
	durationMs = 120,
): Promise<ProcessMetricSelfTest> {
	const rows = [{ command: "bun", pid: process.pid }];
	return runMetricSelfTest(durationMs, () =>
		Promise.resolve(captureKnownProcesses(rows, process.pid)),
	);
}

async function runMetricSelfTest(
	durationMs: number,
	capture: () => Promise<ProcessTreeSnapshot>,
): Promise<ProcessMetricSelfTest> {
	if (!Number.isFinite(durationMs) || durationMs < 100) {
		throw new Error("The real process metric self-test must run for at least 100 ms.");
	}
	const before = await capture();
	const deadline = performance.now() + durationMs;
	let value = 0;
	while (performance.now() < deadline) {
		for (let index = 1; index < 20_000; index += 1) value += Math.sqrt(index);
	}
	if (value <= 0) throw new Error("The real process metric self-test performed no work.");
	const after = await capture();
	const usage = diffProcessTreeUsage(before, after);
	const thresholds = {
		minimumAverageCpuPercent: 10,
		minimumCpuTimeMs: 40,
		minimumEnergyJoules: 0,
	};
	return {
		durationMs,
		passed:
			usage.cpuTimeMs > thresholds.minimumCpuTimeMs &&
			usage.energyJoules > thresholds.minimumEnergyJoules &&
			usage.averageCpuPercent > thresholds.minimumAverageCpuPercent &&
			usage.averagePowerWatts > 0 &&
			usage.lostPids.length === 0,
		thresholds,
		usage,
	};
}
