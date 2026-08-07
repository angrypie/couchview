import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { useWorkspaceNavigation, type WorkspaceMode } from "./useWorkspaceNavigation.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render } = await import("@testing-library/react");

type NavigationController = ReturnType<typeof useWorkspaceNavigation>;

let controller: NavigationController | null = null;

function NavigationHarness({
	mode,
	onNavigate,
}: {
	mode: WorkspaceMode;
	onNavigate(mode: WorkspaceMode, replace?: boolean): void;
}) {
	controller = useWorkspaceNavigation({
		bootstrap: null,
		initialMode: mode,
		onNavigate,
		repository: null,
		repositoryId: null,
		showToast: () => undefined,
		terminalCapability: {
			available: false,
			persistence: "tmux",
			profiles: [],
			reason: "Unavailable in this test",
		},
	});
	return null;
}

function currentController(): NavigationController {
	if (!controller) throw new Error("The navigation harness has not rendered");
	return controller;
}

afterEach(() => {
	cleanup();
	controller = null;
});

describe("workspace navigation", () => {
	test("keeps review overlays on the active route without replacing it", () => {
		const navigations: Array<[WorkspaceMode, boolean | undefined]> = [];
		const onNavigate = (mode: WorkspaceMode, replace?: boolean) => {
			navigations.push([mode, replace]);
		};
		const view = render(<NavigationHarness mode="review" onNavigate={onNavigate} />);

		let shown = false;
		act(() => {
			shown = currentController().showReview();
		});
		expect(shown).toBe(true);
		expect(navigations).toEqual([]);

		view.rerender(<NavigationHarness mode="artifacts" onNavigate={onNavigate} />);
		act(() => {
			shown = currentController().showReview();
		});
		expect(shown).toBe(true);
		expect(navigations).toEqual([["review", true]]);
	});

	test("keeps the repository reset callback stable across route changes", () => {
		const onNavigate = () => undefined;
		const view = render(<NavigationHarness mode="terminal" onNavigate={onNavigate} />);
		const resetForRepository = currentController().resetForRepository;
		expect(currentController().terminalOpened).toBe(true);

		view.rerender(<NavigationHarness mode="review" onNavigate={onNavigate} />);
		expect(currentController().resetForRepository).toBe(resetForRepository);
		expect(currentController().terminalOpened).toBe(true);
	});
});
