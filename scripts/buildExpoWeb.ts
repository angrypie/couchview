import path from "node:path";

import { postprocessExpoWeb } from "./postprocessExpoWeb.ts";

export interface ExpoWebBuildOptions {
	outputRoot: string;
}

export function parseExpoWebBuildArguments(
	args: string[],
	workingDirectory = process.cwd(),
): ExpoWebBuildOptions {
	let outputDirectory = "dist";
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--outDir" || argument === "--output-dir") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`${argument} requires an output directory`);
			}
			outputDirectory = value;
			index += 1;
			continue;
		}
		const inlineOutput = /^--(?:outDir|output-dir)=(.+)$/.exec(argument ?? "");
		if (inlineOutput?.[1]) {
			outputDirectory = inlineOutput[1];
			continue;
		}
		throw new Error(`Unknown Expo web build argument: ${argument}`);
	}
	return { outputRoot: path.resolve(workingDirectory, outputDirectory) };
}

export async function buildExpoWeb(options: ExpoWebBuildOptions): Promise<void> {
	const build = Bun.spawn(
		[
			process.execPath,
			"x",
			"expo",
			"export",
			"--platform",
			"web",
			"--output-dir",
			options.outputRoot,
		],
		{
			cwd: path.resolve(import.meta.dir, ".."),
			env: process.env,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	const exitCode = await build.exited;
	if (exitCode !== 0) throw new Error(`Expo web export failed with exit code ${exitCode}`);
	await postprocessExpoWeb(options.outputRoot);
}

if (import.meta.main) {
	await buildExpoWeb(parseExpoWebBuildArguments(process.argv.slice(2)));
}
