import { resolve } from "node:path";

async function reservePort(): Promise<number> {
	const reservation = Bun.serve({
		fetch: () => new Response("reserved"),
		hostname: "127.0.0.1",
		port: 0,
	});
	const port = reservation.port;
	await reservation.stop(true);
	if (port === undefined) throw new Error("Bun did not allocate a benchmark port.");
	return port;
}

async function waitForServer(url: string, fixtureProcess: ReturnType<typeof Bun.spawn>) {
	const deadline = performance.now() + 20_000;
	while (performance.now() < deadline) {
		if (fixtureProcess.exitCode !== null) {
			throw new Error(`The E2E fixture exited with code ${fixtureProcess.exitCode}.`);
		}
		try {
			const response = await fetch(`${url}/api/bootstrap`);
			if (response.ok) return;
		} catch {
			// The fixture has not bound its socket yet.
		}
		await Bun.sleep(50);
	}
	throw new Error("Timed out waiting for the E2E fixture.");
}

export async function launchDiffScrollFixtureServer(staticDirectory: string) {
	const port = await reservePort();
	const baseURL = `http://127.0.0.1:${port}`;
	const child = Bun.spawn([process.execPath, "run", "scripts/e2e-fixture.ts"], {
		cwd: resolve(import.meta.dir, ".."),
		env: {
			...process.env,
			E2E_HOST: "127.0.0.1",
			E2E_PORT: String(port),
			E2E_STATIC_DIR: staticDirectory,
		},
		stderr: "inherit",
		stdout: "ignore",
	});
	try {
		await waitForServer(baseURL, child);
	} catch (error) {
		child.kill("SIGTERM");
		await child.exited;
		throw error;
	}
	return {
		baseURL,
		async close() {
			child.kill("SIGTERM");
			await child.exited;
		},
	};
}
