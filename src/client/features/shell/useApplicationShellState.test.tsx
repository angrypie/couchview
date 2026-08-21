import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { useApplicationShellState } from "./useApplicationShellState.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render } = await import("@testing-library/react");

type ShellController = ReturnType<typeof useApplicationShellState>;

interface ResetCalls {
	clearFailure: number;
	clearToast: number;
	resetNavigation: number;
	failureDetails: boolean[];
	repositoryPicker: boolean[];
}

type ResetCallbacks = Omit<Parameters<typeof useApplicationShellState>[0], "repositoryId">;

let controller: ShellController | null = null;

function ShellHarness({
	callbacks,
	repositoryId,
}: {
	callbacks: ResetCallbacks;
	repositoryId: string;
}) {
	controller = useApplicationShellState({
		...callbacks,
		repositoryId,
	});
	return null;
}

function currentController(): ShellController {
	if (!controller) throw new Error("The shell state harness has not rendered");
	return controller;
}

afterEach(() => {
	cleanup();
	controller = null;
});

describe("application shell state", () => {
	test("resets repository-scoped overlays while preserving remote bridge visibility", () => {
		const calls: ResetCalls = {
			clearFailure: 0,
			clearToast: 0,
			failureDetails: [],
			repositoryPicker: [],
			resetNavigation: 0,
		};
		const callbacks: ResetCallbacks = {
			clearFailure: () => {
				calls.clearFailure += 1;
			},
			clearToast: () => {
				calls.clearToast += 1;
			},
			resetNavigationForRepository: () => {
				calls.resetNavigation += 1;
			},
			setFailureDetailsOpen: (open) => calls.failureDetails.push(open),
			setRepositoryPickerOpen: (open) => calls.repositoryPicker.push(open),
		};
		const view = render(<ShellHarness callbacks={callbacks} repositoryId="repo-one" />);

		act(() => {
			currentController().setDrawerOpen(true);
			currentController().setDrawerView("commands");
			currentController().setRemoteBridgeOpen(true);
		});
		expect(currentController()).toMatchObject({
			drawerOpen: true,
			drawerView: "commands",
			remoteBridgeOpen: true,
		});

		view.rerender(<ShellHarness callbacks={callbacks} repositoryId="repo-two" />);

		expect(currentController()).toMatchObject({
			drawerOpen: false,
			drawerView: "files",
			remoteBridgeOpen: true,
		});
		expect(calls).toEqual({
			clearFailure: 2,
			clearToast: 2,
			failureDetails: [false, false],
			repositoryPicker: [false, false],
			resetNavigation: 2,
		});
	});
});
