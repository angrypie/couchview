import { expect, test } from "bun:test";

import { parseExpoWebBuildArguments } from "./buildExpoWeb.ts";

test("uses the restart candidate directory supplied through Expo's output directory flag", () => {
	expect(parseExpoWebBuildArguments(["--output-dir", ".couchview-build-next"], "/repo")).toEqual({
		outputRoot: "/repo/.couchview-build-next",
	});
});

test("supports inline output directories and rejects incomplete or legacy arguments", () => {
	expect(parseExpoWebBuildArguments(["--output-dir=dist-preview"], "/repo")).toEqual({
		outputRoot: "/repo/dist-preview",
	});
	expect(() => parseExpoWebBuildArguments(["--output-dir"], "/repo")).toThrow(
		"--output-dir requires an output directory",
	);
	expect(() => parseExpoWebBuildArguments(["--outDir", "dist-preview"], "/repo")).toThrow(
		"Unknown Expo web build argument: --outDir",
	);
});
