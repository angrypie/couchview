import { resolve, sep } from "node:path";

import type { SettingsProfile } from "../src/shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	DEFAULT_SETTINGS_PROFILE_NAME,
} from "../src/shared/settings.ts";
import {
	alternateRepository,
	comments,
	files,
	initialFiles,
	repository,
	reviews,
} from "./e2eFixtureData.ts";
import { fixtureJson, fixtureSecurityHeaders, requireFixtureCsrf } from "./e2eFixtureHttp.ts";
import { handleFixtureReadRoute } from "./e2eFixtureReadRoutes.ts";
import { handleFixtureReviewMutation } from "./e2eFixtureReviewMutations.ts";
import type { FixtureMutableState, FixtureRequestContext } from "./e2eFixtureRouteTypes.ts";
import { handleFixtureSystemMutation } from "./e2eFixtureSystemMutations.ts";
import { FixtureTerminal, type FixtureTerminalSocketData } from "./e2eFixtureTerminal.ts";

const host = process.env.E2E_HOST || "127.0.0.1";
const port = Number(process.env.E2E_PORT || 4174);
const distRoot = resolve(import.meta.dir, "..", "dist");

function defaultSettingsProfile(): SettingsProfile {
	return {
		id: DEFAULT_SETTINGS_PROFILE_ID,
		name: DEFAULT_SETTINGS_PROFILE_NAME,
		data: createDefaultSettingsProfileData(),
		revision: 1,
		createdAt: "2026-07-31T00:00:00.000Z",
		updatedAt: "2026-07-31T00:00:00.000Z",
	};
}

const state: FixtureMutableState = {
	operationRevision: "fixture-operation-1",
	packageRuns: [],
	settingsProfileCounter: 0,
	settingsProfiles: [defaultSettingsProfile()],
	terminal: new FixtureTerminal(),
	reset() {
		files.splice(0, files.length, ...structuredClone(initialFiles));
		reviews.splice(0);
		comments.splice(0);
		this.packageRuns = [];
		this.settingsProfileCounter = 0;
		this.settingsProfiles = [defaultSettingsProfile()];
		this.operationRevision = "fixture-operation-1";
		this.terminal.reset();
	},
};

async function serveStatic(pathname: string, request: Request): Promise<Response> {
	const decodedPath = decodeURIComponent(pathname);
	const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
	const candidate = resolve(distRoot, relativePath);
	const insideDist = candidate === distRoot || candidate.startsWith(`${distRoot}${sep}`);

	if (insideDist) {
		const file = Bun.file(candidate);
		if (await file.exists()) {
			return new Response(file, {
				headers: {
					...fixtureSecurityHeaders,
					"Cache-Control":
						relativePath === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
					...(file.type ? { "Content-Type": file.type } : {}),
				},
			});
		}
	}
	if (request.headers.get("accept")?.includes("text/html")) {
		const index = Bun.file(resolve(distRoot, "index.html"));
		return new Response(index, {
			headers: {
				...fixtureSecurityHeaders,
				"Cache-Control": "no-cache",
				"Content-Type": "text/html; charset=utf-8",
			},
		});
	}
	return new Response("Not found", {
		status: 404,
		headers: fixtureSecurityHeaders,
	});
}

function requestContext(request: Request): FixtureRequestContext {
	const url = new URL(request.url);
	const repositoryRoute = /^\/api\/repositories\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
	const repositoryId = repositoryRoute?.[1] ? decodeURIComponent(repositoryRoute[1]) : null;
	const selectedRepository =
		repositoryId === repository.id
			? repository
			: repositoryId === alternateRepository.id
				? alternateRepository
				: null;
	const nestedPath = repositoryRoute?.[2] || "";
	return {
		request,
		url,
		repositoryId,
		selectedRepository,
		nestedPath,
		fileRoute: /^files\/([^/]+)\/(diff|stage|review|comments)$/.exec(nestedPath),
		commentRoute: /^comments\/([^/]+)$/.exec(nestedPath),
		packageRunRoute: /^package-runs\/([^/]+)(?:\/(stop|events))?$/.exec(nestedPath),
	};
}

const server = Bun.serve<FixtureTerminalSocketData>({
	hostname: host,
	port,
	idleTimeout: 255,
	websocket: state.terminal.websocket,
	async fetch(request, bunServer) {
		const context = requestContext(request);
		if (context.nestedPath === "terminal/socket" && request.method === "GET") {
			return state.terminal.consumeUpgrade(
				request,
				bunServer,
				context.repositoryId,
				context.selectedRepository !== null,
			);
		}

		const readResponse = handleFixtureReadRoute(state, context);
		if (readResponse) return readResponse;
		if (context.repositoryId && !context.selectedRepository) {
			return fixtureJson(
				{
					error: {
						code: "repository_not_found",
						message: "Fixture repository not found",
					},
				},
				404,
			);
		}
		if (context.url.pathname.startsWith("/api/") && request.method !== "GET") {
			const csrfError = requireFixtureCsrf(request);
			if (csrfError) return csrfError;
		}

		const systemResponse = await handleFixtureSystemMutation(state, context);
		if (systemResponse) return systemResponse;
		const reviewResponse = await handleFixtureReviewMutation(state, context);
		if (reviewResponse) return reviewResponse;
		if (context.url.pathname.startsWith("/api/")) {
			return fixtureJson(
				{
					error: {
						code: "not_found",
						message: "Fixture API route not found",
					},
				},
				404,
			);
		}
		return serveStatic(context.url.pathname, request);
	},
});

console.log(`Couchview e2e fixture listening at ${server.url}`);

function stop() {
	void server.stop(true);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
