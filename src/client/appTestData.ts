export const repository = {
	id: "repo",
	name: "fixture",
	root: "/fixture",
	branch: "main",
	head: "abc",
	unborn: false,
};

export const alternateRepository = {
	...repository,
	id: "repo-two",
	name: "second-fixture",
	root: "/second-fixture",
	branch: "feature/other-project",
};

export const repositoryCatalog = [repository, alternateRepository].map((item) => ({
	id: item.id,
	name: item.name,
	root: item.root,
	available: true,
	addedAt: "2026-07-20T10:00:00.000Z",
}));

export const packageScriptsFixture = {
	packages: [
		{
			packagePath: "package.json",
			directory: ".",
			name: "fixture-root",
			manifestRevision: "root-package-revision",
			runner: "bun" as const,
			scripts: [
				{ name: "test", command: "bun test" },
				{ name: "dev", command: "vite" },
			],
		},
		{
			packagePath: "apps/web/package.json",
			directory: "apps/web",
			name: "@fixture/web",
			manifestRevision: "web-package-revision",
			runner: "pnpm" as const,
			scripts: [{ name: "build", command: "vite build" }],
		},
	],
	warnings: [],
};

export const initialFiles = [
	{
		id: "first",
		path: "src/first.ts",
		previousPath: null,
		kind: "modified" as const,
		indexStatus: ".",
		worktreeStatus: "M",
		staged: false,
		unstaged: true,
		conflicted: false,
		binary: false,
		additions: 1,
		deletions: 1,
		contentRevision: "first-v1",
		reviewed: false,
		commentCount: 0,
	},
	{
		id: "second",
		path: "src/second.ts",
		previousPath: null,
		kind: "added" as const,
		indexStatus: ".",
		worktreeStatus: "?",
		staged: false,
		unstaged: true,
		conflicted: false,
		binary: false,
		additions: 1,
		deletions: 0,
		contentRevision: "second-v1",
		reviewed: false,
		commentCount: 0,
	},
];

export const firstDiff = {
	fileId: "first",
	path: "src/first.ts",
	previousPath: null,
	kind: "modified" as const,
	contentRevision: "first-v1",
	operationRevision: "operation-1",
	binary: false,
	tooLarge: false,
	header: [],
	additions: 1,
	deletions: 1,
	hunks: [
		{
			id: "hunk-1",
			header: "@@ -1,2 +1,2 @@",
			oldStart: 1,
			oldLines: 2,
			newStart: 1,
			newLines: 2,
			lines: [
				{
					id: "old",
					kind: "deletion" as const,
					text: "const value = load(oldPath);",
					oldLine: 1,
					newLine: null,
					noNewline: false,
				},
				{
					id: "new",
					kind: "addition" as const,
					text: "const value = load(newPath);",
					oldLine: null,
					newLine: 1,
					noNewline: false,
				},
				{
					id: "context",
					kind: "context" as const,
					text: "return value;",
					oldLine: 2,
					newLine: 2,
					noNewline: false,
				},
			],
		},
	],
};

export const secondDiff = {
	...firstDiff,
	fileId: "second",
	path: "src/second.ts",
	kind: "added" as const,
	contentRevision: "second-v1",
	additions: 1,
	deletions: 0,
	hunks: [
		{
			id: "second-hunk",
			header: "@@ -0,0 +1 @@",
			oldStart: 0,
			oldLines: 0,
			newStart: 1,
			newLines: 1,
			lines: [
				{
					id: "second-line",
					kind: "addition" as const,
					text: "export const second = true;",
					oldLine: null,
					newLine: 1,
					noNewline: false,
				},
			],
		},
	],
};
