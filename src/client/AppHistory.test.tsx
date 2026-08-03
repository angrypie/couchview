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

describe("Couchview Git history workspace", () => {
	const fixture = createAppTestHarness();

	test("opens Git history directly from its own route and follows browser navigation", async () => {
		window.history.replaceState(null, "", "/history?repo=repo");
		render(<App />);

		const workspace = await screen.findByRole("main", {
			name: "Git history and repository actions",
		});
		await within(workspace).findByRole("button", { name: /Improve history review/ });
		expect(screen.queryByRole("region", { name: "Unified diff" })).toBeNull();

		window.history.replaceState(null, "", "/?repo=repo");
		fireEvent.popState(window);
		await screen.findByRole("region", { name: "Unified diff" });
		expect(screen.queryByRole("main", { name: "Git history and repository actions" })).toBeNull();
	});

	test("previews commit files and reuses cached historical responses", async () => {
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open Git history" }));

		const workspace = await screen.findByRole("main", {
			name: "Git history and repository actions",
		});
		expect(window.location.pathname).toBe("/history");
		expect(screen.queryByRole("dialog", { name: "Git history and repository actions" })).toBeNull();
		fireEvent.click(within(workspace).getByRole("button", { name: /Improve history review/ }));
		const historicalFile = await within(workspace).findByRole("button", {
			name: /src\/first\.ts/,
		});
		fireEvent.click(historicalFile);
		await waitFor(() =>
			expect(
				fixture.requests.some((request) =>
					request.path.endsWith(
						"/git/history/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/files/history-first/diff",
					),
				),
			).toBe(true),
		);

		fireEvent.click(within(workspace).getByRole("button", { name: "Back to commit files" }));
		fireEvent.click(within(workspace).getByRole("button", { name: "Back to commits" }));
		fireEvent.click(within(workspace).getByRole("button", { name: /Improve history review/ }));
		await within(workspace).findByRole("button", { name: /src\/first\.ts/ });
		expect(
			fixture.requests.filter((request) =>
				request.path.endsWith("/git/history/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
			),
		).toHaveLength(1);
		fireEvent.click(within(workspace).getByRole("button", { name: "Review" }));
		expect(window.location.pathname).toBe("/");
		expect(screen.getByRole("region", { name: "Current file" })).toBeTruthy();

		fixture.delayNextHistoryResponse = true;
		fireEvent.click(screen.getByRole("button", { name: "Open Git history" }));
		const reopened = screen.getByRole("main", { name: "Git history and repository actions" });
		expect(within(reopened).getByRole("button", { name: /Improve history review/ })).toBeTruthy();
		await waitFor(() => expect(fixture.releaseHistoryResponse).not.toBeNull());
		await act(async () => fixture.releaseHistoryResponse?.());
	});

	test("loads another history page without replacing the current commits", async () => {
		fixture.historyPaginated = true;
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open Git history" }));
		const workspace = await screen.findByRole("main", {
			name: "Git history and repository actions",
		});
		await within(workspace).findByRole("button", { name: /Improve history review/ });
		expect(
			within(workspace).queryByRole("button", { name: /Initial review workspace/ }),
		).toBeNull();
		fireEvent.click(within(workspace).getByRole("button", { name: "Load more" }));
		await within(workspace).findByRole("button", { name: /Initial review workspace/ });
		expect(within(workspace).getByRole("button", { name: /Improve history review/ })).toBeTruthy();
		fireEvent.click(within(workspace).getByRole("button", { name: "All refs" }));
		await waitFor(() => expect(fixture.historyQueries).toContain("?scope=all"));
	});

	test("cancels stale commit details when navigating to another commit", async () => {
		fixture.delayNextHistoryCommitResponse = true;
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open Git history" }));
		const workspace = await screen.findByRole("main", {
			name: "Git history and repository actions",
		});
		fireEvent.click(
			await within(workspace).findByRole("button", { name: /Improve history review/ }),
		);
		await waitFor(() => expect(fixture.releaseHistoryCommitResponse).not.toBeNull());
		fireEvent.click(within(workspace).getByRole("button", { name: "Back to commits" }));
		fireEvent.click(within(workspace).getByRole("button", { name: /Initial review workspace/ }));
		const commitFiles = within(workspace).getByRole("region", { name: "Commit files" });
		await within(commitFiles).findByText("Initial review workspace");
		fixture.releaseHistoryCommitResponse?.();
		await waitFor(() => expect(fixture.historyCommitRequestAborted).toBe(true));
		expect(within(commitFiles).getByText("Initial review workspace")).toBeTruthy();
	});

	test("keeps loaded commits visible during an authoritative status refresh", async () => {
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open Git history" }));
		const workspace = await screen.findByRole("main", {
			name: "Git history and repository actions",
		});
		await within(workspace).findByRole("button", { name: /Improve history review/ });
		fixture.delayNextHistoryResponse = true;
		fireEvent.click(within(workspace).getByRole("button", { name: "Repository actions" }));
		fireEvent.click(within(workspace).getByRole("menuitem", { name: "Stash changes" }));
		const stash = await screen.findByRole("dialog", { name: "Stash repository changes" });
		fireEvent.click(within(stash).getByRole("button", { name: "Stash changes" }));
		await waitFor(() => expect(fixture.releaseHistoryResponse).not.toBeNull());
		expect(within(workspace).getByRole("button", { name: /Improve history review/ })).toBeTruthy();
		fixture.releaseHistoryResponse?.();
		await screen.findByText("Repository changes stashed");
	});

	test("blocks dirty checkout, stashes explicitly, checks out, and returns", async () => {
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open Git history" }));
		const workspace = await screen.findByRole("main", {
			name: "Git history and repository actions",
		});
		fireEvent.click(within(workspace).getByRole("button", { name: /Improve history review/ }));
		await within(workspace).findByRole("button", { name: /src\/first\.ts/ });
		fireEvent.click(within(workspace).getByRole("button", { name: "Checkout" }));

		const blocked = await screen.findByRole("dialog", { name: "Checkout bbbbbbb" });
		expect(within(blocked).getByText(/checkout is blocked/i)).toBeTruthy();
		expect(
			(within(blocked).getByRole("button", { name: "Checkout commit" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.click(within(blocked).getByRole("button", { name: "Stash changes…" }));
		const stash = await screen.findByRole("dialog", { name: "Stash repository changes" });
		fireEvent.click(within(stash).getByRole("button", { name: "Stash changes" }));
		await screen.findByText("Repository changes stashed");

		fireEvent.click(within(workspace).getByRole("button", { name: "Checkout" }));
		const checkout = await screen.findByRole("dialog", { name: "Checkout bbbbbbb" });
		fireEvent.click(within(checkout).getByRole("button", { name: "Checkout commit" }));
		await screen.findByText("Commit checked out");
		await within(workspace).findByText(/Detached HEAD/);

		fireEvent.click(within(workspace).getByRole("button", { name: "Return" }));
		await screen.findByText("Returned to previous branch");
		expect(
			fixture.requests
				.filter((request) => request.path.endsWith("/git/actions"))
				.map((request) => request.body),
		).toEqual([
			{ action: "stash", operationRevision: "operation-1" },
			{
				action: "checkout",
				commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				operationRevision: "operation-git-stash",
			},
			{ action: "return", operationRevision: "operation-git-checkout" },
		]);
	});

	test("requires acknowledgment before cleaning tracked and untracked changes", async () => {
		render(<App />);
		await screen.findByText("src/first.ts");
		fireEvent.click(screen.getByRole("button", { name: "Open Git history" }));
		const workspace = await screen.findByRole("main", {
			name: "Git history and repository actions",
		});
		fireEvent.click(within(workspace).getByRole("button", { name: "Repository actions" }));
		fireEvent.click(within(workspace).getByRole("menuitem", { name: "Clean repository" }));
		const confirmation = await screen.findByRole("dialog", { name: "Clean repository" });
		const clean = within(confirmation).getByRole("button", { name: "Clean repository" });
		expect((clean as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(within(confirmation).getByRole("checkbox"));
		expect((clean as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(clean);
		await screen.findByText("Repository cleaned");
		expect(fixture.requests.find((request) => request.path.endsWith("/git/actions"))).toMatchObject(
			{
				body: { action: "clean", operationRevision: "operation-1" },
			},
		);
	});
});
