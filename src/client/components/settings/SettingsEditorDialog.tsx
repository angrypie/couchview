import { COMMAND_DEFINITIONS } from "../../commands.ts";
import type { ProfileSettingsEditor } from "../../features/settings/useProfileSettingsEditor.ts";
import { Button, Dialog, Input, InputField, Text } from "../ui";

function dialogCopy(editor: ProfileSettingsEditor): {
	confirmLabel: string;
	description: string;
	title: string;
	variant: "destructive" | "primary";
} {
	const { dialog } = editor;
	if (!dialog) {
		return { confirmLabel: "Continue", description: "", title: "Settings", variant: "primary" };
	}
	if (dialog.kind === "create") {
		return {
			confirmLabel: "Create profile",
			description: "Create a fresh settings profile on this Couchview host.",
			title: "New profile",
			variant: "primary",
		};
	}
	if (dialog.kind === "duplicate") {
		return {
			confirmLabel: "Duplicate",
			description: "Copy the active profile and continue editing the copy.",
			title: "Duplicate profile",
			variant: "primary",
		};
	}
	if (dialog.kind === "delete") {
		return {
			confirmLabel: "Delete",
			description: "This removes the profile from the shared Couchview host.",
			title: "Delete profile?",
			variant: "destructive",
		};
	}
	if (dialog.kind === "discard-close" || dialog.kind === "discard-switch") {
		return {
			confirmLabel: "Discard changes",
			description: "Your unsaved changes to this profile will be lost.",
			title: "Discard unsaved changes?",
			variant: "destructive",
		};
	}
	if (dialog.kind === "shortcut") {
		return {
			confirmLabel: "Apply shortcut",
			description: "Use forms such as Mod+K or a sequence such as G T (up to four strokes).",
			title: `Edit ${COMMAND_DEFINITIONS[dialog.commandId].title}`,
			variant: "primary",
		};
	}
	if (dialog.kind === "shortcut-conflict") {
		return {
			confirmLabel: "Replace shortcuts",
			description: `This conflicts with ${dialog.conflictingIds
				.map((commandId) => COMMAND_DEFINITIONS[commandId].title)
				.join(", ")}. Continuing clears the conflicting bindings.`,
			title: "Replace conflicting shortcuts?",
			variant: "destructive",
		};
	}
	return {
		confirmLabel: "OK",
		description: dialog.message,
		title: "Settings could not be updated",
		variant: "primary",
	};
}

export function SettingsEditorDialog({
	busy,
	editor,
}: {
	busy: boolean;
	editor: ProfileSettingsEditor;
}) {
	const copy = dialogCopy(editor);
	const dialog = editor.dialog;
	const hasTextInput = dialog?.kind === "create" || dialog?.kind === "duplicate";
	const hasShortcutInput = dialog?.kind === "shortcut";
	const confirmDisabled =
		busy || ((hasTextInput || hasShortcutInput) && dialog.value.trim().length === 0);
	const errorOnly = dialog?.kind === "error";

	return (
		<Dialog
			description={copy.description}
			dismissible={!busy}
			footer={
				<>
					{errorOnly ? null : (
						<Button disabled={busy} onPress={editor.dismissDialog} variant="outline">
							Cancel
						</Button>
					)}
					<Button
						disabled={confirmDisabled}
						loading={busy}
						onPress={() => void editor.confirmDialog()}
						variant={copy.variant}
					>
						{copy.confirmLabel}
					</Button>
				</>
			}
			onOpenChange={(open) => {
				if (!open) editor.dismissDialog();
			}}
			open={dialog !== null}
			title={copy.title}
		>
			{hasTextInput || hasShortcutInput ? (
				<Input>
					<InputField
						accessibilityLabel={hasShortcutInput ? "Shortcut" : "Profile name"}
						autoCapitalize="none"
						autoCorrect={false}
						autoFocus
						maxLength={hasShortcutInput ? 128 : 64}
						onChangeText={editor.setDialogValue}
						onSubmitEditing={() => void editor.confirmDialog()}
						returnKeyType="done"
						value={dialog.value}
					/>
				</Input>
			) : null}
			{dialog?.kind === "shortcut" && dialog.error ? (
				<Text accessibilityRole="alert" size="sm" tone="destructive">
					{dialog.error}
				</Text>
			) : null}
		</Dialog>
	);
}
