import type { LucideIcon } from "lucide-react-native";
import {
	Archive,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	FileCode2,
	FolderGit2,
	GitCommitHorizontal,
	GitGraph,
	GitPullRequestArrow,
	ListTree,
	MonitorUp,
	Search,
	Settings2,
	SquareTerminal,
	TerminalSquare,
} from "lucide-react-native";

import type { CommandId, ShortcutSequence } from "../shared/settings.ts";
import { VOICE_COMMAND_POLICIES, type VoiceCommandPolicy } from "../shared/voiceCommands.ts";

export type CommandCategory = "Go to" | "Actions" | "Navigate";

export interface CommandMetadata {
	id: CommandId;
	title: string;
	category: CommandCategory;
	keywords: string[];
	icon: LucideIcon;
	repeatable: boolean;
	paletteVisible: boolean;
	voicePolicy: VoiceCommandPolicy;
}

export interface RuntimeCommand extends CommandMetadata {
	binding: ShortcutSequence | null;
	enabled: boolean;
	disabledReason: string | null;
	perform(): boolean | void;
}

export const COMMAND_DEFINITIONS: Record<CommandId, CommandMetadata> = {
	"palette.open": {
		id: "palette.open",
		title: "Open command palette",
		category: "Go to",
		keywords: ["command", "menu", "search"],
		icon: Search,
		repeatable: false,
		paletteVisible: false,
		voicePolicy: VOICE_COMMAND_POLICIES["palette.open"],
	},
	"navigate.review": {
		id: "navigate.review",
		title: "Go to diff review",
		category: "Go to",
		keywords: ["review", "diff", "changes"],
		icon: FileCode2,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["navigate.review"],
	},
	"navigate.history": {
		id: "navigate.history",
		title: "Go to Git history",
		category: "Go to",
		keywords: ["history", "commits", "log", "graph", "git"],
		icon: GitGraph,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["navigate.history"],
	},
	"navigate.artifacts": {
		id: "navigate.artifacts",
		title: "Go to artifacts",
		category: "Go to",
		keywords: ["artifact", "build", "download", "binary", "application"],
		icon: Archive,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["navigate.artifacts"],
	},
	"navigate.terminal": {
		id: "navigate.terminal",
		title: "Go to terminal",
		category: "Go to",
		keywords: ["tmux", "shell", "console"],
		icon: SquareTerminal,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["navigate.terminal"],
	},
	"navigate.remote": {
		id: "navigate.remote",
		title: "Open native remote",
		category: "Go to",
		keywords: ["remote", "zed", "native", "ide"],
		icon: MonitorUp,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["navigate.remote"],
	},
	"navigate.settings": {
		id: "navigate.settings",
		title: "Go to settings",
		category: "Go to",
		keywords: ["preferences", "profile", "keybindings", "appearance"],
		icon: Settings2,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["navigate.settings"],
	},
	"repository.switch": {
		id: "repository.switch",
		title: "Switch repository",
		category: "Go to",
		keywords: ["repository", "project", "git", "switch"],
		icon: FolderGit2,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["repository.switch"],
	},
	"panel.files": {
		id: "panel.files",
		title: "Open changed files",
		category: "Go to",
		keywords: ["drawer", "files", "changes"],
		icon: ListTree,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["panel.files"],
	},
	"panel.packageCommands": {
		id: "panel.packageCommands",
		title: "Open package commands",
		category: "Go to",
		keywords: ["scripts", "package", "run", "commands"],
		icon: TerminalSquare,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["panel.packageCommands"],
	},
	"search.open": {
		id: "search.open",
		title: "Search repository",
		category: "Actions",
		keywords: ["find", "code", "text"],
		icon: Search,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["search.open"],
	},
	"commit.open": {
		id: "commit.open",
		title: "Commit staged changes",
		category: "Actions",
		keywords: ["git", "commit", "staged"],
		icon: GitCommitHorizontal,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["commit.open"],
	},
	"file.toggleStage": {
		id: "file.toggleStage",
		title: "Toggle staged for current file",
		category: "Actions",
		keywords: ["git", "add", "stage", "unstage"],
		icon: GitPullRequestArrow,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["file.toggleStage"],
	},
	"file.toggleReviewed": {
		id: "file.toggleReviewed",
		title: "Toggle reviewed for current file",
		category: "Actions",
		keywords: ["review", "mark", "unreview"],
		icon: CheckCircle2,
		repeatable: false,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["file.toggleReviewed"],
	},
	"file.previous": {
		id: "file.previous",
		title: "Previous file",
		category: "Navigate",
		keywords: ["back", "previous", "file"],
		icon: ChevronLeft,
		repeatable: true,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["file.previous"],
	},
	"file.next": {
		id: "file.next",
		title: "Next file",
		category: "Navigate",
		keywords: ["forward", "next", "file"],
		icon: ChevronRight,
		repeatable: true,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["file.next"],
	},
	"hunk.previous": {
		id: "hunk.previous",
		title: "Previous hunk",
		category: "Navigate",
		keywords: ["back", "previous", "diff", "hunk"],
		icon: ChevronUp,
		repeatable: true,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["hunk.previous"],
	},
	"hunk.next": {
		id: "hunk.next",
		title: "Next hunk",
		category: "Navigate",
		keywords: ["forward", "next", "diff", "hunk"],
		icon: ChevronDown,
		repeatable: true,
		paletteVisible: true,
		voicePolicy: VOICE_COMMAND_POLICIES["hunk.next"],
	},
};

export const COMMAND_CATEGORIES: readonly CommandCategory[] = ["Go to", "Actions", "Navigate"];
