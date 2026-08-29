import { describe, expect, test } from "bun:test";
import {
	App,
	act,
	createAppTestHarness,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "./appTestHarness.tsx";

describe("Couchview quick pickers", () => {
	const fixture = createAppTestHarness();
	const interceptSourceFile = (respond: (url: URL) => Response) => {
		const normalFetch = globalThis.fetch;
		globalThis.fetch = ((input, init) => {
			const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const url = new URL(raw, "http://localhost");
			return url.pathname.endsWith("/source-file")
				? Promise.resolve(respond(url))
				: normalFetch(input, init);
		}) as typeof fetch;
	};

	test("fuzzily selects a project with focused input and closes with Ctrl+C", async () => {
		const selections: Array<{ repositoryId: string | null; mode: "push" | "replace" }> = [];
		render(
			<App
				onRepositorySelection={(repositoryId, mode) => selections.push({ repositoryId, mode })}
				requestedRepositoryId="repo"
			/>,
		);
		await screen.findByTestId("pierre-code-view");

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const projects = await screen.findByRole("dialog", { name: "Projects" });
		const search = within(projects).getByRole("textbox", { name: "Search projects" });
		await waitFor(() => expect(document.activeElement).toBe(search));
		fireEvent.change(search, { target: { value: "second" } });
		fireEvent.keyDown(search, { key: "Enter" });
		expect(selections.at(-1)).toEqual({ repositoryId: "repo-two", mode: "push" });

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const reopened = await screen.findByRole("dialog", { name: "Projects" });
		const reopenedSearch = within(reopened).getByRole("textbox");
		fireEvent.keyDown(reopenedSearch, { ctrlKey: true, key: "c", shiftKey: true });
		expect(screen.getByRole("dialog", { name: "Projects" })).toBeTruthy();
		fireEvent.keyDown(reopenedSearch, { ctrlKey: true, key: "c" });
		expect(screen.queryByRole("dialog", { name: "Projects" })).toBeNull();
	});

	test("cycles projects by pressing p repeatedly while g remains held", async () => {
		const selections: Array<{ repositoryId: string | null; mode: "push" | "replace" }> = [];
		render(
			<App
				onRepositorySelection={(repositoryId, mode) => selections.push({ repositoryId, mode })}
				requestedRepositoryId="repo"
			/>,
		);
		await screen.findByTestId("pierre-code-view");

		fireEvent.keyDown(window, { key: "g" });
		fireEvent.keyDown(window, { key: "p" });
		const projects = await screen.findByRole("dialog", { name: "Projects" });
		fireEvent.keyDown(window, { key: "p" });
		expect(within(projects).getByRole("status").textContent).toContain("second-fixture");
		fireEvent.keyDown(within(projects).getByRole("textbox"), { key: "Enter" });
		fireEvent.keyUp(window, { key: "g" });

		expect(selections.at(-1)).toEqual({ repositoryId: "repo-two", mode: "push" });
	});

	test("keeps the active project by identity while a refresh reorders results", async () => {
		fixture.catalog.push({
			addedAt: "2026-01-02T00:00:00.000Z",
			available: true,
			id: "repo-three",
			name: "third-fixture",
			root: "/third-fixture",
		});
		const normalFetch = globalThis.fetch;
		let releaseRefresh = () => {};
		const refreshGate = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		globalThis.fetch = (async (input, init) => {
			const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const url = new URL(raw, "http://localhost");
			if (url.pathname === "/api/repositories" && (init?.method ?? "GET") === "GET") {
				await refreshGate;
			}
			return normalFetch(input, init);
		}) as typeof fetch;
		const selections: string[] = [];
		render(
			<App
				onRepositorySelection={(repositoryId) => {
					if (repositoryId) selections.push(repositoryId);
				}}
				requestedRepositoryId="repo"
			/>,
		);
		await screen.findByTestId("pierre-code-view");

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		const projects = await screen.findByRole("dialog", { name: "Projects" });
		const search = within(projects).getByRole("textbox", { name: "Search projects" });
		fireEvent.keyDown(search, { key: "ArrowDown" });
		expect(within(projects).getByRole("status").textContent).toContain("second-fixture");

		fixture.catalog = [fixture.catalog[0]!, fixture.catalog[2]!, fixture.catalog[1]!];
		await act(async () => releaseRefresh());
		await waitFor(() =>
			expect(within(projects).getByRole("status").textContent).toContain(
				"second-fixture, /second-fixture, 3 of 3",
			),
		);
		fireEvent.keyDown(search, { key: "Enter" });
		expect(selections.at(-1)).toBe("repo-two");
	});

	test("replaces the quick picker when the command palette opens", async () => {
		render(<App />);
		await screen.findByTestId("pierre-code-view");

		fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
		await screen.findByRole("dialog", { name: "Projects" });
		fireEvent.keyDown(window, { ctrlKey: true, key: "k" });

		const commandPalette = await screen.findByRole("dialog", { name: "Command palette" });
		expect(commandPalette).toBeTruthy();
		expect(screen.queryByRole("dialog", { name: "Projects" })).toBeNull();
	});

	test("opens changed files with Ctrl+P and shows unchanged files in the main viewer", async () => {
		render(<App />);
		await screen.findByTestId("pierre-code-view");

		fireEvent.keyDown(window, { ctrlKey: true, key: "p" });
		let files = await screen.findByRole("dialog", { name: "Files" });
		let search = within(files).getByRole("textbox", { name: "Search project files" });
		const repeatedOpen = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			ctrlKey: true,
			key: "p",
			repeat: true,
		});
		search.dispatchEvent(repeatedOpen);
		expect(repeatedOpen.defaultPrevented).toBe(true);
		fireEvent.change(search, { target: { value: "second" } });
		fireEvent.keyDown(search, { key: "Enter" });
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Files" })).toBeNull());
		await screen.findByText("src/second.ts");
		await waitFor(() =>
			expect(screen.getByTestId("pierre-code-view").textContent).toContain(
				"export const second = true;",
			),
		);

		fireEvent.keyDown(window, { ctrlKey: true, key: "p" });
		files = await screen.findByRole("dialog", { name: "Files" });
		search = within(files).getByRole("textbox", { name: "Search project files" });
		await within(files).findByRole("button", { name: "README.md, Project root" });
		fireEvent.change(search, { target: { value: "readme" } });
		fireEvent.keyDown(search, { key: "Enter" });

		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Files" })).toBeNull());
		const currentFile = screen.getByRole("region", { name: "Current file" });
		expect(within(currentFile).getByText("README.md")).toBeTruthy();
		expect(within(currentFile).getByText("read-only")).toBeTruthy();
		await waitFor(() =>
			expect(screen.getByTestId("pierre-code-view").textContent).toContain(
				"const value = load(newPath);",
			),
		);
		expect(fixture.requests.some((request) => request.path.endsWith("/source-file"))).toBe(true);
		expect(
			fixture.requests.filter((request) => request.path.endsWith("/project-files")),
		).toHaveLength(1);

		fireEvent.keyDown(window, { key: "/" });
		await screen.findByRole("dialog", { name: "Find in project" });
	});

	test("ranks a contiguous filename match ahead of cross-directory fuzzy noise", async () => {
		const distractorPath = "apps/native/src/app/conversations/[id].tsx";
		const targetPath = "apps/native/src/features/audio/transcription.ios.ts";
		fixture.projectFiles = [distractorPath, targetPath];
		render(<App />);
		await screen.findByTestId("pierre-code-view");

		fireEvent.keyDown(window, { ctrlKey: true, key: "p" });
		const files = await screen.findByRole("dialog", { name: "Files" });
		const search = within(files).getByRole("textbox", { name: "Search project files" });
		await within(files).findByRole("button", {
			name: "transcription.ios.ts, apps/native/src/features/audio",
		});
		fireEvent.change(search, { target: { value: "trans ios" } });

		const target = within(files).getByRole("button", {
			name: "transcription.ios.ts, apps/native/src/features/audio",
		});
		await waitFor(() => expect(target.getAttribute("aria-selected")).toBe("true"));

		fireEvent.keyDown(search, { key: "Enter" });
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Files" })).toBeNull());
		const currentFile = screen.getByRole("region", { name: "Current file" });
		expect(within(currentFile).getByText(targetPath)).toBeTruthy();
		expect(within(currentFile).getByText("read-only")).toBeTruthy();
	});

	test("shows source failures instead of the clean-repository state", async () => {
		fixture.files = [];
		fixture.projectFiles = ["README.md"];
		interceptSourceFile(() =>
			Response.json(
				{ error: { code: "binary_file", message: "Binary files cannot be displayed as source" } },
				{ status: 422 },
			),
		);
		render(<App />);
		await screen.findByText("Working tree is clean");

		fireEvent.keyDown(window, { ctrlKey: true, key: "p" });
		const files = await screen.findByRole("dialog", { name: "Files" });
		fireEvent.click(await within(files).findByRole("button", { name: "README.md, Project root" }));

		await screen.findByText("Binary files cannot be displayed as source");
		expect(screen.queryByText("Working tree is clean")).toBeNull();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	test("announces when the main source view is bounded", async () => {
		fixture.files = [];
		fixture.projectFiles = ["README.md"];
		interceptSourceFile((url) =>
			Response.json({
				contentRevision: "readme-large",
				endLine: 2,
				focusLine: 1,
				lines: [
					{ line: 1, text: "first" },
					{ line: 2, text: "second" },
				],
				operationRevision: "operation-1",
				path: url.searchParams.get("path"),
				repositoryId: "repo",
				startLine: 1,
				totalLines: 30_000,
				truncated: true,
			}),
		);
		render(<App />);
		await screen.findByText("Working tree is clean");

		fireEvent.keyDown(window, { ctrlKey: true, key: "p" });
		const files = await screen.findByRole("dialog", { name: "Files" });
		fireEvent.click(await within(files).findByRole("button", { name: "README.md, Project root" }));

		await screen.findByText("Source view truncated around the selected line.");
	});
});
