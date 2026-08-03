import { describe, expect, test } from "bun:test";

import type { RepositorySnapshot } from "../repositoryContent.ts";
import type { GitExecutionPort } from "./execution.ts";
import { createRepositoryGitModule } from "./module.ts";

const snapshot: RepositorySnapshot = {
	repository: {
		id: "repository",
		name: "sample",
		root: "/virtual/sample",
		branch: "main",
		head: null,
		unborn: true,
	},
	files: [],
	operationRevision: "revision-1",
	entries: new Map(),
};

describe("RepositoryGitModule", () => {
	test("uses an injected execution port instead of the local Git CLI", async () => {
		const commands: string[][] = [];
		const execution: GitExecutionPort = {
			async run(args) {
				commands.push([...args]);
				const symbolicHead = args[0] === "symbolic-ref";
				return {
					stdout: Buffer.from(symbolicHead ? "refs/heads/main\n" : ""),
					stdoutTruncated: false,
					stderr: "",
					exitCode: args[0] === "show-ref" || args[1] === "--walk-reflogs" ? 1 : 0,
				};
			},
			isFailure: (error): error is Error & { stderr: string } =>
				error instanceof Error && "stderr" in error,
		};
		const git = createRepositoryGitModule({
			root: "/path/that/does/not/exist",
			repositoryId: snapshot.repository.id,
			emptyTree: "empty-tree",
			getSnapshot: async () => snapshot,
			execution,
		});

		const history = await git.history("current", null);

		expect(history.commits).toEqual([]);
		expect(history.status).toMatchObject({ canUndoLastCommit: false, stashCount: 0 });
		expect(commands).toEqual([
			["show-ref", "--heads", "--tags", "-d"],
			["symbolic-ref", "-q", "HEAD"],
			["rev-list", "--walk-reflogs", "--count", "refs/stash"],
		]);
	});
});
