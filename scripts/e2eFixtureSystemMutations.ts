import type {
	PackageRunSummary,
	SettingsProfile,
	SettingsProfileData,
	TerminalAttachmentRequest,
} from "../src/shared/contracts.ts";
import { API_ROUTES } from "../src/shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	DEFAULT_SETTINGS_PROFILE_NAME,
} from "../src/shared/settings.ts";
import { packageScripts } from "./e2eFixtureData.ts";
import { fixtureJson, fixtureSecurityHeaders } from "./e2eFixtureHttp.ts";
import type { FixtureMutableState, FixtureRequestContext } from "./e2eFixtureRouteTypes.ts";

export async function handleFixtureSystemMutation(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): Promise<Response | null> {
	const { request, url, repositoryId, nestedPath, packageRunRoute } = context;
	if (request.method === "GET") return null;

	if (url.pathname === "/api/e2e/reset" && request.method === "POST") {
		state.reset();
		return fixtureJson({ reset: true });
	}
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
