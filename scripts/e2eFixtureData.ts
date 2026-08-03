import type {
	ChangeFile,
	DiffResponse,
	GitCommitSummary,
	GitHistoryFile,
	PackageScriptsResponse,
	RepositoryCatalogEntry,
	ReviewComment,
	ReviewRecord,
} from "../src/shared/contracts.ts";

export const repository = {
	id: "fixture-repository",
	name: "sample-project",
	root: "/fixtures/sample-project",
	branch: "feature/mobile-review",
	head: "0123456789abcdef0123456789abcdef01234567",
	unborn: false,
};

export const alternateRepository = {
	id: "fixture-repository-two",
	name: "design-system",
	root: "/fixtures/design-system",
	branch: "main",
	head: "fedcba9876543210fedcba9876543210fedcba98",
	unborn: false,
};

export const packageScripts: PackageScriptsResponse = {
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

export const repositoryCatalog: RepositoryCatalogEntry[] = [repository, alternateRepository].map(
	(item) => ({
		id: item.id,
		name: item.name,
		root: item.root,
		available: true,
		addedAt: "2026-01-01T00:00:00.000Z",
	}),
);

export const initialFiles: ChangeFile[] = [
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
export const files: ChangeFile[] = structuredClone(initialFiles);

export const reviewFullFilePatch = [
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

export const diffs: Record<string, DiffResponse> = {
	"fixture-review-ts": {
		diff: {
			fileId: "fixture-review-ts",
			path: "src/review.ts",
			previousPath: null,
			kind: "modified",
			contentRevision: "fixture-review-v1",
			operationRevision: "fixture-operation-1",
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
			operationRevision: "fixture-operation-1",
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

export const historyCommits: GitCommitSummary[] = [
	{
		id: repository.head,
		shortId: repository.head.slice(0, 7),
		parents: ["1111111111111111111111111111111111111111"],
		subject: "Add mobile review workspace",
		authorName: "Couchview Fixture",
		authoredAt: "2026-08-02T10:00:00.000Z",
		decorations: ["HEAD -> feature/mobile-review"],
	},
	{
		id: "1111111111111111111111111111111111111111",
		shortId: "1111111",
		parents: [],
		subject: "Create sample project",
		authorName: "Couchview Fixture",
		authoredAt: "2026-08-01T10:00:00.000Z",
		decorations: ["tag: v1.0.0"],
	},
];

export const historyFiles: GitHistoryFile[] = [
	{
		id: "fixture-history-review-ts",
		path: "src/review.ts",
		previousPath: null,
		kind: "modified",
		binary: false,
		additions: 4,
		deletions: 2,
	},
];

export const historyDiff: DiffResponse = {
	diff: {
		...diffs["fixture-review-ts"]!.diff,
		fileId: historyFiles[0]!.id,
		operationRevision: repository.head,
	},
};

export const reviews: ReviewRecord[] = [];
export const comments: ReviewComment[] = [];
