import { afterEach, describe, expect, mock, test } from "bun:test";

import type { VoiceCommandController } from "../features/voiceCommands/index.ts";

const { cleanup, fireEvent, render, screen } = await import("../appTestEnvironment.tsx");
const { VoiceCommandControl, voiceConfirmationNotice } = await import("./VoiceCommandControl.tsx");

afterEach(cleanup);

function controller(overrides: Partial<VoiceCommandController> = {}): VoiceCommandController {
	return {
		available: true,
		blockedByDictation: false,
		cancel: () => undefined,
		capability: {
			enabled: true,
			ready: true,
			state: "ready",
			model: "Cactus-Compute/needle2",
			reason: null,
			requiredFlags: ["--enable-speech", "--enable-voice-commands"],
			canRetry: false,
		},
		confirmation: null,
		confirm: () => undefined,
		diagnosticsOpen: false,
		dismissConfirmation: () => undefined,
		dismissDiagnostics: () => undefined,
		dismissResult: () => undefined,
		enabled: true,
		phase: "idle",
		recordingEndsAt: null,
		result: null,
		retry: async () => undefined,
		toggle: () => undefined,
		undo: async () => undefined,
		...overrides,
	} as VoiceCommandController;
}

describe("VoiceCommandControl", () => {
	test("uses dangerous-specific confirmation copy", () => {
		expect(voiceConfirmationNotice(false, ["dangerous"])).toBe(
			"This command is classified as dangerous and requires confirmation.",
		);
	});

	test("uses the floating action button to start and stop the same recording", () => {
		const toggle = mock(() => undefined);
		const view = render(<VoiceCommandControl controller={controller({ toggle })} />);
		fireEvent.click(screen.getByRole("button", { name: "Start voice command" }));
		expect(toggle).toHaveBeenCalledTimes(1);

		view.rerender(<VoiceCommandControl controller={controller({ phase: "recording", toggle })} />);
		fireEvent.click(screen.getByRole("button", { name: "Stop voice command recording" }));
		expect(toggle).toHaveBeenCalledTimes(2);
	});

	test("shows host diagnostics from the warning action button", () => {
		render(
			<VoiceCommandControl
				controller={controller({
					available: false,
					capability: {
						enabled: true,
						ready: false,
						state: "failed",
						model: "Cactus-Compute/needle2",
						reason: "Needle runtime download failed.",
						requiredFlags: ["--enable-speech", "--enable-voice-commands"],
						canRetry: true,
					},
					diagnosticsOpen: true,
				})}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Voice commands unavailable; show details" }),
		).toBeTruthy();
		expect(screen.getByText("Needle runtime download failed.")).toBeTruthy();
		expect(screen.getByText("--enable-voice-commands")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry installation" })).toBeTruthy();
	});

	test("strongly marks low-confidence previews and exposes revision-guarded undo", () => {
		const undo = mock(async () => undefined);
		render(
			<VoiceCommandControl
				controller={controller({
					confirmation: {
						commands: [{ actionId: "file.stage" }],
						context: {
							repositoryId: "repo-one",
							operationRevision: "operation-one",
							reviewRevision: 3,
							file: null,
						},
						confidence: 0.2761,
						lowConfidence: true,
						reasoning: "'stage this file' -> stage_current_file",
						transcript: "stage this file",
					},
					result: {
						message: "Stage current file succeeded",
						status: "success",
						undoAvailable: true,
					},
					undo,
				})}
			/>,
		);

		expect(screen.getByText("Low confidence — check every action before continuing.")).toBeTruthy();
		expect(screen.getByText("Transcript: “stage this file”")).toBeTruthy();
		expect(screen.getByText("Confidence: 27.61%")).toBeTruthy();
		expect(screen.queryByText("'stage this file' -> stage_current_file")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Show Needle reasoning" }));
		expect(screen.getByText("'stage this file' -> stage_current_file")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(undo).toHaveBeenCalledTimes(1);
	});

	test("stays absent when the profile has voice commands disabled", () => {
		render(<VoiceCommandControl controller={controller({ enabled: false })} />);
		expect(screen.queryByTestId("voice-command-button")).toBeNull();
	});
});
