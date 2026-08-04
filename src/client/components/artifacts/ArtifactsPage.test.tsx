import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type {
	ArtifactBuild,
	ArtifactCatalogItem,
	ArtifactDefinition,
	ArtifactDefinitionInput,
	ArtifactRun,
} from "../../../shared/contracts.ts";
import { ArtifactCard } from "./ArtifactCard.tsx";
import { ArtifactDefinitionForm } from "./ArtifactDefinitionForm.tsx";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

afterEach(cleanup);

function definition(overrides: Partial<ArtifactDefinition> = {}): ArtifactDefinition {
	return {
		id: "artifact-1",
		repositoryId: "repo-1",
		name: "couchview-cli",
		argv: ["bun", "run", "build cli"],
		workingDirectory: ".",
		outputPath: "dist/couchview",
		outputKind: "file",
		revision: 1,
		createdAt: "2026-08-04T10:00:00.000Z",
		updatedAt: "2026-08-04T10:00:00.000Z",
		...overrides,
	};
}

function build(): ArtifactBuild {
	return {
		id: "build-1",
		repositoryId: "repo-1",
		artifactId: "artifact-1",
		definitionRevision: 1,
		downloadName: "couchview",
		mediaType: "application/octet-stream",
		sizeBytes: 12,
		sha256: "a".repeat(64),
		createdAt: "2026-08-04T10:01:00.000Z",
	};
}

function run(overrides: Partial<ArtifactRun> = {}): ArtifactRun {
	return {
		id: "run-1",
		repositoryId: "repo-1",
		artifactId: "artifact-1",
		artifactName: "couchview-cli",
		definitionRevision: 1,
		argv: ["bun", "run", "build cli"],
		invocation: "bun run 'build cli'",
		workingDirectory: ".",
		status: "succeeded",
		exitCode: 0,
		startedAt: "2026-08-04T10:00:00.000Z",
		finishedAt: "2026-08-04T10:01:00.000Z",
		outputTruncated: false,
		error: null,
		buildId: "build-1",
		...overrides,
	};
}

describe("artifact workspace presentation", () => {
	test("parses one familiar command field into exact argv, including an empty argument", async () => {
		const inputs: ArtifactDefinitionInput[] = [];
		render(
			<ArtifactDefinitionForm
				busy={false}
				onCancel={() => undefined}
				onSave={async (input) => {
					inputs.push(input);
					return true;
				}}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "mac-cli" } });
		fireEvent.change(screen.getByLabelText("Command"), { target: { value: "bun run ''" } });
		fireEvent.change(screen.getByLabelText("Exact output path"), {
			target: { value: "dist/couch view" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create artifact" }));

		await waitFor(() => expect(inputs).toHaveLength(1));
		expect(inputs[0]).toEqual({
			name: "mac-cli",
			argv: ["bun", "run", ""],
			workingDirectory: ".",
			outputPath: "dist/couch view",
			outputKind: "file",
		});
		expect(screen.getByText("bun run ''")).toBeTruthy();
	});

	test("asks for optional intent and applies a Codex proposal as an editable draft", async () => {
		const saved: ArtifactDefinitionInput[] = [];
		render(
			<ArtifactDefinitionForm
				busy={false}
				onCancel={() => undefined}
				onPropose={async (request) => ({
					proposal: {
						name: request ? "static-site" : "default-build",
						argv: ["bun", "run", "build"],
						workingDirectory: ".",
						outputPath: "dist",
						outputKind: "directory",
					},
					summary: "The package build script emits dist.",
					configurationFiles: ["package.json"],
				})}
				onSave={async (input) => {
					saved.push(input);
					return true;
				}}
				proposalCapability={{ available: true, reason: null }}
				suggestOnOpen
			/>,
		);

		fireEvent.change(screen.getByLabelText("What should this artifact produce?"), {
			target: { value: "static build" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Fill form" }));

		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("static-site"),
		);
		expect((screen.getByLabelText("Command") as HTMLInputElement).value).toBe("bun run build");
		expect(screen.getByText("The package build script emits dist.")).toBeTruthy();
		expect(screen.getByText("Read package.json")).toBeTruthy();
		expect(saved).toHaveLength(0);

		fireEvent.change(screen.getByLabelText("Command"), {
			target: { value: "bun run build --minify" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create artifact" }));
		await waitFor(() => expect(saved).toHaveLength(1));
		expect(saved[0]?.argv).toEqual(["bun", "run", "build", "--minify"]);
	});

	test("requests the default configured artifact when intent is left empty", async () => {
		const requests: string[] = [];
		render(
			<ArtifactDefinitionForm
				busy={false}
				onCancel={() => undefined}
				onPropose={async (request) => {
					requests.push(request);
					return {
						proposal: {
							name: "default-build",
							argv: ["bun", "run", "build"],
							workingDirectory: ".",
							outputPath: "dist",
							outputKind: "directory",
						},
						summary: "Default project build.",
						configurationFiles: ["package.json"],
					};
				}}
				onSave={async () => true}
				proposalCapability={{ available: true, reason: null }}
				suggestOnOpen
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Fill form" }));
		await waitFor(() => expect(requests).toEqual([""]));
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("default-build");
	});

	test("shows unsupported shell syntax before save", () => {
		render(
			<ArtifactDefinitionForm busy={false} onCancel={() => undefined} onSave={async () => true} />,
		);
		fireEvent.change(screen.getByLabelText("Command"), {
			target: { value: "bun run build && publish" },
		});
		expect(screen.getByRole("alert").textContent).toContain("Shell operators");
		expect(
			(screen.getByRole("button", { name: "Create artifact" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	test("preserves an in-progress edit when catalog polling returns the same revision", () => {
		const currentDefinition = definition();
		const view = render(
			<ArtifactDefinitionForm
				busy={false}
				definition={currentDefinition}
				onCancel={() => undefined}
				onSave={async () => true}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Exact output path"), {
			target: { value: "dist/locally-edited" },
		});
		view.rerender(
			<ArtifactDefinitionForm
				busy={false}
				definition={{ ...currentDefinition }}
				onCancel={() => undefined}
				onSave={async () => true}
			/>,
		);

		expect((screen.getByLabelText("Exact output path") as HTMLInputElement).value).toBe(
			"dist/locally-edited",
		);
	});

	test("renders retained builds as attachment links without fetching payload bytes", () => {
		const item: ArtifactCatalogItem = {
			definition: definition(),
			builds: [build()],
			activeRun: null,
			recentRun: run(),
		};
		render(
			<ArtifactCard
				busyAction={null}
				item={item}
				onBuild={() => undefined}
				onCopy={() => undefined}
				onDelete={() => undefined}
				onEdit={() => undefined}
				onPair={() => undefined}
				onStop={() => undefined}
				repositoryId="repo-1"
				selectedDevice={null}
				snapshot={{
					run: run(),
					output: [{ sequence: 1, stream: "stdout", text: "built\n" }],
				}}
			/>,
		);

		const download = screen.getByRole("link", { name: "Download" });
		expect(download.getAttribute("download")).toBe("couchview");
		expect(download.getAttribute("href")).toBe(
			"/api/repositories/repo-1/artifacts/artifact-1/builds/build-1/download",
		);
		expect(screen.getByLabelText("couchview-cli build output").textContent).toContain("built");
		expect(screen.getByText("sha256:aaaaaaaaaaaa…")).toBeTruthy();
	});

	test("offers stop while a build is active", () => {
		let stopped = "";
		render(
			<ArtifactCard
				busyAction={null}
				item={{
					definition: definition(),
					builds: [],
					activeRun: run({ status: "running" }),
					recentRun: run({ status: "running" }),
				}}
				onBuild={() => undefined}
				onCopy={() => undefined}
				onDelete={() => undefined}
				onEdit={() => undefined}
				onPair={() => undefined}
				onStop={(runId) => {
					stopped = runId;
				}}
				repositoryId="repo-1"
				selectedDevice={null}
				snapshot={undefined}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Stop" }));
		expect(stopped).toBe("run-1");
		expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
	});
});
