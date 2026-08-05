import { expect, test } from "bun:test";

import { parseExpoWebBuildArguments } from "./buildExpoWeb.ts";

test("uses the restart candidate directory supplied through Vite's outDir spelling", () => {
	expect(parseExpoWebBuildArguments(["--outDir", ".couchview-build-next"], "/repo")).toEqual({
		outputRoot: "/repo/.couchview-build-next",
	});
});

test("supports Expo's output directory spelling and rejects incomplete arguments", () => {
	expect(parseExpoWebBuildArguments(["--output-dir=dist-preview"], "/repo")).toEqual({
		outputRoot: "/repo/dist-preview",
	});
	expect(() => parseExpoWebBuildArguments(["--outDir"], "/repo")).toThrow(
		"--outDir requires an output directory",
	);
});
