import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { SearchMatch } from "../../../shared/contracts.ts";
import { useRepositorySearch } from "./useRepositorySearch.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render } = await import("@testing-library/react");

type SearchController = ReturnType<typeof useRepositorySearch>;

let controller: SearchController | null = null;

function SearchHarness({ onOpenMatch }: { onOpenMatch: (match: SearchMatch) => boolean }) {
	controller = useRepositorySearch({
		currentPath: "src/current.ts",
		onOpenMatch,
		repositoryId: "repo-one",
		showToast: () => undefined,
	});
	return <output>{controller.open ? "open" : "closed"}</output>;
}

function currentController(): SearchController {
	if (!controller) throw new Error("The repository search harness has not rendered");
	return controller;
}

const match: SearchMatch = {
	column: 8,
	line: 12,
	path: "src/result.ts",
	preview: "const result = true;",
};

afterEach(() => {
	cleanup();
	controller = null;
});

describe("repository search selection", () => {
	test("closes only when the main file view accepts the match", () => {
		let accepted = false;
		render(<SearchHarness onOpenMatch={() => accepted} />);

		act(() => {
			currentController().setOpen(true);
		});
		expect(currentController().open).toBe(true);
		act(() => {
			expect(currentController().selectMatch(match)).toBe(false);
		});
		expect(currentController().open).toBe(true);

		accepted = true;
		act(() => {
			expect(currentController().selectMatch(match)).toBe(true);
		});
		expect(currentController().open).toBe(false);
	});
});
