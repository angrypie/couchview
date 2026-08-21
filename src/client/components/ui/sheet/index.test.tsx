import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, screen } = await import("../../../appTestEnvironment.tsx");
const { Sheet } = await import("./index");

afterEach(cleanup);

describe("Sheet", () => {
	test("keeps ordinary sheets content-sized and dismissible", () => {
		const changes: boolean[] = [];
		render(<Sheet onOpenChange={(open) => changes.push(open)} open title="Repository actions" />);

		const host = screen.getByTestId("community-bottom-sheet");
		expect(host.getAttribute("data-dynamic-sizing")).toBe("true");
		expect(host.getAttribute("data-pan-down-to-close")).toBe("true");
		expect(host.getAttribute("data-snap-points")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
		expect(changes).toEqual([false]);
	});

	test("uses a fixed full detent for keyboard-heavy composition", () => {
		render(
			<Sheet
				dismissible={false}
				onOpenChange={() => undefined}
				open
				presentation="full"
				title="Commit staged changes"
			/>,
		);

		const host = screen.getByTestId("community-bottom-sheet");
		expect(host.getAttribute("data-dynamic-sizing")).toBe("false");
		expect(host.getAttribute("data-pan-down-to-close")).toBe("false");
		expect(host.getAttribute("data-snap-points")).toBe("100%");
		expect(screen.queryByRole("button", { name: "Close sheet" })).toBeNull();
	});
});
