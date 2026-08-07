import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import {
	createDefaultSettingsProfileData,
	type SettingsProfile,
} from "../../../shared/settings.ts";
import {
	type ProfileSettingsEditor,
	useProfileSettingsEditor,
} from "./useProfileSettingsEditor.ts";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const { act, cleanup, render } = await import("@testing-library/react");

function createProfile(id = "default"): SettingsProfile {
	return {
		createdAt: "2026-08-07T00:00:00.000Z",
		data: createDefaultSettingsProfileData(),
		id,
		name: id === "default" ? "Default" : "Team",
		revision: 1,
		updatedAt: "2026-08-07T00:00:00.000Z",
	};
}

interface EditorHarnessProps {
	onBack(): void;
	onCreate(name: string): Promise<void>;
	onRecordingChange(recording: boolean): void;
	profile: SettingsProfile;
}

let editor: ProfileSettingsEditor | null = null;

function EditorHarness({ onBack, onCreate, onRecordingChange, profile }: EditorHarnessProps) {
	editor = useProfileSettingsEditor({
		onBack,
		onCreate,
		onDelete: async () => undefined,
		onDirtyChange: () => undefined,
		onDuplicate: async () => undefined,
		onRecordingChange,
		onSave: async () => undefined,
		onSelect: () => undefined,
		profile,
	});
	return <output data-testid="dialog-kind">{editor.dialog?.kind ?? "closed"}</output>;
}

afterEach(() => {
	cleanup();
	editor = null;
});

function currentEditor(): ProfileSettingsEditor {
	if (!editor) throw new Error("The editor harness has not rendered.");
	return editor;
}

describe("profile settings editor", () => {
	test("uses explicit dialogs for dirty navigation and profile creation", async () => {
		let backCalls = 0;
		const createdNames: string[] = [];
		render(
			<EditorHarness
				onBack={() => {
					backCalls += 1;
				}}
				onCreate={async (name) => {
					createdNames.push(name);
				}}
				onRecordingChange={() => undefined}
				profile={createProfile()}
			/>,
		);

		act(() => currentEditor().setName("Renamed"));
		act(() => currentEditor().close());
		expect(currentEditor().dialog?.kind).toBe("discard-close");
		expect(backCalls).toBe(0);
		await act(async () => currentEditor().confirmDialog());
		expect(backCalls).toBe(1);

		act(() => currentEditor().createProfile());
		expect(currentEditor().dialog).toEqual({ kind: "create", value: "New profile" });
		act(() => currentEditor().setDialogValue("  Pairing  "));
		await act(async () => currentEditor().confirmDialog());
		expect(createdNames).toEqual(["Pairing"]);
		expect(currentEditor().dialog).toBeNull();
	});

	test("replaces a conflicting shortcut only after confirmation", async () => {
		const recordingChanges: boolean[] = [];
		render(
			<EditorHarness
				onBack={() => undefined}
				onCreate={async () => undefined}
				onRecordingChange={(recording) => recordingChanges.push(recording)}
				profile={createProfile()}
			/>,
		);

		act(() => {
			currentEditor().editShortcut("file.previous");
		});
		act(() => currentEditor().setDialogValue("L"));
		await act(async () => currentEditor().confirmDialog());
		expect(currentEditor().dialog).toMatchObject({
			commandId: "file.previous",
			conflictingIds: ["file.next"],
			kind: "shortcut-conflict",
		});
		expect(currentEditor().effectiveBindings["file.previous"]).toEqual([
			{ key: "h", modifiers: [] },
		]);

		await act(async () => currentEditor().confirmDialog());
		expect(currentEditor().effectiveBindings["file.previous"]).toEqual([
			{ key: "l", modifiers: [] },
		]);
		expect(currentEditor().effectiveBindings["file.next"]).toBeNull();
		expect(currentEditor().dialog).toBeNull();
		expect(recordingChanges).toContain(true);
		expect(recordingChanges.at(-1)).toBe(false);
	});
});
