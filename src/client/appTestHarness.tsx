import { afterEach, beforeEach } from "bun:test";
import type {
	ChangeFile,
	FileDiff,
	PackageRunSummary,
	SettingsProfile,
} from "../shared/contracts.ts";
import {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	DEFAULT_SETTINGS_PROFILE_NAME,
} from "../shared/settings.ts";
import {
	cleanup,
	EventSourceStub,
	originalFetch,
	originalWebSocket,
	testThemeRuntime,
	viewerCommentJumps,
	viewerHunkJumps,
	viewerState,
} from "./appTestEnvironment.tsx";
import {
	FakeTerminalWebSocket,
	resetFakeTerminalWebSockets,
	resetRendererState,
} from "./terminalTestFakes.ts";

export {
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
} from "../shared/settings.ts";
export {
	App,
	act,
	cleanup,
	EventSourceStub,
	fireEvent,
	fixtureComment,
	render,
	screen,
	viewerCommentJumps,
	viewerHunkJumps,
	waitFor,
	within,
} from "./appTestEnvironment.tsx";
export {
	FakeTerminalWebSocket,
	previewRendererState,
	rendererState,
} from "./terminalTestFakes.ts";

import {
	alternateRepository,
	firstDiff,
	initialFiles,
	packageScriptsFixture,
	repository,
	repositoryCatalog,
	secondDiff,
} from "./appTestData.ts";

export { repository } from "./appTestData.ts";

export function createAppTestHarness() {
	const fixture = {
		files: structuredClone(initialFiles) as ChangeFile[],
		comments: [] as Array<Record<string, unknown>>,
		reviews: [] as Array<Record<string, unknown>>,
		packageRuns: [] as PackageRunSummary[],
		requests: [] as Array<{ path: string; method: string; body: unknown }>,
		catalog: structuredClone(repositoryCatalog),
		repositoryRegistrationFailure: false,
		servedFirstDiff: structuredClone(firstDiff) as FileDiff,
		currentOperationRevision: "operation-1",
		diffFailure: false,
		bulkReviewFailure: false,
		stageFailure: false,
		delayNextDiffResponse: false,
		releaseDiffResponse: null as (() => void) | null,
		delayNextHistoryResponse: false,
		releaseHistoryResponse: null as (() => void) | null,
		delayNextHistoryCommitResponse: false,
		releaseHistoryCommitResponse: null as (() => void) | null,
		historyCommitRequestAborted: false,
		historyPaginated: false,
		historyQueries: [] as string[],
		delayStageResponse: false,
		releaseStageResponse: null as (() => void) | null,
		emitSseDuringStage: false,
		removeActiveFileOnStage: false,
		commitMessageFailure: false,
		delayCommitMessageResponse: false,
		commitMessageRequestAborted: false,
		releaseCommitMessageResponse: null as (() => void) | null,
		commitMessageAvailable: true,
		gitStashCount: 0,
		gitDetached: false,
		terminalAvailable: false,
		remoteBridgeAvailable: false,
		remoteBridgeDevices: [] as Array<Record<string, unknown>>,
		settingsProfiles: [] as SettingsProfile[],
		staleNextSettingsSave: false,
		bootstrapFailureStatus: null as number | null,
		instanceOffline: false,
		get viewerVisibleLineChange() {
			return viewerState.visibleLineChange;
		},
		set viewerVisibleLineChange(value: typeof viewerState.visibleLineChange) {
			viewerState.visibleLineChange = value;
		},
	};

	beforeEach(() => {
		fixture.files = structuredClone(initialFiles);
		fixture.comments = [];
		fixture.reviews = [];
		fixture.packageRuns = [];
		fixture.requests = [];
		fixture.catalog = structuredClone(repositoryCatalog);
		fixture.repositoryRegistrationFailure = false;
		fixture.servedFirstDiff = structuredClone(firstDiff);
		fixture.currentOperationRevision = "operation-1";
		fixture.diffFailure = false;
		fixture.bulkReviewFailure = false;
		fixture.stageFailure = false;
		fixture.delayNextDiffResponse = false;
		fixture.releaseDiffResponse = null;
		fixture.delayNextHistoryResponse = false;
		fixture.releaseHistoryResponse = null;
		fixture.delayNextHistoryCommitResponse = false;
		fixture.releaseHistoryCommitResponse = null;
		fixture.historyCommitRequestAborted = false;
		fixture.historyPaginated = false;
		fixture.historyQueries = [];
		fixture.delayStageResponse = false;
		fixture.releaseStageResponse = null;
		fixture.emitSseDuringStage = false;
		fixture.removeActiveFileOnStage = false;
		fixture.commitMessageFailure = false;
		fixture.delayCommitMessageResponse = false;
		fixture.commitMessageRequestAborted = false;
		fixture.releaseCommitMessageResponse = null;
		fixture.commitMessageAvailable = true;
		fixture.gitStashCount = 0;
		fixture.gitDetached = false;
		fixture.terminalAvailable = false;
		fixture.remoteBridgeAvailable = false;
		fixture.remoteBridgeDevices = [];
		fixture.settingsProfiles = [
			{
				id: DEFAULT_SETTINGS_PROFILE_ID,
				name: DEFAULT_SETTINGS_PROFILE_NAME,
				data: createDefaultSettingsProfileData(),
				revision: 1,
				createdAt: "2026-07-31T00:00:00.000Z",
				updatedAt: "2026-07-31T00:00:00.000Z",
			},
		];
		fixture.staleNextSettingsSave = false;
		fixture.bootstrapFailureStatus = null;
		fixture.instanceOffline = false;
		resetRendererState();
		resetFakeTerminalWebSockets();
		testThemeRuntime.reset();
		EventSourceStub.instances.length = 0;
		viewerCommentJumps.length = 0;
		viewerHunkJumps.length = 0;
		viewerState.visibleLineChange = null;
		localStorage.clear();
		sessionStorage.clear();
		window.history.replaceState(null, "", "/");
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: (query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addEventListener() {},
				removeEventListener() {},
				addListener() {},
				removeListener() {},
				dispatchEvent: () => false,
			}),
		});
		Object.defineProperty(globalThis, "EventSource", {
			configurable: true,
			value: EventSourceStub,
		});
		Object.defineProperty(globalThis, "WebSocket", {
			configurable: true,
			value: FakeTerminalWebSocket,
		});
		Object.defineProperty(window, "WebSocket", {
			configurable: true,
			value: FakeTerminalWebSocket,
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: () => false,
		});
		Object.defineProperty(window, "confirm", {
			configurable: true,
			value: () => true,
		});
		Object.defineProperty(window, "alert", {
			configurable: true,
			value: () => undefined,
		});
		Object.defineProperty(window, "prompt", {
			configurable: true,
			value: () => null,
		});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async () => Promise.reject(new Error("denied")) },
		});

		globalThis.fetch = (async (input, init) => {
			const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const url = new URL(raw, "http://localhost");
			const method = init?.method ?? "GET";
			const body = init?.body ? JSON.parse(String(init.body)) : null;
			fixture.requests.push({ path: url.pathname, method, body });

			const repositoryRoute = /^\/api\/repositories\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
			const requestedRepositoryId = repositoryRoute?.[1]
				? decodeURIComponent(repositoryRoute[1])
				: null;
			const nestedPath = repositoryRoute?.[2] ?? "";
			const requestedRepository =
				requestedRepositoryId === alternateRepository.id
					? alternateRepository
					: requestedRepositoryId === "repo-added"
						? {
								...repository,
								id: "repo-added",
								name: "added-project",
								root: "/projects/added-project",
							}
						: repository;

			if (url.pathname === "/api/bootstrap") {
				if (fixture.bootstrapFailureStatus !== null) {
					return new Response("Cloudflare Access sign-in required", {
						status: fixture.bootstrapFailureStatus,
					});
				}
				return Response.json({
					csrfToken: "csrf",
					repositories: fixture.catalog,
					defaultRepositoryId: repository.id,
					catalogRevision: 1,
					restart: {
						available: true,
						reason: null,
					},
					commitMessage: {
						available: fixture.commitMessageAvailable,
						reason: fixture.commitMessageAvailable
							? null
							: "Codex CLI is unavailable in this test.",
					},
					artifactProposal: {
						available: fixture.commitMessageAvailable,
						reason: fixture.commitMessageAvailable
							? null
							: "Codex CLI is unavailable in this test.",
					},
					terminal: {
						available: fixture.terminalAvailable,
						reason: fixture.terminalAvailable ? null : "tmux is unavailable in this test.",
						persistence: "tmux",
						profiles: [
							{
								id: "tmux",
								label: "tmux",
								available: fixture.terminalAvailable,
								reason: fixture.terminalAvailable ? null : "tmux is unavailable in this test.",
							},
						],
					},
					remoteBridge: {
						available: fixture.remoteBridgeAvailable,
						reason: fixture.remoteBridgeAvailable
							? null
							: "Native IDE bridge is disabled in this test.",
						p2pEnabled: fixture.remoteBridgeAvailable,
					},
					settingsProfiles: fixture.settingsProfiles,
				});
			}
			if (url.pathname === "/api/settings/profiles" && method === "GET") {
				return Response.json({ profiles: fixture.settingsProfiles });
			}
			if (url.pathname === "/api/settings/profiles" && method === "POST") {
				const input = body as { name: string; sourceProfileId?: string };
				const source = input.sourceProfileId
					? fixture.settingsProfiles.find((profile) => profile.id === input.sourceProfileId)
					: undefined;
				const profile: SettingsProfile = {
					id: `profile-${fixture.settingsProfiles.length}`,
					name: input.name,
					data: structuredClone(source?.data ?? createDefaultSettingsProfileData()),
					revision: 1,
					createdAt: "2026-07-31T00:01:00.000Z",
					updatedAt: "2026-07-31T00:01:00.000Z",
				};
				fixture.settingsProfiles = [...fixture.settingsProfiles, profile];
				return Response.json({ profile }, { status: 201 });
			}
			const settingsProfileRoute = /^\/api\/settings\/profiles\/([^/]+)$/.exec(url.pathname);
			if (settingsProfileRoute && method === "PUT") {
				const profileId = decodeURIComponent(settingsProfileRoute[1]!);
				const input = body as {
					name: string;
					data: SettingsProfile["data"];
					expectedRevision: number;
				};
				const previous = fixture.settingsProfiles.find((profile) => profile.id === profileId)!;
				if (fixture.staleNextSettingsSave) {
					fixture.staleNextSettingsSave = false;
					fixture.settingsProfiles = fixture.settingsProfiles.map((item) =>
						item.id === profileId
							? {
									...item,
									revision: item.revision + 1,
									updatedAt: "2026-07-31T00:01:30.000Z",
								}
							: item,
					);
					return Response.json(
						{
							error: {
								code: "stale_settings_profile",
								message: "The settings profile changed on another client.",
							},
						},
						{ status: 409 },
					);
				}
				if (previous.revision !== input.expectedRevision) {
					return Response.json(
						{
							error: {
								code: "stale_settings_profile",
								message: "The settings profile changed on another client.",
							},
						},
						{ status: 409 },
					);
				}
				const profile: SettingsProfile = {
					...previous,
					name: input.name,
					data: structuredClone(input.data),
					revision: previous.revision + 1,
					updatedAt: "2026-07-31T00:02:00.000Z",
				};
				fixture.settingsProfiles = fixture.settingsProfiles.map((item) =>
					item.id === profileId ? profile : item,
				);
				return Response.json({ profile });
			}
			if (settingsProfileRoute && method === "DELETE") {
				const profileId = decodeURIComponent(settingsProfileRoute[1]!);
				fixture.settingsProfiles = fixture.settingsProfiles.filter(
					(profile) => profile.id !== profileId,
				);
				return new Response(null, { status: 204 });
			}
			if (url.pathname === "/api/restart" && method === "POST") {
				return Response.json(
					{
						status: "restarting",
						previousInstanceId: "fixture-instance",
					},
					{ status: 202 },
				);
			}
			if (url.pathname === "/api/instance" && method === "GET") {
				if (fixture.instanceOffline) throw new TypeError("offline");
				return Response.json({
					service: "couchview",
					protocolVersion: 5,
					version: "0.1.0",
					instanceId: "fixture-instance",
					bindHost: "127.0.0.1",
					port: 4173,
					accessOrigins: ["http://127.0.0.1:4173"],
					terminalEnabled: fixture.terminalAvailable,
					terminalP2pEnabled: false,
					terminalStunUrls: ["stun:stun.cloudflare.com:3478"],
					remoteBridgeEnabled: fixture.remoteBridgeAvailable,
					remoteBridgeP2pEnabled: fixture.remoteBridgeAvailable,
					remoteBridgeStunUrls: ["stun:stun.cloudflare.com:3478"],
					remoteBridgeTargetPort: 22,
					remoteBridgeOriginAccess: "auto",
				});
			}
			if (url.pathname === "/api/repository-directories" && method === "GET") {
				const requestedPath = url.searchParams.get("path");
				return Response.json(
					requestedPath === "/projects/added-project"
						? {
								directories: [],
								parent: "/projects",
								path: requestedPath,
								truncated: false,
							}
						: {
								directories: [
									{
										name: "added-project",
										path: "/projects/added-project",
									},
								],
								parent: "/",
								path: "/projects",
								truncated: false,
							},
				);
			}
			if (url.pathname === "/api/repositories" && method === "POST") {
				if (fixture.repositoryRegistrationFailure) {
					return Response.json(
						{
							error: {
								code: "repository_not_found",
								message: "The repository directory does not exist",
							},
						},
						{ status: 400 },
					);
				}
				const added = {
					id: "repo-added",
					name: "added-project",
					root: "/projects/added-project",
					available: true,
					addedAt: "2026-08-05T12:00:00.000Z",
				};
				fixture.catalog = [...fixture.catalog.filter((entry) => entry.id !== added.id), added];
				return Response.json({ repository: added, added: true }, { status: 201 });
			}
			if (url.pathname === "/api/repositories" && method === "GET") {
				return Response.json({ repositories: fixture.catalog, catalogRevision: 1 });
			}
			if (repositoryRoute && !nestedPath && method === "DELETE") {
				fixture.catalog = fixture.catalog.filter((entry) => entry.id !== requestedRepositoryId);
				return Response.json({ deletedId: requestedRepositoryId });
			}
			if (nestedPath === "terminal/end" && method === "POST") {
				return Response.json({ status: "ended" });
			}
			if (nestedPath === "terminal/attachments" && method === "POST") {
				return Response.json(
					{
						ticket: "app-test-ticket",
						expiresAt: "2026-07-26T12:00:30.000Z",
						protocol: "couchview-terminal-v1",
						session: {
							profileId: "tmux",
							running: true,
							controllerConnected: false,
						},
					},
					{ status: 201 },
				);
			}
			if (nestedPath === "remote-bridge/pairings" && method === "GET") {
				return Response.json({ devices: fixture.remoteBridgeDevices });
			}
			if (nestedPath === "remote-bridge/pairings" && method === "POST") {
				return Response.json(
					{
						command:
							"couchview bridge pair --url 'https://review.example.com' --code 'pairing-code' --origin-access 'cloudflare-access'",
						expiresAt: "2099-07-29T12:05:00.000Z",
						sshAlias: "couchview-fixture-new-device",
					},
					{ status: 201 },
				);
			}
			const remoteBridgeDeviceRoute = /^remote-bridge\/pairings\/([^/]+)$/.exec(nestedPath);
			if (remoteBridgeDeviceRoute && method === "DELETE") {
				const deviceId = decodeURIComponent(remoteBridgeDeviceRoute[1]!);
				fixture.remoteBridgeDevices = fixture.remoteBridgeDevices.filter(
					(device) => device.id !== deviceId,
				);
				return new Response(null, { status: 204 });
			}
			if (nestedPath === "package-scripts" && method === "GET") {
				return Response.json(packageScriptsFixture);
			}
			if (nestedPath === "package-runs" && method === "GET") {
				return Response.json({ runs: fixture.packageRuns });
			}
			if (nestedPath === "package-runs" && method === "POST") {
				const input = body as {
					packagePath: string;
					scriptName: string;
				};
				const packageEntry = packageScriptsFixture.packages.find(
					(item) => item.packagePath === input.packagePath,
				)!;
				const script = packageEntry.scripts.find((item) => item.name === input.scriptName)!;
				const run: PackageRunSummary = {
					id: `package-run-${fixture.packageRuns.length + 1}`,
					repositoryId: requestedRepositoryId!,
					packagePath: packageEntry.packagePath,
					packageName: packageEntry.name,
					directory: packageEntry.directory,
					scriptName: script.name,
					command: script.command,
					runner: packageEntry.runner,
					invocation: `${packageEntry.runner} run ${script.name}`,
					status: "running",
					exitCode: null,
					startedAt: "2026-07-23T10:00:00.000Z",
					finishedAt: null,
					outputTruncated: false,
				};
				fixture.packageRuns = [run, ...fixture.packageRuns];
				return Response.json({ run }, { status: 201 });
			}
			const historyCommits = [
				{
					id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					shortId: "bbbbbbb",
					parents: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
					subject: "Improve history review",
					authorName: "Couchview Tests",
					authoredAt: "2026-08-02T10:00:00.000Z",
					decorations: ["HEAD -> main"],
				},
				{
					id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					shortId: "aaaaaaa",
					parents: [],
					subject: "Initial review workspace",
					authorName: "Couchview Tests",
					authoredAt: "2026-08-01T10:00:00.000Z",
					decorations: [],
				},
			];
			const gitStatus = () => ({
				previousBranch: fixture.gitDetached ? "main" : null,
				stashCount: fixture.gitStashCount,
				canUndoLastCommit: !fixture.gitDetached,
				trackedChangeCount: fixture.files.filter((file) => file.kind !== "untracked").length,
				untrackedChangeCount: fixture.files.filter((file) => file.kind === "untracked").length,
			});
			if (nestedPath === "git/history" && method === "GET") {
				fixture.historyQueries.push(url.search);
				if (fixture.delayNextHistoryResponse) {
					fixture.delayNextHistoryResponse = false;
					await new Promise<void>((resolve) => {
						fixture.releaseHistoryResponse = resolve;
					});
				}
				const cursor = url.searchParams.get("cursor");
				return Response.json({
					commits: fixture.historyPaginated
						? cursor
							? historyCommits.slice(1)
							: historyCommits.slice(0, 1)
						: historyCommits,
					nextCursor: fixture.historyPaginated && !cursor ? "fixture-page-2" : null,
					historyRevision: "fixture-history-1",
					scope: url.searchParams.get("scope") ?? "current",
					status: gitStatus(),
				});
			}
			const historyCommitRoute = /^git\/history\/([0-9a-f]{40})$/.exec(nestedPath);
			if (historyCommitRoute && method === "GET") {
				if (fixture.delayNextHistoryCommitResponse) {
					fixture.delayNextHistoryCommitResponse = false;
					await new Promise<void>((resolve) => {
						fixture.releaseHistoryCommitResponse = resolve;
					});
					fixture.historyCommitRequestAborted = Boolean(init?.signal?.aborted);
				}
				const commit = historyCommits.find((item) => item.id === historyCommitRoute[1])!;
				return Response.json({
					commit,
					files: [
						{
							id: "history-first",
							path: "src/first.ts",
							previousPath: null,
							kind: "modified",
							binary: false,
							additions: 1,
							deletions: 1,
						},
					],
				});
			}
			const historyDiffRoute = /^git\/history\/([0-9a-f]{40})\/files\/history-first\/diff$/.exec(
				nestedPath,
			);
			if (historyDiffRoute && method === "GET") {
				return Response.json({
					diff: {
						...fixture.servedFirstDiff,
						fileId: "history-first",
						operationRevision: historyDiffRoute[1],
					},
				});
			}
			if (nestedPath === "git/actions" && method === "POST") {
				const action = String((body as { action?: string }).action);
				if (action === "stash") {
					fixture.files = [];
					fixture.gitStashCount += 1;
				}
				if (action === "restore-stash") {
					fixture.files = structuredClone(initialFiles);
					fixture.gitStashCount = Math.max(0, fixture.gitStashCount - 1);
				}
				if (action === "clean") fixture.files = [];
				if (action === "checkout") fixture.gitDetached = true;
				if (action === "return") fixture.gitDetached = false;
				fixture.currentOperationRevision = `operation-git-${action}`;
				return Response.json({
					repository: {
						...requestedRepository,
						branch: fixture.gitDetached ? null : requestedRepository.branch,
						head: fixture.gitDetached
							? String((body as { commit?: string }).commit ?? requestedRepository.head)
							: requestedRepository.head,
					},
					files: fixture.files,
					operationRevision: fixture.currentOperationRevision,
					status: gitStatus(),
					warning: null,
				});
			}
			const packageRunStopRoute = /^package-runs\/([^/]+)\/stop$/.exec(nestedPath);
			if (packageRunStopRoute && method === "POST") {
				const run = fixture.packageRuns.find(
					(item) => item.id === decodeURIComponent(packageRunStopRoute[1]!),
				)!;
				run.status = "stopping";
				return Response.json({ run });
			}
			if (nestedPath === "files") {
				return Response.json({
					repository: requestedRepository,
					files: fixture.files,
					operationRevision: fixture.currentOperationRevision,
				});
			}
			if (nestedPath === "comments" && method === "GET") {
				return Response.json({
					reviews: fixture.reviews,
					comments: fixture.comments,
				});
			}
			if (nestedPath === "files/first/diff") {
				if (fixture.diffFailure) {
					return Response.json(
						{
							error: {
								code: "git_empty_output",
								message: "Git diff returned no data for a changed file after two attempts",
								diagnostic: {
									id: "diff1234",
									source: "git",
									operation: "diff",
									kind: "empty_output",
									exitCode: 0,
									stderr: "Git reported this path as changed but returned no diff output.",
									retryable: true,
									timeoutMs: null,
								},
							},
						},
						{ status: 503 },
					);
				}
				if (fixture.delayNextDiffResponse) {
					fixture.delayNextDiffResponse = false;
					await new Promise<void>((resolve) => {
						fixture.releaseDiffResponse = resolve;
					});
				}
				return Response.json({ diff: fixture.servedFirstDiff });
			}
			if (nestedPath === "files/second/diff") return Response.json({ diff: secondDiff });
			if (nestedPath === "files/review" && method === "PUT") {
				if (fixture.bulkReviewFailure) {
					return Response.json(
						{
							error: {
								code: "review_update_failed",
								message: "Could not remove review marks.",
							},
						},
						{ status: 409 },
					);
				}
				const input = body as {
					files: Array<{ fileId: string; contentRevision: string }>;
					reviewed: boolean;
				};
				const targetIds = new Set(input.files.map((target) => target.fileId));
				const reviews = fixture.files
					.filter((file) => targetIds.has(file.id))
					.map((file) => {
						file.reviewed = input.reviewed;
						return {
							fileId: file.id,
							path: file.path,
							contentRevision: file.contentRevision,
							reviewed: file.reviewed,
							updatedAt: new Date().toISOString(),
						};
					});
				fixture.reviews = [
					...fixture.reviews.filter((review) => !targetIds.has(String(review.fileId))),
					...reviews,
				];
				return Response.json({ reviews });
			}
			if (nestedPath === "search") {
				const query = url.searchParams.get("q") ?? "";
				return Response.json({
					query,
					currentPath: "src/first.ts",
					currentFile: [
						{ path: "src/first.ts", line: 1, column: 15, preview: "const value = load(newPath);" },
					],
					otherFiles: [
						{ path: "src/second.ts", line: 1, column: 14, preview: "export const load = true;" },
					],
					truncated: false,
				});
			}
			if (nestedPath === "source") {
				return Response.json({
					path: url.searchParams.get("path"),
					focusLine: 1,
					startLine: 1,
					endLine: 2,
					lines: [
						{ line: 1, text: "const value = load(newPath);" },
						{ line: 2, text: "return value;" },
					],
					truncated: false,
				});
			}
			if (nestedPath === "files/first/review" && method === "PUT") {
				fixture.files[0]!.reviewed = Boolean((body as { reviewed: boolean }).reviewed);
				const review = {
					fileId: "first",
					path: "src/first.ts",
					contentRevision: "first-v1",
					reviewed: fixture.files[0]!.reviewed,
					updatedAt: new Date().toISOString(),
				};
				fixture.reviews = [review];
				return Response.json({ review });
			}
			if (nestedPath === "files/stage" && method === "POST") {
				const targets = (body as { files: Array<{ fileId: string; contentRevision: string }> })
					.files;
				const targetIds = new Set(targets.map((target) => target.fileId));
				const stagedFiles = fixture.files.filter((file) => targetIds.has(file.id));
				for (const file of stagedFiles) {
					file.staged = true;
					file.unstaged = false;
					file.indexStatus = file.kind === "added" ? "A" : "M";
					file.worktreeStatus = ".";
				}
				fixture.currentOperationRevision = "operation-bulk-stage";
				return Response.json({
					files: stagedFiles,
					changes: {
						upserted: stagedFiles,
						removedFileIds: [],
						orderedFileIds: fixture.files.map((file) => file.id),
					},
					operationRevision: fixture.currentOperationRevision,
				});
			}
			if (nestedPath === "files/first/stage" && method === "POST") {
				if (fixture.stageFailure) {
					return Response.json(
						{
							error: {
								code: "git_timeout",
								message: "Git update-index stopped responding after 15 seconds",
								diagnostic: {
									id: "stage123",
									source: "git",
									operation: "update-index",
									kind: "timeout",
									exitCode: null,
									stderr: "No output was received before the timeout.",
									retryable: true,
									timeoutMs: 15_000,
								},
							},
						},
						{ status: 504 },
					);
				}
				const staged = (body as { staged?: boolean }).staged ?? true;
				fixture.files[0]!.staged = staged;
				fixture.files[0]!.unstaged = !staged;
				fixture.files[0]!.indexStatus = staged ? "M" : ".";
				fixture.files[0]!.worktreeStatus = staged ? "." : "M";
				fixture.currentOperationRevision = `operation-${staged ? 2 : 3}`;
				const removedFileId = fixture.removeActiveFileOnStage ? fixture.files[0]!.id : null;
				const responseFile = removedFileId ? null : fixture.files[0]!;
				if (removedFileId) fixture.files = fixture.files.slice(1);
				if (fixture.emitSseDuringStage) {
					EventSourceStub.instances.at(-1)?.onmessage?.(
						new MessageEvent("message", {
							data: JSON.stringify({
								type: "changes",
								repositoryId: "repo",
								operationRevision: fixture.currentOperationRevision,
								stateRevision: 0,
								catalogRevision: 1,
								at: "2026-07-22T10:00:00.000Z",
							}),
						}),
					);
				}
				if (fixture.delayStageResponse) {
					await new Promise<void>((resolve) => {
						fixture.releaseStageResponse = resolve;
					});
				}
				return Response.json({
					file: responseFile,
					changes: {
						upserted: responseFile ? [responseFile] : [],
						removedFileIds: removedFileId ? [removedFileId] : [],
						orderedFileIds: fixture.files.map((file) => file.id),
					},
					operationRevision: fixture.currentOperationRevision,
				});
			}
			if (nestedPath === "commit" && method === "POST") {
				fixture.files = fixture.files.filter((file) => !file.staged || file.unstaged);
				for (const file of fixture.files) {
					if (!file.staged) continue;
					file.staged = false;
					file.indexStatus = ".";
				}
				fixture.currentOperationRevision = "operation-after-commit";
				return Response.json(
					{
						commit: "abc1234abc1234abc1234abc1234abc1234abc12",
						operationRevision: fixture.currentOperationRevision,
					},
					{ status: 201 },
				);
			}
			if (nestedPath === "commit-message" && method === "POST") {
				if (fixture.commitMessageFailure) {
					return Response.json(
						{
							error: {
								code: "codex_failed",
								message: "Codex could not generate a commit message",
							},
						},
						{ status: 502 },
					);
				}
				if (fixture.delayCommitMessageResponse) {
					await new Promise<void>((resolve, reject) => {
						fixture.releaseCommitMessageResponse = resolve;
						init?.signal?.addEventListener(
							"abort",
							() => {
								fixture.commitMessageRequestAborted = true;
								reject(new DOMException("The request was aborted.", "AbortError"));
							},
							{ once: true },
						);
					});
				}
				return Response.json({
					message: "feat(review): generate commit messages with Codex",
					operationRevision: fixture.currentOperationRevision,
				});
			}
			if (nestedPath === "files/first/comments" && method === "POST") {
				const now = new Date().toISOString();
				const comment = {
					...(body as Record<string, unknown>),
					id: "comment-1",
					path: "src/first.ts",
					excerpt: ["- const value = load(oldPath);", "+ const value = load(newPath);"],
					stale: false,
					createdAt: now,
					updatedAt: now,
				};
				fixture.comments = [comment];
				return Response.json({ comment }, { status: 201 });
			}
			if (nestedPath === "comments/comment-1" && method === "PUT") {
				fixture.comments[0] = { ...fixture.comments[0], body: (body as { body: string }).body };
				return Response.json({ comment: fixture.comments[0] });
			}
			if (nestedPath === "comments/comment-1" && method === "DELETE") {
				fixture.comments = [];
				return Response.json({ deletedId: "comment-1" });
			}
			return Response.json(
				{ error: { code: "not_found", message: url.pathname } },
				{ status: 404 },
			);
		}) as typeof fetch;
	});

	afterEach(() => {
		cleanup();
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "WebSocket", {
			configurable: true,
			value: originalWebSocket,
		});
		Object.defineProperty(window, "WebSocket", {
			configurable: true,
			value: originalWebSocket,
		});
	});

	return fixture;
}
