import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { createMemoryKvStore } = await import("../../lib/storage/memoryKvStore.ts");
const { AppStoreProvider, createAppStore } = await import("../../lib/store/appStore.tsx");
const { useWorkspacePosition } = await import("./useWorkspacePosition.ts");
const { createWorkspacePositionState, normalizeWorkspacePosition, WORKSPACE_POSITION_KEY } =
	await import("./workspacePositionState.ts");

type Controller = ReturnType<typeof useWorkspacePosition>;
let controller: Controller | null = null;

function Harness({
	legacyRepositoryId = null,
	scope,
	state,
}: {
	legacyRepositoryId?: string | null;
	scope: string;
	state: ReturnType<typeof createWorkspacePositionState>;
}) {
	controller = useWorkspacePosition({ legacyRepositoryId, scope }, state);
	return <output>{String(controller.hydrated)}</output>;
}

function currentController(): Controller {
	if (!controller) throw new Error("The workspace-position harness has not rendered");
	return controller;
}

afterEach(() => {
	cleanup();
	controller = null;
});

describe("device workspace position", () => {
	test("normalizes malformed records without accepting invalid anchors", () => {
		expect(
			normalizeWorkspacePosition({
				servers: {
					valid: {
						lastRepositoryId: "repo-one",
						repositories: {
							"repo-one": {
								anchor: { line: -1, side: "middle" },
								fileId: 42,
								path: "src/one.ts",
							},
							invalid: { path: "" },
						},
					},
				},
			}),
		).toEqual({
			servers: {
				valid: {
					lastRepositoryId: "repo-one",
					repositories: {
						"repo-one": { anchor: null, fileId: null, path: "src/one.ts" },
					},
				},
			},
			version: 1,
		});
	});

	test("migrates the native repository and keeps server positions independent", async () => {
		const kvStore = createMemoryKvStore();
		const state = createWorkspacePositionState(kvStore);
		const view = render(
			<AppStoreProvider store={createAppStore()}>
				<Harness legacyRepositoryId="legacy-repo" scope="native:server-one" state={state} />
			</AppStoreProvider>,
		);
		await waitFor(() => expect(currentController().hydrated).toBe(true));
		await waitFor(() => expect(currentController().lastRepositoryId).toBe("legacy-repo"));

		act(() => {
			currentController().rememberRepository("repo-one");
			currentController().rememberFile("repo-one", "src/one.ts", "file-one");
			currentController().rememberAnchor("repo-one", "src/one.ts", {
				line: 27,
				side: "new",
			});
		});
		await waitFor(() =>
			expect(currentController().positionFor("repo-one")).toEqual({
				anchor: { line: 27, side: "new" },
				fileId: "file-one",
				path: "src/one.ts",
			}),
		);

		view.rerender(
			<AppStoreProvider store={createAppStore()}>
				<Harness scope="native:server-two" state={state} />
			</AppStoreProvider>,
		);
		await waitFor(() => expect(currentController().lastRepositoryId).toBeNull());
		expect(currentController().positionFor("repo-one")).toBeNull();

		const persisted = JSON.parse((await kvStore.get(WORKSPACE_POSITION_KEY)) ?? "null");
		expect(persisted.servers["native:server-one"].repositories["repo-one"]).toEqual({
			anchor: { line: 27, side: "new" },
			fileId: "file-one",
			path: "src/one.ts",
		});
	});
});
