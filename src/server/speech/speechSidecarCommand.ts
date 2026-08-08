import { access } from "node:fs/promises";
import path from "node:path";

interface SpeechSidecarRuntime {
	compiled: boolean;
	executablePath: string;
	projectRoot: string;
	platform: NodeJS.Platform;
	arch: string;
}

export interface SpeechSidecarResolution {
	command: string[] | null;
	reason?: string;
}

export async function resolveSpeechSidecarCommand(
	runtimeOverrides: Partial<SpeechSidecarRuntime> = {},
): Promise<SpeechSidecarResolution> {
	const runtime: SpeechSidecarRuntime = {
		compiled: runtimeOverrides.compiled ?? Bun.main.startsWith("/$bunfs/"),
		executablePath: runtimeOverrides.executablePath ?? process.execPath,
		projectRoot: runtimeOverrides.projectRoot ?? path.resolve(import.meta.dir, "../../.."),
		platform: runtimeOverrides.platform ?? process.platform,
		arch: runtimeOverrides.arch ?? process.arch,
	};
	if (runtime.platform !== "darwin" || runtime.arch !== "arm64") {
		return {
			command: null,
			reason: "Host transcription requires an Apple Silicon Mac running macOS 14 or newer.",
		};
	}
	if (!runtime.compiled) {
		return {
			command: [
				"swift",
				"run",
				"--package-path",
				path.join(runtime.projectRoot, "swift", "SpeechSidecar"),
				"couchview-speech-sidecar",
			],
		};
	}
	const binaryPath = path.join(path.dirname(runtime.executablePath), "couchview-speech-sidecar");
	try {
		await access(binaryPath);
		return { command: [binaryPath] };
	} catch {
		return {
			command: null,
			reason: "The bundled speech sidecar is missing. Reinstall this Couchview build.",
		};
	}
}
