import { resolve, sep } from "node:path";

import {
	API_ROUTES,
	type BootstrapResponse,
	type ChangeFile,
	type ChangesResponse,
	type CommitRequest,
	type CommitResponse,
	type CreateCommentRequest,
	CSRF_HEADER,
	type DiffResponse,
	type GenerateCommitMessageRequest,
	type GenerateCommitMessageResponse,
	type PackageRunEvent,
	type PackageRunSummary,
	type PackageScriptsResponse,
	type ReviewComment,
	type ReviewRecord,
	type ReviewStateResponse,
	type RepositoryCatalogEntry,
	type SetReviewRequest,
	type StageFileRequest,
	type StageFilesRequest,
	type TerminalAttachmentRequest,
	TERMINAL_ENDED_CLOSE_CODE,
} from "../src/shared/contracts.ts";

const host = process.env.E2E_HOST || "127.0.0.1";
const port = Number(process.env.E2E_PORT || 4174);
const distRoot = resolve(import.meta.dir, "..", "dist");
const csrfToken = "e2e-csrf-token";
let operationRevision = "fixture-operation-1";
let packageRuns: PackageRunSummary[] = [];
let terminalRunning = false;
let terminalAttachmentCount = 0;
let terminalSocketConnections = 0;
let terminalTicketCounter = 0;
const terminalInputs: string[] = [];
const terminalResizes: Array<{ cols: number; rows: number }> = [];

interface FixtureTerminalSocketData {
	repositoryId: string;
	clientId: string;
	cols: number;
	rows: number;
}

const terminalTickets = new Map<string, FixtureTerminalSocketData>();
let terminalController: Bun.ServerWebSocket<FixtureTerminalSocketData> | null = null;

const repository = {
	id: "fixture-repository",
	name: "sample-project",
	root: "/fixtures/sample-project",
	branch: "feature/mobile-review",
	head: "0123456789abcdef0123456789abcdef01234567",
	unborn: false,
};

const alternateRepository = {
	id: "fixture-repository-two",
	name: "design-system",
	root: "/fixtures/design-system",
	branch: "main",
	head: "fedcba9876543210fedcba9876543210fedcba98",
	unborn: false,
};

const packageScripts: PackageScriptsResponse = {
	packages: [
		{
			packagePath: "package.json",
			directory: ".",
			name: "sample-project",
			manifestRevision: "fixture-root-package",
			runner: "bun",
			scripts: [
				{ name: "test", command: "bun test src" },
				{ name: "dev", command: "bun run scripts/dev.ts" },
			],
		},
		{
			packagePath: "apps/mobile/package.json",
			directory: "apps/mobile",
			name: "@sample/mobile",
			manifestRevision: "fixture-mobile-package",
			runner: "pnpm",
			scripts: [{ name: "build", command: "expo export" }],
		},
	],
	warnings: [],
};

const repositoryCatalog: RepositoryCatalogEntry[] = [repository, alternateRepository].map(
	(item) => ({
		id: item.id,
		name: item.name,
		root: item.root,
		available: true,
		addedAt: "2026-01-01T00:00:00.000Z",
	}),
);

const initialFiles: ChangeFile[] = [
	{
		id: "fixture-review-ts",
		path: "src/review.ts",
		previousPath: null,
		kind: "modified",
		indexStatus: ".",
		worktreeStatus: "M",
		staged: false,
		unstaged: true,
		conflicted: false,
		binary: false,
		additions: 4,
		deletions: 2,
		contentRevision: "fixture-review-v1",
		reviewed: false,
		commentCount: 0,
	},
	{
		id: "fixture-format-ts",
		path: "src/format.ts",
		previousPath: null,
		kind: "added",
		indexStatus: ".",
		worktreeStatus: "?",
		staged: false,
		unstaged: true,
		conflicted: false,
		binary: false,
		additions: 4,
		deletions: 0,
		contentRevision: "fixture-format-v1",
		reviewed: false,
		commentCount: 0,
	},
];
const files: ChangeFile[] = structuredClone(initialFiles);

const reviewFullFilePatch = [
	"diff --git a/src/review.ts b/src/review.ts",
	"--- a/src/review.ts",
	"+++ b/src/review.ts",
	"@@ -1,14 +1,16 @@",
	" export function review(path: string, options: ReviewOptionsWithAnIntentionallyLongName, repository: RepositorySnapshotWithMetadata) {",
	"-  return load(path);",
	"+  const result = load(path);",
	"+  return result.files;",
	" }",
	" ",
	' export const completeFileContext = "visible between hunks";',
	" ",
	" export interface ReviewOptions {",
	"   enabled: boolean;",
	" }",
	" ",
	" // This unchanged block remains visible in the complete file view.",
	" export const status = {",
	"-  ready: false,",
	"+  ready: true,",
	"+  reviewed: false,",
	" };",
	"",
].join("\n");

const diffs: Record<string, DiffResponse> = {
	"fixture-review-ts": {
		diff: {
			fileId: "fixture-review-ts",
			path: "src/review.ts",
			previousPath: null,
			kind: "modified",
			contentRevision: "fixture-review-v1",
			operationRevision,
			binary: false,
			tooLarge: false,
			header: ["diff --git a/src/review.ts b/src/review.ts"],
			fullFilePatch: reviewFullFilePatch,
			additions: 4,
			deletions: 2,
			hunks: [
				{
					id: "fixture-review-hunk-1",
					header: "@@ -1,3 +1,4 @@",
					oldStart: 1,
					oldLines: 3,
					newStart: 1,
					newLines: 4,
					lines: [
						{
							id: "r1",
							kind: "context",
							text: "export function review(path: string, options: ReviewOptionsWithAnIntentionallyLongName, repository: RepositorySnapshotWithMetadata) {",
							oldLine: 1,
							newLine: 1,
							noNewline: false,
						},
						{
							id: "r2",
							kind: "deletion",
							text: "  return load(path);",
							oldLine: 2,
							newLine: null,
							noNewline: false,
						},
						{
							id: "r3",
							kind: "addition",
							text: "  const result = load(path);",
							oldLine: null,
							newLine: 2,
							noNewline: false,
						},
						{
							id: "r4",
							kind: "addition",
							text: "  return result.files;",
							oldLine: null,
							newLine: 3,
							noNewline: false,
						},
						{
							id: "r5",
							kind: "context",
							text: "}",
							oldLine: 3,
							newLine: 4,
							noNewline: false,
						},
					],
				},
				{
					id: "fixture-review-hunk-2",
					header: "@@ -12,3 +13,4 @@",
					oldStart: 12,
					oldLines: 3,
					newStart: 13,
					newLines: 4,
					lines: [
						{
							id: "r6",
							kind: "context",
							text: "export const status = {",
							oldLine: 12,
							newLine: 13,
							noNewline: false,
						},
						{
							id: "r7",
							kind: "deletion",
							text: "  ready: false,",
							oldLine: 13,
							newLine: null,
							noNewline: false,
						},
						{
							id: "r8",
							kind: "addition",
							text: "  ready: true,",
							oldLine: null,
							newLine: 14,
							noNewline: false,
						},
						{
							id: "r9",
							kind: "addition",
							text: "  reviewed: false,",
							oldLine: null,
							newLine: 15,
							noNewline: false,
						},
						{
							id: "r10",
							kind: "context",
							text: "};",
							oldLine: 14,
							newLine: 16,
							noNewline: false,
						},
					],
				},
			],
		},
	},
	"fixture-format-ts": {
		diff: {
			fileId: "fixture-format-ts",
			path: "src/format.ts",
			previousPath: null,
			kind: "added",
			contentRevision: "fixture-format-v1",
			operationRevision,
			binary: false,
			tooLarge: false,
			header: ["diff --git a/src/format.ts b/src/format.ts"],
			additions: 4,
			deletions: 0,
			hunks: [
				{
					id: "fixture-format-hunk-1",
					header: "@@ -0,0 +1,4 @@",
					oldStart: 0,
					oldLines: 0,
					newStart: 1,
					newLines: 4,
					lines: [
						{
							id: "f1",
							kind: "addition",
							text: "export function compact(value: string) {",
							oldLine: null,
							newLine: 1,
							noNewline: false,
						},
						{
							id: "f2",
							kind: "addition",
							text: "  return value.trim();",
							oldLine: null,
							newLine: 2,
							noNewline: false,
						},
						{
							id: "f3",
							kind: "addition",
							text: "}",
							oldLine: null,
							newLine: 3,
							noNewline: false,
						},
						{
							id: "f4",
							kind: "addition",
							text: "",
							oldLine: null,
							newLine: 4,
							noNewline: false,
						},
					],
				},
			],
		},
	},
};

const reviews: ReviewRecord[] = [];
const comments: ReviewComment[] = [];

const securityHeaders = {
	"Content-Security-Policy": [
		"default-src 'self'",
		"base-uri 'none'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self'",
		"font-src 'self'",
		"connect-src 'self'",
		"manifest-src 'self'",
		"worker-src 'self'",
	].join("; "),
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};

function json(value: unknown, status = 200): Response {
	return Response.json(value, {
		status,
		headers: {
			...securityHeaders,
			"Cache-Control": "no-store",
		},
	});
}

function requireCsrf(request: Request): Response | null {
	if (request.headers.get(CSRF_HEADER) === csrfToken) return null;
	return json(
		{ error: { code: "invalid_csrf", message: "Invalid CSRF token" } },
		403,
	);
}

async function serveStatic(
	pathname: string,
	request: Request,
): Promise<Response> {
	const decodedPath = decodeURIComponent(pathname);
	const relativePath =
		decodedPath === "/" ? "index.html" : decodedPath.slice(1);
	const candidate = resolve(distRoot, relativePath);
	const insideDist =
		candidate === distRoot || candidate.startsWith(`${distRoot}${sep}`);

	if (insideDist) {
		const file = Bun.file(candidate);
		if (await file.exists()) {
			return new Response(file, {
				headers: {
					...securityHeaders,
					"Cache-Control":
						relativePath === "index.html"
							? "no-cache"
							: "public, max-age=31536000, immutable",
					...(file.type ? { "Content-Type": file.type } : {}),
				},
			});
		}
	}

	if (request.headers.get("accept")?.includes("text/html")) {
		const index = Bun.file(resolve(distRoot, "index.html"));
		return new Response(index, {
			headers: {
				...securityHeaders,
				"Cache-Control": "no-cache",
				"Content-Type": "text/html; charset=utf-8",
			},
		});
	}

	return new Response("Not found", { status: 404, headers: securityHeaders });
}

const server = Bun.serve<FixtureTerminalSocketData>({
	hostname: host,
	port,
	idleTimeout: 255,
	websocket: {
		open(socket) {
			if (terminalController && terminalController !== socket) {
				terminalController.close(4001, "taken_over");
			}
			terminalController = socket;
			terminalRunning = true;
			terminalSocketConnections += 1;
			socket.send(JSON.stringify({
				type: "ready",
				profileId: "tmux",
				cols: socket.data.cols,
				rows: socket.data.rows,
			}));
			socket.send(new TextEncoder().encode(
				"\u001b[2J\u001b[H\r\n\u001b[1;32m Couchview fake tmux ready\u001b[0m\r\n",
			));
		},
		message(socket, message) {
			if (typeof message === "string") {
				try {
					const control = JSON.parse(message) as {
						type?: string;
						cols?: number;
						rows?: number;
					};
					if (
						control.type === "resize" &&
						Number.isSafeInteger(control.cols) &&
						Number.isSafeInteger(control.rows)
					) {
						terminalResizes.push({ cols: control.cols!, rows: control.rows! });
					}
				} catch {
					// The deterministic fixture ignores malformed control frames.
				}
				return;
			}
			terminalInputs.push(new TextDecoder().decode(message));
			socket.send(message);
		},
		close(socket) {
			if (terminalController === socket) terminalController = null;
		},
	},
	async fetch(request, bunServer) {
		const url = new URL(request.url);
		const repositoryRoute =
			/^\/api\/repositories\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
		const repositoryId = repositoryRoute?.[1]
			? decodeURIComponent(repositoryRoute[1])
			: null;
		const selectedRepository =
			repositoryId === repository.id
				? repository
				: repositoryId === alternateRepository.id
					? alternateRepository
					: null;
		const nestedPath = repositoryRoute?.[2] || "";
		const fileRoute = /^files\/([^/]+)\/(diff|stage|review|comments)$/.exec(
			nestedPath,
		);
		const commentRoute = /^comments\/([^/]+)$/.exec(nestedPath);
		const packageRunRoute =
			/^package-runs\/([^/]+)(?:\/(stop|events))?$/.exec(nestedPath);

		if (nestedPath === "terminal/socket" && request.method === "GET") {
			const protocols = (request.headers.get("sec-websocket-protocol") || "")
				.split(",")
				.map((value) => value.trim());
			const ticketProtocol = protocols.find((value) =>
				value.startsWith("couchview-ticket.")
			);
			const ticket = ticketProtocol?.slice("couchview-ticket.".length) || "";
			const data = terminalTickets.get(ticket);
			if (ticket) terminalTickets.delete(ticket);
			if (
				!selectedRepository ||
				!protocols.includes("couchview-terminal-v1") ||
				!data ||
				data.repositoryId !== repositoryId ||
				!request.headers.get("origin")
			) {
				return json(
					{ error: { code: "terminal_ticket_invalid", message: "Invalid fixture ticket" } },
					403,
				);
			}
			const upgraded = bunServer.upgrade(request, {
				data,
				headers: { "Sec-WebSocket-Protocol": "couchview-terminal-v1" },
			});
			return upgraded
				? undefined
				: json(
						{ error: { code: "websocket_upgrade_failed", message: "Fixture upgrade failed" } },
						400,
					);
		}

		if (url.pathname === API_ROUTES.accessRefresh && request.method === "GET") {
			const destination = new URL("/", url);
			const repositoryId = url.searchParams.get("repo");
			if (repositoryId) destination.searchParams.set("repo", repositoryId);
			destination.searchParams.set("access_refresh", "1");
			return Response.redirect(destination, 302);
		}
		if (url.pathname === API_ROUTES.accessLogout && request.method === "GET") {
			return Response.redirect(new URL("/cdn-cgi/access/logout", url), 302);
		}

		if (url.pathname === "/api/bootstrap" && request.method === "GET") {
			if (request.headers.get("x-e2e-cloudflare-access-redirect") === "1") {
				return new Response(null, {
					status: 302,
					headers: {
						Location:
							"https://angrypie.cloudflareaccess.com/cdn-cgi/access/login/couchview.angrypie.dev",
					},
				});
			}
			return json({
				csrfToken,
				repositories: repositoryCatalog,
				defaultRepositoryId: repository.id,
				catalogRevision: 1,
				restart: {
					available: false,
					reason: "Restart is unavailable in the browser test fixture.",
				},
				commitMessage: {
					available: true,
					reason: null,
				},
					codex: {
						available: false,
						reason: "Codex is not available in the browser test fixture.",
					},
					terminal: {
						available: true,
						reason: null,
						persistence: "tmux",
						profiles: [
							{
								id: "tmux",
								label: "tmux",
								available: true,
								reason: null,
							},
						],
					},
				} satisfies BootstrapResponse);
		}

		if (url.pathname === "/api/repositories" && request.method === "GET") {
			return json({ repositories: repositoryCatalog, catalogRevision: 1 });
		}

		if (url.pathname === "/api/e2e/terminal" && request.method === "GET") {
			return json({
				running: terminalRunning,
				attachmentCount: terminalAttachmentCount,
				socketConnections: terminalSocketConnections,
				inputs: terminalInputs,
				resizes: terminalResizes,
			});
		}

		if (repositoryRoute && !selectedRepository) {
			return json(
				{ error: { code: "repository_not_found", message: "Fixture repository not found" } },
				404,
			);
		}

		if (nestedPath === "files" && request.method === "GET") {
			return json({
				repository: selectedRepository!,
				files,
				operationRevision,
			} satisfies ChangesResponse);
		}

		if (nestedPath === "terminal" && request.method === "GET") {
			return json({
				profileId: "tmux",
				running: terminalRunning,
				controllerConnected: terminalController !== null,
			});
		}

		if (fileRoute?.[2] === "diff" && request.method === "GET") {
			const diff = diffs[decodeURIComponent(fileRoute[1] || "")];
			return diff
				? json({ ...diff, diff: { ...diff.diff, operationRevision } })
				: json(
						{ error: { code: "not_found", message: "Fixture file not found" } },
						404,
					);
		}

		if (nestedPath === "comments" && request.method === "GET") {
			return json({ reviews, comments } satisfies ReviewStateResponse);
		}

		if (nestedPath === "package-scripts" && request.method === "GET") {
			return json(packageScripts);
		}

		if (nestedPath === "package-runs" && request.method === "GET") {
			return json({ runs: packageRuns });
		}

		if (nestedPath === "search" && request.method === "GET") {
			const query = url.searchParams.get("q") || "";
			const currentPath = url.searchParams.get("currentPath") || files[0]!.path;
			return json({
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

		if (nestedPath === "source" && request.method === "GET") {
			const path = url.searchParams.get("path") || files[0]!.path;
			const focusLine = Number(url.searchParams.get("line") || 2);
			return json({
				path,
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

		if (nestedPath === "events" && request.method === "GET") {
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							`data: ${JSON.stringify({ type: "ready", repositoryId, operationRevision, stateRevision: reviews.length + comments.length, catalogRevision: 1, at: new Date().toISOString() })}\n\n`,
						),
					);
				},
			});
			return new Response(body, {
				headers: {
					...securityHeaders,
					"Cache-Control": "no-cache, no-store, no-transform",
					"Content-Type": "text/event-stream",
					"X-Accel-Buffering": "no",
				},
			});
		}

		if (packageRunRoute?.[2] === "events" && request.method === "GET") {
			const run = packageRuns.find(
				(candidate) =>
					candidate.id === decodeURIComponent(packageRunRoute[1] || ""),
			);
			if (!run) {
				return json(
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
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							`data: ${JSON.stringify(event)}\n\n`,
						),
					);
				},
			});
			return new Response(body, {
				headers: {
					...securityHeaders,
					"Cache-Control": "no-cache, no-store, no-transform",
					"Content-Type": "text/event-stream",
					"X-Accel-Buffering": "no",
				},
			});
		}

		if (url.pathname.startsWith("/api/") && request.method !== "GET") {
			const csrfError = requireCsrf(request);
			if (csrfError) return csrfError;
		}

		if (url.pathname === "/api/e2e/reset" && request.method === "POST") {
			files.splice(0, files.length, ...structuredClone(initialFiles));
			reviews.splice(0);
			comments.splice(0);
			packageRuns = [];
			operationRevision = "fixture-operation-1";
			terminalController?.close(1000, "fixture_reset");
			terminalController = null;
			terminalRunning = false;
			terminalAttachmentCount = 0;
			terminalSocketConnections = 0;
			terminalTicketCounter = 0;
			terminalInputs.splice(0);
			terminalResizes.splice(0);
			terminalTickets.clear();
			return json({ reset: true });
		}

		if (nestedPath === "terminal/attachments" && request.method === "POST") {
			const body = (await request.json()) as TerminalAttachmentRequest;
			if (
				body.profileId !== "tmux" ||
				typeof body.clientId !== "string" ||
				!Number.isSafeInteger(body.cols) ||
				!Number.isSafeInteger(body.rows)
			) {
				return json(
					{ error: { code: "terminal_attachment_invalid", message: "Invalid fixture attachment" } },
					400,
				);
			}
			terminalRunning = true;
			terminalAttachmentCount += 1;
			terminalResizes.push({ cols: body.cols, rows: body.rows });
			const ticket = `fixture-ticket-${++terminalTicketCounter}`;
			terminalTickets.set(ticket, {
				repositoryId: repositoryId!,
				clientId: body.clientId,
				cols: body.cols,
				rows: body.rows,
			});
			return json({
				ticket,
				expiresAt: new Date(Date.now() + 30_000).toISOString(),
				protocol: "couchview-terminal-v1",
				session: {
					profileId: "tmux",
					running: true,
					controllerConnected: terminalController !== null,
				},
			}, 201);
		}

		if (nestedPath === "terminal/end" && request.method === "POST") {
			terminalRunning = false;
			terminalTickets.clear();
			terminalController?.close(TERMINAL_ENDED_CLOSE_CODE, "terminal_ended");
			terminalController = null;
			return json({ status: "ended" });
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
			const script = packageEntry?.scripts.find(
				(candidate) => candidate.name === input.scriptName,
			);
			if (
				!packageEntry ||
				!script ||
				packageEntry.manifestRevision !== input.manifestRevision
			) {
				return json(
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
				id: `fixture-package-run-${packageRuns.length + 1}`,
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
			packageRuns = [run, ...packageRuns];
			return json({ run }, 201);
		}

		if (packageRunRoute?.[2] === "stop" && request.method === "POST") {
			const run = packageRuns.find(
				(candidate) =>
					candidate.id === decodeURIComponent(packageRunRoute[1] || ""),
			);
			return run
				? json({ run })
				: json(
						{
							error: {
								code: "package_run_not_found",
								message: "Fixture package run not found",
							},
						},
						404,
					);
		}

		if (fileRoute?.[2] === "review" && request.method === "PUT") {
			const body = (await request.json()) as SetReviewRequest;
			const file = files.find((candidate) => candidate.id === body.fileId);
			if (!file)
				return json(
					{ error: { code: "not_found", message: "Fixture file not found" } },
					404,
				);
			file.reviewed = body.reviewed;
			const review = {
				fileId: file.id,
				path: file.path,
				contentRevision: file.contentRevision,
				reviewed: file.reviewed,
				updatedAt: new Date().toISOString(),
			} satisfies ReviewRecord;
			const existing = reviews.findIndex(
				(candidate) => candidate.fileId === file.id,
			);
			if (existing >= 0) reviews[existing] = review;
			else reviews.push(review);
			return json({ review });
		}

		if (fileRoute?.[2] === "stage" && request.method === "POST") {
			const body = (await request.json()) as StageFileRequest;
			const file = files.find((candidate) => candidate.id === body.fileId);
			if (!file)
				return json(
					{ error: { code: "not_found", message: "Fixture file not found" } },
					404,
				);
			const staged = body.staged ?? true;
			file.staged = staged;
			file.unstaged = !staged;
			file.indexStatus = staged ? (file.kind === "added" ? "A" : "M") : ".";
			file.worktreeStatus = staged ? "." : file.kind === "added" ? "?" : "M";
			operationRevision = `fixture-operation-${Date.now()}`;
			return json({
				file,
				changes: {
					upserted: [file],
					removedFileIds: [],
					orderedFileIds: files.map((candidate) => candidate.id),
				},
				operationRevision,
			});
		}

		if (nestedPath === "files/stage" && request.method === "POST") {
			const body = (await request.json()) as StageFilesRequest;
			if (body.operationRevision !== operationRevision) {
				return json(
					{
						error: {
							code: "operation_changed",
							message: "Project changes changed; refresh before staging",
						},
					},
					409,
				);
			}
			const targetIds = new Set(body.files.map((target) => target.fileId));
			const stagedFiles = files.filter((file) => targetIds.has(file.id));
			if (stagedFiles.length !== targetIds.size) {
				return json(
					{ error: { code: "not_found", message: "Fixture file not found" } },
					404,
				);
			}
			for (const file of stagedFiles) {
				file.staged = true;
				file.unstaged = false;
				file.indexStatus = file.kind === "added" ? "A" : "M";
				file.worktreeStatus = ".";
			}
			operationRevision = `fixture-operation-${Date.now()}`;
			return json({
				files: stagedFiles,
				changes: {
					upserted: stagedFiles,
					removedFileIds: [],
					orderedFileIds: files.map((candidate) => candidate.id),
				},
				operationRevision,
			});
		}

		if (nestedPath === "commit" && request.method === "POST") {
			const body = (await request.json()) as CommitRequest;
			if (body.operationRevision !== operationRevision) {
				return json(
					{
						error: {
							code: "operation_changed",
							message: "Project changes changed; refresh before committing",
						},
					},
					409,
				);
			}
			if (!body.message?.trim() || !files.some((file) => file.staged)) {
				return json(
					{
						error: {
							code: "nothing_staged",
							message: "Nothing is staged to commit",
						},
					},
					409,
				);
			}
			for (let index = files.length - 1; index >= 0; index -= 1) {
				const file = files[index];
				if (!file?.staged) continue;
				if (!file.unstaged) {
					files.splice(index, 1);
					continue;
				}
				file.staged = false;
				file.indexStatus = ".";
			}
			operationRevision = `fixture-operation-${Date.now()}`;
			return json(
				{
					commit: "abc1234abc1234abc1234abc1234abc1234abc12",
					operationRevision,
				} satisfies CommitResponse,
				201,
			);
		}

		if (nestedPath === "commit-message" && request.method === "POST") {
			const body = (await request.json()) as GenerateCommitMessageRequest;
			if (body.operationRevision !== operationRevision) {
				return json(
					{
						error: {
							code: "operation_changed",
							message:
								"Project changes changed; refresh before generating a commit message",
						},
					},
					409,
				);
			}
			if (!files.some((file) => file.staged)) {
				return json(
					{
						error: {
							code: "nothing_staged",
							message: "Nothing is staged to describe",
						},
					},
					409,
				);
			}
			return json({
				message: "feat(review): generate commit messages with Codex",
				operationRevision,
			} satisfies GenerateCommitMessageResponse);
		}

		if (fileRoute?.[2] === "comments" && request.method === "POST") {
			const body = (await request.json()) as CreateCommentRequest;
			const file = files.find((candidate) => candidate.id === body.fileId);
			if (!file)
				return json(
					{ error: { code: "not_found", message: "Fixture file not found" } },
					404,
				);
			const now = new Date().toISOString();
			const comment: ReviewComment = {
				id: `fixture-comment-${comments.length + 1}`,
				path: file.path,
				stale: false,
				createdAt: now,
				updatedAt: now,
				...body,
			};
			comments.push(comment);
			file.commentCount += 1;
			return json({ comment }, 201);
		}

		if (commentRoute && request.method === "PUT") {
			const body = (await request.json()) as { id: string; body: string };
			const comment = comments.find((candidate) => candidate.id === body.id);
			if (!comment)
				return json(
					{
						error: { code: "not_found", message: "Fixture comment not found" },
					},
					404,
				);
			comment.body = body.body;
			comment.updatedAt = new Date().toISOString();
			return json({ comment });
		}

		if (commentRoute && request.method === "DELETE") {
			const body = (await request.json()) as { id: string };
			const index = comments.findIndex((candidate) => candidate.id === body.id);
			if (index < 0)
				return json(
					{
						error: { code: "not_found", message: "Fixture comment not found" },
					},
					404,
				);
			const [comment] = comments.splice(index, 1);
			const file = files.find((candidate) => candidate.id === comment?.fileId);
			if (file) file.commentCount = Math.max(0, file.commentCount - 1);
			return json({ deletedId: body.id });
		}

		if (url.pathname.startsWith("/api/")) {
			return json(
				{
					error: { code: "not_found", message: "Fixture API route not found" },
				},
				404,
			);
		}

		return serveStatic(url.pathname, request);
	},
});

console.log(`Couchview e2e fixture listening at ${server.url}`);

function stop() {
	void server.stop(true);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
