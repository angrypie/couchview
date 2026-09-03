import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { ReviewLocation } from "../workspacePosition/index.ts";
import { useReviewLocation } from "./useReviewLocation.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render } = await import("@testing-library/react");

type ReviewLocationController = ReturnType<typeof useReviewLocation>;

let controller: ReviewLocationController | null = null;
const routeChanges: ReviewLocation[] = [];

function Harness({ requestedLocation }: { requestedLocation: ReviewLocation | null }) {
	controller = useReviewLocation({
		onReviewLocationChange: (location) => routeChanges.push(location),
		repositoryId: "repo-one",
		requestedLocation,
		showToast: () => undefined,
	});
	return null;
}

function currentController(): ReviewLocationController {
	if (!controller) throw new Error("The review-location harness has not rendered");
	return controller;
}

afterEach(() => {
	cleanup();
	controller = null;
	routeChanges.length = 0;
});

describe("review route synchronization", () => {
	test("does not restore stale route state over a locally opened source file", () => {
		const changedFile = { anchor: null, path: "src/changed.ts" } satisfies ReviewLocation;
		const sourceFile = { anchor: null, path: "README.md" } satisfies ReviewLocation;
		const { rerender } = render(<Harness requestedLocation={changedFile} />);

		act(() => currentController().onFileOpened(sourceFile.path, null, true));
		rerender(<Harness requestedLocation={changedFile} />);
		expect(currentController().initialLocation).toBeNull();
		expect(routeChanges).toEqual([sourceFile]);

		rerender(<Harness requestedLocation={sourceFile} />);
		expect(currentController().initialLocation).toBeNull();

		rerender(<Harness requestedLocation={changedFile} />);
		expect(currentController().initialLocation?.location).toEqual(changedFile);
	});
});
