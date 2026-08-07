import { expect, test } from "bun:test";

function integrationProgram(): string {
	const contractsModule = new URL("../../../shared/nativeClients.ts", import.meta.url).href;
	const runtimeModule = new URL("./runtime.ts", import.meta.url).href;
	const serverEventsModule = new URL("./serverEvents.native.ts", import.meta.url).href;
	return `
		const { NATIVE_CLIENT_TOKEN_HEADER } = await import(${JSON.stringify(contractsModule)});
		const { configureApiRuntime } = await import(${JSON.stringify(runtimeModule)});
		const { subscribeServerEvents } = await import(${JSON.stringify(serverEventsModule)});
		const encoder = new TextEncoder();
		let receivedHeaders = new Headers();
		let receivedUrl = "";
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				receivedHeaders = request.headers;
				receivedUrl = request.url;
				if (request.headers.get(NATIVE_CLIENT_TOKEN_HEADER) !== "native-secret") {
					return Response.json({ error: "unauthorized" }, { status: 401 });
				}
				let timer;
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(encoder.encode(": keep-alive\\n\\ndata: {\\"type\\":\\"ready\\"}"));
							timer = setTimeout(() => controller.enqueue(encoder.encode("\\n\\n")), 5);
						},
						cancel() {
							clearTimeout(timer);
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			},
		});
		configureApiRuntime({
			baseUrl: \`http://127.0.0.1:\${server.port}\`,
			nativeClientToken: "native-secret",
		});
		let subscription;
		try {
			const received = await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error("Timed out waiting for SSE")), 2_000);
				subscription = subscribeServerEvents("/api/repositories/repo/events", {
					onError: reject,
					onMessage(message) {
						clearTimeout(timeout);
						resolve(message);
					},
				});
			});
			process.stdout.write(JSON.stringify({
				accept: receivedHeaders.get("accept"),
				data: received.data,
				path: new URL(receivedUrl).pathname,
				token: receivedHeaders.get(NATIVE_CLIENT_TOKEN_HEADER),
			}));
		} finally {
			subscription?.close();
			server.stop(true);
		}
	`;
}

test("authenticates and parses a native fetch-stream subscription", async () => {
	const child = Bun.spawn([process.execPath, "--eval", integrationProgram()], {
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);

	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	expect(JSON.parse(stdout)).toEqual({
		accept: "text/event-stream",
		data: '{"type":"ready"}',
		path: "/api/repositories/repo/events",
		token: "native-secret",
	});
});
