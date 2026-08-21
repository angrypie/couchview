import { afterEach, describe, expect, test } from "bun:test";

import { createDefaultSettingsProfileData } from "../../shared/settings.ts";
import type { ProfileSettingsEditor } from "../features/settings/useProfileSettingsEditor.ts";
import type { VoiceCommandController } from "../features/voiceCommands/index.ts";

const { cleanup, render, screen } = await import("../appTestEnvironment.tsx");
const { VoiceCommandSettingsCard } = await import("./VoiceCommandSettingsCard.tsx");

afterEach(cleanup);

function controller(enabled: boolean): VoiceCommandController {
	return {
		capability: {
			enabled,
			ready: enabled,
			state: enabled ? "ready" : "disabled",
			model: "Cactus-Compute/needle2",
			reason: enabled ? null : "Start with --enable-voice-commands.",
			requiredFlags: ["--enable-speech", "--enable-voice-commands"],
			canRetry: false,
		},
		retry: async () => undefined,
	} as VoiceCommandController;
}

function editor(commandsEnabled: boolean): ProfileSettingsEditor {
	const draft = createDefaultSettingsProfileData();
	draft.voice.commandsEnabled = commandsEnabled;
	return { draft, updateDraft: () => undefined } as unknown as ProfileSettingsEditor;
}

describe("VoiceCommandSettingsCard", () => {
	test("hard-disables the profile switch when the host flag is absent", () => {
		render(<VoiceCommandSettingsCard controller={controller(false)} editor={editor(true)} />);
		const toggle = screen.getByRole("switch", { name: "Voice command button" });
		expect((toggle as HTMLInputElement).disabled).toBe(true);
		expect((toggle as HTMLInputElement).checked).toBe(false);
		expect(screen.getByText(/server did not start with --enable-voice-commands/)).toBeTruthy();
	});

	test("honors the saved profile setting when the host flag is enabled", () => {
		render(<VoiceCommandSettingsCard controller={controller(true)} editor={editor(true)} />);
		const toggle = screen.getByRole("switch", { name: "Voice command button" });
		expect((toggle as HTMLInputElement).disabled).toBe(false);
		expect((toggle as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText(/--enable-speech --enable-voice-commands/)).toBeTruthy();
		expect(screen.getByText(/hold V to talk/)).toBeTruthy();
	});
});
