import { fileURLToPath } from "node:url";

interface SupervisedChild {
	exited: Promise<number>;
	kill(signal: NodeJS.Signals): void;
}

interface SupervisorSpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	stdin: "inherit";
	stdout: "inherit";
	stderr: "inherit";
}

interface SupervisorRuntime {
	spawn(command: string[], options: SupervisorSpawnOptions): SupervisedChild;
	onSignal(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
	offSignal(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
}

export const restartDelayMs = 250;
export const supervisedWorkerEnvironment = "COUCHVIEW_SUPERVISED_WORKER";
export const SUPERVISOR_RESTART_EXIT_CODE = 75;

export async function superviseServer(
	argv: string[] = [],
	runtimeOverrides: Partial<SupervisorRuntime> = {},
): Promise<number> {
	const runtime: SupervisorRuntime = {
		spawn:
			runtimeOverrides.spawn ??
			((command, options) => Bun.spawn(command, options) as SupervisedChild),
		onSignal: runtimeOverrides.onSignal ?? ((signal, listener) => process.on(signal, listener)),
		offSignal: runtimeOverrides.offSignal ?? ((signal, listener) => process.off(signal, listener)),
	};
	const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
	let child: SupervisedChild | null = null;
	let stopping = false;
	let restarting = false;
	const forward = (signal: "SIGINT" | "SIGTERM") => {
		stopping = true;
		try {
			child?.kill(signal);
		} catch {
			// The worker may already have exited after the signal reached its process group.
		}
	};
	const interrupt = () => forward("SIGINT");
	const terminate = () => forward("SIGTERM");
	runtime.onSignal("SIGINT", interrupt);
	runtime.onSignal("SIGTERM", terminate);
	try {
		while (!stopping) {
			child = runtime.spawn([process.execPath, "run", cliPath, ...argv], {
				cwd: process.cwd(),
				env: {
					...process.env,
					[supervisedWorkerEnvironment]: "1",
					...(restarting ? { COUCHVIEW_DISABLE_REUSE: "1" } : {}),
				},
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			const exitCode = await child.exited;
			child = null;
			if (stopping || exitCode !== SUPERVISOR_RESTART_EXIT_CODE) {
				return exitCode;
			}
			restarting = true;
			console.log("Restarting Couchview server worker...");
		}
		return 0;
	} finally {
		runtime.offSignal("SIGINT", interrupt);
		runtime.offSignal("SIGTERM", terminate);
	}
}
