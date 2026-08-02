import { describe, expect, test } from "bun:test";
import {
	App,
	act,
	cleanup,
	createAppTestHarness,
	EventSourceStub,
	fireEvent,
	fixtureComment,
	render,
	screen,
	viewerCommentJumps,
	viewerHunkJumps,
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
			body: { operationRevision: "operation-2" },
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
		fireEvent.click(within(composer).getByRole("button", { name: "Close commit editor" }));

		await waitFor(() => expect(fixture.commitMessageRequestAborted).toBe(true));
		expect(screen.queryByRole("dialog", { name: "Commit staged changes" })).toBeNull();
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
			name: "Package command output",
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
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "Package command output" })).toBeNull(),
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
			name: "Package command output",
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
		expect(screen.queryByRole("button", { name: "Select old line 1" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Show line numbers" }));
		expect(await screen.findByRole("button", { name: "Select old line 1" })).toBeTruthy();
		await waitFor(() =>
			expect(fixture.settingsProfiles[0]?.data.display.lineNumbersVisible).toBe(true),
		);

		cleanup();
		render(<App />);
		await screen.findByText("src/first.ts");
		expect(screen.getByRole("button", { name: "Hide line numbers" })).toBeTruthy();
		expect(await screen.findByRole("button", { name: "Select new line 1" })).toBeTruthy();
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
		const previousHunk = screen.getByRole("button", {
			name: "Previous hunk",
		}) as HTMLButtonElement;
		const nextHunk = screen.getByRole("button", {
			name: "Next hunk",
		}) as HTMLButtonElement;
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
		const nextHunk = screen.getByRole("button", { name: "Next hunk" }) as HTMLButtonElement;
		await waitFor(() => expect(nextHunk.disabled).toBe(false));
		fireEvent.click(nextHunk);
		expect(viewerHunkJumps).toEqual([0]);
		expect(nextHunk.disabled).toBe(false);

		fireEvent.click(nextHunk);
		expect(viewerHunkJumps).toEqual([0, 1]);
		expect(nextHunk.disabled).toBe(true);
	});

	test("searches a clicked identifier and opens a source preview", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		const loadButtons = await screen.findAllByTitle("Find “load” in project");
		fireEvent.click(loadButtons[0]!);
		await screen.findByRole("dialog", { name: "Project search" });
		await screen.findByRole("button", {
			name: /src\/first\.ts:1:15/,
		});
		fireEvent.click(screen.getByRole("button", { name: "Other files (1)" }));
		expect(await screen.findByRole("button", { name: /src\/second\.ts:1:14/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Current file (1)" }));
		fireEvent.click(await screen.findByRole("button", { name: /src\/first\.ts:1:15/ }));
		expect(await screen.findByText("return value;")).toBeTruthy();
	});

	test("creates a mixed replacement comment and exposes the manual copy fallback", async () => {
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Show line numbers" }));
		fireEvent.click(await screen.findByRole("button", { name: "Select old line 1" }));
		fireEvent.click(await screen.findByRole("button", { name: "Select new line 1" }));
		await screen.findByText(/Old lines 1 \/ new lines 1/);
		fireEvent.click(screen.getByRole("button", { name: "Comment" }));
		fireEvent.change(screen.getByPlaceholderText(/Describe the issue/), {
			target: { value: "Use the safe loader." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
		await waitFor(() => expect(fixture.comments).toHaveLength(1));
		expect(fixture.comments[0]).toMatchObject({
			side: "mixed",
			oldStartLine: 1,
			newStartLine: 1,
		});

		fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
		expect(await screen.findAllByText("Use the safe loader.")).not.toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: /Copy 1 for Codex/ }));
		await screen.findByRole("dialog", { name: "Copy comments manually" });
		const copyField = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(copyField.value).toContain("src/first.ts:old L1 / new L1");
		expect(copyField.value).toContain("Use the safe loader.");
	});

	test("replaces the review comments tray when opening Send to Codex", async () => {
		fixture.comments = [fixtureComment("comment-1", "Send this to Codex")];
		fixture.files[0]!.commentCount = 1;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
		expect(await screen.findByRole("dialog", { name: "Review comments" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Send to Codex" }));

		expect(await screen.findByRole("dialog", { name: "Send comments to Codex" })).toBeTruthy();
		expect(screen.queryByRole("dialog", { name: "Review comments" })).toBeNull();
	});

	test("opens an inline comment chip and focuses its tray card", async () => {
		fixture.comments = [fixtureComment("comment-1", "Inline correction")];
		fixture.files[0]!.commentCount = 1;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(await screen.findByRole("button", { name: /Open comment at/ }));
		await screen.findByRole("dialog", { name: "Review comments" });
		await waitFor(() => {
			expect((document.activeElement as HTMLElement | null)?.dataset.commentId).toBe("comment-1");
		});
	});

	test("jumps from the comment tray through the viewer handle", async () => {
		fixture.comments = [fixtureComment("comment-1", "Jump target")];
		fixture.files[0]!.commentCount = 1;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
		const tray = await screen.findByRole("dialog", { name: "Review comments" });
		fireEvent.click(
			within(tray).getByRole("button", {
				name: "src/first.ts:old L1 / new L1",
			}),
		);
		await waitFor(() => expect(viewerCommentJumps).toEqual(["comment-1"]));
		expect(await screen.findByText(/Old lines 1 \/ new lines 1/)).toBeTruthy();
	});

	test("edits and deletes an existing comment", async () => {
		fixture.comments = [fixtureComment("comment-1", "Original correction")];
		fixture.files[0]!.commentCount = 1;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
		expect(await screen.findAllByText("Original correction")).not.toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: /Edit comment at/ }));
		const editor = screen.getByPlaceholderText(/Describe the issue/) as HTMLTextAreaElement;
		expect(editor.value).toBe("Original correction");
		fireEvent.change(editor, { target: { value: "Updated correction" } });
		fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
		await waitFor(() => expect(fixture.comments[0]?.body).toBe("Updated correction"));

		fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
		expect(await screen.findAllByText("Updated correction")).not.toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: /Delete comment at/ }));
		await waitFor(() => expect(fixture.comments).toHaveLength(0));
		expect(await screen.findByText(/Tap a line number/)).toBeTruthy();
	});

	test("keeps stale comments visible while excluding them from export", async () => {
		fixture.comments = [
			fixtureComment("comment-1", "Current correction"),
			fixtureComment("stale-comment", "Outdated correction", true),
		];
		fixture.files[0]!.commentCount = 2;
		render(<App />);

		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: /Open comments/ }));
		expect(await screen.findByText("Outdated correction")).toBeTruthy();
		expect(screen.getByText(/· stale/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Copy 1 for Codex/ }));
		await screen.findByRole("dialog", { name: "Copy comments manually" });
		const copyField = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(copyField.value).toContain("Current correction");
		expect(copyField.value).not.toContain("Outdated correction");
	});
});
