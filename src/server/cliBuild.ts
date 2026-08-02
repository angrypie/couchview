import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";

import type { RestartCapability } from "../shared/contracts.ts";

export function restartCapability(environment: NodeJS.ProcessEnv = process.env): RestartCapability {
	if (environment.NODE_ENV === "development") {
		return {
			available: false,
			reason: "Development mode reloads source changes automatically.",
		};
	}
	if (environment.STATIC_DIR) {
		return {
			available: false,
			reason: "Restart is unavailable when Couchview uses a custom STATIC_DIR.",
		};
	}
	return { available: true, reason: null };
}

function fileMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function replaceStaticBuild(
	candidateDirectory: string,
	staticDirectory: string,
): Promise<void> {
	const backupDirectory = `${staticDirectory}.previous-${randomUUID()}`;
	let previousBuildMoved = false;
	try {
		await rename(staticDirectory, backupDirectory);
		previousBuildMoved = true;
	} catch (error) {
		if (!fileMissing(error)) throw error;
	}
	try {
		await rename(candidateDirectory, staticDirectory);
	} catch (error) {
		if (previousBuildMoved) {
			try {
				await rename(backupDirectory, staticDirectory);
			} catch (restoreError) {
				throw new AggregateError(
					[error, restoreError],
					"Could not install the new Couchview build or restore the previous build",
				);
			}
		}
		throw error;
	}
	if (previousBuildMoved) {
		try {
			await rm(backupDirectory, { recursive: true, force: true });
		} catch (error) {
			console.warn(
				`Couchview could not remove the previous build backup: ${(error as Error).message}`,
			);
		}
	}
}
