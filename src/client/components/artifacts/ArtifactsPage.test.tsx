import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";

import type {
	ArtifactBuild,
	ArtifactCatalogItem,
	ArtifactDefinition,
	ArtifactDefinitionInput,
	ArtifactRun,
} from "../../../shared/contracts.ts";
import "../../appTestNativeRuntime.tsx";
import type { ArtifactDownloadRequest } from "../../lib/artifactDownloadTypes.ts";

mock.module("uniwind", () => ({
	useResolveClassNames: () => ({ color: "#111827" }),
	withUniwind: <Component,>(component: Component) => component,
}));

const downloads: ArtifactDownloadRequest[] = [];
mock.module("../../lib/artifactDownload", () => ({
	downloadArtifact: async (request: ArtifactDownloadRequest) => {
		downloads.push(request);
	},
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ArtifactCard } = await import("./ArtifactCard.tsx");
const { ArtifactDefinitionForm } = await import("./ArtifactDefinitionForm.tsx");

afterEach(() => {
	cleanup();
	downloads.length = 0;
});

function definition(overrides: Partial<ArtifactDefinition> = {}): ArtifactDefinition {
	return {
		argv: ["bun", "run", "build cli"],
		createdAt: "2026-08-04T10:00:00.000Z",
		id: "artifact-1",
		name: "couchview-cli",
		outputKind: "file",
		outputPath: "dist/couchview",
		repositoryId: "repo-1",
		revision: 1,
		updatedAt: "2026-08-04T10:00:00.000Z",
		workingDirectory: ".",
		...overrides,
	};
}

function build(): ArtifactBuild {
	return {
		artifactId: "artifact-1",
		createdAt: "2026-08-04T10:01:00.000Z",
		definitionRevision: 1,
		downloadName: "couchview",
		executable: false,
		id: "build-1",
		mediaType: "application/octet-stream",
		repositoryId: "repo-1",
		sha256: "a".repeat(64),
		sizeBytes: 12,
	};
}

function run(overrides: Partial<ArtifactRun> = {}): ArtifactRun {
	return {
		argv: ["bun", "run", "build cli"],
		artifactId: "artifact-1",
		artifactName: "couchview-cli",
		buildId: "build-1",
		definitionRevision: 1,
		error: null,
		exitCode: 0,
		finishedAt: "2026-08-04T10:01:00.000Z",
		id: "run-1",
		invocation: "bun run 'build cli'",
		outputTruncated: false,
		repositoryId: "repo-1",
		startedAt: "2026-08-04T10:00:00.000Z",
		status: "succeeded",
		workingDirectory: ".",
		...overrides,
	};
}

function artifactItem(overrides: Partial<ArtifactCatalogItem> = {}): ArtifactCatalogItem {
	return {
		activeRun: null,
		builds: [build()],
		definition: definition(),
		recentRun: run(),
		...overrides,
	};
}

function renderCard(overrides: Partial<ComponentProps<typeof ArtifactCard>> = {}) {
	return render(
		<ArtifactCard
			busyAction={null}
			item={artifactItem()}
			onBuild={() => undefined}
			onCopy={() => undefined}
			onDelete={() => undefined}
			onEdit={() => undefined}
			onPair={() => undefined}
			onStop={() => undefined}
			repositoryId="repo-1"
			selectedDevice={null}
			snapshot={{
				output: [{ sequence: 1, stream: "stdout", text: "built\n" }],
				run: run(),
			}}
			{...overrides}
		/>,
	);
}

describe("artifact workspace presentation", () => {
	test("parses a familiar command into exact argv, including an empty argument", async () => {
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
			argv: ["bun", "run", ""],
			name: "mac-cli",
			outputKind: "file",
			outputPath: "dist/couch view",
			workingDirectory: ".",
		});
		expect(screen.getByText("bun run ''")).toBeTruthy();
	});

	test("applies a Codex proposal as an editable draft", async () => {
		const saved: ArtifactDefinitionInput[] = [];
		render(
			<ArtifactDefinitionForm
				busy={false}
				onCancel={() => undefined}
				onPropose={async () => ({
					configurationFiles: ["package.json"],
					proposal: {
						argv: ["bun", "run", "build"],
						name: "static-site",
						outputKind: "directory",
						outputPath: "dist",
						workingDirectory: ".",
					},
					summary: "The package build script emits dist.",
				})}
				onSave={async (input) => {
					saved.push(input);
					return true;
				}}
				proposalCapability={{ available: true, reason: null }}
				suggestOnOpen
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Fill form" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("static-site"),
		);
		expect((screen.getByLabelText("Command") as HTMLInputElement).value).toBe("bun run build");
		expect(screen.getByText("The package build script emits dist.")).toBeTruthy();
		expect(screen.getByText("Read package.json")).toBeTruthy();
		expect(saved).toHaveLength(0);
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

	test("downloads retained builds through the platform seam", async () => {
		renderCard();
		fireEvent.click(screen.getByRole("button", { name: "Download" }));

		await waitFor(() => expect(downloads).toHaveLength(1));
		expect(downloads[0]).toEqual({
			downloadName: "couchview",
			mediaType: "application/octet-stream",
			path: "/api/repositories/repo-1/artifacts/artifact-1/builds/build-1/download",
		});
		expect(screen.getByLabelText("couchview-cli build output").textContent).toContain("built");
		expect(screen.getByText("sha256:aaaaaaaaaaaa…")).toBeTruthy();
	});

	test("confirms destructive deletion without window.confirm", () => {
		let deleted = false;
		renderCard({ onDelete: () => (deleted = true) });

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(screen.getByRole("dialog", { name: "Delete couchview-cli?" })).toBeTruthy();
		expect(deleted).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "Delete artifact" }));
		expect(deleted).toBe(true);
	});

	test("offers stop while a build is active", () => {
		let stopped = "";
		renderCard({
			item: artifactItem({
				activeRun: run({ status: "running" }),
				builds: [],
				recentRun: run({ status: "running" }),
			}),
			onStop: (runId) => (stopped = runId),
			snapshot: undefined,
		});

		fireEvent.click(screen.getByRole("button", { name: "Stop" }));
		expect(stopped).toBe("run-1");
		expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
	});
});
