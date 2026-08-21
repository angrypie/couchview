import * as Linking from "expo-linking";

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
import { formatShortcutInput } from "../features/settings/shortcutInput.ts";
import {
	type ProfileSettingsEditor,
	useProfileSettingsEditor,
} from "../features/settings/useProfileSettingsEditor.ts";
import type { ThemePreferenceController } from "../features/settings/useThemePreference.ts";
import type { VoiceCommandController } from "../features/voiceCommands/index.ts";
import { GhosttyTerminalPreview } from "../GhosttyTerminalPreview.tsx";
import { DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER } from "../typographyPreferences.ts";
import { CodexGenerationSettingsCard } from "./CodexGenerationSettingsCard.tsx";
import { SettingsEditorDialog } from "./settings/SettingsEditorDialog.tsx";
import { SettingsField, SettingsSection } from "./settings/SettingsSection.tsx";
import { SpeechInput } from "./speech";
import {
	Badge,
	Button,
	Divider,
	Heading,
	HStack,
	Radio,
	RadioGroup,
	ScrollScreen,
	Select,
	Slider,
	Switch,
	Text,
	Toolbar,
	ToolbarSpacer,
	VStack,
} from "./ui";
import { VoiceCommandSettingsCard } from "./VoiceCommandSettingsCard.tsx";

interface ProfileSettingsPageProps {
	busy: boolean;
	commandPaletteShortcut: string;
	onBack(): void;
	onCreate(name: string): Promise<void>;
	onDelete(profileId: string): Promise<void>;
	onDirtyChange(dirty: boolean): void;
	onDuplicate(profileId: string, name: string): Promise<void>;
	nativeServerManagerUrl: string | null;
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
	theme: ThemePreferenceController;
	voiceCommands: VoiceCommandController;
}

interface TypographySliderProps {
	description: string;
	format(value: number): string;
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
	label,
	max,
	min,
	onChange,
	step,
	value,
}: TypographySliderProps) {
	return (
		<SettingsField description={description} label={label} value={format(value)}>
			<Slider
				accessibilityLabel={label}
				maximumValue={max}
				minimumValue={min}
				onValueChange={onChange}
				step={step}
				value={value}
			/>
		</SettingsField>
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
		<SettingsField label={label}>
			<RadioGroup onValueChange={(next) => onChange(next as CodeFontFamily)} value={value}>
				<Radio
					description="Bundled and consistent on every device."
					label="Iosevka"
					value="iosevka"
				/>
				<Radio
					description="Uses the device’s native monospace typeface."
					label="System monospace"
					value="system"
				/>
			</RadioGroup>
		</SettingsField>
	);
}

function signedPixels(value: number): string {
	return `${value > 0 ? "+" : ""}${value}px`;
}

function SettingsToolbar({
	busy,
	commandPaletteShortcut,
	editor,
	nativeServerManagerUrl,
	onOpenCommandPalette,
}: Pick<
	ProfileSettingsPageProps,
	"busy" | "commandPaletteShortcut" | "nativeServerManagerUrl" | "onOpenCommandPalette"
> & {
	editor: ProfileSettingsEditor;
}) {
	return (
		<Toolbar className="flex-wrap" placement="inline">
			<Button onPress={editor.close} size="sm" variant="ghost">
				Review
			</Button>
			<Heading className="px-1" level={2}>
				Settings
			</Heading>
			<ToolbarSpacer className="min-w-2" />
			{nativeServerManagerUrl ? (
				<Button
					accessibilityLabel="Manage paired servers"
					onPress={() => void Linking.openURL(nativeServerManagerUrl).catch(() => undefined)}
					size="sm"
					variant="ghost"
				>
					Servers
				</Button>
			) : null}
			<Button
				accessibilityLabel={`Open command palette, ${commandPaletteShortcut}`}
				onPress={onOpenCommandPalette}
				size="sm"
				variant="ghost"
			>
				Commands · {commandPaletteShortcut}
			</Button>
			<Button disabled={!editor.dirty || busy} onPress={editor.discard} size="sm" variant="outline">
				Discard
			</Button>
			<Button disabled={!editor.dirty} loading={busy} onPress={() => void editor.save()} size="sm">
				Save changes
			</Button>
		</Toolbar>
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
		<SettingsSection
			action={
				<HStack className="flex-wrap justify-end" space="sm">
					<Button onPress={editor.createProfile} size="sm" variant="outline">
						New
					</Button>
					<Button onPress={editor.duplicateProfile} size="sm" variant="outline">
						Duplicate
					</Button>
					<Button
						disabled={profile.id === DEFAULT_SETTINGS_PROFILE_ID}
						onPress={editor.deleteProfile}
						size="sm"
						variant="destructive"
					>
						Delete
					</Button>
				</HStack>
			}
			description="Profiles are shared by this Couchview host; the selected profile stays on this device."
			title="Profiles"
		>
			<SettingsField label="Active profile">
				<Select
					accessibilityLabel="Active profile"
					onValueChange={editor.switchProfile}
					options={profiles.map((item) => ({ label: item.name, value: item.id }))}
					value={profile.id}
				/>
			</SettingsField>
			<SettingsField label="Profile name">
				<SpeechInput
					accessibilityLabel="Profile name"
					isDisabled={profile.id === DEFAULT_SETTINGS_PROFILE_ID}
					maxLength={64}
					onChangeText={editor.setName}
					value={editor.name}
				/>
			</SettingsField>
			<Button
				className="self-start"
				onPress={() => editor.resetProfile(createDefaultSettingsProfileData())}
				variant="outline"
			>
				Reset profile
			</Button>
		</SettingsSection>
	);
}

const THEME_OPTIONS = [
	{ description: "Follow this device’s appearance.", label: "System", value: "system" },
	{ description: "Always use the light interface.", label: "Light", value: "light" },
	{ description: "Always use the dark interface.", label: "Dark", value: "dark" },
] as const;

function ThemePreferencePicker({ theme }: { theme: ThemePreferenceController }) {
	return (
		<SettingsField
			description="Applies immediately on this device, independently of the active profile."
			label="Color theme"
		>
			<RadioGroup onValueChange={theme.setPreference} value={theme.preference}>
				{THEME_OPTIONS.map((option) => (
					<Radio
						description={option.description}
						key={option.value}
						label={option.label}
						value={option.value}
					/>
				))}
			</RadioGroup>
		</SettingsField>
	);
}

function previewFontFamily(fontFamily: CodeFontFamily): string {
	if (fontFamily === "iosevka") return "Iosevka";
	return process.env.EXPO_OS === "ios" ? "Menlo" : "monospace";
}

function DiffTypographyPreview({ editor }: { editor: ProfileSettingsEditor }) {
	const diff = editor.draft.typography.diff;
	const lineHeight = Math.max(
		4,
		diff.fontSize * DEFAULT_DIFF_LINE_HEIGHT_MULTIPLIER + diff.lineHeightAdjustment,
	);
	const textStyle = {
		fontFamily: previewFontFamily(diff.fontFamily),
		fontSize: diff.fontSize,
		letterSpacing: diff.widthAdjustment,
		lineHeight,
	};
	return (
		<VStack
			accessibilityLabel="Diff typography preview"
			className="overflow-hidden rounded-lg border border-border bg-muted p-3"
			space="xs"
			testID="diff-typography-preview"
		>
			<Text className="text-destructive" style={textStyle}>
				12 − const layout = browserSurface;
			</Text>
			<Text className="text-success" style={textStyle}>
				12 + const layout = universalSurface;
			</Text>
			<Text size="xs" testID="diff-column-ruler" tone="muted">
				Diff column ruler through 80
			</Text>
		</VStack>
	);
}

function AppearanceSettingsCard({
	editor,
	theme,
}: {
	editor: ProfileSettingsEditor;
	theme: ThemePreferenceController;
}) {
	const diff = editor.draft.typography.diff;
	const terminal = editor.draft.typography.terminal;
	return (
		<SettingsSection
			description="Device color theme and profile-specific typography."
			testID="appearance-settings-card"
			title="Appearance"
		>
			<ThemePreferencePicker theme={theme} />
			<Divider />
			<VStack space="lg">
				<Heading level={3}>Diff view</Heading>
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
					label="Diff font size"
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
					label="Diff line height adjustment"
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
					label="Diff width adjustment"
					onChange={(value) =>
						editor.updateDraft((next) => {
							next.typography.diff.widthAdjustment = value;
							return next;
						})
					}
					value={diff.widthAdjustment}
					{...TYPOGRAPHY_LIMITS.diff.widthAdjustment}
				/>
				<DiffTypographyPreview editor={editor} />
			</VStack>
			<Divider />
			<VStack space="lg">
				<Heading level={3}>Terminal</Heading>
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
					label="Terminal font size"
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
					label="Terminal cell height adjustment"
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
					label="Terminal cell width adjustment"
					onChange={(value) =>
						editor.updateDraft((next) => {
							next.typography.terminal.cellWidthAdjustment = value;
							return next;
						})
					}
					value={terminal.cellWidthAdjustment}
					{...TYPOGRAPHY_LIMITS.terminal.cellWidthAdjustment}
				/>
				<GhosttyTerminalPreview preferences={terminal} themeType={theme.resolvedTheme} />
			</VStack>
		</SettingsSection>
	);
}

function DisplaySettingsCard({ editor }: { editor: ProfileSettingsEditor }) {
	return (
		<SettingsSection description="Diff presentation shared by this profile." title="Display">
			<Switch
				description="Show source line numbers in diffs."
				label="Line numbers"
				onValueChange={(lineNumbersVisible) =>
					editor.updateDraft((next) => {
						next.display.lineNumbersVisible = lineNumbersVisible;
						return next;
					})
				}
				value={editor.draft.display.lineNumbersVisible}
			/>
			<Switch
				description="Keep long diff lines visible without horizontal scrolling."
				label="Wrap long lines"
				onValueChange={(lineWrapEnabled) =>
					editor.updateDraft((next) => {
						next.display.lineWrapEnabled = lineWrapEnabled;
						return next;
					})
				}
				value={editor.draft.display.lineWrapEnabled}
			/>
		</SettingsSection>
	);
}

function KeyboardSettingsCard({ editor }: { editor: ProfileSettingsEditor }) {
	return (
		<SettingsSection
			action={
				<Button
					onPress={() =>
						editor.updateDraft((next) => {
							next.keyboard.bindings = {};
							return next;
						})
					}
					size="sm"
					variant="outline"
				>
					Reset keymap
				</Button>
			}
			description="Portable shortcut editing for the shared command registry."
			title="Keyboard shortcuts"
		>
			<SettingsField label="Navigation layout">
				<RadioGroup
					onValueChange={(layout) =>
						editor.updateDraft((next) => {
							next.keyboard.layout = layout === "dvorak" ? "dvorak" : "qwerty";
							return next;
						})
					}
					orientation="horizontal"
					value={editor.draft.keyboard.layout}
				>
					<Radio label="QWERTY · H J K L" value="qwerty" />
					<Radio label="Dvorak · H T N S" value="dvorak" />
				</RadioGroup>
			</SettingsField>
			<VStack className="overflow-hidden rounded-xl border border-border" space="xs">
				{COMMAND_IDS.map((commandId, index) => {
					const definition = COMMAND_DEFINITIONS[commandId];
					return (
						<VStack
							className={index === 0 ? "p-3" : "border-t border-border p-3"}
							key={commandId}
							space="sm"
							testID={`keybinding-row-${commandId}`}
						>
							<HStack align="center" justify="between" space="sm">
								<VStack className="min-w-0 flex-1" space="xs">
									<Text bold>{definition.title}</Text>
									<Text size="xs" tone="muted">
										{definition.category}
									</Text>
								</VStack>
								<Badge variant="outline">
									{formatShortcutInput(editor.effectiveBindings[commandId])}
								</Badge>
							</HStack>
							<HStack className="flex-wrap justify-end" space="sm">
								<Button onPress={() => editor.editShortcut(commandId)} size="sm" variant="outline">
									Edit
								</Button>
								<Button
									accessibilityLabel={`Clear ${definition.title} shortcut`}
									onPress={() =>
										editor.updateDraft((next) => {
											next.keyboard.bindings[commandId] = null;
											return next;
										})
									}
									size="sm"
									variant="ghost"
								>
									Clear
								</Button>
								<Button
									accessibilityLabel={`Reset ${definition.title} shortcut`}
									disabled={!Object.hasOwn(editor.draft.keyboard.bindings, commandId)}
									onPress={() =>
										editor.updateDraft((next) => {
											delete next.keyboard.bindings[commandId];
											return next;
										})
									}
									size="sm"
									variant="ghost"
								>
									Default
								</Button>
							</HStack>
						</VStack>
					);
				})}
			</VStack>
		</SettingsSection>
	);
}

export function ProfileSettingsPage(props: ProfileSettingsPageProps) {
	const editor = useProfileSettingsEditor(props);
	return (
		<>
			<ScrollScreen
				accessibilityLabel="Settings"
				contentContainerClassName="mx-auto w-full max-w-7xl gap-4 pb-12"
				role="region"
				testID="settings-workspace"
			>
				<SettingsToolbar
					busy={props.busy}
					commandPaletteShortcut={props.commandPaletteShortcut}
					editor={editor}
					nativeServerManagerUrl={props.nativeServerManagerUrl}
					onOpenCommandPalette={props.onOpenCommandPalette}
				/>
				<ProfilePicker editor={editor} profile={props.profile} profiles={props.profiles} />
				<VStack className="gap-4 lg:flex-row lg:items-start">
					<VStack className="min-w-0 flex-1" space="lg">
						<AppearanceSettingsCard editor={editor} theme={props.theme} />
						<DisplaySettingsCard editor={editor} />
					</VStack>
					<VStack className="min-w-0 flex-1" space="lg">
						<CodexGenerationSettingsCard editor={editor} />
						<VoiceCommandSettingsCard controller={props.voiceCommands} editor={editor} />
						<KeyboardSettingsCard editor={editor} />
					</VStack>
				</VStack>
			</ScrollScreen>
			<SettingsEditorDialog busy={props.busy} editor={editor} />
		</>
	);
}
