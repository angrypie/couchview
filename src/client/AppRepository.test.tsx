import { describe, expect, test } from "bun:test";
import {
	App,
	act,
	createAppTestHarness,
	EventSourceStub,
	fireEvent,
	nativeTestRuntime,
	render,
	repository,
	screen,
	viewerLineJumps,
	waitFor,
	within,
} from "./appTestHarness.tsx";

describe("Couchview app repository workflows", () => {
	const fixture = createAppTestHarness();
	const openRepositoryManager = async () => {
		fireEvent.click(await screen.findByRole("button", { name: "Select repository" }));
		const quickPicker = await screen.findByRole("dialog", { name: "Projects" });
		fireEvent.click(within(quickPicker).getByRole("button", { name: "Manage projects…" }));
		return screen.findByRole("dialog", { name: "Repositories" });
	};
	const syncReviewRecords = () => {
		fixture.reviews = fixture.files
			.filter((file) => file.reviewed)
			.map((file) => ({
				fileId: file.id,
				path: file.path,
				contentRevision: file.contentRevision,
				reviewed: true,
				updatedAt: "2025-01-01T00:00:00.000Z",
			}));
	};

	test("shows reconnecting without a banner while the server still responds", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
		const stream = EventSourceStub.instances[0]!;
		const connectionStatus = screen.getByTestId("repository-connection-status");
		expect(connectionStatus.getAttribute("aria-label")).toBe("Connected");

		await act(async () => {
			stream.onerror?.(new Event("error"));
		});

		await waitFor(() =>
			expect(connectionStatus.getAttribute("aria-label")).toBe("Reconnecting to local server"),
		);
		expect(screen.queryByText("Offline — cannot reach the local server")).toBeNull();
		expect(fixture.requests.some((request) => request.path === "/api/instance")).toBe(true);

		await act(async () => {
			stream.onopen?.(new Event("open"));
		});
		expect(connectionStatus.getAttribute("aria-label")).toBe("Connected");
	});

	test("marks the repository connection offline after the reachability probe fails", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
		fixture.instanceOffline = true;
		await act(async () => {
			EventSourceStub.instances[0]?.onerror?.(new Event("error"));
		});

		const connectionStatus = screen.getByTestId("repository-connection-status");
		await waitFor(() =>
			expect(connectionStatus.getAttribute("aria-label")).toBe(
				"Offline — local server unavailable",
			),
		);
	});

	test("preloads adjacent diffs and reuses them for instant back-and-forth navigation", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		expect(screen.getAllByRole("button", { name: "Previous file" })).toHaveLength(1);
		expect(screen.getAllByRole("button", { name: "Next file" })).toHaveLength(1);
		const diffRequestCount = (fileId: string) =>
			fixture.requests.filter(
				(request) => request.path === `/api/repositories/repo/files/${fileId}/diff`,
			).length;
		await waitFor(() => expect(diffRequestCount("second")).toBe(1));

		fireEvent.click(screen.getAllByRole("button", { name: "Next file" })[0]!);
		expect(screen.queryByText("Loading diff…")).toBeNull();
		expect(screen.getByTestId("pierre-code-view").textContent).toContain(
			"export const second = true;",
		);
		expect(diffRequestCount("second")).toBe(1);

		fireEvent.click(screen.getAllByRole("button", { name: "Previous file" })[0]!);
		expect(screen.queryByText("Loading diff…")).toBeNull();
		expect(screen.getByTestId("pierre-code-view").textContent).toContain(
			"const value = load(newPath);",
		);
		expect(diffRequestCount("first")).toBe(1);
	});

	test("opens routed files at semantic lines and replaces the URL target on file navigation", async () => {
		const locations: Array<{ anchor: null; path: string }> = [];
		render(
			<App
				onReviewLocationChange={(location) =>
					locations.push(location as { anchor: null; path: string })
				}
				requestedRepositoryId="repo"
				requestedReviewLocation={{
					anchor: { line: 1, side: "new" },
					path: "src/second.ts",
				}}
			/>,
		);

		const currentFile = await screen.findByRole("region", { name: "Current file" });
		await waitFor(() => expect(currentFile.textContent).toContain("src/second.ts"));
		await waitFor(() =>
			expect(viewerLineJumps).toContainEqual({
				align: "start",
				behavior: "instant",
				lineNumber: 1,
				side: "new",
			}),
		);
		expect(locations).toEqual([]);

		fireEvent.click(screen.getAllByRole("button", { name: "Previous file" })[0]!);
		await waitFor(() => expect(currentFile.textContent).toContain("src/first.ts"));
		expect(locations.at(-1)).toEqual({ anchor: null, path: "src/first.ts" });
	});

	test("copies a normal server link to the settled review line", async () => {
		let copied = "";
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					copied = value;
				},
			},
		});
		render(<App requestedRepositoryId="repo" shareBaseUrl="https://review.example.test/base" />);
		await screen.findByTestId("pierre-code-view");
		act(() => fixture.viewerVisibleLineChange?.(2, "new"));
		fireEvent.click(screen.getByRole("button", { name: "Copy link to current line" }));

		await waitFor(() =>
			expect(copied).toBe(
				"https://review.example.test/?repo=repo&file=src%2Ffirst.ts&line=2&side=new",
			),
		);
		await screen.findByText("Link to current line copied");
	});

	test("does not reload the diff for duplicate SSE operation revisions", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
		const stream = EventSourceStub.instances[0];
		if (!stream?.onmessage) throw new Error("event stream was not connected");
		const diffRequestCount = () =>
			fixture.requests.filter(
				(request) => request.path === "/api/repositories/repo/files/first/diff",
			).length;
		const reviewRequestCount = () =>
			fixture.requests.filter(
				(request) =>
					request.path === "/api/repositories/repo/files/review" && request.method === "GET",
			).length;
		const initialDiffRequests = diffRequestCount();
		const initialReviewRequests = reviewRequestCount();
		const event = {
			repositoryId: "repo",
			operationRevision: "operation-1",
			stateRevision: 0,
			catalogRevision: 1,
			at: "2026-07-22T10:00:00.000Z",
		};

		await act(async () => {
			stream.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({ ...event, type: "ready" }),
				}),
			);
			await Promise.resolve();
		});
		await waitFor(() => expect(reviewRequestCount()).toBe(initialReviewRequests + 1));
		expect(diffRequestCount()).toBe(initialDiffRequests);

		await act(async () => {
			stream.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({ ...event, type: "changes" }),
				}),
			);
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(diffRequestCount()).toBe(initialDiffRequests);
	});

	test("stages optimistically without refreshing files or reloading an unchanged diff", async () => {
		fixture.delayStageResponse = true;
		fixture.emitSseDuringStage = true;
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
		const fileRequestCount = () =>
			fixture.requests.filter(
				(request) => request.path === "/api/repositories/repo/files" && request.method === "GET",
			).length;
		const diffRequestCount = () =>
			fixture.requests.filter(
				(request) => request.path === "/api/repositories/repo/files/first/diff",
			).length;
		const initialFileRequests = fileRequestCount();
		const initialDiffRequests = diffRequestCount();

		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
		await waitFor(() => expect(fixture.releaseStageResponse).not.toBeNull());

		expect(screen.getByRole("button", { name: "Unstage current file" })).toBeTruthy();
		expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
		expect(screen.queryByText("Loading diff…")).toBeNull();
		expect(fileRequestCount()).toBe(initialFileRequests);
		expect(diffRequestCount()).toBe(initialDiffRequests);

		await act(async () => {
			fixture.releaseStageResponse?.();
			await Promise.resolve();
		});

		await screen.findByText("File staged");
		expect(fileRequestCount()).toBe(initialFileRequests);
		expect(diffRequestCount()).toBe(initialDiffRequests);
		expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
	});

	test("stages only reviewed files from the changed-files drawer", async () => {
		fixture.files[0] = { ...fixture.files[0]!, reviewed: true };
		syncReviewRecords();
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		const diffRequestCount = () =>
			fixture.requests.filter(
				(request) => request.path === "/api/repositories/repo/files/first/diff",
			).length;
		const initialDiffRequests = diffRequestCount();
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("dialog", {
			name: "Changed files",
		});
		expect(within(drawer).getByLabelText("2 changed files, 2 additions, 1 deletion")).toBeTruthy();
		expect(within(drawer).getByRole("button", { name: "Stage all files (2)" })).toBeTruthy();
		fireEvent.click(
			within(drawer).getByRole("button", {
				name: "Stage reviewed files (1)",
			}),
		);

		await screen.findByText("1 reviewed file staged");
		expect(
			fixture.requests.find((request) => request.path === "/api/repositories/repo/files/stage")
				?.body,
		).toMatchObject({
			files: [{ fileId: "first", contentRevision: "first-v1" }],
			operationRevision: "operation-1",
		});
		expect(within(drawer).getByRole("button", { name: "Stage all files (1)" })).toBeTruthy();
		expect(within(drawer).queryByRole("button", { name: "Stage reviewed files (0)" })).toBeNull();
		expect(diffRequestCount()).toBe(initialDiffRequests);
		expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
	});

	test("stages every changed file from the drawer in one request", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("dialog", {
			name: "Changed files",
		});
		fireEvent.click(within(drawer).getByRole("button", { name: "Stage all files (2)" }));

		await screen.findByText("2 files staged");
		expect(
			fixture.requests.find((request) => request.path === "/api/repositories/repo/files/stage")
				?.body,
		).toMatchObject({
			files: [
				{ fileId: "first", contentRevision: "first-v1" },
				{ fileId: "second", contentRevision: "second-v1" },
			],
			operationRevision: "operation-1",
		});
		expect(
			within(drawer).getByRole("button", {
				name: "Commit 2 staged files",
			}),
		).toBeTruthy();
		expect(within(drawer).queryByRole("button", { name: "Stage all files (0)" })).toBeNull();
	});

	test("unreviews only reviewed files shown by the active drawer filters", async () => {
		fixture.files[0] = {
			...fixture.files[0]!,
			indexStatus: "M",
			reviewed: true,
			staged: true,
			unstaged: false,
			worktreeStatus: ".",
		};
		fixture.files[1] = { ...fixture.files[1]!, reviewed: true };
		syncReviewRecords();
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("dialog", { name: "Changed files" });
		expect(within(drawer).getByRole("button", { name: "Unreview shown files (2)" })).toBeTruthy();
		fireEvent.click(within(drawer).getByRole("button", { name: "Review filter" }));
		fireEvent.click(await screen.findByRole("button", { name: "Reviewed" }));
		fireEvent.click(within(drawer).getByRole("button", { name: "Stage filter" }));
		fireEvent.click(await screen.findByRole("button", { name: "Staged" }));
		fireEvent.click(within(drawer).getByRole("button", { name: "Unreview shown files (1)" }));

		await screen.findByText("1 review mark removed");
		expect(
			fixture.requests.find(
				(request) =>
					request.path === "/api/repositories/repo/files/review" && request.method === "PUT",
			)?.body,
		).toEqual({
			files: [{ fileId: "first", contentRevision: "first-v1" }],
			reviewed: false,
		});
		expect(fixture.files[0]?.reviewed).toBe(false);
		expect(fixture.files[1]?.reviewed).toBe(true);
		expect(within(drawer).queryByRole("button", { name: "Unreview shown files (0)" })).toBeNull();
	});

	test("restores review markers when a bulk unreview request fails", async () => {
		fixture.files[0] = { ...fixture.files[0]!, reviewed: true };
		syncReviewRecords();
		fixture.bulkReviewFailure = true;
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("dialog", { name: "Changed files" });
		fireEvent.click(within(drawer).getByRole("button", { name: "Unreview shown files (1)" }));

		await screen.findByText("Could not remove review marks.");
		expect(fixture.files[0]?.reviewed).toBe(true);
		expect(within(drawer).getByRole("button", { name: "Unreview shown files (1)" })).toBeTruthy();
	});

	test("selects the next file when an authoritative stage delta removes the active file", async () => {
		fixture.files[0] = {
			...fixture.files[0]!,
			indexStatus: "A",
			worktreeStatus: "D",
			staged: true,
			unstaged: true,
		};
		fixture.removeActiveFileOnStage = true;
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));

		await screen.findByText("src/second.ts");
		await waitFor(() =>
			expect(screen.getByTestId("pierre-code-view").textContent).toContain(
				"export const second = true;",
			),
		);
	});

	test("applies external staging metadata without reloading unchanged diff content", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
		const stream = EventSourceStub.instances[0];
		if (!stream?.onmessage) throw new Error("event stream was not connected");
		const diffRequestCount = () =>
			fixture.requests.filter(
				(request) => request.path === "/api/repositories/repo/files/first/diff",
			).length;
		const initialDiffRequests = diffRequestCount();
		fixture.files[0] = {
			...fixture.files[0]!,
			indexStatus: "M",
			worktreeStatus: ".",
			staged: true,
			unstaged: false,
		};
		fixture.currentOperationRevision = "operation-external-stage";

		await act(async () => {
			stream.onmessage?.(
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
		});

		await screen.findByRole("button", { name: "Unstage current file" });
		expect(diffRequestCount()).toBe(initialDiffRequests);
		expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
	});

	test("keeps the current diff mounted during a real background diff refresh", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
		const stream = EventSourceStub.instances[0];
		if (!stream?.onmessage) throw new Error("event stream was not connected");
		fixture.files[0] = {
			...fixture.files[0]!,
			contentRevision: "first-v2",
		};
		fixture.servedFirstDiff = {
			...fixture.servedFirstDiff,
			contentRevision: "first-v2",
			operationRevision: "operation-content-change",
		};
		fixture.currentOperationRevision = "operation-content-change";
		fixture.delayNextDiffResponse = true;

		await act(async () => {
			stream.onmessage?.(
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
		});
		await screen.findByText("Refreshing diff…");

		expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
		expect(screen.queryByText("Loading diff…")).toBeNull();

		await act(async () => {
			fixture.releaseDiffResponse?.();
			await Promise.resolve();
		});
		await waitFor(() => expect(screen.queryByText("Refreshing diff…")).toBeNull());
		expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
	});

	test("pairs native IDEs, opens Zed through the managed alias, and revokes devices", async () => {
		fixture.remoteBridgeAvailable = true;
		fixture.remoteBridgeDevices = [
			{
				id: "device-one",
				repositoryId: repository.id,
				label: "MacBook Air",
				sshAlias: "couchview-fixture-device-one",
				createdAt: "2026-07-29T10:00:00.000Z",
				lastUsedAt: "2026-07-29T10:01:00.000Z",
			},
		];
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Set up native IDE" }));

		const dialog = await screen.findByRole("dialog", { name: "Native IDE setup" });
		expect(within(dialog).getByText("Direct WebRTC preferred")).toBeTruthy();
		const openZed = within(dialog).getByRole("button", {
			name: "Open /fixture in Zed through MacBook Air",
		});
		fireEvent.click(openZed);
		await waitFor(() =>
			expect(nativeTestRuntime.openedUrls).toContain(
				"zed://ssh/couchview-fixture-device-one/fixture",
			),
		);
		expect(
			within(dialog).getByText("zed 'ssh://couchview-fixture-device-one/fixture'"),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"couchview bridge codex --profile couchview-fixture-device-one --repo '/fixture'",
			),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"couchview bridge terminal --profile couchview-fixture-device-one --repo '/fixture'",
			),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"couchview bridge claude --profile couchview-fixture-device-one --repo '/fixture'",
			),
		).toBeTruthy();
		expect(within(dialog).getByText("Claude Code Remote Control")).toBeTruthy();

		fireEvent.change(within(dialog).getByRole("textbox"), {
			target: { value: "Travel Air" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Generate" }));
		await within(dialog).findByText(/couchview bridge pair --url/);
		expect(fixture.requests).toContainEqual({
			path: `/api/repositories/${repository.id}/remote-bridge/pairings`,
			method: "POST",
			body: { label: "Travel Air" },
		});

		fireEvent.click(within(dialog).getByRole("button", { name: "Revoke MacBook Air" }));
		await waitFor(() =>
			expect(fixture.requests).toContainEqual({
				path: `/api/repositories/${repository.id}/remote-bridge/pairings/device-one`,
				method: "DELETE",
				body: null,
			}),
		);
		await waitFor(() => expect(within(dialog).queryByText("MacBook Air")).toBeNull());
	});

	test("reuses one native IDE pairing for another registered repository", async () => {
		fixture.remoteBridgeAvailable = true;
		fixture.remoteBridgeDevices = [
			{
				id: "device-one",
				repositoryId: repository.id,
				label: "MacBook Air",
				sshAlias: "couchview-fixture-device-one",
				createdAt: "2026-07-29T10:00:00.000Z",
				lastUsedAt: null,
			},
		];
		render(<App />);
		await screen.findByText("src/first.ts");

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const picker = await screen.findByRole("dialog", { name: "Projects" });
		fireEvent.click(
			within(picker).getByRole("button", { name: "second-fixture, /second-fixture" }),
		);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
				"second-fixture",
			);
		});
		await act(async () => Promise.resolve());

		fireEvent.click(screen.getByRole("button", { name: "Set up native IDE" }));
		const dialog = await screen.findByRole("dialog", { name: "Native IDE setup" });
		expect(within(dialog).getByText("MacBook Air")).toBeTruthy();
		expect(
			within(dialog).getByText("zed 'ssh://couchview-fixture-device-one/second-fixture'"),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"couchview bridge codex --profile couchview-fixture-device-one --repo '/second-fixture'",
			),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"couchview bridge terminal --profile couchview-fixture-device-one --repo '/second-fixture'",
			),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"couchview bridge claude --profile couchview-fixture-device-one --repo '/second-fixture'",
			),
		).toBeTruthy();
		expect(fixture.requests).toContainEqual({
			path: "/api/repositories/repo-two/remote-bridge/pairings",
			method: "GET",
			body: null,
		});
	});

	test("loads a routed repository after URL history catches up and follows Back", async () => {
		const selections: Array<{ repositoryId: string | null; mode: "push" | "replace" }> = [];
		const onRepositorySelection = (repositoryId: string | null, mode: "push" | "replace") => {
			selections.push({ repositoryId, mode });
		};
		const view = render(
			<App onRepositorySelection={onRepositorySelection} requestedRepositoryId="repo" />,
		);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const picker = await screen.findByRole("dialog", { name: "Projects" });
		expect(within(picker).getByText("/second-fixture")).toBeTruthy();
		fireEvent.click(
			within(picker).getByRole("button", { name: "second-fixture, /second-fixture" }),
		);

		await waitFor(() =>
			expect(selections.at(-1)).toEqual({ repositoryId: "repo-two", mode: "push" }),
		);
		expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
			"fixture",
		);
		expect(
			fixture.requests.some((request) => request.path === "/api/repositories/repo-two/files"),
		).toBe(false);

		view.rerender(
			<App onRepositorySelection={onRepositorySelection} requestedRepositoryId="repo-two" />,
		);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
				"second-fixture",
			);
		});
		expect(
			fixture.requests.some((request) => request.path === "/api/repositories/repo-two/files"),
		).toBe(true);

		view.rerender(
			<App onRepositorySelection={onRepositorySelection} requestedRepositoryId="repo" />,
		);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
				"fixture",
			);
		});
	});

	test("adds and opens the first project from an empty repository catalog", async () => {
		fixture.catalog = [];
		const selections: Array<{ repositoryId: string | null; mode: "push" | "replace" }> = [];
		const view = render(
			<App
				onRepositorySelection={(repositoryId, mode) => selections.push({ repositoryId, mode })}
			/>,
		);

		const picker = await openRepositoryManager();
		expect(within(picker).getByText("No saved repositories")).toBeTruthy();
		fireEvent.click(within(picker).getByRole("button", { name: "Browse server folders" }));
		const directoryPicker = await screen.findByRole("dialog", { name: "Choose project folder" });
		await within(directoryPicker).findByText("/projects");
		fireEvent.click(within(directoryPicker).getByRole("button", { name: "added-project" }));
		await within(directoryPicker).findByText("/projects/added-project");
		fireEvent.click(within(directoryPicker).getByRole("button", { name: "Add this project" }));

		await waitFor(() =>
			expect(fixture.requests).toContainEqual({
				path: "/api/repositories",
				method: "POST",
				body: { root: "/projects/added-project" },
			}),
		);
		await waitFor(() =>
			expect(selections.at(-1)).toEqual({ repositoryId: "repo-added", mode: "push" }),
		);
		view.rerender(
			<App
				onRepositorySelection={(repositoryId, mode) => selections.push({ repositoryId, mode })}
				requestedRepositoryId="repo-added"
			/>,
		);
		await screen.findByText("added-project");
		expect(screen.queryByRole("dialog", { name: "Repositories" })).toBeNull();
		expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
			"added-project",
		);
	});

	test("keeps the project path available when registration fails", async () => {
		fixture.repositoryRegistrationFailure = true;
		render(<App />);

		await screen.findByText("src/first.ts");
		const picker = await openRepositoryManager();
		const pathInput = within(picker).getByRole("textbox", {
			name: "Project path on this server",
		});
		fireEvent.change(pathInput, { target: { value: "/projects/missing" } });
		fireEvent.click(within(picker).getByRole("button", { name: "Add" }));

		await screen.findByText("The repository directory does not exist");
		expect(screen.getByRole("dialog", { name: "Repositories" })).toBeTruthy();
		expect((pathInput as HTMLInputElement).value).toBe("/projects/missing");
		expect(
			(within(picker).getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	test("starts a rebuild and waits for the replacement server", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		const picker = await openRepositoryManager();
		fireEvent.click(
			within(picker).getByRole("button", {
				name: "Rebuild & restart Couchview",
			}),
		);

		expect(await screen.findByText("Restarting Couchview…")).toBeTruthy();
		expect(
			fixture.requests.some(
				(request) => request.path === "/api/restart" && request.method === "POST",
			),
		).toBe(true);
	});

	test("shows unavailable repositories and confirms Forget", async () => {
		fixture.catalog[1] = { ...fixture.catalog[1]!, available: false };
		render(<App />);

		await screen.findByText("src/first.ts");
		const picker = await openRepositoryManager();
		expect(within(picker).getByText("Unavailable")).toBeTruthy();
		const unavailableProject = within(picker).getByRole("button", {
			name: "second-fixture, /second-fixture, unavailable",
		}) as HTMLButtonElement;
		expect(unavailableProject.disabled).toBe(true);

		fireEvent.click(within(picker).getByRole("button", { name: "Forget second-fixture" }));
		await waitFor(() => {
			expect(
				fixture.requests.some(
					(request) => request.path === "/api/repositories/repo-two" && request.method === "DELETE",
				),
			).toBe(true);
		});
	});

	test("warns once before forgetting a repository and terminating its tmux work", async () => {
		fixture.catalog[1] = { ...fixture.catalog[1]!, available: false };
		const confirmations: string[] = [];
		Object.defineProperty(window, "confirm", {
			configurable: true,
			value: (message: string) => {
				confirmations.push(message);
				return true;
			},
		});
		render(<App />);

		await screen.findByText("src/first.ts");
		const picker = await openRepositoryManager();
		fireEvent.click(within(picker).getByRole("button", { name: "Forget second-fixture" }));

		await waitFor(() =>
			expect(
				fixture.requests.filter(
					(entry) => entry.path === "/api/repositories/repo-two" && entry.method === "DELETE",
				),
			).toHaveLength(1),
		);
		expect(confirmations).toHaveLength(1);
		expect(confirmations[0]).toContain("running programs and unsaved work");
	});

	test("aborts an in-flight repository load when another project is selected", async () => {
		render(<App />);
		await screen.findByText("src/first.ts");

		const normalFetch = globalThis.fetch;
		let secondLoadAborted = false;
		globalThis.fetch = ((input, init) => {
			const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const url = new URL(raw, "http://localhost");
			if (url.pathname !== "/api/repositories/repo-two/files") {
				return normalFetch(input, init);
			}
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => {
						secondLoadAborted = true;
						reject(new TypeError("aborted"));
					},
					{ once: true },
				);
			});
		}) as typeof fetch;

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const picker = await screen.findByRole("dialog", { name: "Projects" });
		fireEvent.click(
			within(picker).getByRole("button", { name: "second-fixture, /second-fixture" }),
		);
		await waitFor(() =>
			expect(
				fixture.requests.some(
					(request) => request.path === "/api/repositories/repo-two/files/review",
				),
			).toBe(true),
		);

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const returnPicker = await screen.findByRole("dialog", { name: "Projects" });
		fireEvent.click(within(returnPicker).getByRole("button", { name: "fixture, /fixture" }));
		await waitFor(() => expect(secondLoadAborted).toBe(true));
		await screen.findByText("src/first.ts");
	});

	test("keeps one file-navigation control set and toggles staging", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		expect(screen.getAllByRole("button", { name: "Previous file" })).toHaveLength(1);
		expect(screen.getAllByRole("button", { name: "Next file" })).toHaveLength(1);

		fireEvent.click(screen.getByRole("button", { name: "Review + next" }));
		await waitFor(() =>
			expect(
				fixture.requests.find(
					(request) => request.path === "/api/repositories/repo/files/first/review",
				)?.body,
			).toMatchObject({ reviewed: true }),
		);
		await screen.findByText("src/second.ts");

		fireEvent.click(screen.getByRole("button", { name: "Previous file" }));
		await screen.findByText("src/first.ts");

		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Unstage current file" }) as HTMLButtonElement)
					.disabled,
			).toBe(false),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(
			fixture.requests.find(
				(request) => request.path === "/api/repositories/repo/files/first/stage",
			)?.body,
		).toMatchObject({ staged: true });

		fireEvent.click(screen.getByRole("button", { name: "Unstage current file" }));
		await waitFor(() =>
			expect(
				fixture.requests.filter(
					(request) => request.path === "/api/repositories/repo/files/first/stage",
				),
			).toHaveLength(2),
		);
		await screen.findByRole("button", { name: "Stage current file" });
		expect(
			fixture.requests
				.filter((request) => request.path === "/api/repositories/repo/files/first/stage")
				.at(-1)?.body,
		).toMatchObject({ staged: false });
	});

	test("shows structured diagnostics when a diff unexpectedly returns no output", async () => {
		fixture.diffFailure = true;
		render(<App />);

		await screen.findByText("Couldn’t load this diff");
		expect(
			screen.getByText("Git diff returned no data for a changed file after two attempts"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Error details" }));
		const details = await screen.findByRole("dialog", { name: "Error details" });
		expect(within(details).getByText("diff1234")).toBeTruthy();
		expect(within(details).getByText("empty_output")).toBeTruthy();
		expect(
			within(details).getByText("Git reported this path as changed but returned no diff output."),
		).toBeTruthy();
	});

	test("opens Git timeout diagnostics from a failed staging toast", async () => {
		fixture.stageFailure = true;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
		await screen.findByText("Git update-index stopped responding after 15 seconds");
		fireEvent.click(screen.getByRole("button", { name: "Details" }));
		const details = await screen.findByRole("dialog", { name: "Error details" });
		expect(within(details).getByText("stage123")).toBeTruthy();
		expect(within(details).getByText("update-index")).toBeTruthy();
		expect(within(details).getByText("timeout")).toBeTruthy();
	});
});
