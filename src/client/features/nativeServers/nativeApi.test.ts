import { expect, test } from "bun:test";

function integrationProgram(): string {
	const apiModule = new URL("./nativeApi.ts", import.meta.url).href;
	const contractsModule = new URL("../../../shared/contracts.ts", import.meta.url).href;
	return `
		const { mock } = await import("bun:test");
		mock.module("expo/fetch", () => ({ fetch: globalThis.fetch }));
		const { fetchNativeServerInstance } = await import(${JSON.stringify(apiModule)});
		const { NATIVE_CLIENT_TOKEN_HEADER } = await import(${JSON.stringify(contractsModule)});
		const token = "n".repeat(43);
		const requests = [];
		const receivedTokens = [];
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				requests.push(url.pathname);
				receivedTokens.push(request.headers.get(NATIVE_CLIENT_TOKEN_HEADER));
				if (url.pathname !== "/api/instance") {
					return Response.json(
						{ error: { code: "route_not_found", message: "API route not found" } },
						{ status: 404 },
					);
				}
				return Response.json({ serverId: "server", instanceId: "instance" });
			},
		});
		try {
			const instance = await fetchNativeServerInstance(
				\`http://127.0.0.1:\${server.port}\`,
				token,
			);
			process.stdout.write(JSON.stringify({ requests, receivedTokens, instance }));
		} finally {
			server.stop(true);
		}
	`;
}

test("authenticates the native server identity preflight", async () => {
	const child = Bun.spawn([process.execPath, "--eval", integrationProgram()], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);

	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	expect(JSON.parse(stdout)).toEqual({
		requests: ["/api/instance"],
		receivedTokens: ["n".repeat(43)],
		instance: { serverId: "server", instanceId: "instance" },
	});
});
