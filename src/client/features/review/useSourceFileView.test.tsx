import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { SourceFileResponse } from "../../../shared/contracts.ts";
import { configureApiRuntime, resetApiRuntime } from "../../api.ts";
import type { FetchLike } from "../../lib/api/fetchTypes.ts";
import { failureOf } from "../../lib/failures.ts";
import { useSourceFileView } from "./useSourceFileView.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render, waitFor } = await import("@testing-library/react");

type SourceController = ReturnType<typeof useSourceFileView>;

interface PendingRequest {
	aborted: boolean;
	resolve(response: SourceFileResponse): void;
}

let controller: SourceController | null = null;

const reportFailure = (error: unknown, context: string) => failureOf(error, context);

function sourceResponse(
	operationRevision: string,
	path = "src/source.ts",
	text = "export const source = true;",
): SourceFileResponse {
	return {
		contentRevision: `content-${operationRevision}`,
		endLine: 3,
		focusLine: 3,
		lines: [
			{ line: 2, text: "" },
			{ line: 3, text },
		],
		operationRevision,
		path,
		repositoryId: "repo-one",
		startLine: 2,
		totalLines: 10,
		truncated: true,
	};
}

function SourceHarness({
	onRefreshChanges,
	operationRevision,
}: {
	onRefreshChanges: () => Promise<unknown>;
	operationRevision: string;
}) {
	controller = useSourceFileView({
		onRefreshChanges,
		operationRevision,
		reportFailure,
		repositoryId: "repo-one",
	});
	return <output>{controller.diff?.path ?? "none"}</output>;
}

function currentController(): SourceController {
	if (!controller) throw new Error("The source-file harness has not rendered");
	return controller;
}

function deferredFetch(requests: PendingRequest[]): FetchLike {
	return (_input, init) =>
		new Promise<Response>((resolve, reject) => {
			const request: PendingRequest = {
				aborted: false,
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
}

afterEach(() => {
	cleanup();
	resetApiRuntime();
	controller = null;
});

describe("main source-file view", () => {
	test("adapts source lines to the normal diff viewer contract", async () => {
		configureApiRuntime({
			fetch: async () => Response.json(sourceResponse("revision-one")),
		});
		render(
			<SourceHarness onRefreshChanges={async () => undefined} operationRevision="revision-one" />,
		);

		act(() => currentController().open("src/source.ts", 3));
		await waitFor(() => expect(currentController().diff?.path).toBe("src/source.ts"));

		expect(currentController().diff).toMatchObject({
			additions: 0,
			deletions: 0,
			fileId: "source:src/source.ts",
			tooLarge: true,
		});
		expect(currentController().diff?.hunks[0]?.lines).toEqual([
			{
				id: "source-2",
				kind: "context",
				newLine: 2,
				noNewline: false,
				oldLine: 2,
				text: "",
			},
			{
				id: "source-3",
				kind: "context",
				newLine: 3,
				noNewline: false,
				oldLine: 3,
				text: "export const source = true;",
			},
		]);
		expect(currentController().loadedSelectionId).toBe(currentController().selectionId);
	});

	test("aborts a stale revision and displays only the replacement response", async () => {
		const requests: PendingRequest[] = [];
		configureApiRuntime({ fetch: deferredFetch(requests) });
		const refreshChanges = async () => undefined;
		const view = render(
			<SourceHarness onRefreshChanges={refreshChanges} operationRevision="revision-one" />,
		);
		act(() => currentController().open("src/source.ts", 3));
		await waitFor(() => expect(requests).toHaveLength(1));

		view.rerender(
			<SourceHarness onRefreshChanges={refreshChanges} operationRevision="revision-two" />,
		);
		await waitFor(() => expect(requests).toHaveLength(2));
		expect(requests[0]?.aborted).toBe(true);
		expect(currentController().diff).toBeNull();

		await act(async () => {
			requests[1]?.resolve(sourceResponse("revision-two", "src/source.ts", "current"));
		});
		await waitFor(() => expect(currentController().diff?.hunks[0]?.lines[1]?.text).toBe("current"));
	});

	test("refreshes changes instead of displaying a response from another revision", async () => {
		let refreshCount = 0;
		configureApiRuntime({
			fetch: async () => Response.json(sourceResponse("server-revision")),
		});
		render(
			<SourceHarness
				onRefreshChanges={async () => {
					refreshCount += 1;
				}}
				operationRevision="client-revision"
			/>,
		);

		act(() => currentController().open("src/source.ts", 3));
		await waitFor(() => expect(refreshCount).toBe(1));
		expect(currentController().diff).toBeNull();
		expect(currentController().error).toBe("The file changed while it was opening. Refreshing…");
	});
});
