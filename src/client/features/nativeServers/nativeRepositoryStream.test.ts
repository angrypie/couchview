import { expect, test } from "bun:test";

function integrationProgram(): string {
	const streamModule = new URL("./nativeRepositoryStream.ts", import.meta.url).href;
	const contractsModule = new URL("../../../shared/contracts.ts", import.meta.url).href;
	return `
		const { runNativeRepositoryStream } = await import(${JSON.stringify(streamModule)});
		const { NATIVE_CLIENT_TOKEN_HEADER } = await import(${JSON.stringify(contractsModule)});
		let connections = 0;
		const receivedTokens = [];
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				connections += 1;
				const connection = connections;
				receivedTokens.push(request.headers.get(NATIVE_CLIENT_TOKEN_HEADER));
				const event = {
					type: "state",
					repositoryId: "repository-one",
					operationRevision: \`revision-\${connection}\`,
					stateRevision: connection,
					catalogRevision: 1,
					at: "2026-08-05T12:00:00.000Z",
				};
				const encoded = new TextEncoder().encode(\`data: \${JSON.stringify(event)}\\n\\n\`);
				const headers = { "content-type": "text/event-stream" };
				if (connection === 1) return new Response(encoded, { headers });
				return new Response(new ReadableStream({
					start(controller) {
						controller.enqueue(encoded);
					},
				}), { headers });
			},
		});
		const controller = new AbortController();
		const events = [];
		let authoritativeRefetches = 0;
		let reconnecting = 0;
		try {
			await runNativeRepositoryStream({
				api: {
					async openEventStream(path, signal) {
						return fetch(\`http://127.0.0.1:\${server.port}\${path}\`, {
							headers: { [NATIVE_CLIENT_TOKEN_HEADER]: "native-token" },
							signal,
						});
					},
				},
				repositoryId: "repository-one",
				signal: controller.signal,
				onConnected() {},
				onReconnecting() {
					reconnecting += 1;
				},
				async onAuthoritativeRefetch() {
					authoritativeRefetches += 1;
				},
				onEvent(event) {
					events.push(event);
					if (events.length === 2) controller.abort();
				},
			});
		} finally {
			controller.abort();
			server.stop(true);
		}
		process.stdout.write(JSON.stringify({
			connections,
			reconnecting,
			authoritativeRefetches,
			receivedTokens,
			operationRevisions: events.map(({ operationRevision }) => operationRevision),
		}));
	`;
}

test("native repository SSE reconnects over real HTTP and refetches authoritatively", async () => {
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
		connections: 2,
		reconnecting: 1,
		authoritativeRefetches: 1,
		receivedTokens: ["native-token", "native-token"],
		operationRevisions: ["revision-1", "revision-2"],
	});
});
