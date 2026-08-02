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
import { COMMAND_DEFINITIONS } from "../../commands.ts";
import { shortcutStrokeFromEvent } from "../../shortcutEngine.ts";

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

function cloneData(data: SettingsProfileData): SettingsProfileData {
	return structuredClone(data);
}

function dataEqual(left: SettingsProfileData, right: SettingsProfileData): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function commandName(commandId: CommandId): string {
	return COMMAND_DEFINITIONS[commandId].title;
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
	const [recordingId, setRecordingId] = useState<CommandId | null>(null);
	const [recorded, setRecorded] = useState<ShortcutSequence>([]);
	const recordingTimerRef = useRef<number | null>(null);
	const recordedRef = useRef<ShortcutSequence>([]);
	const profileBaseRef = useRef(profile);
	const applyRecordedRef = useRef<(commandId: CommandId, binding: ShortcutSequence) => void>(
		() => undefined,
	);
	const dirty = name !== profile.name || !dataEqual(draft, profile.data);
	const effectiveBindings = useMemo(() => effectiveKeybindings(draft.keyboard), [draft.keyboard]);

	useEffect(() => {
		const previous = profileBaseRef.current;
		const hadLocalChanges = name !== previous.name || !dataEqual(draft, previous.data);
		if (profile.id !== previous.id || !hadLocalChanges) {
			setDraft(cloneData(profile.data));
			setName(profile.name);
			setRecordingId(null);
			setRecorded([]);
		}
		profileBaseRef.current = profile;
	}, [profile.id, profile.revision]);
	useEffect(() => {
		onDirtyChange(dirty);
	}, [dirty, onDirtyChange]);
	useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
	useEffect(() => {
		onRecordingChange(recordingId !== null);
		return () => onRecordingChange(false);
	}, [onRecordingChange, recordingId]);

	const updateDraft = (update: (current: SettingsProfileData) => SettingsProfileData) => {
		setDraft((current) => update(cloneData(current)));
	};

	const applyRecorded = (commandId: CommandId, binding: ShortcutSequence) => {
		if (commandId === "palette.open" && !paletteShortcutHasRequiredModifier(binding)) {
			window.alert("The command palette shortcut must begin with a modifier.");
			return;
		}
		const next = cloneData(draft);
		next.keyboard.bindings[commandId] = binding;
		const conflicts = keybindingConflicts(effectiveKeybindings(next.keyboard)).filter(
			(conflict) => conflict.first === commandId || conflict.second === commandId,
		);
		if (conflicts.length > 0) {
			const conflictingIds = [
				...new Set(
					conflicts.flatMap((conflict) =>
						[conflict.first, conflict.second].filter((id) => id !== commandId),
					),
				),
			];
			const replace = window.confirm(
				`This conflicts with ${conflictingIds.map(commandName).join(", ")}. Replace the existing binding?`,
			);
			if (!replace) return;
			for (const conflictingId of conflictingIds) {
				next.keyboard.bindings[conflictingId] = null;
			}
		}
		setDraft(next);
	};
	applyRecordedRef.current = applyRecorded;

	useEffect(() => {
		if (!recordingId) return;
		const finish = (binding: ShortcutSequence) => {
			if (recordingTimerRef.current !== null) {
				window.clearTimeout(recordingTimerRef.current);
				recordingTimerRef.current = null;
			}
			if (binding.length > 0) applyRecordedRef.current(recordingId, binding);
			setRecordingId(null);
			recordedRef.current = [];
			setRecorded([]);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setRecordingId(null);
				recordedRef.current = [];
				setRecorded([]);
				return;
			}
			const stroke = shortcutStrokeFromEvent(event);
			if (!stroke || event.repeat) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const next = [...recordedRef.current, stroke].slice(0, 4);
			recordedRef.current = next;
			setRecorded(next);
			if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
			if (next.length === 4) {
				finish(next);
			} else {
				recordingTimerRef.current = window.setTimeout(() => finish(next), 1_000);
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
			recordingTimerRef.current = null;
		};
	}, [recordingId]);

	const switchProfile = (profileId: string) => {
		if (profileId === profile.id) return;
		if (dirty && !window.confirm("Discard unsaved profile changes?")) return;
		onSelect(profileId);
	};
	const close = () => {
		if (dirty && !window.confirm("Discard unsaved profile changes?")) return;
		onBack();
	};
	const save = async () => {
		try {
			await onSave(profile.id, name, parseSettingsProfileData(draft), profile.revision);
		} catch (error) {
			window.alert(error instanceof Error ? error.message : "Settings could not be saved.");
		}
	};
	const createProfile = async () => {
		const createdName = window.prompt("New profile name", "New profile");
		if (!createdName?.trim()) return;
		try {
			await onCreate(createdName);
		} catch (error) {
			window.alert(error instanceof Error ? error.message : "Profile could not be created.");
		}
	};
	const duplicateProfile = async () => {
		const duplicatedName = window.prompt("Duplicate profile name", `${profile.name} copy`);
		if (!duplicatedName?.trim()) return;
		try {
			await onDuplicate(profile.id, duplicatedName);
		} catch (error) {
			window.alert(error instanceof Error ? error.message : "Profile could not be duplicated.");
		}
	};
	const deleteProfile = async () => {
		if (
			profile.id !== DEFAULT_SETTINGS_PROFILE_ID &&
			window.confirm(`Delete the “${profile.name}” profile?`)
		) {
			try {
				await onDelete(profile.id);
			} catch (error) {
				window.alert(error instanceof Error ? error.message : "Profile could not be deleted.");
			}
		}
	};
	const toggleRecording = (commandId: CommandId) => {
		recordedRef.current = [];
		setRecorded([]);
		setRecordingId(recordingId === commandId ? null : commandId);
	};

	return {
		close,
		createProfile,
		deleteProfile,
		dirty,
		discard: () => {
			setDraft(cloneData(profile.data));
			setName(profile.name);
		},
		draft,
		duplicateProfile,
		effectiveBindings,
		name,
		recorded,
		recordingId,
		resetProfile: (data: SettingsProfileData) => setDraft(cloneData(data)),
		save,
		setName,
		switchProfile,
		toggleRecording,
		updateDraft,
	};
}

export type ProfileSettingsEditor = ReturnType<typeof useProfileSettingsEditor>;
