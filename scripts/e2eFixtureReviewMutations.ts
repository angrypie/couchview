import type {
	CommitRequest,
	CommitResponse,
	GenerateCommitMessageRequest,
	GenerateCommitMessageResponse,
	ReviewRecord,
	SetReviewRequest,
	SetReviewsRequest,
	SetReviewsResponse,
	StageFileRequest,
	StageFilesRequest,
} from "../src/shared/contracts.ts";
import type { GitActionRequest, GitActionResponse } from "../src/shared/git/index.ts";
import { files, initialFiles, repository, reviews } from "./e2eFixtureData.ts";
import { fixtureJson } from "./e2eFixtureHttp.ts";
import type { FixtureMutableState, FixtureRequestContext } from "./e2eFixtureRouteTypes.ts";

function missingFile(): Response {
	return fixtureJson({ error: { code: "not_found", message: "Fixture file not found" } }, 404);
}

export async function handleFixtureReviewMutation(
	state: FixtureMutableState,
	context: FixtureRequestContext,
): Promise<Response | null> {
	const { request, nestedPath, fileRoute } = context;
	if (request.method === "GET") return null;
	if (nestedPath === "git/actions" && request.method === "POST") {
		const body = (await request.json()) as GitActionRequest;
		if (body.operationRevision !== state.operationRevision) {
			return fixtureJson(
				{
					error: {
						code: "operation_changed",
						message: "Project changes changed; refresh before running this Git action",
					},
				},
				409,
			);
		}
		if ((body.action === "checkout" || body.action === "return") && files.length > 0) {
			return fixtureJson(
				{ error: { code: "dirty_worktree", message: "Stash or clean changes first" } },
				409,
			);
		}
		if (body.action === "stash") {
			files.splice(0);
			state.gitStashCount += 1;
		}
		if (body.action === "restore-stash") {
			files.splice(0, files.length, ...structuredClone(initialFiles));
			state.gitStashCount = Math.max(0, state.gitStashCount - 1);
		}
		if (body.action === "clean") files.splice(0);
		if (body.action === "checkout") {
			state.gitDetached = true;
			state.gitHead = body.commit;
		}
		if (body.action === "return") {
			state.gitDetached = false;
			state.gitHead = repository.head;
		}
		state.operationRevision = `fixture-operation-${Date.now()}`;
		return fixtureJson({
			repository: {
				...repository,
				branch: state.gitDetached ? null : repository.branch,
				head: state.gitHead,
			},
			files,
			operationRevision: state.operationRevision,
			status: {
				previousBranch: state.gitDetached ? repository.branch : null,
				stashCount: state.gitStashCount,
				canUndoLastCommit: !state.gitDetached,
				trackedChangeCount: files.filter((file) => file.kind !== "untracked").length,
				untrackedChangeCount: files.filter((file) => file.kind === "untracked").length,
			},
			warning: null,
		} satisfies GitActionResponse);
	}

	if (nestedPath === "files/review" && request.method === "PUT") {
		const body = (await request.json()) as SetReviewsRequest;
		const targets = body.files.map((target) =>
			files.find(
				(file) => file.id === target.fileId && file.contentRevision === target.contentRevision,
			),
		);
		if (targets.some((file) => !file)) return missingFile();
		const updated = targets.map((file) => {
			if (!file) throw new Error("Validated fixture review target is missing");
			file.reviewed = body.reviewed;
			const review = {
				fileId: file.id,
				path: file.path,
				contentRevision: file.contentRevision,
				reviewed: file.reviewed,
				updatedAt: new Date().toISOString(),
			} satisfies ReviewRecord;
			const existing = reviews.findIndex((candidate) => candidate.fileId === file.id);
			if (existing >= 0) reviews[existing] = review;
			else reviews.push(review);
			return review;
		});
		state.reviewRevision += updated.length;
		return fixtureJson({
			reviews: updated,
			reviewRevision: state.reviewRevision,
		} satisfies SetReviewsResponse);
	}
	if (fileRoute?.[2] === "review" && request.method === "PUT") {
		const body = (await request.json()) as SetReviewRequest;
		if (
			body.operationRevision !== undefined &&
			body.operationRevision !== state.operationRevision
		) {
			return fixtureJson(
				{
					error: {
						code: "operation_changed",
						message: "Project changes changed; refresh before updating review state",
					},
				},
				409,
			);
		}
		if (
			body.expectedReviewRevision !== undefined &&
			body.expectedReviewRevision !== state.reviewRevision
		) {
			return fixtureJson(
				{
					error: {
						code: "review_changed",
						message: "Review state changed; refresh before updating the review mark",
					},
				},
				409,
			);
		}
		const file = files.find((candidate) => candidate.id === body.fileId);
		if (!file) return missingFile();
		file.reviewed = body.reviewed;
		const review = {
			fileId: file.id,
			path: file.path,
			contentRevision: file.contentRevision,
			reviewed: file.reviewed,
			updatedAt: new Date().toISOString(),
		} satisfies ReviewRecord;
		const existing = reviews.findIndex((candidate) => candidate.fileId === file.id);
		if (existing >= 0) reviews[existing] = review;
		else reviews.push(review);
		state.reviewRevision += 1;
		return fixtureJson({
			review,
			operationRevision: state.operationRevision,
			reviewRevision: state.reviewRevision,
		});
	}
	if (fileRoute?.[2] === "stage" && request.method === "POST") {
		const body = (await request.json()) as StageFileRequest;
		if (body.operationRevision !== state.operationRevision) {
			return fixtureJson(
				{
					error: {
						code: "operation_changed",
						message: "Project changes changed; refresh before staging",
					},
				},
				409,
			);
		}
		const file = files.find((candidate) => candidate.id === body.fileId);
		if (!file) return missingFile();
		const staged = body.staged ?? true;
		file.staged = staged;
		file.unstaged = !staged;
		file.indexStatus = staged ? (file.kind === "added" ? "A" : "M") : ".";
		file.worktreeStatus = staged ? "." : file.kind === "added" ? "?" : "M";
		state.operationRevision = `fixture-operation-${Date.now()}`;
		return fixtureJson({
			file,
			changes: {
				upserted: [file],
				removedFileIds: [],
				orderedFileIds: files.map((candidate) => candidate.id),
			},
			operationRevision: state.operationRevision,
		});
	}
	if (nestedPath === "files/stage" && request.method === "POST") {
		const body = (await request.json()) as StageFilesRequest;
		if (body.operationRevision !== state.operationRevision) {
			return fixtureJson(
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
		if (stagedFiles.length !== targetIds.size) return missingFile();
		for (const file of stagedFiles) {
			file.staged = true;
			file.unstaged = false;
			file.indexStatus = file.kind === "added" ? "A" : "M";
			file.worktreeStatus = ".";
		}
		state.operationRevision = `fixture-operation-${Date.now()}`;
		return fixtureJson({
			files: stagedFiles,
			changes: {
				upserted: stagedFiles,
				removedFileIds: [],
				orderedFileIds: files.map((candidate) => candidate.id),
			},
			operationRevision: state.operationRevision,
		});
	}
	if (nestedPath === "commit" && request.method === "POST") {
		const body = (await request.json()) as CommitRequest;
		if (body.operationRevision !== state.operationRevision) {
			return fixtureJson(
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
			return fixtureJson(
				{
					error: { code: "nothing_staged", message: "Nothing is staged to commit" },
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
		state.operationRevision = `fixture-operation-${Date.now()}`;
		return fixtureJson(
			{
				commit: "abc1234abc1234abc1234abc1234abc1234abc12",
				operationRevision: state.operationRevision,
			} satisfies CommitResponse,
			201,
		);
	}
	if (nestedPath === "commit-message" && request.method === "POST") {
		const body = (await request.json()) as GenerateCommitMessageRequest;
		if (body.operationRevision !== state.operationRevision) {
			return fixtureJson(
				{
					error: {
						code: "operation_changed",
						message: "Project changes changed; refresh before generating a commit message",
					},
				},
				409,
			);
		}
		if (!files.some((file) => file.staged)) {
			return fixtureJson(
				{
					error: { code: "nothing_staged", message: "Nothing is staged to describe" },
				},
				409,
			);
		}
		return fixtureJson({
			message: "feat(review): generate commit messages with Codex",
			operationRevision: state.operationRevision,
		} satisfies GenerateCommitMessageResponse);
	}
	return null;
}
