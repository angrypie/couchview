import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const packagePath = path.join(projectRoot, "swift", "SpeechSidecar");
const outputDirectory = path.join(projectRoot, "dist");

async function run(command: string[]): Promise<string> {
	const processHandle = Bun.spawn(command, {
		cwd: projectRoot,
		env: process.env,
		stdin: "inherit",
		stdout: "pipe",
		stderr: "inherit",
	});
	const output = await new Response(processHandle.stdout).text();
	const exitCode = await processHandle.exited;
	if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command[0]}`);
	return output.trim();
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
	console.log("Skipping speech sidecar build: it is supported only on macOS ARM64.");
	process.exit(0);
}

await run(["swift", "build", "--configuration", "release", "--package-path", packagePath]);
const binaryDirectory = await run([
	"swift",
	"build",
	"--configuration",
	"release",
	"--package-path",
	packagePath,
	"--show-bin-path",
]);
await mkdir(outputDirectory, { recursive: true });
const destination = path.join(outputDirectory, "couchview-speech-sidecar");
await copyFile(path.join(binaryDirectory, "couchview-speech-sidecar"), destination);
await chmod(destination, 0o755);
console.log(`Built speech sidecar at ${destination}.`);
