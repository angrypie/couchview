import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, render, screen } = await import("../../appTestEnvironment.tsx");
const { Slider } = await import("./slider");
const { Switch } = await import("./switch");

afterEach(cleanup);

describe("universal form controls", () => {
	test("keeps slider accessibility values and semantic theme colors on the native control", () => {
		render(
			<Slider
				accessibilityLabel="Diff font size"
				accessibilityValue={{ max: 30, min: 8, now: 14, text: "14 pixels" }}
				maximumValue={30}
				minimumValue={8}
				value={14}
			/>,
		);

		const slider = screen.getByRole("slider", { name: "Diff font size" });
		expect(slider.getAttribute("aria-valuetext")).toBe("14 pixels");
		expect(slider.getAttribute("data-accessibility-min")).toBe("8");
		expect(slider.getAttribute("data-accessibility-max")).toBe("30");
		expect(slider.getAttribute("data-accessibility-now")).toBe("14");
		expect(slider.getAttribute("data-maximum-track-class")).toBe("accent-border");
		expect(slider.getAttribute("data-minimum-track-class")).toBe("accent-primary");
		expect(slider.getAttribute("data-thumb-class")).toBe("accent-primary");
	});

	test("derives an accessible switch label from its visible label", () => {
		render(<Switch label="Line numbers" onValueChange={() => undefined} value />);

		expect(screen.getByRole("switch", { name: "Line numbers" })).toBeTruthy();
	});
});
