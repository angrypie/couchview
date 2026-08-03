import { describe, expect, test } from "bun:test";
import {
	App,
	act,
	createAppTestHarness,
	EventSourceStub,
	fireEvent,
	render,
	repository,
	screen,
	waitFor,
	within,
} from "./appTestHarness.tsx";

describe("Couchview app repository workflows", () => {
	const fixture = createAppTestHarness();
	test("preloads adjacent diffs and reuses them for instant back-and-forth navigation", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
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
				(request) => request.path === "/api/repositories/repo/comments" && request.method === "GET",
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
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		const diffRequestCount = () =>
			fixture.requests.filter(
				(request) => request.path === "/api/repositories/repo/files/first/diff",
			).length;
		const initialDiffRequests = diffRequestCount();
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("complementary", {
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
		expect(
			(
				within(drawer).getByRole("button", {
					name: "Stage reviewed files (0)",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(diffRequestCount()).toBe(initialDiffRequests);
		expect(screen.getByTestId("pierre-code-view")).toBeTruthy();
	});

	test("stages every changed file from the drawer in one request", async () => {
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("complementary", {
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
		expect(
			(
				within(drawer).getByRole("button", {
					name: "Stage all files (0)",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
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
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("complementary", { name: "Changed files" });
		expect(within(drawer).getByRole("button", { name: "Unreview shown files (2)" })).toBeTruthy();
		fireEvent.click(within(drawer).getByRole("button", { name: /^reviewed$/ }));
		fireEvent.click(within(drawer).getByRole("button", { name: /^staged$/ }));
		fireEvent.click(within(drawer).getByRole("button", { name: "Unreview shown files (1)" }));

		await screen.findByText("1 review mark removed");
		expect(
			fixture.requests.find((request) => request.path === "/api/repositories/repo/files/review")
				?.body,
		).toEqual({
			files: [{ fileId: "first", contentRevision: "first-v1" }],
			reviewed: false,
		});
		expect(fixture.files[0]?.reviewed).toBe(false);
		expect(fixture.files[1]?.reviewed).toBe(true);
		expect(
			(
				within(drawer).getByRole("button", {
					name: "Unreview shown files (0)",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	test("restores review markers when a bulk unreview request fails", async () => {
		fixture.files[0] = { ...fixture.files[0]!, reviewed: true };
		fixture.bulkReviewFailure = true;
		render(<App />);

		await screen.findByTestId("pierre-code-view");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		const drawer = await screen.findByRole("complementary", { name: "Changed files" });
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
		const zedLink = within(dialog).getByRole("link", { name: "Open" });
		expect(zedLink.getAttribute("href")).toBe("zed://ssh/couchview-fixture-device-one/fixture");
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

		fireEvent.change(within(dialog).getByLabelText("Device name"), {
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
		const picker = await screen.findByRole("dialog", { name: "Repositories" });
		fireEvent.click(
			within(picker).getByRole("button", {
				name: /second-fixture \/second-fixture/,
			}),
		);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
				"second-fixture",
			);
		});

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

	test("switches repositories through the picker and follows URL history", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const picker = await screen.findByRole("dialog", { name: "Repositories" });
		expect(within(picker).getByText("/second-fixture")).toBeTruthy();
		fireEvent.click(
			within(picker).getByRole("button", {
				name: /second-fixture \/second-fixture/,
			}),
		);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
				"second-fixture",
			);
		});
		expect(new URL(window.location.href).searchParams.get("repo")).toBe("repo-two");
		expect(
			fixture.requests.some((request) => request.path === "/api/repositories/repo-two/files"),
		).toBe(true);

		window.history.replaceState(null, "", "/?repo=repo");
		await new Promise((resolve) => setTimeout(resolve, 0));
		fireEvent.popState(window);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Select repository" }).textContent).toContain(
				"fixture",
			);
		});
	});

	test("starts a rebuild and waits for the replacement server", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const picker = await screen.findByRole("dialog", { name: "Repositories" });
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
		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const picker = await screen.findByRole("dialog", { name: "Repositories" });
		expect(within(picker).getByText("Unavailable")).toBeTruthy();
		const unavailableProject = within(picker).getByRole("button", {
			name: /second-fixture \/second-fixture Unavailable/,
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
		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const picker = await screen.findByRole("dialog", { name: "Repositories" });
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
		const picker = await screen.findByRole("dialog", { name: "Repositories" });
		fireEvent.click(
			within(picker).getByRole("button", { name: /second-fixture \/second-fixture/ }),
		);
		await waitFor(() =>
			expect(
				fixture.requests.some((request) => request.path === "/api/repositories/repo-two/comments"),
			).toBe(true),
		);

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const returnPicker = await screen.findByRole("dialog", { name: "Repositories" });
		fireEvent.click(within(returnPicker).getByRole("button", { name: /fixture \/fixture/ }));
		await waitFor(() => expect(secondLoadAborted).toBe(true));
		await screen.findByText("src/first.ts");
	});

	test("uses portrait-consistent compact landscape actions and toggles staging", async () => {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: (query: string) => ({
				matches: query.includes("max-height: 599px"),
				media: query,
				onchange: null,
				addEventListener() {},
				removeEventListener() {},
				addListener() {},
				removeListener() {},
				dispatchEvent: () => false,
			}),
		});
		const { container } = render(<App />);

		await screen.findByText("src/first.ts");
		expect(container.querySelector(".app-shell.compact-landscape")).toBeTruthy();
		expect(container.querySelector(".file-bar")).toBeNull();
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
		await screen.findByRole("button", { name: "Unstage current file" });
		expect(
			fixture.requests.find(
				(request) => request.path === "/api/repositories/repo/files/first/stage",
			)?.body,
		).toMatchObject({ staged: true });

		fireEvent.click(screen.getByRole("button", { name: "Unstage current file" }));
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
		const details = await screen.findByRole("dialog", { name: "Git error details" });
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
		const details = await screen.findByRole("dialog", { name: "Git error details" });
		expect(within(details).getByText("stage123")).toBeTruthy();
		expect(within(details).getByText("update-index")).toBeTruthy();
		expect(within(details).getByText("timeout")).toBeTruthy();
	});
});
