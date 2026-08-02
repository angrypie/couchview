import type {
	PackageRunSummary,
	PackageScriptsPackage,
	PackageScriptsResponse,
} from "../../../shared/contracts.ts";

export const emptyPackageScripts: PackageScriptsResponse = {
	packages: [],
	warnings: [],
};

export function packageLabel(packageEntry: PackageScriptsPackage): string {
	return (
		packageEntry.name ??
		(packageEntry.directory === "." ? "Repository root" : packageEntry.directory)
	);
}

export function runStatusLabel(status: PackageRunSummary["status"]): string {
	if (status === "succeeded") return "Passed";
	if (status === "failed") return "Failed";
	if (status === "stopped") return "Stopped";
	if (status === "stopping") return "Stopping";
	return "Running";
}

export function runElapsed(run: PackageRunSummary, now = Date.now()): string {
	const started = Date.parse(run.startedAt);
	const finished = run.finishedAt ? Date.parse(run.finishedAt) : now;
	const milliseconds = Math.max(0, finished - started);
	if (milliseconds < 1_000) return `${milliseconds} ms`;
	const seconds = Math.floor(milliseconds / 1_000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
