import {
	ArrowLeft,
	Copy,
	Keyboard,
	Plus,
	RotateCcw,
	Save,
	Search,
	Settings2,
	SquareTerminal,
	Trash2,
	Type,
} from "lucide-react";

import {
	COMMAND_IDS,
	type CodeFontFamily,
	createDefaultSettingsProfileData,
	DEFAULT_SETTINGS_PROFILE_ID,
	type SettingsProfile,
	type SettingsProfileData,
	TYPOGRAPHY_LIMITS,
} from "../../shared/settings.ts";
import { COMMAND_DEFINITIONS } from "../commands.ts";
import {
	type ProfileSettingsEditor,
	useProfileSettingsEditor,
} from "../features/settings/useProfileSettingsEditor.ts";
import { GhosttyTerminalPreview } from "../GhosttyTerminalPreview.tsx";
import { formatShortcut } from "../shortcutEngine.ts";
import { codeFontStack, DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER } from "../typographyPreferences.ts";
import { CodexGenerationSettingsCard } from "./CodexGenerationSettingsCard.tsx";

interface ProfileSettingsPageProps {
	busy: boolean;
	commandPaletteShortcut: string;
	onBack(): void;
	onCreate(name: string): Promise<void>;
	onDelete(profileId: string): Promise<void>;
	onDirtyChange(dirty: boolean): void;
	onDuplicate(profileId: string, name: string): Promise<void>;
	onRecordingChange(recording: boolean): void;
	onOpenCommandPalette(): void;
	onSave(
		profileId: string,
		name: string,
		data: SettingsProfileData,
		expectedRevision: number,
	): Promise<void>;
	onSelect(profileId: string): void;
	profile: SettingsProfile;
	profiles: SettingsProfile[];
}

interface TypographySliderProps {
	description: string;
	format(value: number): string;
	id: string;
	label: string;
	max: number;
	min: number;
	onChange(value: number): void;
	step: number;
	value: number;
}

function TypographySlider({
	description,
	format,
	id,
	label,
	max,
	min,
	onChange,
	step,
	value,
}: TypographySliderProps) {
	return (
		<div className="settings-control">
			<div className="settings-control-heading">
				<label htmlFor={id}>{label}</label>
				<output htmlFor={id}>{format(value)}</output>
			</div>
			<input
				aria-describedby={`${id}-description`}
				id={id}
				max={max}
				min={min}
				onChange={(event) => onChange(Number(event.target.value))}
				step={step}
				type="range"
				value={value}
			/>
			<p id={`${id}-description`}>{description}</p>
		</div>
	);
}

function FontFamilyPicker({
	label,
	onChange,
	value,
}: {
	label: string;
	onChange(value: CodeFontFamily): void;
	value: CodeFontFamily;
}) {
	return (
		<fieldset className="settings-fieldset">
			<legend>{label}</legend>
			<div className="font-family-picker">
				<button
					aria-pressed={value === "iosevka"}
					className={value === "iosevka" ? "active" : ""}
					onClick={() => onChange("iosevka")}
					type="button"
				>
					<strong>Iosevka</strong>
					<span>Bundled and identical on every device</span>
				</button>
				<button
					aria-pressed={value === "system"}
					className={value === "system" ? "active" : ""}
					onClick={() => onChange("system")}
					type="button"
				>
					<strong>System monospace</strong>
					<span>Uses ui-monospace from this browser and OS</span>
				</button>
			</div>
		</fieldset>
	);
}

function signedPixels(value: number): string {
	return `${value > 0 ? "+" : ""}${value}px`;
}

function SettingsToolbar({
	busy,
	commandPaletteShortcut,
	editor,
	onOpenCommandPalette,
}: Pick<ProfileSettingsPageProps, "busy" | "commandPaletteShortcut" | "onOpenCommandPalette"> & {
	editor: ProfileSettingsEditor;
}) {
	return (
		<header className="settings-toolbar">
			<button className="terminal-toolbar-button" onClick={editor.close} type="button">
				<ArrowLeft size={16} /> Review
			</button>
			<div className="settings-heading">
				<Settings2 size={16} />
				<span>Settings</span>
			</div>
			<div className="settings-toolbar-actions">
				<button
					aria-label="Open command palette"
					className="terminal-toolbar-button command-palette-trigger"
					onClick={onOpenCommandPalette}
					type="button"
				>
					<Search size={15} />
					<span className="workspace-command-label">Commands</span>
					<kbd className="workspace-command-shortcut">{commandPaletteShortcut}</kbd>
				</button>
				<button
					className="terminal-toolbar-button"
					disabled={!editor.dirty || busy}
					onClick={editor.discard}
					type="button"
				>
					Discard
				</button>
				<button
					className="action-button settings-save-button"
					disabled={!editor.dirty || busy}
					onClick={() => void editor.save()}
					type="button"
				>
					<Save size={15} /> {busy ? "Saving…" : "Save changes"}
				</button>
			</div>
		</header>
	);
}

function ProfilePicker({
	editor,
	profile,
	profiles,
}: Pick<ProfileSettingsPageProps, "profile" | "profiles"> & {
	editor: ProfileSettingsEditor;
}) {
	return (
		<>
			<div className="settings-intro settings-profile-intro">
				<div>
					<h1>Profiles</h1>
					<p>
						Profile contents are shared by this Couchview host. This browser remembers only which
						profile is selected.
					</p>
				</div>
				<div className="settings-profile-actions">
					<button className="text-button" onClick={() => void editor.createProfile()} type="button">
						<Plus size={14} /> New
					</button>
					<button
						className="text-button"
						onClick={() => void editor.duplicateProfile()}
						type="button"
					>
						<Copy size={14} /> Duplicate
					</button>
					<button
						className="text-button danger"
						disabled={profile.id === DEFAULT_SETTINGS_PROFILE_ID}
						onClick={() => void editor.deleteProfile()}
						type="button"
					>
						<Trash2 size={14} /> Delete
					</button>
				</div>
			</div>
			<div className="settings-profile-picker">
				<label htmlFor="settings-profile">Active profile</label>
				<select
					id="settings-profile"
					onChange={(event) => editor.switchProfile(event.target.value)}
					value={profile.id}
				>
					{profiles.map((item) => (
						<option key={item.id} value={item.id}>
							{item.name}
						</option>
					))}
				</select>
				<label htmlFor="settings-profile-name">Profile name</label>
				<input
					disabled={profile.id === DEFAULT_SETTINGS_PROFILE_ID}
					id="settings-profile-name"
					maxLength={64}
					onChange={(event) => editor.setName(event.target.value)}
					value={editor.name}
				/>
				<button
					className="text-button"
					onClick={() => editor.resetProfile(createDefaultSettingsProfileData())}
					type="button"
				>
					<RotateCcw size={14} /> Reset profile
				</button>
			</div>
		</>
	);
}

function AppearanceSettingsCard({ editor }: { editor: ProfileSettingsEditor }) {
	const diff = editor.draft.typography.diff;
	const terminal = editor.draft.typography.terminal;
	const diffLineHeight = Math.max(
		4,
		diff.fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + diff.lineHeightAdjustment,
	);
	return (
		<section className="settings-card" aria-labelledby="appearance-settings-title">
			<header className="settings-card-header">
				<div className="settings-card-heading">
					<span className="settings-card-icon">
						<Type size={18} />
					</span>
					<div>
						<h2 id="appearance-settings-title">Appearance</h2>
						<p>Diff and terminal typography saved in this profile.</p>
					</div>
				</div>
			</header>
			<h3>Diff view</h3>
			<FontFamilyPicker
				label="Diff font family"
				onChange={(fontFamily) =>
					editor.updateDraft((next) => {
						next.typography.diff.fontFamily = fontFamily;
						return next;
					})
				}
				value={diff.fontFamily}
			/>
			<TypographySlider
				description="Changes glyph size without changing terminal text."
				format={(value) => `${value}px`}
				id="diff-font-size"
				label="Font size"
				onChange={(fontSize) =>
					editor.updateDraft((next) => {
						next.typography.diff.fontSize = fontSize;
						return next;
					})
				}
				value={diff.fontSize}
				{...TYPOGRAPHY_LIMITS.diff.fontSize}
			/>
			<TypographySlider
				description="Adds pixels to or removes pixels from the diff row height."
				format={signedPixels}
				id="diff-line-height-adjustment"
				label="Line height adjustment"
				onChange={(value) =>
					editor.updateDraft((next) => {
						next.typography.diff.lineHeightAdjustment = value;
						return next;
					})
				}
				value={diff.lineHeightAdjustment}
				{...TYPOGRAPHY_LIMITS.diff.lineHeightAdjustment}
			/>
			<TypographySlider
				description="Adds pixels to or removes pixels from character width."
				format={signedPixels}
				id="diff-width-adjustment"
				label="Width adjustment"
				onChange={(value) =>
					editor.updateDraft((next) => {
						next.typography.diff.widthAdjustment = value;
						return next;
					})
				}
				value={diff.widthAdjustment}
				{...TYPOGRAPHY_LIMITS.diff.widthAdjustment}
			/>
			<div
				className="typography-preview diff-typography-preview"
				data-testid="diff-typography-preview"
				style={{
					fontFamily: codeFontStack(diff.fontFamily),
					fontSize: `${diff.fontSize}px`,
					letterSpacing: `${diff.widthAdjustment}px`,
					lineHeight: `${diffLineHeight}px`,
				}}
			>
				<div className="diff-preview-lines">
					<span>
						<i>12</i>
						<b>−</b> const layout = legacyBrowser;
					</span>
					<span>
						<i>12</i>
						<b>+</b> const layout = activeProfile;
					</span>
				</div>
				<span className="sr-only" data-testid="diff-column-ruler">
					Diff column ruler through 80
				</span>
			</div>
			<h3>
				<SquareTerminal size={15} /> Terminal
			</h3>
			<FontFamilyPicker
				label="Terminal font family"
				onChange={(fontFamily) =>
					editor.updateDraft((next) => {
						next.typography.terminal.fontFamily = fontFamily;
						return next;
					})
				}
				value={terminal.fontFamily}
			/>
			<TypographySlider
				description="Sets the persistent terminal glyph size."
				format={(value) => `${value}px`}
				id="terminal-font-size"
				label="Font size"
				onChange={(fontSize) =>
					editor.updateDraft((next) => {
						next.typography.terminal.fontSize = fontSize;
						return next;
					})
				}
				value={terminal.fontSize}
				{...TYPOGRAPHY_LIMITS.terminal.fontSize}
			/>
			<TypographySlider
				description="Adds pixels to every measured terminal row."
				format={signedPixels}
				id="terminal-cell-height"
				label="Cell height adjustment"
				onChange={(value) =>
					editor.updateDraft((next) => {
						next.typography.terminal.cellHeightAdjustment = value;
						return next;
					})
				}
				value={terminal.cellHeightAdjustment}
				{...TYPOGRAPHY_LIMITS.terminal.cellHeightAdjustment}
			/>
			<TypographySlider
				description="Adds pixels to every measured terminal column."
				format={signedPixels}
				id="terminal-cell-width"
				label="Cell width adjustment"
				onChange={(value) =>
					editor.updateDraft((next) => {
						next.typography.terminal.cellWidthAdjustment = value;
						return next;
					})
				}
				value={terminal.cellWidthAdjustment}
				{...TYPOGRAPHY_LIMITS.terminal.cellWidthAdjustment}
			/>
			<GhosttyTerminalPreview preferences={terminal} />
		</section>
	);
}

function DisplaySettingsCard({ editor }: { editor: ProfileSettingsEditor }) {
	return (
		<section className="settings-card" aria-labelledby="display-settings-title">
			<header className="settings-card-header">
				<div className="settings-card-heading">
					<span className="settings-card-icon">
						<Settings2 size={18} />
					</span>
					<div>
						<h2 id="display-settings-title">Display</h2>
						<p>Diff presentation shared by this profile.</p>
					</div>
				</div>
			</header>
			<label className="settings-toggle-row">
				<span>
					<strong>Line numbers</strong>
					<small>Show source line numbers in diffs.</small>
				</span>
				<input
					checked={editor.draft.display.lineNumbersVisible}
					onChange={(event) =>
						editor.updateDraft((next) => {
							next.display.lineNumbersVisible = event.target.checked;
							return next;
						})
					}
					type="checkbox"
				/>
			</label>
			<label className="settings-toggle-row">
				<span>
					<strong>Wrap long lines</strong>
					<small>Keep long diff lines visible without horizontal scrolling.</small>
				</span>
				<input
					checked={editor.draft.display.lineWrapEnabled}
					onChange={(event) =>
						editor.updateDraft((next) => {
							next.display.lineWrapEnabled = event.target.checked;
							return next;
						})
					}
					type="checkbox"
				/>
			</label>
		</section>
	);
}

function KeyboardSettingsCard({ editor }: { editor: ProfileSettingsEditor }) {
	return (
		<section
			className="settings-card settings-keyboard-card"
			aria-labelledby="keyboard-settings-title"
		>
			<header className="settings-card-header">
				<div className="settings-card-heading">
					<span className="settings-card-icon">
						<Keyboard size={18} />
					</span>
					<div>
						<h2 id="keyboard-settings-title">Keyboard shortcuts</h2>
						<p>Palette and direct shortcuts share this command registry.</p>
					</div>
				</div>
				<button
					className="text-button"
					onClick={() =>
						editor.updateDraft((next) => {
							next.keyboard.bindings = {};
							return next;
						})
					}
					type="button"
				>
					Reset keymap
				</button>
			</header>
			<fieldset className="settings-fieldset keyboard-layout-picker">
				<legend>Navigation layout</legend>
				{(["qwerty", "dvorak"] as const).map((layout) => (
					<label key={layout}>
						<input
							checked={editor.draft.keyboard.layout === layout}
							name="keyboard-layout"
							onChange={() =>
								editor.updateDraft((next) => {
									next.keyboard.layout = layout;
									return next;
								})
							}
							type="radio"
						/>
						{layout === "qwerty" ? "QWERTY · H J K L" : "Dvorak · H T N S"}
					</label>
				))}
			</fieldset>
			<div className="keybinding-list">
				{COMMAND_IDS.map((commandId) => {
					const definition = COMMAND_DEFINITIONS[commandId];
					const isRecording = editor.recordingId === commandId;
					return (
						<div className="keybinding-row" key={commandId}>
							<span className="keybinding-copy">
								<strong>{definition.title}</strong>
								<small>{definition.category}</small>
							</span>
							<kbd>
								{isRecording
									? editor.recorded.length > 0
										? formatShortcut(editor.recorded)
										: "Type shortcut…"
									: formatShortcut(editor.effectiveBindings[commandId])}
							</kbd>
							<button
								data-shortcut-capture={isRecording ? "true" : undefined}
								onClick={() => editor.toggleRecording(commandId)}
								type="button"
							>
								{isRecording ? "Cancel" : "Record"}
							</button>
							<button
								aria-label={`Clear ${definition.title} shortcut`}
								onClick={() =>
									editor.updateDraft((next) => {
										next.keyboard.bindings[commandId] = null;
										return next;
									})
								}
								type="button"
							>
								Clear
							</button>
							<button
								aria-label={`Reset ${definition.title} shortcut`}
								disabled={!Object.hasOwn(editor.draft.keyboard.bindings, commandId)}
								onClick={() =>
									editor.updateDraft((next) => {
										delete next.keyboard.bindings[commandId];
										return next;
									})
								}
								type="button"
							>
								Default
							</button>
						</div>
					);
				})}
			</div>
		</section>
	);
}

export function ProfileSettingsPage(props: ProfileSettingsPageProps) {
	const editor = useProfileSettingsEditor(props);
	return (
		<section aria-label="Settings" className="settings-workspace">
			<SettingsToolbar
				busy={props.busy}
				commandPaletteShortcut={props.commandPaletteShortcut}
				editor={editor}
				onOpenCommandPalette={props.onOpenCommandPalette}
			/>
			<div className="settings-scroll">
				<ProfilePicker editor={editor} profile={props.profile} profiles={props.profiles} />
				<div className="settings-grid settings-profile-grid">
					<AppearanceSettingsCard editor={editor} />
					<DisplaySettingsCard editor={editor} />
					<CodexGenerationSettingsCard editor={editor} />
					<KeyboardSettingsCard editor={editor} />
				</div>
			</div>
		</section>
	);
}
