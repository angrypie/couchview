import packageJson from "../../package.json" with { type: "json" };

export const CLI_VERSION = packageJson.version;

export type CliCommandName = "serve" | "restart" | "bridge" | "artifacts" | "help";
export type ArtifactCliAction = "list" | "build" | "download" | "pull";

export interface ParsedArtifactArguments {
	action: ArtifactCliAction;
	name: string | null;
	profile: string | null;
	repository: string | null;
	repo: string | null;
	build: string | null;
	output: string | null;
	force: boolean;
	json: boolean;
}

export interface ParsedServeArguments {
	repo: string | undefined;
	host: string | undefined;
	port: string | undefined;
	interactive: boolean;
	help: boolean;
	version: boolean;
	terminalMode: "enabled" | "disabled" | undefined;
	terminalP2pMode: "enabled" | "disabled" | undefined;
	remoteBridgeMode: "enabled" | "disabled" | undefined;
	remoteBridgeP2pMode: "enabled" | "disabled" | undefined;
	remoteBridgeOriginAccess: string | undefined;
	speechMode: "enabled" | "disabled" | undefined;
	voiceCommandsEnabled: boolean;
	explicit: {
		repo: boolean;
		host: boolean;
		port: boolean;
		terminal: boolean;
		remoteBridge: boolean;
		speech: boolean;
		voiceCommands: boolean;
	};
}

export interface ParsedRestartArguments {
	host: string | undefined;
	port: string | undefined;
	help: boolean;
	version: boolean;
}

export type CliInvocation =
	| {
			kind: "serve";
			argv: string[];
			parsed: ParsedServeArguments;
	  }
	| {
			kind: "restart";
			argv: string[];
			parsed: ParsedRestartArguments;
	  }
	| {
			kind: "bridge-pair";
			origin: string;
			code: string;
			originAccess: string;
	  }
	| {
			kind: "bridge-proxy";
			profileId: string;
	  }
	| {
			kind: "bridge-codex";
			profileSelector: string | null;
			repositoryRoot: string | null;
			codexArgs: string[];
	  }
	| {
			kind: "bridge-terminal";
			profileSelector: string | null;
			repositoryRoot: string | null;
	  }
	| {
			kind: "bridge-claude";
			profileSelector: string | null;
			repositoryRoot: string | null;
			claudeArgs: string[];
	  }
	| {
			kind: "artifacts";
			parsed: ParsedArtifactArguments;
	  }
	| {
			kind: "help";
			path: string[];
	  }
	| {
			kind: "version";
	  };

export class CliUsageError extends Error {
	constructor(
		message: string,
		readonly helpCommand: string | null = null,
	) {
		super(message);
		this.name = "CliUsageError";
	}
}

export class CliPromptInterrupted extends Error {
	constructor() {
		super("Interactive setup was cancelled.");
		this.name = "CliPromptInterrupted";
	}
}

export interface InteractivePrompter {
	isTTY: boolean;
	question(message: string): Promise<string>;
	error(message: string): void;
	close(): void;
}

export interface InteractiveServeDefaults {
	root: string;
	host: string;
	port: number;
	terminalMode: "auto" | "enabled" | "disabled";
	terminalP2pMode: "auto" | "enabled" | "disabled";
	remoteBridgeMode?: "auto" | "enabled" | "disabled";
	remoteBridgeP2pMode?: "auto" | "enabled" | "disabled";
	speechMode?: "auto" | "enabled" | "disabled";
}

export interface InteractiveValidators {
	root(value: string): string;
	host(value: string): string;
	port(value: string): number;
}
