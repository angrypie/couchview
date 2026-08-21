import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createStagedSnapshot } from "./benchmarkQualityChecks.ts";

export interface StagedQualityCommand {
	command: string[];
	name: string;
}

const FAST_QUALITY_COMMANDS: StagedQualityCommand[] = [
	{ name: "architecture", command: ["run", "check:architecture"] },
	{ name: "formatting", command: ["run", "format:check"] },
	{ name: "linting", command: ["run", "lint"] },
	{ name: "type checking", command: ["run", "typecheck"] },
];

export async function runStagedQualityCommands(
	repositoryRoot: string,
	commands: readonly StagedQualityCommand[] = FAST_QUALITY_COMMANDS,
): Promise<void> {
	const snapshot = await createStagedSnapshot(repositoryRoot);
	try {
		for (const check of commands) {
			console.log(`\nChecking staged ${check.name}...`);
			const result = Bun.spawnSync([process.execPath, ...check.command], {
				cwd: snapshot.root,
				stderr: "inherit",
				stdout: "inherit",
			});
			if (!result.success) {
				const instruction =
					check.name === "formatting" ? " Run `bun run format`, stage the result, and retry." : "";
				throw new Error(`Staged ${check.name} check failed.${instruction}`);
			}
		}
	} finally {
		await snapshot.cleanup();
	}
}

async function main() {
	const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
	if (argumentsWithoutSeparator.length > 0) {
		throw new Error("Usage: bun run check:commit:static");
	}
	await runStagedQualityCommands(resolve(import.meta.dir, ".."));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
