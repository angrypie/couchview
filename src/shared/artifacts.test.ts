import { describe, expect, test } from "bun:test";

import { normalizeGitRemoteIdentity } from "./artifactRepositoryIdentity.ts";
import {
	parseArtifactCommandLine,
	parseArtifactDefinitionInput,
	parseArtifactProposalRequest,
	quoteArtifactInvocation,
} from "./artifacts.ts";

describe("artifact contracts", () => {
	test("validates exact argv and safe repository-relative output paths", () => {
		expect(
			parseArtifactDefinitionInput({
				name: "couchview-cli",
				argv: ["bun", "build", "--compile", "path with spaces"],
				workingDirectory: ".",
				outputPath: "dist/couchview",
				outputKind: "file",
			}),
		).toMatchObject({ argv: ["bun", "build", "--compile", "path with spaces"] });
		expect(() =>
			parseArtifactDefinitionInput({
				name: "unsafe name",
				argv: ["build"],
				workingDirectory: ".",
				outputPath: "../secret",
				outputKind: "file",
			}),
		).toThrow();
		expect(() =>
			parseArtifactDefinitionInput({
				name: "release",
				argv: ["build"],
				workingDirectory: ".git/hooks",
				outputPath: "result",
				outputKind: "file",
			}),
		).toThrow("unsafe");
		expect(quoteArtifactInvocation(["bun", "x y", "a'b"])).toBe("bun 'x y' 'a'\\''b'");
	});

	test("normalizes credential-free HTTPS and SSH remote identities", () => {
		expect(normalizeGitRemoteIdentity("https://secret@example.com/Owner/repo.git")).toBe(
			"example.com/Owner/repo",
		);
		expect(normalizeGitRemoteIdentity("git@example.com:Owner/repo.git")).toBe(
			"example.com/Owner/repo",
		);
		expect(normalizeGitRemoteIdentity("file:///private/repo")).toBeNull();
	});

	test("round-trips one-field commands to exact argv without shell evaluation", () => {
		const cases = [
			["bun", "run", "build:cli", "--", "path with spaces", ""],
			["command", "a'b", "$HOME", "semi;colon", "back\\slash"],
			["bun", "build", "--compile", "src/cli.ts"],
		];
		for (const argv of cases) {
			expect(parseArtifactCommandLine(quoteArtifactInvocation(argv))).toEqual(argv);
		}
		expect(parseArtifactCommandLine('bun run build --target "mac os"')).toEqual([
			"bun",
			"run",
			"build",
			"--target",
			"mac os",
		]);
	});

	test("rejects shell behavior while allowing quoted literal operator characters", () => {
		expect(() => parseArtifactCommandLine("bun run build && publish")).toThrow("Shell operators");
		expect(() => parseArtifactCommandLine('echo "$HOME"')).toThrow("variable expansion");
		expect(() => parseArtifactCommandLine("NODE_ENV=production bun run build")).toThrow(
			"Environment assignments",
		);
		expect(() => parseArtifactCommandLine("bun run 'unterminated")).toThrow("unterminated");
		expect(parseArtifactCommandLine("echo '$HOME' 'a;b'")).toEqual(["echo", "$HOME", "a;b"]);
	});

	test("validates bounded artifact proposal requests and Codex preferences", () => {
		expect(
			parseArtifactProposalRequest({
				request: "  static build  ",
				codex: { model: "gpt-5.6-terra", reasoning: "medium" },
			}),
		).toEqual({
			request: "static build",
			codex: { model: "gpt-5.6-terra", reasoning: "medium" },
		});
		expect(() =>
			parseArtifactProposalRequest({
				request: "build",
				codex: { model: "bad model", reasoning: "low" },
			}),
		).toThrow("model");
	});
});
