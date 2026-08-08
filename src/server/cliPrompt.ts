import { createInterface } from "node:readline/promises";

import {
	CliPromptInterrupted,
	CliUsageError,
	type InteractivePrompter,
	type InteractiveServeDefaults,
	type InteractiveValidators,
	type ParsedServeArguments,
} from "./cliCommandTypes.ts";

export function createInteractivePrompter(): InteractivePrompter {
	const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	readline.on("SIGINT", () => {
		readline.close();
	});
	return {
		isTTY,
		async question(message) {
			try {
				return await readline.question(message);
			} catch {
				throw new CliPromptInterrupted();
			}
		},
		error(message) {
			process.stderr.write(`${message}\n`);
		},
		close() {
			readline.close();
		},
	};
}

async function askValidated<T>(
	prompter: InteractivePrompter,
	label: string,
	defaultValue: string,
	validate: (value: string) => T,
): Promise<T> {
	while (true) {
		const answer = (await prompter.question(`${label} [${defaultValue}]: `)).trim();
		try {
			return validate(answer || defaultValue);
		} catch (error) {
			prompter.error((error as Error).message);
		}
	}
}

type TerminalChoice = "automatic" | "disabled" | "websocket" | "p2p";

function defaultTerminalChoice(defaults: InteractiveServeDefaults): TerminalChoice {
	if (defaults.terminalP2pMode === "enabled") return "p2p";
	if (defaults.terminalMode === "disabled") return "disabled";
	if (defaults.terminalMode === "enabled") return "websocket";
	return "automatic";
}

function parseTerminalChoice(value: string): TerminalChoice {
	const normalized = value.trim().toLowerCase();
	const aliases: Record<string, TerminalChoice> = {
		"1": "automatic",
		a: "automatic",
		auto: "automatic",
		automatic: "automatic",
		"2": "disabled",
		d: "disabled",
		disabled: "disabled",
		"3": "websocket",
		w: "websocket",
		websocket: "websocket",
		"4": "p2p",
		p: "p2p",
		p2p: "p2p",
	};
	const choice = aliases[normalized];
	if (!choice) {
		throw new Error("Choose automatic, disabled, websocket, or p2p.");
	}
	return choice;
}

function terminalArguments(
	terminalMode: InteractiveServeDefaults["terminalMode"],
	terminalP2pMode: InteractiveServeDefaults["terminalP2pMode"],
): string[] {
	return [
		...(terminalMode === "enabled"
			? ["--enable-terminal"]
			: terminalMode === "disabled"
				? ["--disable-terminal"]
				: []),
		...(terminalP2pMode === "enabled"
			? ["--enable-terminal-p2p"]
			: terminalP2pMode === "disabled"
				? ["--disable-terminal-p2p"]
				: []),
	];
}

export async function promptForServeArguments(
	parsed: ParsedServeArguments,
	defaults: InteractiveServeDefaults,
	prompter: InteractivePrompter,
	validators: InteractiveValidators,
): Promise<string[]> {
	if (!prompter.isTTY) {
		throw new CliUsageError(
			"--interactive requires an attached terminal; remove it when running non-interactively.",
			"serve",
		);
	}

	const root = parsed.explicit.repo
		? defaults.root
		: await askValidated(prompter, "Repository", defaults.root, validators.root);
	const host = parsed.explicit.host
		? defaults.host
		: await askValidated(prompter, "Host", defaults.host, validators.host);
	const port = parsed.explicit.port
		? defaults.port
		: await askValidated(prompter, "Port", String(defaults.port), validators.port);

	let terminal = terminalArguments(defaults.terminalMode, defaults.terminalP2pMode);
	if (!parsed.explicit.terminal) {
		const defaultChoice = defaultTerminalChoice(defaults);
		const choice = await askValidated(
			prompter,
			"Terminal (automatic/disabled/websocket/p2p)",
			defaultChoice,
			parseTerminalChoice,
		);
		terminal =
			choice === "automatic"
				? []
				: choice === "disabled"
					? ["--disable-terminal", "--disable-terminal-p2p"]
					: choice === "websocket"
						? ["--enable-terminal", "--disable-terminal-p2p"]
						: ["--enable-terminal", "--enable-terminal-p2p"];
	}

	const remoteBridge = [
		...(defaults.remoteBridgeMode === "enabled"
			? ["--enable-remote-bridge"]
			: defaults.remoteBridgeMode === "disabled"
				? ["--disable-remote-bridge"]
				: []),
		...(defaults.remoteBridgeP2pMode === "enabled"
			? ["--enable-remote-bridge-p2p"]
			: defaults.remoteBridgeP2pMode === "disabled"
				? ["--disable-remote-bridge-p2p"]
				: []),
	];
	const speech =
		defaults.speechMode === "enabled"
			? ["--enable-speech"]
			: defaults.speechMode === "disabled"
				? ["--disable-speech"]
				: [];

	return [
		"--repo",
		root,
		"--host",
		host,
		"--port",
		String(port),
		...terminal,
		...remoteBridge,
		...speech,
	];
}
