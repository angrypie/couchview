import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { FileChange, FileDiff, SourceFileResponse } from "../../../shared/contracts.ts";
import { configureApiRuntime, resetApiRuntime } from "../../api.ts";
import { failureOf } from "../../lib/failures.ts";
import type { DiffViewerHandle, ViewerLineTarget } from "./types.ts";
import { useDiffReview } from "./useDiffReview.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render, waitFor } = await import("@testing-library/react");

type DiffController = ReturnType<typeof useDiffReview>;

const changedFile: FileChange = {
	additions: 1,
	binary: false,
	conflicted: false,
	contentRevision: "changed-content",
	deletions: 1,
	id: "changed-file",
	indexStatus: ".",
	kind: "modified",
	path: "src/changed.ts",
	previousPath: null,
	reviewed: false,
	staged: false,
	unstaged: true,
	worktreeStatus: "M",
};

const boundedDiff: FileDiff = {
	additions: 1,
	binary: false,
	contentRevision: changedFile.contentRevision,
	deletions: 1,
	fileId: changedFile.id,
	fullFilePatch: null,
	header: ["Diff preview truncated at 2 MiB or 20,000 rendered rows."],
	hunks: [
		{
			header: "@@ -1 +1 @@",
			id: "first-hunk",
			lines: [
				{
					id: "first-line",
					kind: "context",
					newLine: 1,
					noNewline: false,
					oldLine: 1,
					text: "const first = true;",
				},
			],
			newLines: 1,
			newStart: 1,
			oldLines: 1,
			oldStart: 1,
		},
	],
	kind: "modified",
	operationRevision: "operation-one",
	path: changedFile.path,
	previousPath: null,
	tooLarge: true,
};

const focusedSource: SourceFileResponse = {
	contentRevision: "focused-source",
	endLine: 40,
	focusLine: 40,
	lines: [
		{ line: 39, text: "const before = true;" },
		{ line: 40, text: "const result = target();" },
	],
	operationRevision: "operation-one",
	path: changedFile.path,
	repositoryId: "repo-one",
	startLine: 39,
	totalLines: 40,
	truncated: true,
};

let controller: DiffController | null = null;
let sourceRequests = 0;
const lineJumps: ViewerLineTarget[] = [];
const viewer: DiffViewerHandle = {
	scrollToHunk: () => undefined,
	scrollToLine: (target) => lineJumps.push(target),
	scrollToTop: () => undefined,
};
const onRefreshChanges = async () => undefined;
const reportFailure = (error: unknown, context: string) => failureOf(error, context);

function DiffHarness() {
	controller = useDiffReview({
		files: [changedFile],
		onFileSelected: () => undefined,
		onRefreshChanges,
		operationRevision: "operation-one",
		reportFailure,
		repositoryId: "repo-one",
	});
	controller.viewerRef.current = viewer;
	return <output>{controller.diff?.fileId ?? "none"}</output>;
}

function currentController(): DiffController {
	if (!controller) throw new Error("The diff-review harness has not rendered");
	return controller;
}

afterEach(() => {
	cleanup();
	resetApiRuntime();
	controller = null;
	sourceRequests = 0;
	lineJumps.length = 0;
});

describe("main-view search navigation", () => {
	test("loads focused source when a bounded changed-file diff omits the match", async () => {
		configureApiRuntime({
			fetch: async (input) => {
				const url = new URL(String(input), "http://127.0.0.1");
				if (url.pathname.endsWith("/diff")) return Response.json({ diff: boundedDiff });
				if (url.pathname.endsWith("/source-file")) {
					sourceRequests += 1;
					return Response.json(focusedSource);
				}
				return Response.json(
					{ error: { code: "not_found", message: url.pathname } },
					{ status: 404 },
				);
			},
		});
		render(<DiffHarness />);
		await waitFor(() => expect(currentController().diff?.fileId).toBe(changedFile.id));

		act(() => currentController().openPathAtLine(changedFile.path, 42));
		await waitFor(() => expect(sourceRequests).toBe(1));
		await waitFor(() =>
			expect(currentController().diff?.fileId).toBe(`source:${changedFile.path}`),
		);

		expect(currentController().activeFile?.id).toBe(changedFile.id);
		expect(currentController().changeDiff?.fileId).toBe(changedFile.id);
		expect(currentController().readOnly).toBe(false);
		await waitFor(() =>
			expect(lineJumps).toContainEqual({
				align: "center",
				behavior: "instant",
				lineNumber: 40,
				side: "new",
			}),
		);
	});
});
