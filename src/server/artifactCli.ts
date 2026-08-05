import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, link, lstat, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
	API_ROUTES,
	type ApiErrorBody,
	ARTIFACT_EXECUTABLE_HEADER,
	type ArtifactBuild,
	type ArtifactCatalogItem,
	type ArtifactCatalogResponse,
	type ArtifactRepositoryResolveResponse,
	type ArtifactRun,
	type ArtifactRunEvent,
	type ArtifactRunResponse,
	type InstanceResponse,
	type RemoteBridgeProfile,
} from "../shared/contracts.ts";
import { repositoryRemoteFingerprints } from "./artifactRepositoryIdentity.ts";
import type { ParsedArtifactArguments } from "./cliCommandTypes.ts";
import { resolveStateDatabasePath, StateDatabase, type StoredServerInstance } from "./database.ts";
import {
	type AuthenticatedRemoteBridgeRuntime,
	authenticatedRemoteBridgeFetch,
} from "./remoteBridgeClient.ts";
import { resolveRemoteBridgeProfile } from "./remoteBridgeConfig.ts";

interface ArtifactCliOutput {
	write(text: string): void;
}

export interface ArtifactCliRuntime {
	fetch: typeof globalThis.fetch;
	cwd(): string;
	stateDatabasePath: string;
	resolveProfile(selector: string): Promise<RemoteBridgeProfile>;
	originAccessProviders?: AuthenticatedRemoteBridgeRuntime["originAccessProviders"];
	onInterrupt(handler: () => void): () => void;
	stdout: ArtifactCliOutput;
	stderr: ArtifactCliOutput;
}

interface ArtifactConnection {
	repository: { id: string; name: string };
	request(pathname: string, init?: RequestInit): Promise<Response>;
}

class ArtifactCliInterrupted extends Error {
	constructor() {
		super("Artifact build cancelled.");
		this.name = "ArtifactCliInterrupted";
	}
}

function defaultRuntime(): ArtifactCliRuntime {
	return {
		fetch: globalThis.fetch,
		cwd: process.cwd,
		stateDatabasePath: resolveStateDatabasePath(),
		resolveProfile: (selector) => resolveRemoteBridgeProfile(selector),
		onInterrupt(handler) {
			process.on("SIGINT", handler);
			return () => process.off("SIGINT", handler);
		},
		stdout: process.stdout,
		stderr: process.stderr,
	};
}

async function apiError(response: Response): Promise<{ code: string | null; message: string }> {
	try {
		const body = (await response.json()) as ApiErrorBody;
		return {
			code: typeof body.error?.code === "string" ? body.error.code : null,
			message:
				typeof body.error?.message === "string" ? body.error.message : `HTTP ${response.status}`,
		};
	} catch {
		return { code: null, message: `HTTP ${response.status}` };
	}
}

async function requireResponse(response: Response, updateIfMissing = false): Promise<Response> {
	if (response.ok) return response;
	const error = await apiError(response);
	if (updateIfMissing && (response.status === 404 || error.code === "route_not_found")) {
		throw new Error(
			"This Couchview server does not support repository artifacts; update Couchview on the server.",
		);
	}
	throw new Error(error.message);
}

async function gitRoot(candidate: string): Promise<string> {
	const result = Bun.spawnSync(
		["git", "-C", path.resolve(candidate), "rev-parse", "--show-toplevel"],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`Could not identify a Git repository from ${path.resolve(candidate)}; use --repo or --repository.`,
		);
	}
	return realpath(result.stdout.toString().trim());
}

function instanceOrigin(instance: StoredServerInstance): string | null {
	const preferred = [
		`http://127.0.0.1:${instance.port}`,
		`http://localhost:${instance.port}`,
		...instance.accessOrigins,
	];
	return (
		preferred.find((origin, index, all) => {
			if (all.indexOf(origin) !== index) return false;
			try {
				const url = new URL(origin);
				return url.protocol === "http:" || url.protocol === "https:";
			} catch {
				return false;
			}
		}) ?? null
	);
}

async function resolveRepository(
	request: ArtifactConnection["request"],
	selector: string | null,
	fingerprints: readonly string[],
): Promise<ArtifactRepositoryResolveResponse> {
	const response = await requireResponse(
		await request(API_ROUTES.artifactRepositoryResolve, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(
				selector ? { repository: selector } : { fingerprints: [...fingerprints] },
			),
		}),
		true,
	);
	return (await response.json()) as ArtifactRepositoryResolveResponse;
}

function selectionError(response: ArtifactRepositoryResolveResponse): Error {
	const available = response.repositories
		.map((repository) => `${repository.name} (${repository.id})`)
		.join(", ");
	return new Error(
		available
			? `Repository selection is ambiguous or unmatched. Available repositories: ${available}. Use --repository.`
			: "No repositories are registered on this Couchview server.",
	);
}

async function localConnection(
	options: ParsedArtifactArguments,
	runtime: ArtifactCliRuntime,
): Promise<ArtifactConnection> {
	if (!existsSync(runtime.stateDatabasePath)) {
		throw new Error("No running local Couchview server was found.");
	}
	const root = options.repository ? null : await gitRoot(options.repo ?? runtime.cwd());
	const fingerprints = root ? await repositoryRemoteFingerprints(root) : [];
	const database = await StateDatabase.open(runtime.stateDatabasePath);
	let instances: StoredServerInstance[];
	let localRepositoryId: string | null = null;
	try {
		instances = database.serverInstances();
		if (root) {
			for (const repository of database.repositories()) {
				const storedRoot = await realpath(repository.root).catch(() => null);
				if (storedRoot === root) {
					localRepositoryId = repository.id;
					break;
				}
			}
		}
	} finally {
		database.close();
	}
	let updateRequired = false;
	let unmatched: ArtifactRepositoryResolveResponse | null = null;
	for (const instance of instances) {
		const origin = instanceOrigin(instance);
		if (!origin) continue;
		const instanceResponse = await runtime
			.fetch(`${origin}${API_ROUTES.instance}`)
			.catch(() => null);
		if (!instanceResponse?.ok) continue;
		const advertised = (await instanceResponse.json().catch(() => null)) as InstanceResponse | null;
		if (advertised?.instanceId !== instance.instanceId) continue;
		const request: ArtifactConnection["request"] = (pathname, init = {}) => {
			const headers = new Headers(init.headers);
			headers.set("authorization", `Bearer ${instance.controlToken}`);
			return runtime.fetch(`${origin}${pathname}`, { ...init, headers });
		};
		let resolved: ArtifactRepositoryResolveResponse;
		try {
			resolved = await resolveRepository(
				request,
				options.repository ?? localRepositoryId,
				fingerprints,
			);
		} catch (error) {
			if ((error as Error).message.includes("does not support repository artifacts")) {
				updateRequired = true;
				continue;
			}
			throw error;
		}
		if (resolved.repository) return { repository: resolved.repository, request };
		unmatched = resolved;
	}
	if (updateRequired) {
		throw new Error(
			"The running Couchview server does not support repository artifacts; update Couchview and restart it.",
		);
	}
	if (unmatched) throw selectionError(unmatched);
	throw new Error(
		"No running local Couchview server was found. Start Couchview separately and retry.",
	);
}

async function remoteConnection(
	options: ParsedArtifactArguments,
	runtime: ArtifactCliRuntime,
): Promise<ArtifactConnection> {
	const profile = await runtime.resolveProfile(options.profile!);
	const root = options.repository ? null : await gitRoot(options.repo ?? runtime.cwd());
	const fingerprints = root ? await repositoryRemoteFingerprints(root) : [];
	const request: ArtifactConnection["request"] = (pathname, init) =>
		authenticatedRemoteBridgeFetch(profile, pathname, init, {
			fetch: runtime.fetch,
			...(runtime.originAccessProviders
				? { originAccessProviders: runtime.originAccessProviders }
				: {}),
		});
	const resolved = await resolveRepository(request, options.repository, fingerprints);
	if (!resolved.repository) throw selectionError(resolved);
	return { repository: resolved.repository, request };
}

async function connect(
	options: ParsedArtifactArguments,
	runtime: ArtifactCliRuntime,
): Promise<ArtifactConnection> {
	return options.profile ? remoteConnection(options, runtime) : localConnection(options, runtime);
}

async function catalog(connection: ArtifactConnection): Promise<ArtifactCatalogResponse> {
	const response = await requireResponse(
		await connection.request(API_ROUTES.artifacts(connection.repository.id)),
		true,
	);
	return (await response.json()) as ArtifactCatalogResponse;
}

function artifact(catalogResponse: ArtifactCatalogResponse, selector: string): ArtifactCatalogItem {
	const normalized = selector.toLocaleLowerCase();
	const item = catalogResponse.artifacts.find(
		(candidate) =>
			candidate.definition.id === selector ||
			candidate.definition.name.toLocaleLowerCase() === normalized,
	);
	if (!item) throw new Error(`Artifact '${selector}' is not configured for this repository.`);
	return item;
}

function terminal(status: ArtifactRun["status"]): boolean {
	return status === "succeeded" || status === "failed" || status === "stopped";
}

function emitLog(runtime: ArtifactCliRuntime, text: string): void {
	runtime.stderr.write(text);
}

async function waitForRun(
	connection: ArtifactConnection,
	artifactId: string,
	started: ArtifactRun,
	runtime: ArtifactCliRuntime,
): Promise<ArtifactRun> {
	let interrupted = false;
	let stopRequested = false;
	const requestStop = (): void => {
		interrupted = true;
		if (stopRequested || terminal(started.status)) return;
		stopRequested = true;
		void connection.request(
			API_ROUTES.artifactRunStop(connection.repository.id, artifactId, started.id),
			{ method: "POST" },
		);
	};
	const removeInterrupt = runtime.onInterrupt(requestStop);
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	try {
		const response = await requireResponse(
			await connection.request(
				API_ROUTES.artifactRunEvents(connection.repository.id, artifactId, started.id),
			),
		);
		if (!response.body) throw new Error("The Couchview server returned no artifact event stream.");
		reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let lastSequence = 0;
		while (true) {
			const result = await reader.read();
			buffer += decoder.decode(result.value, { stream: !result.done });
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const data = block
					.split("\n")
					.filter((line) => line.startsWith("data: "))
					.map((line) => line.slice(6))
					.join("\n");
				if (data) {
					const event = JSON.parse(data) as ArtifactRunEvent;
					if (event.type === "snapshot") {
						for (const chunk of event.snapshot.output) {
							if (chunk.sequence > lastSequence) emitLog(runtime, chunk.text);
							lastSequence = Math.max(lastSequence, chunk.sequence);
						}
						if (terminal(event.snapshot.run.status)) {
							if (interrupted) throw new ArtifactCliInterrupted();
							return event.snapshot.run;
						}
					} else if (event.type === "output") {
						if (event.chunk.sequence > lastSequence) emitLog(runtime, event.chunk.text);
						lastSequence = Math.max(lastSequence, event.chunk.sequence);
					} else if (terminal(event.run.status)) {
						if (interrupted) throw new ArtifactCliInterrupted();
						return event.run;
					}
				}
				boundary = buffer.indexOf("\n\n");
			}
			if (result.done) break;
		}
		throw new Error("The artifact event stream ended before the build completed.");
	} finally {
		removeInterrupt();
		await reader?.cancel().catch(() => undefined);
	}
}

async function buildArtifact(
	connection: ArtifactConnection,
	item: ArtifactCatalogItem,
	runtime: ArtifactCliRuntime,
): Promise<{ run: ArtifactRun; build: ArtifactBuild }> {
	const response = await requireResponse(
		await connection.request(
			API_ROUTES.artifactRuns(connection.repository.id, item.definition.id),
			{ method: "POST" },
		),
	);
	const started = (await response.json()) as ArtifactRunResponse;
	const run = await waitForRun(connection, item.definition.id, started.run, runtime);
	if (run.status !== "succeeded" || !run.buildId) {
		throw new Error(
			run.status === "stopped"
				? "Artifact build was cancelled."
				: (run.error ?? `Artifact command exited with ${run.exitCode ?? "an unknown status"}.`),
		);
	}
	const refreshed = artifact(await catalog(connection), item.definition.id);
	const build = refreshed.builds.find((candidate) => candidate.id === run.buildId);
	if (!build) throw new Error("The completed artifact snapshot is unavailable.");
	return { run, build };
}

async function downloadArtifact(
	connection: ArtifactConnection,
	item: ArtifactCatalogItem,
	build: ArtifactBuild,
	options: ParsedArtifactArguments,
	runtime: ArtifactCliRuntime,
): Promise<string> {
	const target = path.resolve(runtime.cwd(), options.output ?? build.downloadName);
	const existing = await lstat(target).catch(() => null);
	if (existing && !options.force) {
		throw new Error(`Refusing to overwrite ${target}; use --force or --output.`);
	}
	const response = await requireResponse(
		await connection.request(
			API_ROUTES.artifactDownload(connection.repository.id, item.definition.id, build.id),
		),
	);
	const contentLength = response.headers.get("content-length");
	const declaredSize = contentLength === null ? null : Number(contentLength);
	const etag = response.headers.get("etag")?.replace(/^"|"$/g, "");
	const executableHeader = response.headers.get(ARTIFACT_EXECUTABLE_HEADER);
	if (executableHeader === null) {
		throw new Error(
			"This Couchview server does not provide executable artifact metadata; update Couchview on the server.",
		);
	}
	const executable = executableHeader === "1";
	if (
		(declaredSize !== null && declaredSize !== build.sizeBytes) ||
		(etag !== undefined && etag !== build.sha256) ||
		(executableHeader !== "0" && executableHeader !== "1") ||
		executable !== build.executable ||
		!response.body
	) {
		throw new Error("The Couchview server returned inconsistent artifact metadata.");
	}
	const temporary = path.join(
		path.dirname(target),
		`.${path.basename(target)}.tmp-${randomUUID()}`,
	);
	const hash = createHash("sha256");
	let sizeBytes = 0;
	const verifier = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			sizeBytes += chunk.byteLength;
			if (sizeBytes > build.sizeBytes) {
				callback(new Error("Artifact download exceeded its declared size."));
				return;
			}
			hash.update(chunk);
			callback(null, chunk);
		},
	});
	try {
		await pipeline(
			Readable.fromWeb(response.body as never),
			verifier,
			createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
		);
		const digest = hash.digest("hex");
		if (sizeBytes !== build.sizeBytes || digest !== build.sha256) {
			throw new Error("Artifact download failed size or SHA-256 verification.");
		}
		if (process.platform !== "win32") {
			const umask = process.umask();
			const mode = (executable ? 0o777 : 0o666) & ~umask;
			await chmod(temporary, executable ? mode | 0o100 : mode);
		}
		if (!options.force) {
			try {
				await link(temporary, target);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") {
					throw new Error(`Refusing to overwrite ${target}; use --force or --output.`);
				}
				throw error;
			}
			await rm(temporary);
		} else {
			try {
				await rename(temporary, target);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "EEXIST" && code !== "EPERM") throw error;
				await rm(target, { force: true });
				await rename(temporary, target);
			}
		}
		return target;
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined);
		throw error;
	}
}

function writeJson(runtime: ArtifactCliRuntime, value: unknown): void {
	runtime.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeList(
	runtime: ArtifactCliRuntime,
	connection: ArtifactConnection,
	response: ArtifactCatalogResponse,
): void {
	if (!response.artifacts.length) {
		runtime.stdout.write(
			`No artifacts are configured for ${connection.repository.name} (${connection.repository.id}).\n`,
		);
		return;
	}
	for (const item of response.artifacts) {
		const latest = item.builds[0];
		runtime.stdout.write(
			`${item.definition.name}\t${item.definition.outputKind}\t${latest ? `${latest.sizeBytes} bytes  ${latest.createdAt}` : "not built"}\n`,
		);
	}
}

export async function runArtifactCli(
	options: ParsedArtifactArguments,
	runtimeOverrides: Partial<ArtifactCliRuntime> = {},
): Promise<number> {
	const runtime = { ...defaultRuntime(), ...runtimeOverrides };
	try {
		const connection = await connect(options, runtime);
		const catalogResponse = await catalog(connection);
		if (options.action === "list") {
			if (options.json) {
				writeJson(runtime, { repository: connection.repository, ...catalogResponse });
			} else {
				writeList(runtime, connection, catalogResponse);
			}
			return 0;
		}
		const item = artifact(catalogResponse, options.name!);
		if (options.action === "build" || options.action === "pull") {
			const built = await buildArtifact(connection, item, runtime);
			if (options.action === "build") {
				if (options.json) {
					writeJson(runtime, {
						repository: connection.repository,
						artifact: item.definition,
						...built,
					});
				} else {
					runtime.stdout.write(
						`Built ${item.definition.name}: ${built.build.sizeBytes} bytes, sha256 ${built.build.sha256}\n`,
					);
				}
				return 0;
			}
			const output = await downloadArtifact(connection, item, built.build, options, runtime);
			if (options.json) {
				writeJson(runtime, {
					repository: connection.repository,
					artifact: item.definition,
					...built,
					output,
				});
			} else {
				runtime.stdout.write(`Downloaded ${item.definition.name} to ${output}\n`);
			}
			return 0;
		}
		const selectedBuild = options.build
			? item.builds.find((build) => build.id === options.build)
			: item.builds[0];
		if (!selectedBuild) {
			throw new Error(
				options.build
					? `Retained build '${options.build}' was not found for ${item.definition.name}.`
					: `${item.definition.name} has no successful build to download.`,
			);
		}
		const output = await downloadArtifact(connection, item, selectedBuild, options, runtime);
		if (options.json) {
			writeJson(runtime, {
				repository: connection.repository,
				artifact: item.definition,
				build: selectedBuild,
				output,
			});
		} else {
			runtime.stdout.write(`Downloaded ${item.definition.name} to ${output}\n`);
		}
		return 0;
	} catch (error) {
		if (error instanceof ArtifactCliInterrupted) return 130;
		throw error;
	}
}
