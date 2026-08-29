import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { ProjectFilesResponse } from "../../../shared/contracts.ts";
import { configureApiRuntime, resetApiRuntime } from "../../api.ts";
import type { FetchLike } from "../../lib/api/fetchTypes.ts";
import { useProjectFileCatalog } from "./useProjectFileCatalog.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render, waitFor } = await import("@testing-library/react");

type CatalogController = ReturnType<typeof useProjectFileCatalog>;

interface PendingRequest {
	aborted: boolean;
	repositoryId: string;
	resolve(response: ProjectFilesResponse): void;
}

let controller: CatalogController | null = null;

function CatalogHarness({
	enabled = true,
	onRefreshChanges,
	operationRevision,
	repositoryId,
}: {
	enabled?: boolean;
	onRefreshChanges: () => Promise<unknown>;
	operationRevision: string;
	repositoryId: string;
}) {
	controller = useProjectFileCatalog({
		enabled,
		onRefreshChanges,
		operationRevision,
		repositoryId,
	});
	return <output data-testid="paths">{controller.paths.join(",")}</output>;
}

function currentController(): CatalogController {
	if (!controller) throw new Error("The project file catalog harness has not rendered");
	return controller;
}

function response(
	repositoryId: string,
	operationRevision: string,
	paths: string[],
): ProjectFilesResponse {
	return {
		files: paths.map((path) => ({ path })),
		operationRevision,
		repositoryId,
		truncated: false,
	};
}

function deferredFetch(requests: PendingRequest[]): FetchLike {
	return (input, init) => {
		const match = String(input).match(/\/api\/repositories\/([^/]+)\/project-files$/);
		const repositoryId = decodeURIComponent(match?.[1] ?? "");
		return new Promise<Response>((resolve, reject) => {
			const request: PendingRequest = {
				aborted: false,
				repositoryId,
				resolve: (body) => resolve(Response.json(body)),
			};
			requests.push(request);
			init?.signal?.addEventListener(
				"abort",
				() => {
					request.aborted = true;
					reject(new DOMException("The request was aborted.", "AbortError"));
				},
				{ once: true },
			);
		});
	};
}

afterEach(() => {
	cleanup();
	resetApiRuntime();
	controller = null;
});

describe("project file catalog", () => {
	test("does no catalog work until file search is opened", async () => {
		let calls = 0;
		configureApiRuntime({
			fetch: async () => {
				calls += 1;
				return Response.json(response("repo-one", "revision-one", ["README.md"]));
			},
		});
		const refreshChanges = async () => undefined;
		const view = render(
			<CatalogHarness
				enabled={false}
				onRefreshChanges={refreshChanges}
				operationRevision="revision-one"
				repositoryId="repo-one"
			/>,
		);
		expect(calls).toBe(0);

		view.rerender(
			<CatalogHarness
				onRefreshChanges={refreshChanges}
				operationRevision="revision-one"
				repositoryId="repo-one"
			/>,
		);
		await waitFor(() => expect(currentController().paths).toEqual(["README.md"]));
		expect(calls).toBe(1);

		view.rerender(
			<CatalogHarness
				enabled={false}
				onRefreshChanges={refreshChanges}
				operationRevision="revision-two"
				repositoryId="repo-one"
			/>,
		);
		expect(currentController().paths).toEqual([]);
		expect(calls).toBe(1);
	});

	test("reuses only an exact repository and operation revision cache entry", async () => {
		const calls: string[] = [];
		configureApiRuntime({
			fetch: async (input) => {
				const repositoryId = String(input).includes("repo-two") ? "repo-two" : "repo-one";
				calls.push(repositoryId);
				const revision = repositoryId === "repo-one" ? "revision-one" : "revision-two";
				return Response.json(response(repositoryId, revision, [`${repositoryId}.ts`]));
			},
		});
		const refreshChanges = async () => undefined;
		const view = render(
			<CatalogHarness
				onRefreshChanges={refreshChanges}
				operationRevision="revision-one"
				repositoryId="repo-one"
			/>,
		);
		await waitFor(() => expect(currentController().paths).toEqual(["repo-one.ts"]));

		view.rerender(
			<CatalogHarness
				onRefreshChanges={refreshChanges}
				operationRevision="revision-two"
				repositoryId="repo-two"
			/>,
		);
		await waitFor(() => expect(currentController().paths).toEqual(["repo-two.ts"]));

		view.rerender(
			<CatalogHarness
				onRefreshChanges={refreshChanges}
				operationRevision="revision-one"
				repositoryId="repo-one"
			/>,
		);
		await waitFor(() => expect(currentController().paths).toEqual(["repo-one.ts"]));
		expect(calls).toEqual(["repo-one", "repo-two"]);
	});

	test("aborts and ignores stale catalog requests when the revision changes", async () => {
		const requests: PendingRequest[] = [];
		configureApiRuntime({ fetch: deferredFetch(requests) });
		const refreshChanges = async () => undefined;
		const view = render(
			<CatalogHarness
				onRefreshChanges={refreshChanges}
				operationRevision="revision-one"
				repositoryId="repo-one"
			/>,
		);
		await waitFor(() => expect(requests).toHaveLength(1));

		view.rerender(
			<CatalogHarness
				onRefreshChanges={refreshChanges}
				operationRevision="revision-two"
				repositoryId="repo-one"
			/>,
		);
		await waitFor(() => expect(requests).toHaveLength(2));
		expect(requests[0]?.aborted).toBe(true);
		expect(currentController().paths).toEqual([]);

		await act(async () => {
			requests[0]?.resolve(response("repo-one", "revision-one", ["stale.ts"]));
			requests[1]?.resolve(response("repo-one", "revision-two", ["current.ts"]));
		});
		await waitFor(() => expect(currentController().paths).toEqual(["current.ts"]));
		expect(currentController().paths).not.toContain("stale.ts");
	});

	test("refreshes changes instead of caching a response from another revision", async () => {
		let refreshCount = 0;
		configureApiRuntime({
			fetch: async () =>
				Response.json(response("repo-one", "server-revision", ["server-state.ts"])),
		});
		render(
			<CatalogHarness
				onRefreshChanges={async () => {
					refreshCount += 1;
				}}
				operationRevision="client-revision"
				repositoryId="repo-one"
			/>,
		);

		await waitFor(() => expect(refreshCount).toBe(1));
		expect(currentController().paths).toEqual([]);
		expect(currentController().error).toBe("Project files changed. Refreshing…");
	});
});
