import { preferredProjectUrl } from "./cliAccess.ts";
import { registerWithRunningServer } from "./cliRunningServer.ts";
import { parseCliState } from "./cliServeOptions.ts";

interface BrowseCliRuntime {
	fetch: typeof globalThis.fetch;
	openUrl(url: string): Promise<void>;
	cwd(): string;
}

export function browserOpenCommand(
	url: string,
	platform: NodeJS.Platform = process.platform,
): string[] {
	if (platform === "darwin") return ["open", url];
	if (platform === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
	return ["xdg-open", url];
}

async function openBrowserUrl(url: string): Promise<void> {
	const command = browserOpenCommand(url);
	const child = Bun.spawn(command, {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
	});
	const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || `Browser opener exited with status ${exitCode}`);
	}
}

export async function browseRunningServer(
	argv: string[] = [],
	runtimeOverrides: Partial<BrowseCliRuntime> = {},
): Promise<string> {
	const runtime: BrowseCliRuntime = {
		fetch: runtimeOverrides.fetch ?? globalThis.fetch,
		openUrl: runtimeOverrides.openUrl ?? openBrowserUrl,
		cwd: runtimeOverrides.cwd ?? process.cwd,
	};
	const browseArgv = argv.includes("--repo") ? argv : ["--repo", runtime.cwd(), ...argv];
	const { options, parsed } = parseCliState(browseArgv);
	const explicitHost = parsed.explicit.host || Bun.env.COUCHVIEW_HOST !== undefined;
	const running = await registerWithRunningServer(options, explicitHost, runtime.fetch);
	if (!running) {
		throw new Error(
			`No Couchview server is running on ${options.host}:${options.port}. Start Couchview first.`,
		);
	}
	const url = preferredProjectUrl(
		running.instance.accessOrigins,
		running.registration.repository.id,
	);
	if (!url) throw new Error("The running Couchview server did not advertise a browser URL");
	await runtime.openUrl(url);
	return url;
}
