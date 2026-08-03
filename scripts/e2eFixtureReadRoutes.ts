import type {
	BootstrapResponse,
	ChangesResponse,
	GitCommitChangesResponse,
	GitHistoryResponse,
	PackageRunEvent,
	ReviewStateResponse,
} from "../src/shared/contracts.ts";
import { API_ROUTES } from "../src/shared/contracts.ts";
import {
	comments,
	diffs,
	files,
	historyCommits,
	historyDiff,
	historyFiles,
	packageScripts,
	repository,
	repositoryCatalog,
	reviews,
} from "./e2eFixtureData.ts";
import { fixtureCsrfToken, fixtureJson, fixtureSecurityHeaders } from "./e2eFixtureHttp.ts";
import type { FixtureMutableState, FixtureRequestContext } from "./e2eFixtureRouteTypes.ts";

function eventStream(value: unknown): Response {
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
		},
	});
	return new Response(body, {
		headers: {
			...fixtureSecurityHeaders,
			"Cache-Control": "no-cache, no-store, no-transform",
			"Content-Type": "text/event-stream",
			"X-Accel-Buffering": "no",
		},
	});
}

export function handleFixtureReadRoute(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): Response | null {
	const { request, url, repositoryId, nestedPath, selectedRepository, fileRoute, packageRunRoute } =
		context;
	if (request.method !== "GET") return null;

	if (url.pathname === API_ROUTES.accessRefresh) {
		const destination = new URL("/", url);
		const selectedId = url.searchParams.get("repo");
		if (selectedId) destination.searchParams.set("repo", selectedId);
		destination.searchParams.set("access_refresh", "1");
		return Response.redirect(destination, 302);
	}
	if (url.pathname === API_ROUTES.accessLogout) {
		return Response.redirect(new URL("/cdn-cgi/access/logout", url), 302);
	}
	if (url.pathname === API_ROUTES.bootstrap) {
		if (request.headers.get("x-e2e-cloudflare-access-redirect") === "1") {
			return new Response(null, {
				status: 302,
				headers: {
					Location:
						"https://angrypie.cloudflareaccess.com/cdn-cgi/access/login/couchview.angrypie.dev",
				},
			});
		}
		return fixtureJson({
			csrfToken: fixtureCsrfToken,
			repositories: repositoryCatalog,
			defaultRepositoryId: repository.id,
			catalogRevision: 1,
			restart: {
				available: false,
				reason: "Restart is unavailable in the browser test fixture.",
			},
			commitMessage: { available: true, reason: null },
			codex: {
				available: false,
				reason: "Codex is not available in the browser test fixture.",
			},
			terminal: {
				available: true,
				reason: null,
				persistence: "tmux",
				profiles: [{ id: "tmux", label: "tmux", available: true, reason: null }],
			},
			remoteBridge: {
				available: false,
				reason: "Native remote development is unavailable in the browser test fixture.",
				p2pEnabled: false,
			},
			settingsProfiles: state.settingsProfiles,
		} satisfies BootstrapResponse);
	}
	if (url.pathname === API_ROUTES.settingsProfiles) {
		return fixtureJson({ profiles: state.settingsProfiles });
	}
	if (url.pathname === API_ROUTES.repositories) {
		return fixtureJson({ repositories: repositoryCatalog, catalogRevision: 1 });
	}
	if (url.pathname === "/api/e2e/terminal") {
		return fixtureJson(state.terminal.diagnostics());
	}
	if (context.repositoryId && !selectedRepository) {
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
	const gitStatus = {
		previousBranch: state.gitDetached ? repository.branch : null,
		stashCount: state.gitStashCount,
		canUndoLastCommit: !state.gitDetached,
		trackedChangeCount: files.filter((file) => file.kind !== "untracked").length,
		untrackedChangeCount: files.filter((file) => file.kind === "untracked").length,
	};
	if (nestedPath === "git/history") {
		return fixtureJson({
			commits: historyCommits,
			nextCursor: null,
			historyRevision: `fixture-history-${state.gitHead}`,
			scope: url.searchParams.get("scope") === "all" ? "all" : "current",
			status: gitStatus,
		} satisfies GitHistoryResponse);
	}
	const historyCommitRoute = /^git\/history\/([0-9a-f]{40})$/.exec(nestedPath);
	if (historyCommitRoute) {
		const commit = historyCommits.find((candidate) => candidate.id === historyCommitRoute[1]);
		return commit
			? fixtureJson({ commit, files: historyFiles } satisfies GitCommitChangesResponse)
			: fixtureJson({ error: { code: "not_found", message: "Fixture commit not found" } }, 404);
	}
	const historyDiffRoute = /^git\/history\/([0-9a-f]{40})\/files\/([^/]+)\/diff$/.exec(nestedPath);
	if (historyDiffRoute) {
		return historyDiffRoute[2] === historyFiles[0]?.id
			? fixtureJson(historyDiff)
			: fixtureJson({ error: { code: "not_found", message: "Fixture file not found" } }, 404);
	}
	if (nestedPath === "files") {
		return fixtureJson({
			repository:
				state.gitDetached && selectedRepository?.id === repository.id
					? { ...selectedRepository, branch: null, head: state.gitHead }
					: selectedRepository!,
			files,
			operationRevision: state.operationRevision,
		} satisfies ChangesResponse);
	}
	if (nestedPath === "terminal") return fixtureJson(state.terminal.status());
	if (fileRoute?.[2] === "diff") {
		const diff = diffs[decodeURIComponent(fileRoute[1] || "")];
		return diff
			? fixtureJson({
					...diff,
					diff: { ...diff.diff, operationRevision: state.operationRevision },
				})
			: fixtureJson({ error: { code: "not_found", message: "Fixture file not found" } }, 404);
	}
	if (nestedPath === "comments") {
		return fixtureJson({ reviews, comments } satisfies ReviewStateResponse);
	}
	if (nestedPath === "package-scripts") return fixtureJson(packageScripts);
	if (nestedPath === "package-runs") {
		return fixtureJson({ runs: state.packageRuns });
	}
	if (nestedPath === "search") {
		const query = url.searchParams.get("q") || "";
		const currentPath = url.searchParams.get("currentPath") || files[0]!.path;
		return fixtureJson({
			query,
			currentPath,
			currentFile: [
				{
					path: currentPath,
					line: 2,
					column: 16,
					preview: "  const result = load(path);",
				},
			],
			otherFiles: [
				{
					path: "src/format.ts",
					line: 2,
					column: 10,
					preview: "  return value.trim();",
				},
			],
			truncated: false,
		});
	}
	if (nestedPath === "source") {
		const sourcePath = url.searchParams.get("path") || files[0]!.path;
		const focusLine = Number(url.searchParams.get("line") || 2);
		return fixtureJson({
			path: sourcePath,
			focusLine,
			startLine: 1,
			endLine: 4,
			lines: [
				{ line: 1, text: "export function fixture() {" },
				{ line: 2, text: "  return true;" },
				{ line: 3, text: "}" },
				{ line: 4, text: "" },
			],
			truncated: false,
		});
	}
	if (nestedPath === "events") {
		return eventStream({
			type: "ready",
			repositoryId,
			operationRevision: state.operationRevision,
			stateRevision: reviews.length + comments.length,
			catalogRevision: 1,
			at: new Date().toISOString(),
		});
	}
	if (packageRunRoute?.[2] === "events") {
		const run = state.packageRuns.find(
			(candidate) => candidate.id === decodeURIComponent(packageRunRoute[1] || ""),
		);
		if (!run) {
			return fixtureJson(
				{
					error: {
						code: "package_run_not_found",
						message: "Fixture package run not found",
					},
				},
				404,
			);
		}
		const event: PackageRunEvent = {
			type: "snapshot",
			snapshot: {
				run,
				output: [
					{
						sequence: 1,
						stream: "stdout",
						text: `fixture output: ${run.invocation}\n`,
					},
				],
			},
		};
		return eventStream(event);
	}
	return null;
}
