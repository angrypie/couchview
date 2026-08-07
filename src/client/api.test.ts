import { afterEach, describe, expect, test } from "bun:test";

import {
	ApiError,
	absoluteApiDownloadUrl,
	absoluteApiHttpUrl,
	absoluteApiWebSocketUrl,
	api,
	configureApiRuntime,
	resetApiRuntime,
} from "./api.ts";

const originalFetch = globalThis.fetch;

function pairedRuntimeIntegrationProgram(): string {
	const apiModule = new URL("./api.ts", import.meta.url).href;
	const contractsModule = new URL("../shared/contracts.ts", import.meta.url).href;
	return `
		const { api, configureApiRuntime } = await import(${JSON.stringify(apiModule)});
		const { CSRF_HEADER, NATIVE_CLIENT_TOKEN_HEADER } = await import(${JSON.stringify(
			contractsModule,
		)});
		const requests = [];
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				requests.push({
					csrf: request.headers.get(CSRF_HEADER),
					method: request.method,
					path: new URL(request.url).pathname,
					token: request.headers.get(NATIVE_CLIENT_TOKEN_HEADER),
				});
				if (request.headers.get(NATIVE_CLIENT_TOKEN_HEADER) !== "native-secret") {
					return Response.json({ error: "unauthorized" }, { status: 401 });
				}
				return Response.json({});
			},
		});
		configureApiRuntime({
			baseUrl: \`http://127.0.0.1:\${server.port}\`,
			fetch: (input, init) => Bun.fetch(input, init),
			nativeClientToken: "native-secret",
		});
		try {
			await api.changes("repository-id");
			await api.stage(
				"repository-id",
				{
					fileId: "file-id",
					contentRevision: "content-revision",
					operationRevision: "operation-revision",
					staged: true,
				},
				"browser-csrf-token",
			);
			process.stdout.write(JSON.stringify(requests));
		} finally {
			server.stop(true);
		}
	`;
}

afterEach(() => {
	resetApiRuntime();
	globalThis.fetch = originalFetch;
});

describe("API client", () => {
	test("preserves abort semantics instead of reporting a disconnect", async () => {
		const controller = new AbortController();
		globalThis.fetch = (() =>
			Promise.reject(new TypeError("cancelled"))) as unknown as typeof fetch;
		controller.abort();

		const error = await api.changes("repository-id", controller.signal).catch((caught) => caught);
		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe("AbortError");
	});

	test("turns an actual network failure into a structured disconnected error", async () => {
		globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;

		const error = await api.changes("repository-id").catch((caught) => caught);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 0, code: "disconnected" });
	});

	test("requests an AJAX 401 and reports that secure sign-in is required", async () => {
		let requestHeaders = new Headers();
		let requestUrl = "";
		let credentials: RequestCredentials | undefined;
		let redirect: RequestRedirect | undefined;
		globalThis.fetch = ((input, init) => {
			requestUrl = String(input);
			requestHeaders = new Headers(init?.headers);
			credentials = init?.credentials;
			redirect = init?.redirect;
			return Promise.resolve(new Response("Sign in", { status: 401 }));
		}) as typeof fetch;

		const error = await api.bootstrap().catch((caught) => caught);
		expect(requestUrl).toBe("/api/bootstrap");
		expect(requestHeaders.get("x-requested-with")).toBe("XMLHttpRequest");
		expect(credentials).toBe("same-origin");
		expect(redirect).toBe("manual");
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			status: 401,
			code: "authentication_required",
			message: "Your secure sign-in session has expired.",
		});
	});

	test("treats an opaque Access login redirect as an authentication failure", async () => {
		globalThis.fetch = (() =>
			Promise.resolve({
				ok: false,
				status: 0,
				type: "opaqueredirect",
			} as Response)) as unknown as typeof fetch;

		const error = await api.bootstrap().catch((caught) => caught);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			status: 401,
			code: "authentication_required",
		});
	});

	test("preserves Git diagnostics returned by the local server", async () => {
		globalThis.fetch = (() =>
			Promise.resolve(
				Response.json(
					{
						error: {
							code: "git_timeout",
							message: "Git diff stopped responding after 15 seconds",
							diagnostic: {
								id: "abc12345",
								source: "git",
								operation: "diff",
								kind: "timeout",
								exitCode: null,
								stderr: "fatal: simulated timeout",
								retryable: true,
								timeoutMs: 15_000,
							},
						},
					},
					{ status: 504 },
				),
			)) as unknown as typeof fetch;

		const error = await api.changes("repository-id").catch((caught) => caught);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			status: 504,
			code: "git_timeout",
			diagnostic: {
				id: "abc12345",
				operation: "diff",
				kind: "timeout",
				timeoutMs: 15_000,
			},
		});
	});

	test("authenticates paired-server reads and mutations through the configured runtime", async () => {
		const child = Bun.spawn([process.execPath, "--eval", pairedRuntimeIntegrationProgram()], {
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
		expect(JSON.parse(stdout)).toEqual([
			{
				csrf: null,
				method: "GET",
				path: "/api/repositories/repository-id/files",
				token: "native-secret",
			},
			{
				csrf: "browser-csrf-token",
				method: "POST",
				path: "/api/repositories/repository-id/files/file-id/stage",
				token: "native-secret",
			},
		]);
	});

	test("supports an explicit browser development origin without native credentials", async () => {
		let credentials: RequestCredentials | undefined;
		let requestUrl = "";
		configureApiRuntime({
			baseUrl: "http://127.0.0.1:3001",
			fetch: (input, init) => {
				credentials = init?.credentials;
				requestUrl = String(input);
				return Promise.resolve(Response.json({}));
			},
		});

		await api.bootstrap();

		expect(requestUrl).toBe("http://127.0.0.1:3001/api/bootstrap");
		expect(credentials).toBe("include");
	});

	test("rejects a native credential without a paired-server origin", () => {
		expect(() => configureApiRuntime({ nativeClientToken: "native-secret" })).toThrow(
			"requires an API base URL",
		);
	});

	test("constructs absolute paired-server URLs without accepting external paths", () => {
		configureApiRuntime({
			baseUrl: "https://paired.example.test:8443",
			nativeClientToken: "native-secret",
		});

		expect(absoluteApiHttpUrl("/api/instance")).toBe(
			"https://paired.example.test:8443/api/instance",
		);
		expect(absoluteApiDownloadUrl("/api/artifacts/build/download")).toBe(
			"https://paired.example.test:8443/api/artifacts/build/download",
		);
		expect(absoluteApiWebSocketUrl("/api/terminal/socket")).toBe(
			"wss://paired.example.test:8443/api/terminal/socket",
		);
		expect(() => absoluteApiHttpUrl("https://attacker.example/api")).toThrow(
			"same-origin absolute paths",
		);
		expect(() => absoluteApiHttpUrl("//attacker.example/api")).toThrow(
			"same-origin absolute paths",
		);
	});
});
