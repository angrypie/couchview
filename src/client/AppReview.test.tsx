import { describe, expect, test } from "bun:test";
import {
	App,
	act,
	cleanup,
	createAppTestHarness,
	EventSourceStub,
	fireEvent,
	render,
	screen,
	viewerHunkJumps,
	viewerLineJumps,
	waitFor,
	within,
} from "./appTestHarness.tsx";

describe("Couchview app review and delivery workflows", () => {
	const fixture = createAppTestHarness();
	test("commits staged files from the changed-files drawer", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
		await screen.findByRole("button", { name: "Unstage current file" });

		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		fireEvent.click(await screen.findByRole("button", { name: "Commit 1 staged file" }));
		const composer = await screen.findByRole("dialog", {
			name: "Commit staged changes",
		});
		expect(
			fixture.requests.some((request) => request.path === "/api/repositories/repo/commit-message"),
		).toBe(false);
		fireEvent.click(within(composer).getByRole("button", { name: "Generate with Codex" }));
		const generated = await within(composer).findByDisplayValue(
			"feat(review): generate commit messages with Codex",
		);
		expect(
			fixture.requests.find((request) => request.path === "/api/repositories/repo/commit-message"),
		).toMatchObject({
			method: "POST",
			body: {
				operationRevision: "operation-2",
				codex: { model: "gpt-5.6-luna", reasoning: "low" },
			},
		});
		fireEvent.change(generated, {
			target: { value: "fix(review): edit the generated commit message" },
		});
		fireEvent.click(within(composer).getByRole("button", { name: "Commit staged changes" }));

		await screen.findByText("Committed abc1234");
		expect(
			fixture.requests.find((request) => request.path === "/api/repositories/repo/commit"),
		).toMatchObject({
			method: "POST",
			body: {
				message: "fix(review): edit the generated commit message",
				operationRevision: "operation-2",
			},
		});
		await waitFor(() => expect(screen.getByText("src/second.ts")).toBeTruthy());
	});

	test("preserves a commit draft when Codex generation fails", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
		await screen.findByRole("button", { name: "Unstage current file" });
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		fireEvent.click(await screen.findByRole("button", { name: "Commit 1 staged file" }));
		const composer = await screen.findByRole("dialog", {
			name: "Commit staged changes",
		});
		const input = within(composer).getByPlaceholderText("Commit message…");
		fireEvent.change(input, {
			target: { value: "fix(review): preserve this draft" },
		});
		fixture.commitMessageFailure = true;
		fireEvent.click(
			within(composer).getByRole("button", {
				name: "Regenerate with Codex",
			}),
		);

		await screen.findByText("Codex could not generate a commit message");
		expect((input as HTMLTextAreaElement).value).toBe("fix(review): preserve this draft");
	});

	test("aborts Codex generation when the commit editor closes", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
		await screen.findByRole("button", { name: "Unstage current file" });
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		fireEvent.click(await screen.findByRole("button", { name: "Commit 1 staged file" }));
		const composer = await screen.findByRole("dialog", {
			name: "Commit staged changes",
		});
		fixture.delayCommitMessageResponse = true;
		fireEvent.click(within(composer).getByRole("button", { name: "Generate with Codex" }));
		await waitFor(() =>
			expect(
				fixture.requests.some(
					(request) => request.path === "/api/repositories/repo/commit-message",
				),
			).toBe(true),
		);
		fireEvent.click(within(composer).getByRole("button", { name: "Close sheet" }));

		await waitFor(() => expect(fixture.commitMessageRequestAborted).toBe(true));
		fixture.releaseCommitMessageResponse?.();
	});

	test("explains when Codex commit generation is unavailable", async () => {
		fixture.commitMessageAvailable = false;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Stage current file" }));
		await screen.findByRole("button", { name: "Unstage current file" });
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		fireEvent.click(await screen.findByRole("button", { name: "Commit 1 staged file" }));
		const composer = await screen.findByRole("dialog", {
			name: "Commit staged changes",
		});
		expect(
			(
				within(composer).getByRole("button", {
					name: "Generate with Codex",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(within(composer).getByText("Codex CLI is unavailable in this test.")).toBeTruthy();
	});

	test("groups package scripts by subproject and streams a completed run", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		fireEvent.click(await screen.findByRole("button", { name: /Commands/ }));
		expect(await screen.findByText("fixture-root")).toBeTruthy();
		expect(screen.getByText("@fixture/web")).toBeTruthy();
		expect(screen.getByText("vite build")).toBeTruthy();
		expect(screen.getByText(/Package scripts run on this computer/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Run build in apps/web" }));
		const output = await screen.findByRole("dialog", {
			name: "@fixture/web / build",
		});
		expect(
			fixture.requests.find(
				(request) =>
					request.path === "/api/repositories/repo/package-runs" && request.method === "POST",
			),
		).toMatchObject({
			body: {
				packagePath: "apps/web/package.json",
				scriptName: "build",
				manifestRevision: "web-package-revision",
			},
		});
		await waitFor(() => expect(EventSourceStub.instances.length).toBeGreaterThan(1));
		const stream = EventSourceStub.instances.at(-1)!;
		const running = fixture.packageRuns[0]!;
		await act(async () => {
			stream.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({
						type: "snapshot",
						snapshot: {
							run: running,
							output: [{ sequence: 1, stream: "stdout", text: "building web\n" }],
						},
					}),
				}),
			);
			stream.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({
						type: "status",
						run: {
							...running,
							status: "succeeded",
							exitCode: 0,
							finishedAt: "2026-07-23T10:00:02.000Z",
						},
					}),
				}),
			);
		});

		expect(within(output).getByText("building web")).toBeTruthy();
		expect(within(output).getByText("Passed")).toBeTruthy();
		fireEvent.click(within(output).getByRole("button", { name: "Close sheet" }));
		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "@fixture/web / build" })).toBeNull(),
		);
		expect(fixture.requests.some((request) => request.path.endsWith("/stop"))).toBe(false);
	});

	test("stops a running package script from its output sheet", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open changed files" }));
		fireEvent.click(await screen.findByRole("button", { name: /Commands/ }));
		fireEvent.click(screen.getByRole("button", { name: "Run dev in ." }));
		const output = await screen.findByRole("dialog", {
			name: "fixture-root / dev",
		});
		fireEvent.click(within(output).getByRole("button", { name: "Stop" }));

		await waitFor(() =>
			expect(
				fixture.requests.some(
					(request) =>
						request.path === "/api/repositories/repo/package-runs/package-run-1/stop" &&
						request.method === "POST",
				),
			).toBe(true),
		);
		expect(await within(output).findByText("Stopping")).toBeTruthy();
	});

	test("hides line numbers by default and remembers the 123 toggle", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		expect(screen.queryByTestId("old-line-1")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Show line numbers" }));
		expect(await screen.findByTestId("old-line-1")).toBeTruthy();
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.display.lineNumbersVisible).toBe(true),
		);

		cleanup();
		render(<App />);
		await screen.findByText("src/first.ts");
		expect(screen.getByRole("button", { name: "Hide line numbers" })).toBeTruthy();
		expect(await screen.findByTestId("new-line-1")).toBeTruthy();
	});

	test("wraps long lines on request and remembers the display preference", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		expect((await screen.findByTestId("pierre-code-view")).dataset.lineWrap).toBe("false");
		fireEvent.click(screen.getByRole("button", { name: "Wrap long lines" }));
		expect(screen.getByRole("button", { name: "Keep long lines on one line" })).toBeTruthy();
		expect(screen.getByTestId("pierre-code-view").dataset.lineWrap).toBe("true");
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.display.lineWrapEnabled).toBe(true),
		);

		cleanup();
		render(<App />);
		await screen.findByText("src/first.ts");
		expect(screen.getByRole("button", { name: "Keep long lines on one line" })).toBeTruthy();
		expect((await screen.findByTestId("pierre-code-view")).dataset.lineWrap).toBe("true");
	});

	test("jumps to the only hunk from above or below it", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		const previousHunk = screen.getAllByRole("button", {
			name: "Previous hunk",
		})[0] as HTMLButtonElement;
		const nextHunk = screen.getAllByRole("button", {
			name: "Next hunk",
		})[0] as HTMLButtonElement;
		await waitFor(() => expect(nextHunk.disabled).toBe(false));
		expect(previousHunk.disabled).toBe(true);

		fireEvent.click(nextHunk);

		expect(viewerHunkJumps).toEqual([0]);
		expect(nextHunk.disabled).toBe(true);
		expect(previousHunk.disabled).toBe(true);

		act(() => fixture.viewerVisibleLineChange?.(100, "new"));
		expect(previousHunk.disabled).toBe(false);
		expect(nextHunk.disabled).toBe(true);

		fireEvent.click(previousHunk);
		expect(viewerHunkJumps).toEqual([0, 0]);
		expect(previousHunk.disabled).toBe(true);
	});

	test("routes hunk navigation without skipping the first hunk", async () => {
		const secondHunk = structuredClone(fixture.servedFirstDiff.hunks[0]!);
		secondHunk.id = "hunk-2";
		secondHunk.header = "@@ -11,2 +11,2 @@";
		secondHunk.oldStart = 11;
		secondHunk.newStart = 11;
		secondHunk.lines = secondHunk.lines.map((line) => ({
			...line,
			oldLine: line.oldLine === null ? null : line.oldLine + 10,
			newLine: line.newLine === null ? null : line.newLine + 10,
		}));
		fixture.servedFirstDiff.hunks.push(secondHunk);
		render(<App />);

		await screen.findByText("src/first.ts");
		const nextHunk = screen.getAllByRole("button", {
			name: "Next hunk",
		})[0] as HTMLButtonElement;
		await waitFor(() => expect(nextHunk.disabled).toBe(false));
		fireEvent.click(nextHunk);
		expect(viewerHunkJumps).toEqual([0]);
		expect(nextHunk.disabled).toBe(false);

		fireEvent.click(nextHunk);
		expect(viewerHunkJumps).toEqual([0, 1]);
		expect(nextHunk.disabled).toBe(true);
	});

	test("keeps a long hunk jump anchored while intermediate lines are reported", async () => {
		fixture.servedFirstDiff.hunks = [0, 10, 20].map((offset, index) => {
			const hunk = structuredClone(fixture.servedFirstDiff.hunks[0]!);
			hunk.id = `hunk-${index + 1}`;
			hunk.header = `@@ -${offset + 1},2 +${offset + 1},2 @@`;
			hunk.oldStart += offset;
			hunk.newStart += offset;
			hunk.lines = hunk.lines.map((line) => ({
				...line,
				id: `${line.id}-${index + 1}`,
				oldLine: line.oldLine === null ? null : line.oldLine + offset,
				newLine: line.newLine === null ? null : line.newLine + offset,
			}));
			return hunk;
		});
		render(<App />);

		await screen.findByText("src/first.ts");
		const nextHunk = screen.getAllByRole("button", {
			name: "Next hunk",
		})[0] as HTMLButtonElement;
		await waitFor(() => expect(nextHunk.disabled).toBe(false));

		fireEvent.click(nextHunk);
		fireEvent.click(nextHunk);
		expect(viewerHunkJumps).toEqual([0, 1]);
		await act(() => new Promise((resolve) => setTimeout(resolve, 275)));
		act(() => fixture.viewerVisibleLineChange?.(5, "new"));
		fireEvent.click(nextHunk);

		expect(viewerHunkJumps).toEqual([0, 1, 2]);
	});

	test("searches a clicked identifier and opens a full-view source file at the match", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		const loadButtons = await screen.findAllByTitle("Find “load” in project");
		fireEvent.click(loadButtons[0]!);
		await screen.findByRole("dialog", { name: "Find in project" });
		await screen.findByText(/src\/first\.ts:1:15/);
		fireEvent.click(screen.getByRole("tab", { name: "Other files (1)" }));
		fireEvent.click(await screen.findByText(/README\.md:2:1/));

		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "Find in project" })).toBeNull(),
		);
		const currentFile = screen.getByRole("region", { name: "Current file" });
		expect(within(currentFile).getByText("README.md")).toBeTruthy();
		expect(within(currentFile).getByText("read-only")).toBeTruthy();
		await waitFor(() =>
			expect(screen.getByTestId("pierre-code-view").textContent).toContain("return value;"),
		);
		await waitFor(() =>
			expect(viewerLineJumps).toContainEqual({
				align: "center",
				behavior: "instant",
				lineNumber: 2,
				side: "new",
			}),
		);
	});
});
