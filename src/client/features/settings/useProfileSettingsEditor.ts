import { useEffect, useMemo, useRef, useState } from "react";

import {
	type CommandId,
	DEFAULT_SETTINGS_PROFILE_ID,
	effectiveKeybindings,
	keybindingConflicts,
	paletteShortcutHasRequiredModifier,
	parseSettingsProfileData,
	type SettingsProfile,
	type SettingsProfileData,
	type ShortcutSequence,
} from "../../../shared/settings.ts";
import { formatShortcutInput, parseShortcutInput } from "./shortcutInput.ts";

export interface ProfileSettingsEditorOptions {
	onBack(): void;
	onCreate(name: string): Promise<void>;
	onDelete(profileId: string): Promise<void>;
	onDirtyChange(dirty: boolean): void;
	onDuplicate(profileId: string, name: string): Promise<void>;
	onRecordingChange(recording: boolean): void;
	onSave(
		profileId: string,
		name: string,
		data: SettingsProfileData,
		expectedRevision: number,
	): Promise<void>;
	onSelect(profileId: string): void;
	profile: SettingsProfile;
}

export type ProfileSettingsDialog =
	| { kind: "create"; value: string }
	| { kind: "delete" }
	| { kind: "discard-close" }
	| { kind: "discard-switch"; profileId: string }
	| { kind: "duplicate"; value: string }
	| { kind: "error"; message: string }
	| {
			kind: "shortcut";
			commandId: CommandId;
			value: string;
			error: string | null;
	  }
	| {
			kind: "shortcut-conflict";
			commandId: CommandId;
			binding: ShortcutSequence;
			conflictingIds: CommandId[];
	  };

function cloneData(data: SettingsProfileData): SettingsProfileData {
	return structuredClone(data);
}

function dataEqual(left: SettingsProfileData, right: SettingsProfileData): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

export function useProfileSettingsEditor({
	onBack,
	onCreate,
	onDelete,
	onDirtyChange,
	onDuplicate,
	onRecordingChange,
	onSave,
	onSelect,
	profile,
}: ProfileSettingsEditorOptions) {
	const [draft, setDraft] = useState(() => cloneData(profile.data));
	const [name, setName] = useState(profile.name);
	const [dialog, setDialog] = useState<ProfileSettingsDialog | null>(null);
	const profileBaseRef = useRef(profile);
	const dirty = name !== profile.name || !dataEqual(draft, profile.data);
	const effectiveBindings = useMemo(() => effectiveKeybindings(draft.keyboard), [draft.keyboard]);
	const editingShortcut = dialog?.kind === "shortcut" || dialog?.kind === "shortcut-conflict";

	useEffect(() => {
		const previous = profileBaseRef.current;
		const hadLocalChanges = name !== previous.name || !dataEqual(draft, previous.data);
		if (profile.id !== previous.id || !hadLocalChanges) {
			setDraft(cloneData(profile.data));
			setName(profile.name);
			setDialog(null);
		}
		profileBaseRef.current = profile;
	}, [profile.id, profile.revision]);
	useEffect(() => {
		onDirtyChange(dirty);
	}, [dirty, onDirtyChange]);
	useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
	useEffect(() => {
		onRecordingChange(editingShortcut);
		return () => onRecordingChange(false);
	}, [editingShortcut, onRecordingChange]);

	const updateDraft = (update: (current: SettingsProfileData) => SettingsProfileData) => {
		setDraft((current) => update(cloneData(current)));
	};

	const applyShortcut = (
		commandId: CommandId,
		binding: ShortcutSequence,
		replaceConflicts = false,
	) => {
		const next = cloneData(draft);
		next.keyboard.bindings[commandId] = binding;
		const conflicts = keybindingConflicts(effectiveKeybindings(next.keyboard)).filter(
			(conflict) => conflict.first === commandId || conflict.second === commandId,
		);
		const conflictingIds = [
			...new Set(
				conflicts.flatMap((conflict) =>
					[conflict.first, conflict.second].filter((id) => id !== commandId),
				),
			),
		];
		if (conflictingIds.length > 0 && !replaceConflicts) {
			setDialog({ kind: "shortcut-conflict", commandId, binding, conflictingIds });
			return;
		}
		for (const conflictingId of conflictingIds) next.keyboard.bindings[conflictingId] = null;
		setDraft(next);
		setDialog(null);
	};

	const confirmDialog = async () => {
		if (!dialog) return;
		try {
			if (dialog.kind === "create") {
				const value = dialog.value.trim();
				if (!value) return;
				await onCreate(value);
				setDialog(null);
				return;
			}
			if (dialog.kind === "duplicate") {
				const value = dialog.value.trim();
				if (!value) return;
				await onDuplicate(profile.id, value);
				setDialog(null);
				return;
			}
			if (dialog.kind === "delete") {
				await onDelete(profile.id);
				setDialog(null);
				return;
			}
			if (dialog.kind === "discard-close") {
				setDialog(null);
				onDirtyChange(false);
				onBack();
				return;
			}
			if (dialog.kind === "discard-switch") {
				setDialog(null);
				onSelect(dialog.profileId);
				return;
			}
			if (dialog.kind === "shortcut") {
				let binding: ShortcutSequence;
				try {
					binding = parseShortcutInput(dialog.value);
				} catch (error) {
					setDialog({ ...dialog, error: errorMessage(error, "Enter a valid shortcut.") });
					return;
				}
				if (dialog.commandId === "palette.open" && !paletteShortcutHasRequiredModifier(binding)) {
					setDialog({ ...dialog, error: "The command palette shortcut must begin with Mod." });
					return;
				}
				applyShortcut(dialog.commandId, binding);
				return;
			}
			if (dialog.kind === "shortcut-conflict") {
				applyShortcut(dialog.commandId, dialog.binding, true);
				return;
			}
			setDialog(null);
		} catch (error) {
			setDialog({ kind: "error", message: errorMessage(error, "Settings could not be updated.") });
		}
	};

	const switchProfile = (profileId: string) => {
		if (profileId === profile.id) return;
		if (dirty) setDialog({ kind: "discard-switch", profileId });
		else onSelect(profileId);
	};
	const close = () => {
		if (dirty) setDialog({ kind: "discard-close" });
		else onBack();
	};
	const save = async () => {
		try {
			await onSave(profile.id, name, parseSettingsProfileData(draft), profile.revision);
		} catch (error) {
			setDialog({ kind: "error", message: errorMessage(error, "Settings could not be saved.") });
		}
	};

	return {
		close,
		confirmDialog,
		createProfile: () => setDialog({ kind: "create", value: "New profile" }),
		deleteProfile: () => {
			if (profile.id !== DEFAULT_SETTINGS_PROFILE_ID) setDialog({ kind: "delete" });
		},
		dialog,
		dirty,
		discard: () => {
			setDraft(cloneData(profile.data));
			setName(profile.name);
			setDialog(null);
		},
		dismissDialog: () => setDialog(null),
		draft,
		duplicateProfile: () => setDialog({ kind: "duplicate", value: `${profile.name} copy` }),
		editShortcut: (commandId: CommandId) =>
			setDialog({
				kind: "shortcut",
				commandId,
				value:
					effectiveBindings[commandId] === null
						? ""
						: formatShortcutInput(effectiveBindings[commandId]),
				error: null,
			}),
		effectiveBindings,
		name,
		resetProfile: (data: SettingsProfileData) => setDraft(cloneData(data)),
		save,
		setDialogValue: (value: string) =>
			setDialog((current) => {
				if (!current) return null;
				if (current.kind === "create" || current.kind === "duplicate") {
					return { ...current, value };
				}
				if (current.kind === "shortcut") return { ...current, value, error: null };
				return current;
			}),
		setName,
		switchProfile,
		updateDraft,
	};
}

export type ProfileSettingsEditor = ReturnType<typeof useProfileSettingsEditor>;
