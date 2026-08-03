import {
	API_ROUTES,
	type ApiErrorBody,
	type BootstrapResponse,
	CSRF_HEADER,
	type InstanceResponse,
	type RegisterRepositoryResponse,
	type RestartResponse,
} from "../shared/contracts.ts";
import { parseRestartArguments } from "./cliCommand.ts";
import type { CliOptions } from "./cliServeOptions.ts";
import { resolveStateDatabasePath, StateDatabase } from "./database.ts";
import { hostForUrl, INSTANCE_PROTOCOL_VERSION, normalizeBindHost } from "./server.ts";

export interface RunningRegistration {
	instance: InstanceResponse;
	registration: RegisterRepositoryResponse;
}

export interface RestartCliOptions {
	host: string;
	port: number;
}

interface RestartCliRuntime {
	fetch: typeof globalThis.fetch;
	now(): number;
	wait(milliseconds: number): Promise<void>;
}

export function parseRestartCli(argv: string[]): RestartCliOptions {
	const parsed = parseRestartArguments(argv);
	const host = parsed.host ?? Bun.env.COUCHVIEW_HOST ?? "127.0.0.1";
	const port = Number(parsed.port ?? Bun.env.PORT ?? 4173);
	if (!host) throw new Error("Host is required");
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		throw new Error("Port must be between 1 and 65535");
	}
	return {
		host: normalizeBindHost(host),
		port,
	};
}

function probeHost(host: string): string {
	if (host === "0.0.0.0") return "127.0.0.1";
	if (host === "::") return "::1";
	return host;
}

function probeOrigin(options: Pick<CliOptions, "host" | "port">): string {
	return `http://${hostForUrl(probeHost(options.host))}:${options.port}`;
}

function requestedHostIsCompatible(requested: string, existing: string): boolean {
	if (requested === existing) return true;
	if (existing === "0.0.0.0") {
		return (
			requested === "localhost" ||
			requested === "127.0.0.1" ||
			/^\d+\.\d+\.\d+\.\d+$/.test(requested)
		);
	}
	if (existing === "::") return true;
	return false;
}

async function fetchWithTimeout(
	url: string,
	fetchImplementation: typeof globalThis.fetch,
	init?: RequestInit,
	timeoutMs = 500,
): Promise<Response | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetchImplementation(url, { ...init, signal: controller.signal });
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function parseInstanceResponse(value: unknown): InstanceResponse | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<InstanceResponse>;
	const valid =
		candidate.service === "couchview" &&
		typeof candidate.protocolVersion === "number" &&
		typeof candidate.version === "string" &&
		typeof candidate.instanceId === "string" &&
		typeof candidate.bindHost === "string" &&
		typeof candidate.port === "number" &&
		Array.isArray(candidate.accessOrigins) &&
		candidate.accessOrigins.every((origin) => typeof origin === "string") &&
		typeof candidate.terminalEnabled === "boolean" &&
		typeof candidate.terminalP2pEnabled === "boolean" &&
		Array.isArray(candidate.terminalStunUrls) &&
		candidate.terminalStunUrls.every((url) => typeof url === "string") &&
		typeof candidate.remoteBridgeEnabled === "boolean" &&
		typeof candidate.remoteBridgeP2pEnabled === "boolean" &&
		Array.isArray(candidate.remoteBridgeStunUrls) &&
		candidate.remoteBridgeStunUrls.every((url) => typeof url === "string") &&
		typeof candidate.remoteBridgeTargetPort === "number" &&
		(candidate.remoteBridgeOriginAccess === undefined ||
			typeof candidate.remoteBridgeOriginAccess === "string");
	if (!valid) return null;
	return {
		...candidate,
		remoteBridgeOriginAccess: candidate.remoteBridgeOriginAccess ?? "auto",
	} as InstanceResponse;
}

async function responseError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as ApiErrorBody;
		return body.error.message;
	} catch {
		return `HTTP ${response.status}`;
	}
}

async function responseErrorDetails(
	response: Response,
): Promise<{ code: string | null; message: string }> {
	try {
		const body = (await response.json()) as ApiErrorBody;
		return {
			code: body.error.code,
			message: body.error.message,
		};
	} catch {
		return { code: null, message: `HTTP ${response.status}` };
	}
}

function isRestartResponse(value: unknown): value is RestartResponse {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<RestartResponse>;
	return candidate.status === "restarting" && typeof candidate.previousInstanceId === "string";
}

async function requestRunningRestart(
	origin: string,
	controlToken: string,
	fetchImplementation: typeof globalThis.fetch,
): Promise<RestartResponse> {
	const requestTimeoutMs = 5 * 60_000 + 10_000;
	let response = await fetchWithTimeout(
		`${origin}${API_ROUTES.controlRestart}`,
		fetchImplementation,
		{
			method: "POST",
			headers: { authorization: `Bearer ${controlToken}` },
		},
		requestTimeoutMs,
	);
	if (!response) throw new Error("The running Couchview server stopped responding");

	if (!response.ok) {
		const error = await responseErrorDetails(response);
		const legacyControlRoute =
			response.status === 404 ||
			error.code === "route_not_found" ||
			error.code === "origin_required";
		if (!legacyControlRoute) throw new Error(error.message);

		const bootstrapResponse = await fetchWithTimeout(
			`${origin}${API_ROUTES.bootstrap}`,
			fetchImplementation,
		);
		if (!bootstrapResponse?.ok) {
			throw new Error("The running Couchview server stopped responding");
		}
		const bootstrap = (await bootstrapResponse
			.json()
			.catch(() => null)) as Partial<BootstrapResponse> | null;
		if (!bootstrap || typeof bootstrap.csrfToken !== "string") {
			throw new Error("The running Couchview server returned invalid control data");
		}
		response = await fetchWithTimeout(
			`${origin}${API_ROUTES.restart}`,
			fetchImplementation,
			{
				method: "POST",
				headers: {
					origin,
					[CSRF_HEADER]: bootstrap.csrfToken,
				},
			},
			requestTimeoutMs,
		);
		if (!response) throw new Error("The running Couchview server stopped responding");
	}

	if (!response.ok) throw new Error(await responseError(response));
	const result: unknown = await response.json().catch(() => null);
	if (!isRestartResponse(result)) {
		throw new Error("The running Couchview server returned an invalid restart response");
	}
	return result;
}

export async function restartRunningServer(
	argv: string[] = [],
	runtimeOverrides: Partial<RestartCliRuntime> = {},
): Promise<{ previous: InstanceResponse; replacement: InstanceResponse }> {
	const runtime: RestartCliRuntime = {
		fetch: runtimeOverrides.fetch ?? globalThis.fetch,
		now: runtimeOverrides.now ?? Date.now,
		wait:
			runtimeOverrides.wait ??
			((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
	};
	const options = parseRestartCli(argv);
	const origin = probeOrigin(options);
	const instanceResponse = await fetchWithTimeout(`${origin}${API_ROUTES.instance}`, runtime.fetch);
	if (!instanceResponse) throw new Error(`No Couchview server is running at ${origin}`);
	if (!instanceResponse.ok) {
		throw new Error(`The service at ${origin} is not a compatible Couchview server`);
	}
	const rawInstance = parseInstanceResponse(await instanceResponse.json().catch(() => null));
	if (!rawInstance) {
		throw new Error(`The service at ${origin} is not a compatible Couchview server`);
	}
	if (rawInstance.protocolVersion !== INSTANCE_PROTOCOL_VERSION) {
		throw new Error(
			`Couchview ${rawInstance.version} uses control protocol ${rawInstance.protocolVersion}; update the CLI or server before restarting`,
		);
	}

	const database = await StateDatabase.open(resolveStateDatabasePath());
	let controlToken: string;
	try {
		const stored = database.serverInstance(rawInstance.instanceId);
		if (!stored) {
			throw new Error(
				"The running Couchview server uses a different XDG data directory; use the matching XDG_DATA_HOME",
			);
		}
		controlToken = stored.controlToken;
	} finally {
		database.close();
	}

	console.log(`Requesting rebuild and restart from Couchview at ${origin}...`);
	const restart = await requestRunningRestart(origin, controlToken, runtime.fetch);
	if (restart.previousInstanceId !== rawInstance.instanceId) {
		throw new Error("The Couchview server changed before the restart request completed");
	}

	const deadline = runtime.now() + 60_000;
	while (runtime.now() < deadline) {
		await runtime.wait(250);
		const candidateResponse = await fetchWithTimeout(
			`${origin}${API_ROUTES.instance}`,
			runtime.fetch,
		);
		if (!candidateResponse?.ok) continue;
		const candidate = parseInstanceResponse(await candidateResponse.json().catch(() => null));
		if (
			candidate &&
			candidate.protocolVersion === INSTANCE_PROTOCOL_VERSION &&
			candidate.instanceId !== rawInstance.instanceId
		) {
			console.log(`Couchview restarted successfully at ${origin}.`);
			return { previous: rawInstance, replacement: candidate };
		}
	}
	throw new Error("Couchview did not come back within 60 seconds. Check the owner process logs.");
}

export async function registerWithRunningServer(
	options: CliOptions,
	explicitHost: boolean,
	fetchImplementation: typeof globalThis.fetch,
): Promise<RunningRegistration | null> {
	const origin = probeOrigin(options);
	const instanceResponse = await fetchWithTimeout(
		`${origin}${API_ROUTES.instance}`,
		fetchImplementation,
	);
	if (!instanceResponse) return null;
	if (!instanceResponse.ok) {
		throw new Error(
			`Port ${options.port} is occupied by a service that is not a compatible Couchview server`,
		);
	}
	const rawInstance = parseInstanceResponse(await instanceResponse.json().catch(() => null));
	if (!rawInstance) {
		throw new Error(
			`Port ${options.port} is occupied by a service that is not a compatible Couchview server`,
		);
	}
	if (rawInstance.protocolVersion !== INSTANCE_PROTOCOL_VERSION) {
		throw new Error(
			`Couchview ${rawInstance.version} uses control protocol ${rawInstance.protocolVersion}; use another port or stop it first`,
		);
	}
	if (explicitHost && !requestedHostIsCompatible(options.host, rawInstance.bindHost)) {
		throw new Error(
			`Couchview is already using port ${options.port} on ${rawInstance.bindHost}, which does not satisfy --host ${options.host}`,
		);
	}
	if (options.terminalMode === "enabled" && !rawInstance.terminalEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with terminal access disabled; stop it or choose another port`,
		);
	}
	if (options.terminalMode === "disabled" && rawInstance.terminalEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with terminal access enabled; stop it or choose another port`,
		);
	}
	if (options.terminalP2pMode === "enabled" && !rawInstance.terminalP2pEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with terminal P2P disabled; stop it or choose another port`,
		);
	}
	if (options.terminalP2pMode === "disabled" && rawInstance.terminalP2pEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with terminal P2P enabled; stop it or choose another port`,
		);
	}
	if (
		options.terminalP2pMode === "enabled" &&
		options.terminalStunUrls.join(",") !== rawInstance.terminalStunUrls.join(",")
	) {
		throw new Error(
			`Couchview is already using port ${options.port} with different terminal STUN servers; stop it or choose another port`,
		);
	}
	if (options.remoteBridgeMode === "enabled" && !rawInstance.remoteBridgeEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with the native bridge disabled; stop it or choose another port`,
		);
	}
	if (options.remoteBridgeMode === "disabled" && rawInstance.remoteBridgeEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with the native bridge enabled; stop it or choose another port`,
		);
	}
	if (options.remoteBridgeP2pMode === "enabled" && !rawInstance.remoteBridgeP2pEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with native bridge P2P disabled; stop it or choose another port`,
		);
	}
	if (options.remoteBridgeP2pMode === "disabled" && rawInstance.remoteBridgeP2pEnabled) {
		throw new Error(
			`Couchview is already using port ${options.port} with native bridge P2P enabled; stop it or choose another port`,
		);
	}
	if (
		options.remoteBridgeP2pMode === "enabled" &&
		options.remoteBridgeStunUrls.join(",") !== rawInstance.remoteBridgeStunUrls.join(",")
	) {
		throw new Error(
			`Couchview is already using port ${options.port} with different native bridge STUN servers; stop it or choose another port`,
		);
	}
	if (
		Bun.env.COUCHVIEW_REMOTE_BRIDGE_PORT !== undefined &&
		options.remoteBridgePort !== rawInstance.remoteBridgeTargetPort
	) {
		throw new Error(
			`Couchview is already using port ${options.port} with a different loopback SSH port; stop it or choose another port`,
		);
	}
	if (
		options.remoteBridgeOriginAccess !== "auto" &&
		options.remoteBridgeOriginAccess !== rawInstance.remoteBridgeOriginAccess
	) {
		throw new Error(
			`Couchview is already using port ${options.port} with native bridge origin access '${rawInstance.remoteBridgeOriginAccess}'; stop it or choose another port`,
		);
	}

	const database = await StateDatabase.open(resolveStateDatabasePath());
	try {
		const stored = database.serverInstance(rawInstance.instanceId);
		if (!stored) {
			throw new Error(
				"The running Couchview server uses a different XDG data directory; use the matching XDG_DATA_HOME or another port",
			);
		}
		const response = await fetchWithTimeout(
			`${origin}${API_ROUTES.controlRepositories}`,
			fetchImplementation,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${stored.controlToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ root: options.root }),
			},
		);
		if (!response) throw new Error("The running Couchview server stopped responding");
		if (!response.ok) throw new Error(await responseError(response));
		return {
			instance: rawInstance,
			registration: (await response.json()) as RegisterRepositoryResponse,
		};
	} finally {
		database.close();
	}
}
