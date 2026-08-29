import type { CommandId, ShortcutStroke } from "./settings.ts";

export const VOICE_COMMAND_MODEL = "Cactus-Compute/needle2";
export const VOICE_COMMAND_MAX_RECORDING_MS = 20_000;
export const VOICE_COMMAND_AUTO_EXECUTE_CONFIDENCE = 0.5;
export const VOICE_PUSH_TO_TALK_STROKE: ShortcutStroke = { key: "v", modifiers: [] };
export const VOICE_TOGGLE_STROKE: ShortcutStroke = { key: "v", modifiers: ["shift"] };
export const VOICE_KEYBOARD_STROKES = [VOICE_PUSH_TO_TALK_STROKE, VOICE_TOGGLE_STROKE] as const;

export type VoiceCommandRisk = "navigation" | "reversible" | "dangerous";

export type VoiceCommandPolicy =
	| {
			supported: true;
			risk: VoiceCommandRisk;
	  }
	| {
			supported: false;
			risk: "unsupported";
			reason: string;
	  };

export const VOICE_COMMAND_POLICIES = {
	"palette.open": { supported: true, risk: "navigation" },
	"navigate.review": { supported: true, risk: "navigation" },
	"navigate.history": { supported: true, risk: "navigation" },
	"navigate.artifacts": { supported: true, risk: "navigation" },
	"navigate.terminal": { supported: true, risk: "navigation" },
	"navigate.remote": { supported: true, risk: "navigation" },
	"navigate.settings": { supported: true, risk: "navigation" },
	"repository.switch": { supported: true, risk: "navigation" },
	"panel.files": { supported: true, risk: "navigation" },
	"panel.packageCommands": { supported: true, risk: "navigation" },
	"search.open": { supported: true, risk: "navigation" },
	"commit.open": { supported: true, risk: "navigation" },
	"file.open": { supported: true, risk: "navigation" },
	"file.toggleStage": { supported: true, risk: "reversible" },
	"file.toggleReviewed": { supported: true, risk: "reversible" },
	"file.previous": { supported: true, risk: "navigation" },
	"file.next": { supported: true, risk: "navigation" },
	"hunk.previous": { supported: true, risk: "navigation" },
	"hunk.next": { supported: true, risk: "navigation" },
} as const satisfies Record<CommandId, VoiceCommandPolicy>;

export const VOICE_ACTION_IDS = [
	"palette.open",
	"navigate.review",
	"navigate.history",
	"navigate.artifacts",
	"navigate.terminal",
	"navigate.remote",
	"navigate.settings",
	"repository.switch",
	"panel.files",
	"panel.packageCommands",
	"search.open",
	"commit.open",
	"file.open",
	"file.stage",
	"file.unstage",
	"file.markReviewed",
	"file.markUnreviewed",
	"file.previous",
	"file.next",
	"hunk.previous",
	"hunk.next",
] as const;

export type VoiceActionId = (typeof VOICE_ACTION_IDS)[number];

export interface VoiceActionDefinition {
	id: VoiceActionId;
	toolName: string;
	commandId: CommandId;
	title: string;
	description: string;
	risk: VoiceCommandRisk;
	contextual: boolean;
}

export const VOICE_ACTION_DEFINITIONS: Record<VoiceActionId, VoiceActionDefinition> = {
	"palette.open": {
		id: "palette.open",
		toolName: "open_action_palette",
		commandId: "palette.open",
		title: "Open command palette",
		description: "Open the Couchview action palette.",
		risk: "navigation",
		contextual: false,
	},
	"navigate.review": {
		id: "navigate.review",
		toolName: "open_review",
		commandId: "navigate.review",
		title: "Open review",
		description: "Open the diff review workspace. Does not mark a file as reviewed.",
		risk: "navigation",
		contextual: false,
	},
	"navigate.history": {
		id: "navigate.history",
		toolName: "open_git_history",
		commandId: "navigate.history",
		title: "Open Git history",
		description: "Navigate to the Git commit history and repository actions workspace.",
		risk: "navigation",
		contextual: false,
	},
	"navigate.artifacts": {
		id: "navigate.artifacts",
		toolName: "open_artifacts",
		commandId: "navigate.artifacts",
		title: "Open artifacts",
		description: "Navigate to repository artifacts.",
		risk: "navigation",
		contextual: false,
	},
	"navigate.terminal": {
		id: "navigate.terminal",
		toolName: "open_terminal_screen",
		commandId: "navigate.terminal",
		title: "Open terminal",
		description: "Open the Couchview terminal screen.",
		risk: "navigation",
		contextual: false,
	},
	"navigate.remote": {
		id: "navigate.remote",
		toolName: "open_native_remote",
		commandId: "navigate.remote",
		title: "Open native remote",
		description: "Open native remote development controls.",
		risk: "navigation",
		contextual: false,
	},
	"navigate.settings": {
		id: "navigate.settings",
		toolName: "open_settings",
		commandId: "navigate.settings",
		title: "Open settings",
		description: "Navigate to application settings.",
		risk: "navigation",
		contextual: false,
	},
	"repository.switch": {
		id: "repository.switch",
		toolName: "switch_repository",
		commandId: "repository.switch",
		title: "Switch repository",
		description: "Open the repository or project picker.",
		risk: "navigation",
		contextual: false,
	},
	"panel.files": {
		id: "panel.files",
		toolName: "open_changed_files",
		commandId: "panel.files",
		title: "Open changed files",
		description: "Open the changed-files panel.",
		risk: "navigation",
		contextual: false,
	},
	"panel.packageCommands": {
		id: "panel.packageCommands",
		toolName: "open_package_commands",
		commandId: "panel.packageCommands",
		title: "Open package commands",
		description:
			"Open the package-command panel listing package scripts or npm commands. Does not run a command.",
		risk: "navigation",
		contextual: false,
	},
	"search.open": {
		id: "search.open",
		toolName: "open_repository_search",
		commandId: "search.open",
		title: "Search repository",
		description: "Open repository search for finding code or text.",
		risk: "navigation",
		contextual: false,
	},
	"commit.open": {
		id: "commit.open",
		toolName: "open_commit_composer",
		commandId: "commit.open",
		title: "Open commit composer",
		description: "Open the commit composer without committing.",
		risk: "navigation",
		contextual: false,
	},
	"file.open": {
		id: "file.open",
		toolName: "open_project_file_picker",
		commandId: "file.open",
		title: "Go to file",
		description: "Open the current project's fuzzy file picker.",
		risk: "navigation",
		contextual: false,
	},
	"file.stage": {
		id: "file.stage",
		toolName: "stage_current_file",
		commandId: "file.toggleStage",
		title: "Stage current file",
		description: "Stage the current changed file. Do not choose this for unstage requests.",
		risk: "reversible",
		contextual: true,
	},
	"file.unstage": {
		id: "file.unstage",
		toolName: "unstage_current_file",
		commandId: "file.toggleStage",
		title: "Unstage current file",
		description: "Unstage the current changed file. Do not choose this for stage requests.",
		risk: "reversible",
		contextual: true,
	},
	"file.markReviewed": {
		id: "file.markReviewed",
		toolName: "review_current_file",
		commandId: "file.toggleReviewed",
		title: "Mark current file reviewed",
		description:
			"Review the current file or mark it reviewed. Completes review without opening the workspace.",
		risk: "reversible",
		contextual: true,
	},
	"file.markUnreviewed": {
		id: "file.markUnreviewed",
		toolName: "unreview_current_file",
		commandId: "file.toggleReviewed",
		title: "Mark current file unreviewed",
		description: "Undo review completion for the current file.",
		risk: "reversible",
		contextual: true,
	},
	"file.previous": {
		id: "file.previous",
		toolName: "open_previous_file",
		commandId: "file.previous",
		title: "Previous file",
		description: "Navigate to the previous changed file.",
		risk: "navigation",
		contextual: false,
	},
	"file.next": {
		id: "file.next",
		toolName: "open_next_file",
		commandId: "file.next",
		title: "Next file",
		description: "Navigate to the next changed file.",
		risk: "navigation",
		contextual: false,
	},
	"hunk.previous": {
		id: "hunk.previous",
		toolName: "open_previous_hunk",
		commandId: "hunk.previous",
		title: "Previous hunk",
		description: "Navigate to the previous diff hunk.",
		risk: "navigation",
		contextual: false,
	},
	"hunk.next": {
		id: "hunk.next",
		toolName: "open_next_hunk",
		commandId: "hunk.next",
		title: "Next hunk",
		description: "Navigate to the next diff hunk.",
		risk: "navigation",
		contextual: false,
	},
};

export function voiceActionIdIsValid(value: unknown): value is VoiceActionId {
	return typeof value === "string" && (VOICE_ACTION_IDS as readonly string[]).includes(value);
}
