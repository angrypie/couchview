import type {
	ArtifactBuild,
	ArtifactDefinition,
	ArtifactRun,
	PackageRunSummary,
	SettingsProfile,
	SettingsProfileData,
	TerminalAttachmentRequest,
} from "../src/shared/contracts.ts";
import {
	API_ROUTES,
	NATIVE_CLIENT_PROTOCOL,
	parseArtifactDefinitionInput,
	quoteArtifactInvocation,
} from "../src/shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	DEFAULT_SETTINGS_PROFILE_NAME,
} from "../src/shared/settings.ts";
import { packageScripts } from "./e2eFixtureData.ts";
import { fixtureJson, fixtureSecurityHeaders } from "./e2eFixtureHttp.ts";
import type { FixtureMutableState, FixtureRequestContext } from "./e2eFixtureRouteTypes.ts";

function scheduleArtifactWork(state: FixtureMutableState, delay: number, work: () => void): void {
	const timer = setTimeout(() => {
		state.artifactTimers.delete(timer);
		work();
	}, delay);
	state.artifactTimers.add(timer);
}

function completeArtifactBuild(
	state: FixtureMutableState,
	definition: ArtifactDefinition,
	run: ArtifactRun,
): void {
	if (run.status !== "running") return;
	const payload = new TextEncoder().encode(
		`fixture artifact: ${definition.name}\noutput: ${definition.outputPath}\n`,
	);
	const buildId = `fixture-artifact-build-${state.artifactBuilds.length + 1}`;
	const basename = definition.outputPath.split("/").at(-1) ?? definition.name;
	const build: ArtifactBuild = {
		id: buildId,
		repositoryId: definition.repositoryId,
		artifactId: definition.id,
		definitionRevision: definition.revision,
		downloadName: definition.outputKind === "directory" ? `${basename}.tar.gz` : basename,
		mediaType:
			definition.outputKind === "directory" ? "application/gzip" : "application/octet-stream",
		sizeBytes: payload.byteLength,
		sha256: new Bun.CryptoHasher("sha256").update(payload).digest("hex"),
		executable: false,
		createdAt: new Date().toISOString(),
	};
	state.artifactPayloads.set(build.id, payload);
	state.artifactBuilds = [build, ...state.artifactBuilds];
	const retained = state.artifactBuilds
		.filter((candidate) => candidate.artifactId === definition.id)
		.slice(2);
	for (const obsolete of retained) state.artifactPayloads.delete(obsolete.id);
	const retainedIds = new Set(retained.map((candidate) => candidate.id));
	state.artifactBuilds = state.artifactBuilds.filter((candidate) => !retainedIds.has(candidate.id));
	run.status = "succeeded";
	run.exitCode = 0;
	run.finishedAt = new Date().toISOString();
	run.buildId = build.id;
}

function handleNativeClientMutation(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): Response | null {
	const { request, url } = context;
	if (url.pathname === API_ROUTES.nativeClientPairings && request.method === "POST") {
		state.nativePairingCounter += 1;
		const code = `ABCDEF${String(state.nativePairingCounter + 21).slice(-2)}`;
		const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
		const serverId = "11111111-2222-4333-8444-555555555555";
		const deepLink = new URL("couchview://pair");
		deepLink.searchParams.set("protocol", NATIVE_CLIENT_PROTOCOL);
		deepLink.searchParams.set("baseUrl", url.origin);
		deepLink.searchParams.set("serverId", serverId);
		deepLink.searchParams.set("code", code);
		deepLink.searchParams.set("expiresAt", expiresAt);
		return fixtureJson(
			{
				protocol: NATIVE_CLIENT_PROTOCOL,
				baseUrl: url.origin,
				serverId,
				code,
				expiresAt,
				deepLink: deepLink.toString(),
			},
			201,
		);
	}
	const nativeClientRoute = /^\/api\/native-clients\/([^/]+)$/.exec(url.pathname);
	if (nativeClientRoute && request.method === "DELETE") {
		const clientId = decodeURIComponent(nativeClientRoute[1] ?? "");
		state.nativeClients = state.nativeClients.filter((client) => client.id !== clientId);
		return new Response(null, { status: 204, headers: fixtureSecurityHeaders });
	}
	return null;
}

export async function handleFixtureSystemMutation(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): Promise<Response | null> {
	const {
		request,
		url,
		repositoryId,
		nestedPath,
		packageRunRoute,
		artifactRoute,
		artifactRunRoute,
	} = context;
	if (request.method === "GET") return null;

	if (url.pathname === "/api/e2e/reset" && request.method === "POST") {
		state.reset();
		return fixtureJson({ reset: true });
	}
	const nativeClientResponse = handleNativeClientMutation(state, context);
	if (nativeClientResponse) return nativeClientResponse;
	if (url.pathname === API_ROUTES.settingsProfiles && request.method === "POST") {
		const input = (await request.json()) as {
			name: string;
			sourceProfileId?: string;
		};
		const source = input.sourceProfileId
			? state.settingsProfiles.find((profile) => profile.id === input.sourceProfileId)
			: undefined;
		if (input.sourceProfileId && !source) {
			return fixtureJson(
				{
					error: {
						code: "settings_profile_not_found",
						message: "Fixture profile not found",
					},
				},
				404,
			);
		}
		const now = new Date().toISOString();
		const profile: SettingsProfile = {
			id: `fixture-settings-${++state.settingsProfileCounter}`,
			name: input.name.trim(),
			data: structuredClone(source?.data ?? createDefaultSettingsProfileData()),
			revision: 1,
			createdAt: now,
			updatedAt: now,
		};
		state.settingsProfiles = [...state.settingsProfiles, profile];
		return fixtureJson({ profile }, 201);
	}
	const profileRoute = /^\/api\/settings\/profiles\/([^/]+)$/.exec(url.pathname);
	if (profileRoute && request.method === "PUT") {
		const profileId = decodeURIComponent(profileRoute[1] || "");
		const input = (await request.json()) as {
			name: string;
			data: SettingsProfileData;
			expectedRevision: number;
		};
		const previous = state.settingsProfiles.find((profile) => profile.id === profileId);
		if (!previous) {
			return fixtureJson(
				{
					error: {
						code: "settings_profile_not_found",
						message: "Fixture profile not found",
					},
				},
				404,
			);
		}
		if (previous.revision !== input.expectedRevision) {
			return fixtureJson(
				{
					error: {
						code: "stale_settings_profile",
						message: "Fixture profile changed in another browser",
					},
				},
				409,
			);
		}
		const profile: SettingsProfile = {
			...previous,
			name:
				profileId === DEFAULT_SETTINGS_PROFILE_ID
					? DEFAULT_SETTINGS_PROFILE_NAME
					: input.name.trim(),
			data: structuredClone(input.data),
			revision: previous.revision + 1,
			updatedAt: new Date().toISOString(),
		};
		state.settingsProfiles = state.settingsProfiles.map((item) =>
			item.id === profileId ? profile : item,
		);
		return fixtureJson({ profile });
	}
	if (profileRoute && request.method === "DELETE") {
		const profileId = decodeURIComponent(profileRoute[1] || "");
		if (profileId === DEFAULT_SETTINGS_PROFILE_ID) {
			return fixtureJson(
				{
					error: {
						code: "default_profile_required",
						message: "Default is required",
					},
				},
				409,
			);
		}
		state.settingsProfiles = state.settingsProfiles.filter((profile) => profile.id !== profileId);
		return new Response(null, { status: 204, headers: fixtureSecurityHeaders });
	}
	if (url.pathname === "/api/e2e/terminal/p2p/fail" && request.method === "POST") {
		return state.terminal.failP2p();
	}
	if (nestedPath === "terminal/attachments" && request.method === "POST") {
		const body = (await request.json()) as TerminalAttachmentRequest;
		return state.terminal.issueAttachment(repositoryId!, body);
	}
	if (nestedPath === "terminal/lease" && request.method === "POST") {
		return state.terminal.renewLease();
	}
	if (nestedPath === "terminal/end" && request.method === "POST") {
		return state.terminal.end();
	}
	if (nestedPath === "package-runs" && request.method === "POST") {
		const input = (await request.json()) as {
			packagePath: string;
			scriptName: string;
			manifestRevision: string;
		};
		const packageEntry = packageScripts.packages.find(
			(candidate) => candidate.packagePath === input.packagePath,
		);
		const script = packageEntry?.scripts.find((candidate) => candidate.name === input.scriptName);
		if (!packageEntry || !script || packageEntry.manifestRevision !== input.manifestRevision) {
			return fixtureJson(
				{
					error: {
						code: "package_scripts_changed",
						message: "Fixture package scripts changed",
					},
				},
				409,
			);
		}
		const now = new Date();
		const run: PackageRunSummary = {
			id: `fixture-package-run-${state.packageRuns.length + 1}`,
			repositoryId: repositoryId!,
			packagePath: packageEntry.packagePath,
			packageName: packageEntry.name,
			directory: packageEntry.directory,
			scriptName: script.name,
			command: script.command,
			runner: packageEntry.runner,
			invocation: `${packageEntry.runner} run ${script.name}`,
			status: "succeeded",
			exitCode: 0,
			startedAt: now.toISOString(),
			finishedAt: new Date(now.getTime() + 350).toISOString(),
			outputTruncated: false,
		};
		state.packageRuns = [run, ...state.packageRuns];
		return fixtureJson({ run }, 201);
	}
	if (nestedPath === "artifacts/proposal" && request.method === "POST") {
		const input = (await request.json()) as {
			request?: string;
			codex?: { model?: string; reasoning?: string };
		};
		return fixtureJson({
			proposal: {
				name: input.request?.trim() ? "suggested-static" : "suggested-default",
				argv: ["bun", "run", "build"],
				workingDirectory: ".",
				outputPath: "dist/suggested-app",
				outputKind: "file",
			},
			summary: `Fixture suggestion using ${input.codex?.model ?? "default model"}.`,
			configurationFiles: ["package.json"],
		});
	}
	if (nestedPath === "artifacts" && request.method === "POST") {
		let input;
		try {
			input = parseArtifactDefinitionInput(await request.json());
		} catch (error) {
			return fixtureJson(
				{
					error: {
						code: "artifact_definition_invalid",
						message: error instanceof Error ? error.message : String(error),
					},
				},
				400,
			);
		}
		if (
			state.artifactDefinitions.some(
				(definition) => definition.repositoryId === repositoryId && definition.name === input.name,
			)
		) {
			return fixtureJson(
				{ error: { code: "artifact_name_conflict", message: "Artifact name already exists" } },
				409,
			);
		}
		const now = new Date().toISOString();
		const definition: ArtifactDefinition = {
			...input,
			id: `fixture-artifact-${state.artifactDefinitions.length + 1}`,
			repositoryId: repositoryId!,
			revision: 1,
			createdAt: now,
			updatedAt: now,
		};
		state.artifactDefinitions = [...state.artifactDefinitions, definition];
		return fixtureJson({ definition }, 201);
	}
	if (artifactRoute && request.method === "PUT") {
		const artifactId = decodeURIComponent(artifactRoute[1] ?? "");
		const previous = state.artifactDefinitions.find(
			(definition) => definition.repositoryId === repositoryId && definition.id === artifactId,
		);
		if (!previous) {
			return fixtureJson(
				{ error: { code: "artifact_not_found", message: "Fixture artifact not found" } },
				404,
			);
		}
		const body = (await request.json()) as Record<string, unknown>;
		if (body.expectedRevision !== previous.revision) {
			return fixtureJson(
				{
					error: {
						code: "stale_artifact_definition",
						message: "Fixture artifact changed in another browser",
					},
				},
				409,
			);
		}
		let input;
		try {
			input = parseArtifactDefinitionInput(body);
		} catch (error) {
			return fixtureJson(
				{
					error: {
						code: "artifact_definition_invalid",
						message: error instanceof Error ? error.message : String(error),
					},
				},
				400,
			);
		}
		const definition: ArtifactDefinition = {
			...previous,
			...input,
			revision: previous.revision + 1,
			updatedAt: new Date().toISOString(),
		};
		state.artifactDefinitions = state.artifactDefinitions.map((candidate) =>
			candidate.id === definition.id ? definition : candidate,
		);
		return fixtureJson({ definition });
	}
	if (artifactRoute && request.method === "DELETE") {
		const artifactId = decodeURIComponent(artifactRoute[1] ?? "");
		state.artifactDefinitions = state.artifactDefinitions.filter(
			(definition) => definition.id !== artifactId,
		);
		for (const build of state.artifactBuilds.filter(
			(candidate) => candidate.artifactId === artifactId,
		)) {
			state.artifactPayloads.delete(build.id);
		}
		state.artifactBuilds = state.artifactBuilds.filter(
			(candidate) => candidate.artifactId !== artifactId,
		);
		return new Response(null, { status: 204, headers: fixtureSecurityHeaders });
	}
	if (artifactRunRoute && !artifactRunRoute[2] && request.method === "POST") {
		const artifactId = decodeURIComponent(artifactRunRoute[1] ?? "");
		const definition = state.artifactDefinitions.find(
			(candidate) => candidate.repositoryId === repositoryId && candidate.id === artifactId,
		);
		if (!definition) {
			return fixtureJson(
				{ error: { code: "artifact_not_found", message: "Fixture artifact not found" } },
				404,
			);
		}
		if (
			state.artifactRuns.some(
				(candidate) =>
					candidate.artifactId === artifactId &&
					["running", "stopping", "capturing"].includes(candidate.status),
			)
		) {
			return fixtureJson(
				{ error: { code: "artifact_running", message: "Fixture artifact is already building" } },
				409,
			);
		}
		const run: ArtifactRun = {
			id: `fixture-artifact-run-${state.artifactRuns.length + 1}`,
			repositoryId: repositoryId!,
			artifactId,
			artifactName: definition.name,
			definitionRevision: definition.revision,
			argv: [...definition.argv],
			invocation: quoteArtifactInvocation(definition.argv),
			workingDirectory: definition.workingDirectory,
			status: "running",
			exitCode: null,
			startedAt: new Date().toISOString(),
			finishedAt: null,
			outputTruncated: false,
			error: null,
			buildId: null,
		};
		state.artifactRuns = [run, ...state.artifactRuns];
		state.artifactRunOutputs.set(run.id, [
			{
				sequence: 1,
				stream: "stdout",
				text: `fixture build started: ${run.invocation}\n`,
			},
		]);
		scheduleArtifactWork(state, 350, () => {
			if (run.status !== "running") return;
			state.artifactRunOutputs.get(run.id)?.push({
				sequence: 2,
				stream: "stdout",
				text: "fixture artifact captured\n",
			});
		});
		scheduleArtifactWork(state, 2_500, () => completeArtifactBuild(state, definition, run));
		return fixtureJson({ run }, 201);
	}
	if (artifactRunRoute?.[3] === "stop" && request.method === "POST") {
		const runId = decodeURIComponent(artifactRunRoute[2] ?? "");
		const run = state.artifactRuns.find((candidate) => candidate.id === runId);
		if (!run) {
			return fixtureJson(
				{ error: { code: "artifact_run_not_found", message: "Fixture run not found" } },
				404,
			);
		}
		run.status = "stopped";
		run.finishedAt = new Date().toISOString();
		return fixtureJson({ run });
	}
	if (packageRunRoute?.[2] === "stop" && request.method === "POST") {
		const run = state.packageRuns.find(
			(candidate) => candidate.id === decodeURIComponent(packageRunRoute[1] || ""),
		);
		return run
			? fixtureJson({ run })
			: fixtureJson(
					{
						error: {
							code: "package_run_not_found",
							message: "Fixture package run not found",
						},
					},
					404,
				);
	}
	return null;
}
