import packageJson from "../../package.json" with { type: "json" };

export const CLI_VERSION = packageJson.version;

export type CliCommandName = "serve" | "restart" | "completion" | "bridge";
export type CompletionShell = "zsh" | "bash" | "fish";

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
	explicit: {
		repo: boolean;
		host: boolean;
		port: boolean;
		terminal: boolean;
		remoteBridge: boolean;
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
			kind: "completion";
			shell: CompletionShell;
			install: boolean;
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
			kind: "help";
			command: CliCommandName | null;
	  }
	| {
			kind: "version";
	  };

export class CliUsageError extends Error {
	constructor(
		message: string,
		readonly helpCommand: CliCommandName | null = null,
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
}

export interface InteractiveValidators {
	root(value: string): string;
	host(value: string): string;
	port(value: string): number;
}
